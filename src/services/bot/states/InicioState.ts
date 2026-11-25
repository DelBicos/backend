import { Op } from "sequelize";
import { AppointmentModel } from "../../../models/Appointment";
import { ClientModel } from "../../../models/Client";
import { ServiceModel } from "../../../models/Service";
import type {
  BotChatSessionModel,
  BotSessionContext,
} from "../../../models/BotChatSession";
import {
  classifyClosingMessage,
  extractProblemStatement,
  isSupportProblemReport,
  type NluResult,
} from "../../nlu.service";
import type { ClosingMessageKind } from "../../nlu/intent.rules";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import { DEFAULT_BOT_TIME_ZONE } from "../../../utils/date.util";
import { normalizeText } from "../../../utils/nlp.util";
import { logError } from "../../../utils/logger";
import {
  isAdmin,
  openTicketFromChat,
  TicketOpeningNotAllowedError,
} from "../../ticket/ticket.service";
import {
  buildChatbotTicket,
  TICKET_CATEGORY_LABELS,
  TICKET_DESCRIPTION_MAX_LENGTH,
  TICKET_DESCRIPTION_MIN_LENGTH,
  TICKET_DETAILED_SUMMARY_MIN_WORDS,
} from "../../ticket/ticket.rules";

import type { AppointmentWithRelations } from "../../appointment/appointment.types";

/** Respostas curtas que desistem do chamado em qualquer etapa da coleta. */
const TICKET_ABORT_PATTERN =
  /^(?:cancelar|cancela|cancele|desistir|desisto|deixa|deixa pra la|esquece|voltar|agora nao)$/;
// Na etapa do problema, "não" também desiste. Na etapa dos detalhes, "não"
// significa "nada a acrescentar" e segue para a confirmação.
const TICKET_DESCRIPTION_ABORT_PATTERN = /^(?:nao|n|depois)$/;
const TICKET_DETAILS_SKIP_PATTERN =
  /^(?:nao|n|nada|nada mais|nao sei|nao tenho|so|so isso|somente|somente isso|e so isso|era so isso|pode abrir|abre|abrir|abra|sem detalhes)$/;
// Na confirmação, a negativa é verificada antes: "não quero abrir" contém
// palavras das duas listas e deve desistir do chamado.
const TICKET_DENY_PATTERN =
  /\b(?:nao|n|cancelar|cancela|desistir|desisto|esquece|deixa)\b/;
const TICKET_CONFIRM_PATTERN =
  /\b(?:sim|s|claro|pode|confirmo|confirmar|abrir|abre|abra|ok|isso|beleza|bora)\b/;

const CLEARED_TICKET_CONTEXT: Partial<BotSessionContext> = {
  intent: undefined,
  pendingPrompt: undefined,
  ticketSummary: undefined,
  ticketDetails: undefined,
};

const TICKET_CANCELLED_RESULT: HandlerResult = {
  reply:
    "Tudo bem, não abri nenhum chamado. Se precisar do suporte técnico, é só me chamar.",
  nextState: "INICIO",
  contextUpdate: CLEARED_TICKET_CONTEXT,
};

const ADMIN_CANNOT_OPEN_TICKET_RESULT: HandlerResult = {
  reply: "Administradores atendem chamados e não podem abri-los pelo assistente.",
  nextState: "INICIO",
  contextUpdate: CLEARED_TICKET_CONTEXT,
};

const CLOSING_REPLIES: Readonly<Record<ClosingMessageKind, string>> = {
  THANKS:
    "Não há de quê! 😊 Fico feliz em ajudar. Se precisar de mais alguma coisa, é só me chamar.",
  FAREWELL: "Até logo! 👋 Quando precisar, é só me chamar.",
  ACKNOWLEDGMENT: "Combinado! Se precisar de mais alguma coisa, é só me chamar.",
};

function closingResult(kind: ClosingMessageKind): HandlerResult {
  return {
    reply: CLOSING_REPLIES[kind],
    nextState: "INICIO",
    contextUpdate: { intent: undefined, pendingPrompt: undefined },
  };
}

function askTicketDescription(): HandlerResult {
  return {
    reply:
      "Certo, vou abrir um chamado para o suporte técnico. " +
      "Em poucas palavras, qual é o problema?",
    nextState: "INICIO",
    contextUpdate: {
      ...CLEARED_TICKET_CONTEXT,
      intent: "SUPORTE",
      pendingAction: undefined,
      pendingPrompt: "TICKET_DESCRIPTION",
      ticketId: undefined,
      ticketCode: undefined,
    },
  };
}

function askTicketDetails(summary: string): HandlerResult {
  return {
    reply:
      `Entendi: "${summary}".\n\n` +
      "Para o suporte resolver mais rápido, conte mais detalhes: quando aconteceu, " +
      "o código do agendamento (se houver), valores envolvidos e o que você já tentou.\n\n" +
      'Se não tiver mais nada a acrescentar, responda "só isso".',
    nextState: "INICIO",
    contextUpdate: {
      ...CLEARED_TICKET_CONTEXT,
      intent: "SUPORTE",
      pendingAction: undefined,
      pendingPrompt: "TICKET_DETAILS",
      ticketSummary: summary,
      ticketId: undefined,
      ticketCode: undefined,
    },
  };
}

