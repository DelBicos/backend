import { AppointmentModel } from "../../models/Appointment";
import {
  AppointmentAuditLogModel,
  AuditLogAction,
} from "../../models/AppointmentAuditLog";
import { AdminModel } from "../../models/Admin";
import { UserModel } from "../../models/User";
import { NotificationModel } from "../../models/Notification";
import { sequelize } from "../../config/database";
import { emitAppointmentStatusUpdate } from "../../realtime/chatSocket";
import {
  calculateDistanceInMeters,
  MAX_ARRIVAL_DISTANCE_METERS,
  validateArrivedDistance,
  validateInTransitTransition,
  validateArrivedTransition,
  validateCheckinTransition,
  validateCheckoutTransition,
  canAccessAuditTrailRule,
} from "./checkin.rules";

export {
  calculateDistanceInMeters,
  MAX_ARRIVAL_DISTANCE_METERS,
  validateArrivedDistance,
};

export interface AppointmentWithRelations extends AppointmentModel {
  Client?: {
    id: number;
    user_id: number;
    User?: {
      id: number;
      name: string;
      avatar_uri?: string;
      phone?: string;
      email?: string;
    };
  };
  Professional?: {
    id: number;
    user_id: number;
    User?: {
      id: number;
      name: string;
      avatar_uri?: string;
      phone?: string;
      email?: string;
    };
  };
  Service?: {
    id: number;
    title: string;
    price: string;
  };
  Address?: {
    id: number;
    lat?: number | null;
    lng?: number | null;
  };
}

/**
 * Aplica a transição de status e grava o log de auditoria na mesma transação.
 * O WHERE com o status anterior impede que duas requisições simultâneas façam a
 * mesma transição: a segunda não afeta nenhuma linha e recebe `false`.
 */
export const applyStatusTransitionWithAudit = (
  appointmentId: number,
  fromStatus: AppointmentModel["status"],
  changes: {
    status: AppointmentModel["status"];
    started_at?: Date;
    completed_at?: Date;
  },
  audit: {
    user_id: number;
    action: AuditLogAction;
    metadata: Record<string, unknown>;
  },
): Promise<boolean> =>
  sequelize.transaction(async (transaction) => {
    const [affected] = await AppointmentModel.update(changes, {
      where: { id: appointmentId, status: fromStatus },
      transaction,
    });
    if (affected === 0) return false;

    await AppointmentAuditLogModel.create(
      {
        appointment_id: appointmentId,
        user_id: audit.user_id,
        action: audit.action,
        from_status: fromStatus,
        to_status: changes.status,
        metadata: JSON.stringify(audit.metadata),
      },
      { transaction },
    );
    return true;
  });

export type InTransitProcessResult =
  | { success: true; appointment: AppointmentWithRelations }
  | { success: false; status: 400 | 403; error: string };

export async function processAppointmentInTransit(
  appointment: AppointmentWithRelations,
  userId: number,
): Promise<InTransitProcessResult> {
  const ruleCheck = validateInTransitTransition(
    appointment.status,
    appointment.Professional?.user_id,
    userId,
  );

  if (!ruleCheck.valid) {
    return {
      success: false,
      status: ruleCheck.status,
      error: ruleCheck.error,
    };
  }

  const previousStatus = appointment.status;
  appointment.status = "in_transit";

  await sequelize.transaction(async (transaction) => {
    await appointment.save({ transaction });
    await AppointmentAuditLogModel.create(
      {
        appointment_id: appointment.id,
        user_id: userId,
        action: "status_change",
        from_status: previousStatus,
        to_status: "in_transit",
        metadata: JSON.stringify({ marked_in_transit_at: new Date() }),
      },
      { transaction },
    );
  });

  const clientUser = appointment.Client?.User;
  const profUser = appointment.Professional?.User;
  const service = appointment.Service;

  if (clientUser) {
    await sendAppointmentStatusNotification(
      appointment,
      "in_transit",
      "Profissional a caminho! 🚗",
      `O profissional ${profUser?.name || ""} informou que está a caminho do seu local para o serviço '${service?.title || ""}'.`,
    );
  }

  return { success: true, appointment };
}

export type ArrivedProcessResult =
  | { success: true; code: string | null | undefined }
  | {
      success: false;
      status: 400 | 403;
      error: string;
      distance?: number;
      maxDistance?: number;
    };

export async function processAppointmentArrived(
  appointment: AppointmentWithRelations,
  userId: number,
  latitude: number,
  longitude: number,
): Promise<ArrivedProcessResult> {
  const ruleCheck = validateArrivedTransition(
    appointment.status,
    appointment.Professional?.user_id,
    userId,
  );

  if (!ruleCheck.valid) {
    return {
      success: false,
      status: ruleCheck.status,
      error: ruleCheck.error,
    };
  }

  const address = appointment.Address;
  const distanceCheck = validateArrivedDistance(
    latitude,
    longitude,
    address?.lat,
    address?.lng,
    MAX_ARRIVAL_DISTANCE_METERS,
  );

  if (!distanceCheck.valid) {
    return {
      success: false,
      status: 400,
      error: distanceCheck.error || "Distância além do limite permitido.",
      distance: distanceCheck.distance,
      maxDistance: distanceCheck.maxDistance,
    };
  }

  const previousStatus = appointment.status;
  appointment.status = "arrived";
  appointment.arrived_at = new Date();

  await sequelize.transaction(async (transaction) => {
    await appointment.save({ transaction });
    await AppointmentAuditLogModel.create(
      {
        appointment_id: appointment.id,
        user_id: userId,
        action: "status_change",
        from_status: previousStatus,
        to_status: "arrived",
        metadata: JSON.stringify({ arrived_at: appointment.arrived_at }),
      },
      { transaction },
    );
  });

  return { success: true, code: appointment.verification_code };
}

