import { Op } from "sequelize";
import { AppointmentModel } from "../../../models/Appointment";
import { ClientModel } from "../../../models/Client";
import { ServiceModel } from "../../../models/Service";
import type {
  BotChatSessionModel,
  BotSessionContext,
} from "../../../models/BotChatSession";
import type { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";

export class InicioState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;
    const normalizedReply = userMessage
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    if (ctx.pendingPrompt === "OFFER_CREATE_AFTER_EMPTY_QUERY") {
      const confirmed = /\b(sim|s|claro|quero|pode|vamos|bora|ok|beleza)\b/.test(
        normalizedReply,
      );
      const denied = /\b(nao|n|agora nao|depois|cancelar|voltar)\b/.test(
        normalizedReply,
      );

      if (confirmed) {
        return {
          reply:
            "Ótimo! Qual serviço você gostaria de agendar? " +
            "(Ex: corte de cabelo, pintura, limpeza...)",
          nextState: "COLETANDO_SERVICO",
          contextUpdate: {
            intent: "AGENDAR",
            pendingAction: "CREATE",
            pendingPrompt: undefined,
          },
        };
      }

      if (denied) {
        return {
          reply:
            "Tudo bem. Posso ajudá-lo a consultar seus agendamentos, " +
            "cancelar, reagendar ou iniciar um agendamento quando desejar.",
          nextState: "INICIO",
          contextUpdate: {
            intent: undefined,
            pendingAction: undefined,
            pendingPrompt: undefined,
          },
        };
      }

      if (nlu.intent === "FALLBACK") {
        return {
          reply:
            'Deseja iniciar um agendamento? Responda com "sim" ou "não".',
          nextState: "INICIO",
          contextUpdate: {},
        };
      }
    }

    switch (nlu.intent) {
      case "SAUDACAO":
        return {
          reply:
            "Olá! 👋 Sou o assistente virtual do DelBicos. Posso ajudá-lo a:\n" +
            "• Agendar um serviço\n" +
            "• Consultar seus agendamentos\n" +
            "• Cancelar ou reagendar\n\n" +
            "O que você gostaria de fazer?",
          nextState: "INICIO",
          contextUpdate: {},
        };

      case "AGENDAR": {
        const newCtx: Partial<BotSessionContext> = {
          intent: "AGENDAR",
          pendingAction: "CREATE",
        };
        if (nlu.entities.service) {
          newCtx.serviceName = nlu.entities.service;
        }
        if (nlu.entities.date) newCtx.date = nlu.entities.date;
        if (nlu.entities.time) newCtx.time = nlu.entities.time;
        if (nlu.entities.time_period) newCtx.timePeriod = nlu.entities.time_period;

        return {
          reply:
            nlu.entities.service
              ? `Ótimo! Você quer agendar "${nlu.entities.service}". Vou localizar esse serviço...`
              : "Ótimo! Qual serviço você gostaria de agendar? (Ex: corte de cabelo, pintura, limpeza...)",
          nextState: "COLETANDO_SERVICO",
          contextUpdate: newCtx,
        };
      }

      case "ALTERAR":
        return {
          reply:
            "Para reagendar, preciso do ID do agendamento. Você pode encontrá-lo na seção \"Meus Agendamentos\" do app.\n\nDigite o número do ID do agendamento:",
          nextState: "AGUARDANDO_ID_AGENDAMENTO",
          contextUpdate: { intent: "ALTERAR", pendingAction: "RESCHEDULE" },
        };

      case "CANCELAR":
        return {
          reply:
            "Para cancelar, preciso do ID do agendamento. Você pode encontrá-lo na seção \"Meus Agendamentos\" do app.\n\nDigite o número do ID do agendamento:",
          nextState: "AGUARDANDO_ID_AGENDAMENTO",
          contextUpdate: { intent: "CANCELAR", pendingAction: "CANCEL" },
        };

      case "CONSULTAR": {
        const clientRecord = await ClientModel.findOne({ where: { user_id: userId } });
        if (!clientRecord) {
          return {
            reply: "Você ainda não possui perfil de cliente. Acesse o app para completar seu cadastro.",
            nextState: "FINALIZADO",
            contextUpdate: {},
            finalize: true,
          };
        }
        const upcoming = await AppointmentModel.findAll({
          where: {
            client_id: clientRecord.id,
            status: { [Op.in]: ["pending", "confirmed"] },
            start_time: { [Op.gte]: new Date() },
          },
          include: [{ model: ServiceModel, as: "Service" }],
          order: [["start_time", "ASC"]],
          limit: 5,
        });
        if (upcoming.length === 0) {
          return {
            reply: "Você não possui agendamentos futuros. Deseja agendar um serviço?",
            nextState: "INICIO",
            contextUpdate: {
              intent: "CONSULTAR",
              pendingAction: undefined,
              pendingPrompt: "OFFER_CREATE_AFTER_EMPTY_QUERY",
            },
          };
        }
        const lines = upcoming.map((a: any, i: number) => {
          const d = new Date(a.start_time);
          const dateStr = d.toLocaleDateString("pt-BR");
          const timeStr = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
          return `${i + 1}. ID ${a.id} — ${a.Service?.title ?? "serviço"} — ${dateStr} às ${timeStr} (${a.status})`;
        });
        return {
          reply: `Seus próximos agendamentos:\n\n${lines.join("\n")}\n\nPosso ajudá-lo com mais alguma coisa?`,
          nextState: "INICIO",
          contextUpdate: {},
        };
      }

      default:
        return {
          reply:
            "Não entendi sua solicitação. Posso ajudá-lo a:\n" +
            "• Agendar um serviço\n• Consultar seus agendamentos\n• Cancelar ou reagendar",
          nextState: "INICIO",
          contextUpdate: {},
        };
    }
  }
}
