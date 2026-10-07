/**
 * Casos de uso do agendamento. Concentra regras de negocio e autorizacao;
 * os controllers apenas traduzem HTTP <-> chamadas deste modulo.
 */
import { Includeable, Op, Transaction } from "sequelize";
import { AppointmentModel } from "../../models/Appointment";
import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { ServiceModel } from "../../models/Service";
import { AddressModel } from "../../models/Address";
import { SubCategoryModel } from "../../models/Subcategory";
import { HttpError } from "../../errors/HttpError";
import { assertSlotInAgenda } from "../availability.service";
import logger from "../../utils/logger";
import {
  ensureChatRoomForAppointment,
  syncChatRoomStatusForAppointment,
} from "../../utils/chatRoom";
import { syncBotSessionsForAppointmentStatus } from "../botAppointmentStatus.service";
import { PaymentService } from "../payment.service";
import { enqueuePaymentRefund } from "../appointmentRefund.service";
import {
  assertNoAppointmentOverlap,
  ScheduleConflictError,
  withProfessionalScheduleLock,
} from "../appointmentSchedule.service";
import {
  assertCanComplete,
  assertMinimumAdvance,
  assertProfessionalResponse,
  assertStatus,
  assertValidPeriod,
  assertValidReview,
  assertWithinServiceRadius,
} from "./appointment.rules";
import {
  formatAppointmentDate,
  formatAppointmentTime,
  notifyAppointmentAccepted,
  notifyAppointmentCompleted,
  notifyAppointmentCreated,
  notifyAppointmentRejected,
  notifyReviewReceived,
} from "./appointmentNotifications.service";

import type { AppointmentWithRelations } from "./appointment.types";
const USER_PUBLIC_ATTRIBUTES = ["id", "name", "avatar_uri", "phone", "email"];

/** Statuses que ocupam a agenda do profissional. */
const BLOCKING_STATUSES = ["pending", "confirmed"];

// ---------------------------------------------------------------------------
// Helpers de busca e autorizacao
// ---------------------------------------------------------------------------

/**
 * Localiza um agendamento pelo identificador publico (short_id, exposto ao
 * app) ou, por compatibilidade, pela chave numerica.
 */
export async function findAppointmentByPublicId(
  publicId: string | number,
  options: { include?: Includeable[]; transaction?: Transaction } = {},
): Promise<AppointmentModel | null> {
  const raw = String(publicId ?? "").trim();
  if (!raw) return null;

  const byShortId = await AppointmentModel.findOne({
    where: { short_id: raw.toUpperCase() },
    ...options,
  });
  if (byShortId) return byShortId;

  if (/^\d+$/.test(raw)) {
    return AppointmentModel.findByPk(Number(raw), options);
  }
  return null;
}

async function requireAppointment(
  publicId: string | number,
  include?: Includeable[],
): Promise<AppointmentModel> {
  const appointment = await findAppointmentByPublicId(publicId, { include });
  if (!appointment) throw HttpError.notFound("Agendamento não encontrado");
  return appointment;
}

export async function requireClientForUser(userId: number): Promise<ClientModel> {
  const client = await ClientModel.findOne({ where: { user_id: userId } });
  if (!client) {
    throw HttpError.forbidden(
      "Usuário não possui perfil de cliente. Finalize seu cadastro antes de agendar.",
    );
  }
  return client;
}

async function requireResponsibleProfessional(
  appointment: AppointmentModel,
  userId: number,
  action: string,
): Promise<void> {
  const professional = await ProfessionalModel.findByPk(appointment.professional_id);
  if (!professional || professional.user_id !== userId) {
    throw HttpError.forbidden(
      `Apenas o profissional responsável pode ${action} este agendamento`,
    );
  }
}

/** No app, o "id" do agendamento e o short_id. */
export function toPublicAppointment(appointment: AppointmentModel) {
  const json = { ...appointment.toJSON() } as Record<string, unknown>;
  json.id = json.short_id;
  delete json.short_id;
  json.payment_method = "Cartão de Crédito";
  return json;
}