export type CheckinProcessResult =
  | { success: true; startedAt: Date }
  | { success: false; status: 400 | 403 | 409; error: string };

export async function processAppointmentCheckin(
  appointment: AppointmentWithRelations,
  userId: number,
  code: string | undefined,
): Promise<CheckinProcessResult> {
  const ruleCheck = validateCheckinTransition(
    appointment.status,
    appointment.Professional?.user_id,
    userId,
    code,
    appointment.verification_code,
  );

  if (!ruleCheck.valid) {
    if (ruleCheck.reason === "already_used") {
      await AppointmentAuditLogModel.create({
        appointment_id: appointment.id,
        user_id: userId,
        action: "check_in_failed",
        from_status: appointment.status,
        to_status: appointment.status,
        metadata: JSON.stringify({
          reason: "already_used",
          status: appointment.status,
        }),
      });
    } else if (ruleCheck.reason === "invalid_code") {
      await AppointmentAuditLogModel.create({
        appointment_id: appointment.id,
        user_id: userId,
        action: "check_in_failed",
        from_status: appointment.status,
        to_status: appointment.status,
        metadata: JSON.stringify({
          reason: "invalid_code",
          code_attempted: String(code || "").slice(0, 10),
        }),
      });
    }

    return {
      success: false,
      status: ruleCheck.status,
      error: ruleCheck.error,
    };
  }

  // CHK-05 & CHK-07: status, timestamp e log de check-in na mesma transação
  const startedAt = new Date();
  const transitioned = await applyStatusTransitionWithAudit(
    appointment.id,
    "arrived",
    { status: "in_progress", started_at: startedAt },
    {
      user_id: userId,
      action: "check_in",
      metadata: { started_at: startedAt },
    },
  );

  if (!transitioned) {
    return {
      success: false,
      status: 409,
      error: "Este código já foi utilizado para este agendamento.",
    };
  }

  appointment.status = "in_progress";
  appointment.started_at = startedAt;

  return { success: true, startedAt };
}

export type CheckoutProcessResult =
  | { success: true; completedAt: Date }
  | { success: false; status: 400 | 403 | 409; error: string };

export async function processAppointmentCheckout(
  appointment: AppointmentWithRelations,
  userId: number,
  code: string | undefined,
): Promise<CheckoutProcessResult> {
  const ruleCheck = validateCheckoutTransition(
    appointment.status,
    appointment.Professional?.user_id,
    userId,
    code,
    appointment.verification_code,
  );

  if (!ruleCheck.valid) {
    if (ruleCheck.reason === "already_completed") {
      await AppointmentAuditLogModel.create({
        appointment_id: appointment.id,
        user_id: userId,
        action: "check_out_failed",
        from_status: appointment.status,
        to_status: appointment.status,
        metadata: JSON.stringify({ reason: "already_completed" }),
      });
    } else if (ruleCheck.reason === "invalid_code") {
      await AppointmentAuditLogModel.create({
        appointment_id: appointment.id,
        user_id: userId,
        action: "check_out_failed",
        from_status: appointment.status,
        to_status: appointment.status,
        metadata: JSON.stringify({
          reason: "invalid_code",
          code_attempted: String(code || "").slice(0, 10),
        }),
      });
    }

    return {
      success: false,
      status: ruleCheck.status,
      error: ruleCheck.error,
    };
  }

  // CHK-05 & CHK-07: status, timestamp e log de check-out na mesma transação
  const completedAt = new Date();
  const transitioned = await applyStatusTransitionWithAudit(
    appointment.id,
    "in_progress",
    { status: "completed", completed_at: completedAt },
    {
      user_id: userId,
      action: "check_out",
      metadata: { completed_at: completedAt },
    },
  );

  if (!transitioned) {
    return {
      success: false,
      status: 409,
      error: "Este serviço já foi concluído anteriormente.",
    };
  }

  appointment.status = "completed";
  appointment.completed_at = completedAt;

  return { success: true, completedAt };
}

export async function sendAppointmentStatusNotification(
  appointment: AppointmentWithRelations,
  status: "in_transit" | "arrived" | "in_progress" | "completed",
  title: string,
  message: string,
): Promise<void> {
  const clientUser = appointment.Client?.User;
  if (!clientUser) return;

  await NotificationModel.create({
    user_id: clientUser.id,
    title,
    message,
    notification_type: "appointment",
    related_entity_id: appointment.id,
    is_read: false,
  });

  emitAppointmentStatusUpdate(clientUser.id, {
    appointment_id: appointment.id,
    status,
    session_ids: [],
    message,
    payment_status: appointment.payment_intent_id ? "paid" : "pending",
    payment_pending: !appointment.payment_intent_id,
    paid: Boolean(appointment.payment_intent_id),
    updated_at: new Date().toISOString(),
  });
}

export async function canUserAccessAuditTrail(
  appointment: AppointmentWithRelations,
  userId: number,
  isAdmin: boolean,
): Promise<boolean> {
  if (
    canAccessAuditTrailRule(
      appointment.Client?.user_id,
      appointment.Professional?.user_id,
      userId,
      isAdmin,
    )
  ) {
    return true;
  }
  const adminRecord = await AdminModel.findOne({ where: { user_id: userId } });
  return Boolean(adminRecord);
}

export async function fetchAppointmentAuditTrail(appointmentId: number) {
  return AppointmentAuditLogModel.findAll({
    where: { appointment_id: appointmentId },
    include: [
      {
        model: UserModel,
        as: "User",
        attributes: ["id", "name", "email", "avatar_uri"],
      },
    ],
    order: [["created_at", "ASC"]],
  });
}
