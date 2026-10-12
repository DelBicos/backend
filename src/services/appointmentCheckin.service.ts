import { AppointmentModel } from "../models/Appointment";
import {
  AppointmentAuditLogModel,
  AuditLogAction,
} from "../models/AppointmentAuditLog";
import { AdminModel } from "../models/Admin";
import { UserModel } from "../models/User";
import { NotificationModel } from "../models/Notification";
import { sequelize } from "../config/database";
import { confirmationCodesMatch } from "../utils/confirmationCode.util";
import { emitAppointmentStatusUpdate } from "../realtime/chatSocket";

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

export function calculateDistanceInMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371000;
  const radLat1 = (lat1 * Math.PI) / 180;
  const radLat2 = (lat2 * Math.PI) / 180;
  const deltaLat = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLon = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
    Math.cos(radLat1) *
      Math.cos(radLat2) *
      Math.sin(deltaLon / 2) *
      Math.sin(deltaLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
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
  if (appointment.Professional?.user_id !== userId) {
    return {
      success: false,
      status: 403,
      error: "Apenas o profissional responsável pode marcar chegada.",
    };
  }

  if (appointment.status !== "in_transit" && appointment.status !== "arrived") {
    return {
      success: false,
      status: 400,
      error: `Não é possível marcar chegada em um agendamento com status '${appointment.status}'`,
    };
  }

  const address = appointment.Address;
  if (address && address.lat != null && address.lng != null) {
    const profLat = Number(latitude);
    const profLng = Number(longitude);
    const addrLat = Number(address.lat);
    const addrLng = Number(address.lng);

    const distanceMeters = calculateDistanceInMeters(
      profLat,
      profLng,
      addrLat,
      addrLng,
    );
    const MAX_DISTANCE_METERS = 300;

    if (distanceMeters > MAX_DISTANCE_METERS) {
      const roundedDistance = Math.round(distanceMeters);
      return {
        success: false,
        status: 400,
        error: `Você está a ${roundedDistance}m do endereço do cliente. Aproxime-se (menos de ${MAX_DISTANCE_METERS}m) para confirmar a chegada.`,
        distance: roundedDistance,
        maxDistance: MAX_DISTANCE_METERS,
      };
    }
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
  if (appointment.Professional?.user_id !== userId) {
    return {
      success: false,
      status: 403,
      error: "Apenas o profissional responsável pode iniciar o serviço.",
    };
  }

  // CHK-06: Rejeitar código já utilizado
  if (
    appointment.status === "in_progress" ||
    appointment.status === "completed"
  ) {
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
    return {
      success: false,
      status: 400,
      error: "Este código já foi utilizado para este agendamento.",
    };
  }

  if (appointment.status !== "arrived") {
    return {
      success: false,
      status: 400,
      error: `Não é possível iniciar o serviço em um agendamento com status '${appointment.status}'. Confirme a chegada primeiro.`,
    };
  }

  // CHK-03 & CHK-06: Validação case-sensitive do código e log de tentativa falha
  if (!confirmationCodesMatch(code, appointment.verification_code)) {
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
    return {
      success: false,
      status: 400,
      error:
        "Código de confirmação incorreto. Verifique o código com o cliente.",
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
  if (appointment.Professional?.user_id !== userId) {
    return {
      success: false,
      status: 403,
      error: "Apenas o profissional responsável pode finalizar o serviço.",
    };
  }

  // CHK-06: Rejeitar se já concluído
  if (appointment.status === "completed") {
    await AppointmentAuditLogModel.create({
      appointment_id: appointment.id,
      user_id: userId,
      action: "check_out_failed",
      from_status: appointment.status,
      to_status: appointment.status,
      metadata: JSON.stringify({ reason: "already_completed" }),
    });
    return {
      success: false,
      status: 400,
      error: "Este serviço já foi concluído anteriormente.",
    };
  }

  if (appointment.status !== "in_progress") {
    return {
      success: false,
      status: 400,
      error: `Não é possível finalizar um serviço com status '${appointment.status}'. O serviço precisa estar em andamento.`,
    };
  }

  // CHK-04 & CHK-06: Validação case-sensitive do código para check-out e log de falha
  if (!confirmationCodesMatch(code, appointment.verification_code)) {
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
    return {
      success: false,
      status: 400,
      error:
        "Código de confirmação incorreto. Verifique o código com o cliente.",
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
  if (isAdmin) return true;
  const clientUserId = appointment.Client?.user_id;
  const profUserId = appointment.Professional?.user_id;
  if (userId === clientUserId || userId === profUserId) return true;
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