/** Lanca 409 se o profissional ja tiver agendamento ativo no periodo. */
export async function assertProfessionalIsFree(
  professionalId: number,
  start: Date,
  end: Date,
  transaction?: Transaction,
  excludeAppointmentId?: number,
): Promise<void> {
  const conflict = await AppointmentModel.findOne({
    where: {
      ...(excludeAppointmentId ? { id: { [Op.ne]: excludeAppointmentId } } : {}),
      professional_id: professionalId,
      status: { [Op.in]: BLOCKING_STATUSES },
      start_time: { [Op.lt]: end },
      end_time: { [Op.gt]: start },
    },
    transaction,
  });
  if (conflict) {
    throw HttpError.conflict(
      "O profissional já possui um agendamento nesse horário. Escolha outro horário.",
    );
  }
}

/**
 * Valida o trio profissional/servico/endereco de um pedido de agendamento.
 * Usado tanto na criacao direta quanto na criacao via pagamento.
 */
export async function validateBookingRequest(params: {
  userId: number;
  professionalId: number;
  serviceId: number;
  addressId: number;
  start: Date;
}) {
  const { userId, professionalId, serviceId, addressId, start } = params;
  if (!Number.isInteger(professionalId) || !Number.isInteger(serviceId)) {
    throw HttpError.badRequest("professional_id e service_id devem ser numéricos");
  }
  if (!Number.isInteger(addressId)) {
    throw HttpError.badRequest("address_id é obrigatório");
  }
  assertMinimumAdvance(start);

  const [client, professional, service, address] = await Promise.all([
    requireClientForUser(userId),
    ProfessionalModel.findByPk(professionalId, {
      include: [{ model: AddressModel, as: "MainAddress", attributes: ["lat", "lng"] }],
    }),
    ServiceModel.findByPk(serviceId),
    AddressModel.findByPk(addressId),
  ]);

  if (!professional) throw HttpError.notFound("Profissional não encontrado");
  if (!service) throw HttpError.notFound("Serviço não encontrado");
  if (!service.active) throw HttpError.badRequest("Serviço não está ativo");
  if (service.professional_id !== professional.id) {
    throw HttpError.badRequest("O serviço informado não pertence a este profissional");
  }
  if (!address || address.user_id !== userId) {
    throw HttpError.notFound("Endereço do cliente não encontrado");
  }
  if (professional.user_id === userId) {
    throw HttpError.badRequest("Você não pode agendar um serviço consigo mesmo");
  }

  const mainAddress = (professional as AppointmentWithRelations["Professional"])?.MainAddress;
  assertWithinServiceRadius({
    professionalLat: mainAddress?.lat,
    professionalLng: mainAddress?.lng,
    clientLat: address.lat,
    clientLng: address.lng,
    radiusKm: (professional as AppointmentWithRelations["Professional"])?.service_radius_km ?? undefined,
  });

  const durationMinutes = Number(service.duration) || 60;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  assertValidPeriod(start, end);
  await assertSlotInAgenda({
    professionalId: professional.id,
    start,
    durationMinutes,
    serviceId: service.id,
  });

  return { client, professional, service, address, end };
}

// ---------------------------------------------------------------------------
// Casos de uso
// ---------------------------------------------------------------------------

export interface CreateAppointmentInput {
  service_id: unknown;
  professional_id: unknown;
  address_id: unknown;
  start_time: unknown;
}