function askTicketConfirmation(summary: string, details?: string): HandlerResult {
  const draft = buildChatbotTicket(summary, details);
  return {
    reply:
      "Confira o chamado antes de eu abrir:\n\n" +
      `Título: ${draft.title}\n` +
      `Categoria: ${TICKET_CATEGORY_LABELS[draft.category]}\n` +
      `Descrição: ${draft.description}\n\n` +
      'Posso abrir o chamado? Responda com "sim" ou "não".',
    nextState: "INICIO",
    contextUpdate: {
      intent: "SUPORTE",
      pendingAction: undefined,
      pendingPrompt: "TICKET_CONFIRMATION",
      ticketSummary: summary,
      ticketDetails: details,
      ticketId: undefined,
      ticketCode: undefined,
    },
  };
}

/** Um relato já completo vai direto para a confirmação; um curto pede detalhes. */
function continueWithSummary(summary: string): HandlerResult {
  const words = summary.split(/\s+/).filter(Boolean).length;
  return words >= TICKET_DETAILED_SUMMARY_MIN_WORDS
    ? askTicketConfirmation(summary)
    : askTicketDetails(summary);
}

function handleTicketDescription(userMessage: string): HandlerResult {
  const text = userMessage.trim();
  const answer = normalizeText(text);
  if (
    TICKET_ABORT_PATTERN.test(answer) ||
    TICKET_DESCRIPTION_ABORT_PATTERN.test(answer)
  ) {
    return TICKET_CANCELLED_RESULT;
  }
  const summary = (extractProblemStatement(text) || text).slice(
    0,
    TICKET_DESCRIPTION_MAX_LENGTH,
  );
  if (summary.length < TICKET_DESCRIPTION_MIN_LENGTH) {
    return {
      reply:
        "Preciso de um pouco mais de detalhes para o suporte entender o problema. " +
        "Pode descrever o que aconteceu?",
      nextState: "INICIO",
      contextUpdate: {},
    };
  }
  return continueWithSummary(summary);
}

function handleTicketDetails(
  userMessage: string,
  ctx: BotSessionContext,
): HandlerResult {
  if (!ctx.ticketSummary) return askTicketDescription();

  const text = userMessage.trim();
  const answer = normalizeText(text);
  if (TICKET_ABORT_PATTERN.test(answer)) return TICKET_CANCELLED_RESULT;
  if (TICKET_DETAILS_SKIP_PATTERN.test(answer)) {
    return askTicketConfirmation(ctx.ticketSummary);
  }
  return askTicketConfirmation(
    ctx.ticketSummary,
    text.slice(0, TICKET_DESCRIPTION_MAX_LENGTH),
  );
}

