/**
 * Casos de uso do agendamento. Concentra regras de negocio e autorizacao;
 * os controllers apenas traduzem HTTP <-> chamadas deste modulo.
 */
import { Op, Transaction } from "sequelize";
import { AppointmentModel } from "../../models/Appointment";
import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { ServiceModel } from "../../models/Service";
import { AddressModel } from "../../models/Address";
import { SubCategoryModel } from "../../models/Subcategory";
import { HttpError } from "../../errors/HttpError";
import logger from "../../utils/logger";
import {
  ensureChatRoomForAppointment,
  syncChatRoomStatusForAppointment,
} from "../../utils/chatRoom";
import { syncBotSessionsForAppointmentStatus } from "../botAppointmentStatus.service";
import { PaymentService } from "../payment.service";
import {
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
  notifyAppointmentCreated,
  notifyAppointmentRejected,
  notifyReviewReceived,
} from "./appointment.notifications";

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
  options: { include?: any[]; transaction?: Transaction } = {},
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
  include?: any[],
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
  const json = appointment.toJSON() as any;
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
): Promise<void> {
  const conflict = await AppointmentModel.findOne({
    where: {
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

  const mainAddress = (professional as any).MainAddress;
  assertWithinServiceRadius({
    professionalLat: mainAddress?.lat,
    professionalLng: mainAddress?.lng,
    clientLat: address.lat,
    clientLng: address.lng,
    radiusKm: (professional as any).service_radius_km,
  });

  const durationMinutes = Number(service.duration) || 60;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  assertValidPeriod(start, end);

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
  await assertProfessionalIsFree(professional.id, start, end);

  const appointment = await AppointmentModel.create({
    professional_id: professional.id,
    client_id: client.id,
    service_id: service.id,
    address_id: address.id,
    start_time: start,
    end_time: end,
    status: "pending",
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

/** Profissional aceita um agendamento pendente. */
export async function confirmAppointment(userId: number, publicId: string) {
  const appointment = await requireAppointment(publicId);
  await requireResponsibleProfessional(appointment, userId, "aceitar");
  assertStatus(appointment.status, "pending", "aceitar");

  appointment.status = "confirmed";
  await appointment.save();
  await syncBotSessionsForAppointmentStatus(appointment);

  const client = await ClientModel.findByPk(appointment.client_id);
  const service = await ServiceModel.findByPk(appointment.service_id);
  await notifyAppointmentAccepted(client?.user_id, service?.title, appointment.id);

  logger.info("Appointment confirmado", { appointmentId: appointment.id });
  return appointment;
}

/**
 * Profissional responde a um agendamento pendente (aceitar ou recusar).
 * Na recusa, estorna o pagamento (se houver) e arquiva o chat.
 */
export async function respondToAppointment(userId: number, publicId: string, status: unknown) {
  const response = assertProfessionalResponse(status);
  const appointment = await requireAppointment(publicId, [
    { model: ClientModel, as: "Client", attributes: ["id", "user_id"] },
    { model: ServiceModel, as: "Service", attributes: ["id", "title"] },
  ]);
  await requireResponsibleProfessional(appointment, userId, "alterar");
  assertStatus(appointment.status, "pending", "alterar");

  appointment.status = response;
  await appointment.save();
  await syncChatRoomStatusForAppointment(appointment.id, response);

  const clientUserId: number | undefined = (appointment as any).Client?.user_id;
  const serviceTitle: string | undefined = (appointment as any).Service?.title;

  if (response === "confirmed") {
    await notifyAppointmentAccepted(clientUserId, serviceTitle, appointment.id);
  } else {
    let refund: "none" | "refunded" | "processing" = "none";
    if (appointment.payment_intent_id) {
      const refunded = await PaymentService.refundPaymentIntent(appointment.payment_intent_id);
      refund = refunded ? "refunded" : "processing";
    }
    await notifyAppointmentRejected(clientUserId, serviceTitle, appointment.id, refund);
  }

  await syncBotSessionsForAppointmentStatus(appointment);
  logger.info(`Appointment status updated to ${response}`, { appointmentId: appointment.id });
  return appointment;
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

  if ((appointment as any).Client?.user_id !== userId) {
    throw HttpError.forbidden("Você não tem permissão para avaliar este agendamento");
  }
  assertStatus(appointment.status, "completed", "avaliar");

  const isUpdate = appointment.rating !== null && appointment.rating !== undefined;
  appointment.rating = rating;
  appointment.review = review as any;
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

  const data: any = appointment;
  const price = parseFloat(data.final_price ?? data.Service?.price ?? "0");
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