export async function createAppointment(userId: number, input: CreateAppointmentInput) {
  if (!input.service_id || !input.professional_id || !input.start_time || !input.address_id) {
    throw HttpError.badRequest(
      "Campos obrigatórios: service_id, professional_id, address_id, start_time",
    );
  }
  const start = new Date(String(input.start_time));
  const { client, professional, service, address, end } = await validateBookingRequest({
    userId,
    professionalId: Number(input.professional_id),
    serviceId: Number(input.service_id),
    addressId: Number(input.address_id),
    start,
  });
  // Trava a agenda do profissional: duas reservas simultaneas nao ocupam o mesmo horario.
  const appointment = await withProfessionalScheduleLock(professional.id, async (transaction) => {
    await assertNoAppointmentOverlap(professional.id, start, end, transaction);
    return AppointmentModel.create(
      {
        professional_id: professional.id,
        client_id: client.id,
        service_id: service.id,
        address_id: address.id,
        start_time: start,
        end_time: end,
        status: "pending",
      },
      { transaction },
    );
  });

  await ensureChatRoomForAppointment(appointment);

  const clientUser = await UserModel.findByPk(userId, { attributes: ["id", "name"] });
  await notifyAppointmentCreated({
    appointmentId: appointment.id,
    startTime: appointment.start_time,
    serviceTitle: service.title,
    clientUserId: userId,
    clientName: clientUser?.name,
    professionalUserId: professional.user_id,
  });

  logger.info("Appointment criado com sucesso", {
    appointmentId: appointment.id,
    clientId: appointment.client_id,
    professionalId: appointment.professional_id,
  });
  return appointment;
}

/**
 * Lista os agendamentos do proprio usuario autenticado.
 * `role` filtra pela visao de cliente ou profissional.
 */
export async function listAppointmentsForUser(
  authUserId: number,
  requestedUserId: string | number,
  role?: unknown,
) {
  if (Number(requestedUserId) !== authUserId) {
    throw HttpError.forbidden("Você só pode consultar os seus próprios agendamentos");
  }

  const [client, professional] = await Promise.all([
    ClientModel.findOne({ where: { user_id: authUserId } }),
    ProfessionalModel.findOne({ where: { user_id: authUserId } }),
  ]);

  const filters: Record<string, number>[] = [];
  if (role !== "professional" && client) filters.push({ client_id: client.id });
  if (role !== "client" && professional) filters.push({ professional_id: professional.id });
  if (filters.length === 0) return [];

  const appointments = await AppointmentModel.findAll({
    where: filters.length === 1 ? filters[0] : { [Op.or]: filters },
    include: [
      {
        model: ServiceModel,
        as: "Service",
        include: [{ model: SubCategoryModel, as: "Subcategory" }],
      },
      {
        model: ClientModel,
        as: "Client",
        attributes: ["id", "user_id"],
        include: [{ model: UserModel, as: "User", attributes: USER_PUBLIC_ATTRIBUTES }],
      },
      {
        model: ProfessionalModel,
        as: "Professional",
        attributes: ["id", "user_id"],
        include: [{ model: UserModel, as: "User", attributes: USER_PUBLIC_ATTRIBUTES }],
      },
      { model: AddressModel, as: "Address" },
    ],
    order: [["start_time", "ASC"]],
  });

  return appointments.map(toPublicAppointment);
}

/**
 * Devolve o dinheiro de um agendamento que nao vai acontecer e informa o
 * resultado para a notificacao ("processing" = nao foi possivel confirmar).
 */
export async function returnPaymentFor(appointment: {
  id?: number;
  payment_intent_id?: string | null;
}): Promise<"none" | "released" | "refunded" | "processing"> {
  if (!appointment.payment_intent_id) return "none";
  const settlement = await PaymentService.settleUnusedPayment(appointment.payment_intent_id);
  if (settlement !== "failed") return settlement;
  // Stripe indisponivel: guarda na fila de devolucao para o cron tentar de novo.
  try {
    await enqueuePaymentRefund(appointment.payment_intent_id, appointment.id ?? null);
  } catch (error) {
    logger.error("Falha ao enfileirar devolução de pagamento", {
      appointmentId: appointment.id,
      reason: error instanceof Error ? error.message : String(error),
    });
  }
  return "processing";
}

/**
 * Executa `work` sob a trava da agenda, com o agendamento relido do banco.
 * Falha (409) se ele deixou de estar pendente ou mudou de horario enquanto o
 * profissional respondia (ex.: o pedido expirou ou foi reagendado).
 */
