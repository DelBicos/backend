import { Op } from "sequelize";
import { AppointmentModel } from "../../models/Appointment";
import { ClientModel } from "../../models/Client";
import { ServiceModel } from "../../models/Service";
import type { BotSessionContext } from "../../models/BotChatSession";
import type { HandlerResult } from "./BotStateNode";
import {
  APPOINTMENT_QUERY_PAGE_SIZE,
  parseAppointmentQuery,
} from "./appointmentQuery.rules";

const STATUS_LABELS = {
  pending: "Pendente",
  confirmed: "Confirmado",
  completed: "Concluído",
  canceled: "Cancelado",
};

/** Consulta somente reservas do cliente autenticado, inclusive histórico. */
export async function queryBotAppointments(
  userId: number,
  message: string,
  context: BotSessionContext,
): Promise<HandlerResult> {
  const query = parseAppointmentQuery(message, context.appointmentQuery) ?? {
    statuses: [],
    offset: 0,
    hasMore: false,
  };
  const client = await ClientModel.findOne({ where: { user_id: userId } });
  if (!client) {
    return {
      reply:
        "Você ainda não possui perfil de cliente. Acesse o app para completar seu cadastro.",
      nextState: "FINALIZADO",
      contextUpdate: {},
      finalize: true,
    };
  }
  const appointments = await AppointmentModel.findAll({
    where: {
      client_id: client.id,
      ...(query.statuses.length ? { status: { [Op.in]: query.statuses } } : {}),
    },
    include: [{ model: ServiceModel, as: "Service" }],
    // O ID desempata datas iguais para que a paginação tenha ordem estável.
    order: [
      ["start_time", "DESC"],
      ["id", "DESC"],
    ],
    offset: query.offset,
    limit: APPOINTMENT_QUERY_PAGE_SIZE + 1,
  });
  const page = appointments.slice(0, APPOINTMENT_QUERY_PAGE_SIZE);
  const appointmentQuery = {
    ...query,
    hasMore: appointments.length > APPOINTMENT_QUERY_PAGE_SIZE,
  };
  const filter = query.statuses.length
    ? query.statuses
        .map((status) => STATUS_LABELS[status].toLowerCase())
        .join(", ")
    : "todos os status";
  if (!page.length) {
    const emptyHistory = !query.statuses.length && query.offset === 0;
    return {
      reply: emptyHistory
        ? "Você não possui agendamentos. Deseja agendar um serviço?"
        : `Nenhum agendamento encontrado nesta página (${filter}). Você pode consultar todos os agendamentos ou escolher outro status.`,
      nextState: "INICIO",
      contextUpdate: {
        intent: "CONSULTAR",
        pendingAction: undefined,
        pendingPrompt: emptyHistory
          ? "OFFER_CREATE_AFTER_EMPTY_QUERY"
          : undefined,
        appointmentQuery,
      },
    };
  }
  const lines = page.map((appointment, index) => {
    const service = (
      appointment as AppointmentModel & { Service?: ServiceModel }
    ).Service;
    const start = new Date(appointment.start_time);
    const date = start.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    const time = start.toLocaleTimeString("pt-BR", {
      timeZone: "America/Sao_Paulo",
      hour: "2-digit",
      minute: "2-digit",
    });
    return `${query.offset + index + 1}. ID ${appointment.id} — ${service?.title ?? "Serviço"}\n${date} às ${time} • ${STATUS_LABELS[appointment.status]}`;
  });
  const navigation = appointmentQuery.hasMore
    ? "Há mais agendamentos. Clique em “Ver mais agendamentos” ou digite “ver mais”."
    : "Fim da lista para esta consulta.";
  return {
    reply: `Seus agendamentos (${filter}):\nMais recentes primeiro. Exibindo ${query.offset + 1} a ${query.offset + page.length}, em páginas de até 5.\n\n${lines.join("\n\n")}\n\n${navigation}`,
    nextState: "INICIO",
    contextUpdate: {
      intent: "CONSULTAR",
      pendingAction: undefined,
      pendingPrompt: undefined,
      appointmentQuery,
    },
  };
}
