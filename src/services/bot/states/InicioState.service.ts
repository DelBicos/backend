import { AguardandoIdAgendamentoState } from "./AguardandoIdAgendamentoState.service";
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
import { queryBotAppointments } from "../appointmentQuery.service";

export class InicioState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number,
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;
    const normalizedReply = userMessage
      .toLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim();

    if (ctx.pendingPrompt === "OFFER_CREATE_AFTER_EMPTY_QUERY") {
      const confirmed =
        /\b(sim|s|claro|quero|pode|vamos|bora|ok|beleza)\b/.test(
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
          reply: 'Deseja iniciar um agendamento? Responda com "sim" ou "não".',
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
        if (nlu.entities.time_period)
          newCtx.timePeriod = nlu.entities.time_period;

        return {
          reply: nlu.entities.service
            ? `Ótimo! Você quer agendar "${nlu.entities.service}". Vou localizar esse serviço...`
            : "Ótimo! Qual serviço você gostaria de agendar? (Ex: corte de cabelo, pintura, limpeza...)",
          nextState: "COLETANDO_SERVICO",
          contextUpdate: newCtx,
        };
      }

      case "ALTERAR":
      case "CANCELAR": {
        const action = nlu.intent === "CANCELAR" ? "CANCEL" : "RESCHEDULE";
        const actionText = nlu.intent === "CANCELAR" ? "cancelar" : "reagendar";
        const intentName = nlu.intent;
        const explicitCode = userMessage.match(/#([a-z0-9]{1,6})\b/i)?.[1];
        const reference = explicitCode ?? nlu.entities.appointment_id;
        if (action === "CANCEL" && reference !== undefined) {
          const result = await new AguardandoIdAgendamentoState().handle(
            String(reference),
            { ...nlu, entities: {} },
            { ...session, context: { pendingAction: action } } as BotChatSessionModel,
            userId,
          );
          return {
            ...result,
            contextUpdate: { intent: intentName, pendingAction: action, ...result.contextUpdate },
          };
        }


        const clientRecord = await ClientModel.findOne({
          where: { user_id: userId },
        });
        let activeAppointments: Array<
          AppointmentModel & { Service?: ServiceModel }
        > = [];

        if (clientRecord) {
          activeAppointments = await AppointmentModel.findAll({
            where: {
              client_id: clientRecord.id,
              status: { [Op.in]: ["pending", "confirmed"] },
              start_time: { [Op.gte]: new Date() },
            },
            include: [{ model: ServiceModel, as: "Service" }],
            order: [["start_time", "ASC"]],
            limit: 5,
          });
        }

        if (activeAppointments.length > 0) {
          const optionLabels: string[] = [];
          const appointmentList: Array<{
            index: number;
            id: number;
            shortId?: string;
          }> = [];

          const lines = activeAppointments.map((a, i) => {
            const idx = i + 1;
            const d = new Date(a.start_time);
            const dateStr = d.toLocaleDateString("pt-BR", {
              timeZone: "America/Sao_Paulo",
            });
            const timeStr = d.toLocaleTimeString("pt-BR", {
              timeZone: "America/Sao_Paulo",
              hour: "2-digit",
              minute: "2-digit",
            });
            const svcTitle = a.Service?.title ?? "Serviço";
            const label = `${idx}. ${svcTitle} (${dateStr})`;

            optionLabels.push(label);
            appointmentList.push({ index: idx, id: a.id, shortId: a.short_id });

            return `${idx}. ${svcTitle} — ${dateStr} às ${timeStr} (ID: ${a.short_id || a.id})`;
          });

          const replyMessage =
            `Selecione qual agendamento você deseja ${actionText}:\n\n` +
            `${lines.join("\n")}\n\n` +
            `Clique em uma das opções abaixo ou digite o número correspondente:`;

          return {
            reply: replyMessage,
            nextState: "AGUARDANDO_ID_AGENDAMENTO",
            contextUpdate: {
              intent: intentName,
              pendingAction: action,
              serviceOptions: optionLabels,
              userAppointmentList: appointmentList,
            },
          };
        }

        const defaultWord =
          nlu.intent === "CANCELAR" ? "cancelar" : "reagendar";
        return {
          reply: `Para ${defaultWord}, preciso do ID do agendamento. Você pode encontrá-lo na seção "Meus Agendamentos" do app.\n\nDigite o número do ID do agendamento:`,
          nextState: "AGUARDANDO_ID_AGENDAMENTO",
          contextUpdate: { intent: intentName, pendingAction: action },
        };
      }

      case "CONSULTAR":
        return queryBotAppointments(userId, userMessage, ctx);

      default:
        return {
          reply:
            "Entendi. No momento, consigo ajudar com serviços e agendamentos do DelBicos. " +
            "Você pode:\n" +
            "• Agendar um serviço\n" +
            "• Consultar seus agendamentos\n" +
            "• Cancelar ou reagendar\n\n" +
            'Por exemplo, diga: "quero agendar uma limpeza".',
          nextState: "INICIO",
          contextUpdate: {},
        };
    }
  }
}