async function withPendingAppointment(
  appointment: AppointmentModel,
  work: (current: AppointmentModel, transaction: Transaction) => Promise<void>,
): Promise<void> {
  await withProfessionalScheduleLock(appointment.professional_id, async (transaction) => {
    const current = await AppointmentModel.findByPk(appointment.id, {
      transaction,
      lock: transaction.LOCK.UPDATE,
    });
    if (
      !current ||
      current.status !== "pending" ||
      new Date(current.start_time).getTime() !== new Date(appointment.start_time).getTime()
    ) {
      throw new ScheduleConflictError(
        "O agendamento foi alterado. Atualize a agenda antes de responder.",
      );
    }
    await work(current, transaction);
    await current.save({ transaction });
  });
}

/** Profissional aceita um agendamento pendente (cobra o valor reservado). */
export async function confirmAppointment(userId: number, publicId: string) {
  const appointment = await requireAppointment(publicId);
  await requireResponsibleProfessional(appointment, userId, "aceitar");
  assertStatus(appointment.status, "pending", "aceitar");

  // Cobra antes de confirmar: se a reserva expirou, o pedido segue pendente.
  await withPendingAppointment(appointment, async (current) => {
    if (current.payment_intent_id) {
      await PaymentService.capturePayment(current.payment_intent_id);
    }
    current.status = "confirmed";
  });
  appointment.status = "confirmed";
  await syncBotSessionsForAppointmentStatus(appointment);

  const client = await ClientModel.findByPk(appointment.client_id);
  const service = await ServiceModel.findByPk(appointment.service_id);
  await notifyAppointmentAccepted(client?.user_id, service?.title, appointment.id);

  logger.info("Appointment confirmado", { appointmentId: appointment.id });
  return appointment;
}

/**
 * Profissional responde a um agendamento pendente (aceitar ou recusar).
 * Na aceitacao, cobra o valor reservado; na recusa, libera a reserva no
 * cartao (ou estorna, se ja cobrado) e arquiva o chat.
 */
export async function respondToAppointment(userId: number, publicId: string, status: unknown) {
  const response = assertProfessionalResponse(status);
  const appointment = await requireAppointment(publicId, [
    { model: ClientModel, as: "Client", attributes: ["id", "user_id"] },
    { model: ServiceModel, as: "Service", attributes: ["id", "title"] },
  ]);
  await requireResponsibleProfessional(appointment, userId, "alterar");
  assertStatus(appointment.status, "pending", "alterar");

  await withPendingAppointment(appointment, async (current) => {
    if (response === "confirmed" && current.payment_intent_id) {
      await PaymentService.capturePayment(current.payment_intent_id);
    }
    current.status = response;
    if (response === "canceled") {
      current.canceled_by = "professional";
      current.canceled_at = new Date();
      current.cancellation_reason = "Pedido recusado pelo profissional";
      current.retained_cents = 0;
    }
  });
  appointment.status = response;
  await syncChatRoomStatusForAppointment(appointment.id, response);

  const clientUserId: number | undefined = (appointment as AppointmentWithRelations).Client?.user_id;
  const serviceTitle: string | undefined = (appointment as AppointmentWithRelations).Service?.title;

  if (response === "confirmed") {
    await notifyAppointmentAccepted(clientUserId, serviceTitle, appointment.id);
  } else {
    const refund = await returnPaymentFor(appointment);
    await notifyAppointmentRejected(clientUserId, serviceTitle, appointment.id, refund);
  }

  await syncBotSessionsForAppointmentStatus(appointment);
  logger.info(`Appointment status updated to ${response}`, { appointmentId: appointment.id });
  return appointment;
}

/**
 * Profissional marca um atendimento confirmado como concluido (apos o inicio).
 * E o que alimenta ganhos, historico e libera a avaliacao do cliente.
 */
export async function completeAppointment(
  userId: number,
  publicId: string,
  now: Date = new Date(),
) {
  const appointment = await requireAppointment(publicId, [
    { model: ClientModel, as: "Client", attributes: ["id", "user_id"] },
    { model: ServiceModel, as: "Service", attributes: ["id", "title"] },
  ]);
  await requireResponsibleProfessional(appointment, userId, "concluir");
  assertStatus(appointment.status, "confirmed", "concluir");
  assertCanComplete(appointment.start_time, now);

  appointment.status = "completed";
  appointment.completed_at = now;
  await appointment.save();
  await syncChatRoomStatusForAppointment(appointment.id, "completed");
  await syncBotSessionsForAppointmentStatus(appointment);

  await notifyAppointmentCompleted(
    (appointment as AppointmentWithRelations).Client?.user_id,
    (appointment as AppointmentWithRelations).Service?.title,
    appointment.id,
  );

  logger.info("Appointment concluido", { appointmentId: appointment.id });
  return toPublicAppointment(appointment);
}

