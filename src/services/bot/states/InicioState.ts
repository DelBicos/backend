import { Op } from "sequelize";
import { AppointmentModel } from "../../../models/Appointment";
import { ClientModel } from "../../../models/Client";
import { ServiceModel } from "../../../models/Service";
import { BotChatSessionModel, BotSessionContext } from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";

export class InicioState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number
  ): Promise<HandlerResult> {
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

        return {
          reply:
            nlu.entities.service
              ? `Ótimo! Você quer agendar "${nlu.entities.service}". Aguarde enquanto busco os profissionais disponíveis...`
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
            contextUpdate: {},
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