async function handleTicketConfirmation(
  userMessage: string,
  ctx: BotSessionContext,
  userId: number,
): Promise<HandlerResult> {
  if (!ctx.ticketSummary) return askTicketDescription();

  const answer = normalizeText(userMessage);
  if (TICKET_DENY_PATTERN.test(answer)) return TICKET_CANCELLED_RESULT;
  if (!TICKET_CONFIRM_PATTERN.test(answer)) {
    return {
      reply: 'Deseja abrir o chamado? Responda com "sim" ou "não".',
      nextState: "INICIO",
      contextUpdate: {},
    };
  }

  try {
    const ticket = await openTicketFromChat(
      userId,
      ctx.ticketSummary,
      ctx.ticketDetails,
    );
    return {
      reply:
        `Chamado ${ticket.ticket_code} aberto com sucesso! ✅\n\n` +
        'Nossa equipe de suporte vai analisar e responder por lá. Toque em "Ver chamado" para acompanhar.\n\n' +
        "Posso ajudar com mais alguma coisa?",
      nextState: "INICIO",
      // O app usa ticketId e ticketCode para exibir o atalho "Ver chamado".
      contextUpdate: {
        ...CLEARED_TICKET_CONTEXT,
        ticketId: ticket.id,
        ticketCode: ticket.ticket_code,
      },
    };
  } catch (error) {
    if (error instanceof TicketOpeningNotAllowedError) {
      return ADMIN_CANNOT_OPEN_TICKET_RESULT;
    }
    logError("Bot: falha ao abrir chamado de suporte", error, { userId });
    // Mantém o rascunho: um novo "sim" tenta abrir o chamado outra vez.
    return {
      reply:
        "Não consegui abrir o chamado agora. Responda \"sim\" para tentar de novo " +
        "ou \"não\" para desistir.",
      nextState: "INICIO",
      contextUpdate: {},
    };
  }
}

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

    if (ctx.pendingPrompt === "TICKET_DESCRIPTION") {
      return handleTicketDescription(userMessage);
    }
    if (ctx.pendingPrompt === "TICKET_DETAILS") {
      return handleTicketDetails(userMessage, ctx);
    }
    if (ctx.pendingPrompt === "TICKET_CONFIRMATION") {
      return handleTicketConfirmation(userMessage, ctx, userId);
    }

    // Um agradecimento ou despedida também encerra a oferta pendente:
    // "obrigado" diante de "Deseja agendar?" é uma recusa educada. Já uma
    // concordância ("ok", "beleza") responde à oferta e só é tratada depois.
    const closing = classifyClosingMessage(userMessage);
    if (closing === "THANKS" || closing === "FAREWELL") {
      return closingResult(closing);
    }

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

    if (closing === "ACKNOWLEDGMENT") return closingResult(closing);

    switch (nlu.intent) {
      case "SAUDACAO":
        return {
          reply:
            "Olá! 👋 Sou o assistente virtual do DelBicos. Posso ajudá-lo a:\n" +
            "• Agendar um serviço\n" +
            "• Consultar seus agendamentos\n" +
            "• Cancelar ou reagendar\n" +
            "• Abrir um chamado de suporte técnico\n\n" +
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
      case "CANCELAR": {
        const action = nlu.intent === "CANCELAR" ? "CANCEL" : "RESCHEDULE";
        const actionText = nlu.intent === "CANCELAR" ? "cancelar" : "reagendar";
        const intentName = nlu.intent;

        const clientRecord = await ClientModel.findOne({ where: { user_id: userId } });
        let activeAppointments: AppointmentWithRelations[] = [];

        if (clientRecord) {
          activeAppointments = (await AppointmentModel.findAll({
            where: {
              client_id: clientRecord.id,
              status: { [Op.in]: ["pending", "confirmed"] },
              start_time: { [Op.gte]: new Date() },
            },
            include: [{ model: ServiceModel, as: "Service" }],
            order: [["start_time", "ASC"]],
            limit: 5,
          })) as AppointmentWithRelations[];
        }

        if (activeAppointments.length > 0) {
          const optionLabels: string[] = [];
          const appointmentList: Array<{ index: number; id: number; shortId?: string }> = [];

          const lines = activeAppointments.map((a, i) => {
            const idx = i + 1;
            const d = new Date(a.start_time);
            const dateStr = d.toLocaleDateString("pt-BR", { timeZone: DEFAULT_BOT_TIME_ZONE });
            const timeStr = d.toLocaleTimeString("pt-BR", { timeZone: DEFAULT_BOT_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
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

        const defaultWord = nlu.intent === "CANCELAR" ? "cancelar" : "reagendar";
        return {
          reply:
            `Para ${defaultWord}, preciso do ID do agendamento. Você pode encontrá-lo na seção "Meus Agendamentos" do app.\n\nDigite o número do ID do agendamento:`,
          nextState: "AGUARDANDO_ID_AGENDAMENTO",
          contextUpdate: { intent: intentName, pendingAction: action },
        };
      }

      case "SUPORTE": {
        // Recusa o administrador antes de pedir a descrição, para não fazê-lo
        // responder duas perguntas inúteis. openTicketFromChat mantém a mesma
        // checagem na gravação.
        if (await isAdmin(userId)) return ADMIN_CANNOT_OPEN_TICKET_RESULT;

        // Um relato de problema já traz o resumo, sem cumprimentos nem o
        // pedido de suporte ("Legal, porém fui cobrado duas vezes, quero
        // suporte" vira "Fui cobrado duas vezes"). Um pedido genérico ("quero
        // abrir um chamado") ainda precisa do relato do usuário.
        const summary = extractProblemStatement(userMessage).slice(
          0,
          TICKET_DESCRIPTION_MAX_LENGTH,
        );
        if (
          isSupportProblemReport(userMessage) &&
          summary.length >= TICKET_DESCRIPTION_MIN_LENGTH
        ) {
          return continueWithSummary(summary);
        }
        return askTicketDescription();
      }

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
        const upcoming = (await AppointmentModel.findAll({
          where: {
            client_id: clientRecord.id,
            status: { [Op.in]: ["pending", "confirmed"] },
            start_time: { [Op.gte]: new Date() },
          },
          include: [{ model: ServiceModel, as: "Service" }],
          order: [["start_time", "ASC"]],
          limit: 5,
        })) as AppointmentWithRelations[];
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
        const lines = upcoming.map((a, i) => {
          const d = new Date(a.start_time);
          const dateStr = d.toLocaleDateString("pt-BR", { timeZone: DEFAULT_BOT_TIME_ZONE });
          const timeStr = d.toLocaleTimeString("pt-BR", { timeZone: DEFAULT_BOT_TIME_ZONE, hour: "2-digit", minute: "2-digit" });
          return `${i + 1}. ID ${a.short_id || a.id} — ${a.Service?.title ?? "serviço"} — ${dateStr} às ${timeStr} (${a.status})`;
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
            "Entendi. No momento, consigo ajudar com serviços e agendamentos do DelBicos. " +
            "Você pode:\n" +
            "• Agendar um serviço\n" +
            "• Consultar seus agendamentos\n" +
            "• Cancelar ou reagendar\n" +
            "• Abrir um chamado de suporte técnico\n\n" +
            'Por exemplo, diga: "quero agendar uma limpeza".',
          nextState: "INICIO",
          contextUpdate: {},
        };
    }
  }
}