/** Cliente avalia um agendamento concluido (cria ou atualiza a avaliacao). */
export async function reviewAppointment(
  userId: number,
  publicId: string,
  input: { rating: unknown; review: unknown },
) {
  const { rating, review } = assertValidReview(input.rating, input.review);
  const appointment = await requireAppointment(publicId, [
    { model: ClientModel, as: "Client", attributes: ["id", "user_id"] },
  ]);

  if ((appointment as AppointmentWithRelations).Client?.user_id !== userId) {
    throw HttpError.forbidden("Você não tem permissão para avaliar este agendamento");
  }
  assertStatus(appointment.status, "completed", "avaliar");

  const isUpdate = appointment.rating !== null && appointment.rating !== undefined;
  appointment.rating = rating;
  appointment.review = review as string;
  await appointment.save();

  if (!isUpdate) {
    const [professional, service] = await Promise.all([
      ProfessionalModel.findByPk(appointment.professional_id),
      ServiceModel.findByPk(appointment.service_id),
    ]);
    await notifyReviewReceived(
      professional?.user_id,
      appointment.id,
      rating,
      review,
      service?.title,
    );
  }

  return {
    success: true,
    message: isUpdate
      ? "Avaliação atualizada com sucesso"
      : "Avaliação registrada com sucesso",
  };
}

/** Comprovante do agendamento, visivel apenas para o cliente que contratou. */
export async function getAppointmentInvoice(userId: number, publicId: string) {
  const client = await ClientModel.findOne({ where: { user_id: userId } });
  if (!client) throw HttpError.notFound("Cliente não encontrado.");

  const appointment = await findAppointmentByPublicId(publicId, {
    include: [
      {
        model: ServiceModel,
        as: "Service",
        include: [{ model: SubCategoryModel, as: "Subcategory" }],
      },
      {
        model: ClientModel,
        as: "Client",
        include: [{ model: UserModel, as: "User", attributes: ["name"] }],
      },
      {
        model: ProfessionalModel,
        as: "Professional",
        include: [{ model: UserModel, as: "User", attributes: ["name"] }],
      },
      { model: AddressModel, as: "Address" },
    ],
  });

  if (!appointment || appointment.client_id !== client.id) {
    throw HttpError.notFound("Agendamento não encontrado ou não pertence a este usuário.");
  }

  const data = appointment as AppointmentWithRelations;
  const price = parseFloat(String(data.final_price ?? data.Service?.price ?? "0"));
  const address = data.Address;

  return {
    invoiceNumber: `NF${appointment.id.toString().padStart(6, "0")}`,
    date: formatAppointmentDate(new Date(appointment.createdAt)),
    customerName: data.Client?.User?.name || "Cliente não encontrado",
    customerCpf: data.Client?.cpf || "CPF não encontrado",
    customerAddress: address
      ? `${address.street}, ${address.number} - ${address.neighborhood} - ${address.city}/${address.state}`
      : "Endereço não fornecido",
    professionalName: data.Professional?.User?.name || "Profissional não encontrado",
    professionalCpf: data.Professional?.cnpj || data.Professional?.cpf || "CPF/CNPJ não encontrado",
    serviceName: data.Service?.title || "Serviço não encontrado",
    serviceDescription: data.Service?.description || "",
    servicePrice: price,
    serviceDate: formatAppointmentDate(appointment.start_time),
    serviceTime: `${formatAppointmentTime(appointment.start_time)} - ${formatAppointmentTime(
      appointment.end_time,
    )}`,
    total: price,
    paymentMethod: "Cartão de Crédito",
    transactionId: appointment.payment_intent_id || "N/A",
  };
}
