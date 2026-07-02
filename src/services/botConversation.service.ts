import { Op } from "sequelize";
import { AppointmentModel } from "../models/Appointment";
import { ClientModel } from "../models/Client";
import { ServiceModel } from "../models/Service";
import { ProfessionalModel } from "../models/Professional";
import { UserModel } from "../models/User";
import { NotificationModel } from "../models/Notification";
import {
  BotChatSessionModel,
  BotSessionContext,
  BotSessionState,
  BotPendingAction,
} from "../models/BotChatSession";
import { BotChatMessageModel } from "../models/BotChatMessage";
import { analyzeMessage, NluResult } from "./nlu.service";
import { getAvailableSlots } from "./availability.service";
import { ensureChatRoomForAppointment } from "../utils/chatRoom";
import logger, { logError } from "../utils/logger";

// ─── Tipos públicos ─────────────────────────────────────────────────────────

export interface BotMessageResponse {
  sessionId: number;
  message: string;
  state: BotSessionState;
  context: BotSessionContext;
}

export interface BotSessionHistory {
  session: {
    id: number;
    state: BotSessionState;
    status: string;
    channel: string;
    started_at: Date;
    ended_at: Date | null;
    appointment_id: number | null;
  };
  messages: Array<{
    id: number;
    sender: "user" | "bot";
    content: string;
    intent: string | null;
    createdAt: Date;
  }>;
}

// ─── Helpers de formatação ──────────────────────────────────────────────────

function formatDatePtBR(date: string): string {
  const [year, month, day] = date.split("-");
  const months = [
    "jan", "fev", "mar", "abr", "mai", "jun",
    "jul", "ago", "set", "out", "nov", "dez",
  ];
  return `${day}/${months[Number(month) - 1]}/${year}`;
}

function formatCurrency(cents: number | undefined, decimal: number | undefined): string {
  const value = cents != null ? cents / 100 : decimal ?? 0;
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function findNearbySlots(allSlots: string[], requestedTime: string, maxResults = 5): string[] {
  const [rh, rm] = requestedTime.split(":").map(Number);
  const reqMinutes = rh * 60 + rm;
  return allSlots
    .map((slot) => {
      const [h, m] = slot.split(":").map(Number);
      return { slot, diff: Math.abs(h * 60 + m - reqMinutes) };
    })
    .sort((a, b) => a.diff - b.diff)
    .slice(0, maxResults)
    .map((x) => x.slot)
    .sort();
}

/** Verifica se a data é válida e >= hoje */
function isValidFutureDate(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return new Date(date + "T00:00:00") >= today;
}

/** Tenta extrair HH:MM de texto livre */
function parseTimeFromText(text: string): string | null {
  const match = text.match(/\b(\d{1,2})[h:](\d{2})?\b/i);
  if (match) {
    const h = match[1].padStart(2, "0");
    const m = (match[2] || "00").padStart(2, "0");
    if (Number(h) < 24 && Number(m) < 60) return `${h}:${m}`;
  }
  const simpleMatch = text.match(/\b(\d{1,2})[hH]\b/);
  if (simpleMatch) {
    const h = simpleMatch[1].padStart(2, "0");
    if (Number(h) < 24) return `${h}:00`;
  }
  return null;
}

/** Encontra slots em dias próximos ao requestedTime */
async function findAlternativeDays(
  professionalId: number,
  serviceId: number,
  duration: number,
  requestedTime: string,
  fromDate: string,
  daysAhead = 5,
): Promise<Array<{ date: string; slots: string[] }>> {
  const results: Array<{ date: string; slots: string[] }> = [];
  const base = new Date(fromDate + "T12:00:00.000Z");

  for (let i = 1; i <= daysAhead; i++) {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    const dateStr = d.toISOString().split("T")[0];
    const slots = await getAvailableSlots(professionalId, dateStr, duration, serviceId);
    if (slots.length > 0) {
      // Prefere o slot mais próximo do horário pedido
      const nearby = findNearbySlots(slots, requestedTime, 3);
      results.push({ date: dateStr, slots: nearby });
      if (results.length >= 3) break;
    }
  }
  return results;
}

// ─── Operações de agendamento (chamam modelos seguindo as mesmas regras do controller) ─

async function createBotAppointment(
  userId: number,
  ctx: BotSessionContext,
): Promise<AppointmentModel> {
  const { serviceId, professionalId, date, time } = ctx;
  if (!serviceId || !professionalId || !date || !time)
    throw new Error("Dados insuficientes para criar agendamento");

  const clientRecord = await ClientModel.findOne({ where: { user_id: userId } });
  if (!clientRecord) throw new Error("Usuário não possui perfil de cliente");

  const [professional, service] = await Promise.all([
    ProfessionalModel.findByPk(professionalId),
    ServiceModel.findByPk(serviceId),
  ]);
  if (!professional) throw new Error("Profissional não encontrado");
  if (!service || !service.active) throw new Error("Serviço inativo ou não encontrado");

  const [hour, minute] = time.split(":").map(Number);
  const startTime = new Date(`${date}T00:00:00.000Z`);
  startTime.setUTCHours(hour, minute, 0, 0);
  const endTime = new Date(startTime.getTime() + service.duration * 60000);

  // Verificação de disponibilidade (double-booking guard)
  const slots = await getAvailableSlots(professionalId, date, service.duration, serviceId);
  const slotStr = startTime.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "UTC",
  });
  if (!slots.includes(slotStr)) {
    throw new Error(
      `Horário ${time} não está mais disponível. Por favor, escolha outro horário.`,
    );
  }

  const addressId = clientRecord.main_address_id ?? 1; // fallback; address_id nullable no contexto do bot
  const appointment = await AppointmentModel.create({
    professional_id: professionalId,
    client_id: clientRecord.id,
    service_id: serviceId,
    address_id: addressId,
    start_time: startTime,
    end_time: endTime,
    status: "pending",
  });

  // Cria sala de chat P2P para este agendamento (mesma lógica do controller)
  try {
    await ensureChatRoomForAppointment(appointment);
  } catch (e) {
    logger.warn("Bot: falha ao criar chat_room para agendamento", {
      appointmentId: appointment.id,
    });
  }

  // Notificações (mesma lógica do controller existente)
  try {
    const clientUser = await UserModel.findByPk(clientRecord.user_id);
    const profUser = await UserModel.findByPk(professional.user_id);
    const dateStr = startTime.toLocaleDateString("pt-BR");
    const timeStr = startTime.toLocaleTimeString("pt-BR", {
      hour: "2-digit",
      minute: "2-digit",
    });

    if (profUser) {
      await NotificationModel.create({
        user_id: profUser.id,
        title: "Novo Agendamento Recebido",
        message: `Agendamento de ${clientUser?.name || "cliente"} para "${service.title}" em ${dateStr} às ${timeStr}.`,
        notification_type: "appointment",
        related_entity_id: appointment.id,
        is_read: false,
      });
    }
    if (clientUser) {
      await NotificationModel.create({
        user_id: clientUser.id,
        title: "Agendamento Criado",
        message: `Seu agendamento para "${service.title}" em ${dateStr} às ${timeStr} foi criado.`,
        notification_type: "appointment",
        related_entity_id: appointment.id,
        is_read: false,
      });
    }
  } catch (e) {
    logger.warn("Bot: falha ao criar notificações do agendamento", {
      appointmentId: appointment.id,
    });
  }

  logger.info("Bot: agendamento criado via chatbot", {
    appointmentId: appointment.id,
    userId,
  });
  return appointment;
}

async function cancelBotAppointment(userId: number, appointmentId: number): Promise<void> {
  const clientRecord = await ClientModel.findOne({ where: { user_id: userId } });
  if (!clientRecord) throw new Error("Usuário não possui perfil de cliente");

  const appointment = await AppointmentModel.findByPk(appointmentId, {
    include: [{ model: ServiceModel, as: "Service" }],
  });
  if (!appointment) throw new Error("Agendamento não encontrado");
  if (appointment.client_id !== clientRecord.id)
    throw new Error("Você não tem permissão para cancelar este agendamento");
  if (appointment.status === "completed")
    throw new Error("Não é possível cancelar um agendamento já concluído");
  if (appointment.status === "canceled")
    throw new Error("Este agendamento já está cancelado");

  appointment.status = "canceled";
  await appointment.save();
  logger.info("Bot: agendamento cancelado via chatbot", { appointmentId, userId });
}

// ─── Handlers de estado ─────────────────────────────────────────────────────

interface HandlerResult {
  reply: string;
  nextState: BotSessionState;
  contextUpdate: Partial<BotSessionContext>;
  appointmentId?: number;
  finalize?: boolean;
}

async function handleInicio(
  userId: number,
  nlu: NluResult,
  session: BotChatSessionModel,
): Promise<HandlerResult> {
  const ctx = (session.context ?? {}) as BotSessionContext;

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

async function handleColetandoServico(
  userMessage: string,
  nlu: NluResult,
  session: BotChatSessionModel,
): Promise<HandlerResult> {
  const ctx = (session.context ?? {}) as BotSessionContext;

  // Se há opções listadas e usuário digitou um número
  if (ctx.serviceOptions && ctx.serviceOptions.length > 0) {
    const choice = parseInt(userMessage.trim(), 10);
    if (!isNaN(choice) && choice >= 1 && choice <= ctx.serviceOptions.length) {
      const picked = ctx.serviceOptions[choice - 1];
      const contextUpdate: Partial<BotSessionContext> = {
        serviceId: picked.id,
        serviceName: picked.title,
        servicePrice: picked.price,
        serviceDuration: picked.duration,
        professionalId: picked.professionalId,
        professionalName: picked.professionalName,
        serviceOptions: undefined,
      };
      const dateHint = ctx.date ? ` para ${formatDatePtBR(ctx.date)}` : "";
      return {
        reply: `Ótimo! Serviço selecionado: "${picked.title}" com ${picked.professionalName}${dateHint}.\n\nQual data você prefere? (Ex: amanhã, 10/07/2026 ou AAAA-MM-DD)`,
        nextState: ctx.date ? "COLETANDO_HORARIO" : "COLETANDO_DATA",
        contextUpdate,
      };
    }
  }

  const searchTerm = nlu.entities.service ?? userMessage.trim();
  if (!searchTerm) {
    return {
      reply: "Por favor, informe o nome ou tipo de serviço que deseja agendar.",
      nextState: "COLETANDO_SERVICO",
      contextUpdate: {},
    };
  }

  const services = await ServiceModel.findAll({
    where: {
      title: { [Op.like]: `%${searchTerm}%` },
      active: true,
    },
    include: [
      {
        model: ProfessionalModel,
        as: "Professional",
        include: [{ model: UserModel, as: "User", attributes: ["name"] }],
      },
    ],
    limit: 5,
  });

  if (services.length === 0) {
    return {
      reply: `Não encontrei serviços com o nome "${searchTerm}". Tente um termo diferente ou mais genérico (ex: "cabelo", "pintura"):`,
      nextState: "COLETANDO_SERVICO",
      contextUpdate: { serviceOptions: undefined },
    };
  }

  if (services.length === 1) {
    const svc = services[0] as any;
    const profName = svc.Professional?.User?.name ?? "Profissional";
    return {
      reply: `Encontrei: "${svc.title}" com ${profName} — ${formatCurrency(svc.price_cents, svc.price)}.\n\nQual data você prefere?`,
      nextState: "COLETANDO_DATA",
      contextUpdate: {
        serviceId: svc.id,
        serviceName: svc.title,
        servicePrice: svc.price_cents ?? svc.price * 100,
        serviceDuration: svc.duration,
        professionalId: svc.professional_id,
        professionalName: profName,
        serviceOptions: undefined,
      },
    };
  }

  // Múltiplos resultados
  const options = services.map((svc: any) => {
    const profName = svc.Professional?.User?.name ?? "Profissional";
    return {
      id: svc.id,
      title: svc.title,
      professionalId: svc.professional_id,
      professionalName: profName,
      price: svc.price_cents ?? Math.round(svc.price * 100),
      duration: svc.duration,
    };
  });
  const lines = options.map(
    (o, i) => `${i + 1}. ${o.title} — ${o.professionalName} — ${formatCurrency(undefined, o.price / 100)}`,
  );
  return {
    reply: `Encontrei ${options.length} serviços:\n\n${lines.join("\n")}\n\nQual deles você prefere? Responda com o número:`,
    nextState: "COLETANDO_SERVICO",
    contextUpdate: { serviceOptions: options },
  };
}

async function handleColetandoData(
  userMessage: string,
  nlu: NluResult,
  session: BotChatSessionModel,
): Promise<HandlerResult> {
  const ctx = (session.context ?? {}) as BotSessionContext;

  // Tenta extrair a data: primeiro do NLU, depois do texto diretamente
  let date = nlu.entities.date;
  if (!date) {
    // Tenta parsear formatos brasileiros dd/mm/aaaa
    const brMatch = userMessage.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (brMatch) {
      date = `${brMatch[3]}-${brMatch[2].padStart(2, "0")}-${brMatch[1].padStart(2, "0")}`;
    }
  }

  if (!date || !isValidFutureDate(date)) {
    return {
      reply:
        "Por favor, informe uma data válida no futuro.\nFormatos aceitos: DD/MM/AAAA, AAAA-MM-DD ou texto como \"amanhã\", \"próxima segunda\".",
      nextState: "COLETANDO_DATA",
      contextUpdate: {},
    };
  }

  const isAlterar = ctx.pendingAction === "RESCHEDULE";
  const field = isAlterar ? "newDate" : "date";

  // Busca slots disponíveis já para dar uma prévia
  const profId = ctx.professionalId;
  const svcId = ctx.serviceId;
  const duration = ctx.serviceDuration ?? 60;

  let slotPreview = "";
  if (profId && svcId) {
    const slots = await getAvailableSlots(profId, date, duration, svcId);
    if (slots.length === 0) {
      return {
        reply: `Nenhum horário disponível em ${formatDatePtBR(date)}. Por favor, escolha outra data:`,
        nextState: "COLETANDO_DATA",
        contextUpdate: {},
      };
    }
    slotPreview = `\n\nHorários disponíveis em ${formatDatePtBR(date)}: ${slots.slice(0, 8).join(", ")}${slots.length > 8 ? ` e mais ${slots.length - 8}...` : ""}.`;
  }

  return {
    reply: `Data registrada: ${formatDatePtBR(date)}.${slotPreview}\n\nQual horário você prefere? (Formato HH:MM, ex: 09:30)`,
    nextState: "COLETANDO_HORARIO",
    contextUpdate: { [field]: date },
  };
}

async function handleColetandoHorario(
  userMessage: string,
  nlu: NluResult,
  session: BotChatSessionModel,
): Promise<HandlerResult> {
  const ctx = (session.context ?? {}) as BotSessionContext;
  const isAlterar = ctx.pendingAction === "RESCHEDULE";
  const date = isAlterar ? (ctx.newDate ?? ctx.date) : ctx.date;
  const { serviceId, professionalId } = ctx;

  if (!date || !serviceId || !professionalId) {
    return {
      reply: "Ocorreu um erro na sessão. Vamos recomeçar — qual serviço você deseja agendar?",
      nextState: "COLETANDO_SERVICO",
      contextUpdate: {
        serviceId: undefined, professionalId: undefined, date: undefined, time: undefined,
      },
    };
  }

  // Verifica se usuário está escolhendo de uma lista numerada de sugestões
  if (ctx.suggestedSlots && ctx.suggestedSlots.length > 0) {
    const choice = parseInt(userMessage.trim(), 10);
    if (!isNaN(choice) && choice >= 1 && choice <= ctx.suggestedSlots.length) {
      const pickedSlot = ctx.suggestedSlots[choice - 1];
      const field = isAlterar ? "newTime" : "time";
      return buildConfirmationResponse(ctx, date, pickedSlot, { [field]: pickedSlot, suggestedSlots: undefined });
    }
  }

  const time = nlu.entities.time ?? parseTimeFromText(userMessage);
  if (!time) {
    return {
      reply: "Não consegui identificar o horário. Por favor, informe no formato HH:MM (ex: 14:30):",
      nextState: "COLETANDO_HORARIO",
      contextUpdate: { suggestedSlots: undefined },
    };
  }

  const duration = ctx.serviceDuration ?? 60;
  const slots = await getAvailableSlots(professionalId, date, duration, serviceId);

  if (slots.includes(time)) {
    const field = isAlterar ? "newTime" : "time";
    return buildConfirmationResponse(ctx, date, time, { [field]: time, suggestedSlots: undefined });
  }

  // Horário solicitado não disponível — sugerir alternativas
  const nearbyToday = findNearbySlots(slots, time, 5);
  const altDays = nearbyToday.length === 0
    ? await findAlternativeDays(professionalId, serviceId, duration, time, date)
    : [];

  const suggestions: string[] = [];
  const suggestionLines: string[] = [];

  nearbyToday.forEach((s, i) => {
    suggestions.push(s);
    suggestionLines.push(`${i + 1}. ${s} em ${formatDatePtBR(date)}`);
  });

  altDays.forEach(({ date: altDate, slots: altSlots }) => {
    altSlots.forEach((s) => {
      suggestions.push(`${altDate}|${s}`);
      suggestionLines.push(`${suggestions.length}. ${s} em ${formatDatePtBR(altDate)}`);
    });
  });

  if (suggestions.length === 0) {
    return {
      reply: `Nenhum horário disponível próximo às ${time} em ${formatDatePtBR(date)}. Gostaria de tentar outra data?`,
      nextState: "COLETANDO_DATA",
      contextUpdate: { suggestedSlots: undefined },
    };
  }

  return {
    reply:
      `O horário ${time} não está disponível em ${formatDatePtBR(date)}.\n\n` +
      `Horários alternativos:\n${suggestionLines.join("\n")}\n\n` +
      `Escolha um número ou informe outro horário:`,
    nextState: "COLETANDO_HORARIO",
    contextUpdate: { suggestedSlots: suggestions },
  };
}

function buildConfirmationResponse(
  ctx: BotSessionContext,
  date: string,
  time: string,
  ctxUpdate: Partial<BotSessionContext>,
): HandlerResult {
  const isAlterar = ctx.pendingAction === "RESCHEDULE";
  const price = ctx.servicePrice != null ? formatCurrency(ctx.servicePrice, undefined) : "";
  const oldInfo = isAlterar && ctx.appointmentId
    ? `\n\n📋 Agendamento original (ID ${ctx.appointmentId}) será cancelado automaticamente.`
    : "";

  return {
    reply:
      `📅 *Resumo do agendamento:*\n\n` +
      `Serviço: ${ctx.serviceName ?? "N/A"}\n` +
      `Profissional: ${ctx.professionalName ?? "N/A"}\n` +
      `Data: ${formatDatePtBR(date)}\n` +
      `Horário: ${time}\n` +
      (price ? `Valor: ${price}\n` : "") +
      oldInfo +
      `\nConfirma? Responda com *sim* para confirmar ou *não* para cancelar.`,
    nextState: "CONFIRMACAO",
    contextUpdate: ctxUpdate,
  };
}

async function handleConfirmacao(
  userMessage: string,
  userId: number,
  session: BotChatSessionModel,
): Promise<HandlerResult> {
  const ctx = (session.context ?? {}) as BotSessionContext;
  const lower = userMessage.toLowerCase().trim();
  const confirmed = /\b(sim|s|yes|confirmar|confirmo|ok|pode|vamos)\b/.test(lower);
  const denied = /\b(n[aã]o|nao|no|cancelar|desistir|voltar)\b/.test(lower);

  if (!confirmed && !denied) {
    return {
      reply: "Por favor, responda com *sim* para confirmar ou *não* para cancelar:",
      nextState: "CONFIRMACAO",
      contextUpdate: {},
    };
  }

  if (denied) {
    return {
      reply:
        ctx.pendingAction === "CANCEL"
          ? "Ok, o cancelamento foi descartado. Posso ajudá-lo com mais alguma coisa?"
          : "Ok, agendamento descartado. Gostaria de escolher outra data ou horário?",
      nextState: ctx.pendingAction === "CANCEL" ? "FINALIZADO" : "COLETANDO_DATA",
      contextUpdate: { time: undefined, newTime: undefined },
      finalize: ctx.pendingAction === "CANCEL",
    };
  }

  // Confirmado — executa a ação pendente
  const pendingAction = ctx.pendingAction ?? "CREATE";

  try {
    if (pendingAction === "CANCEL") {
      if (!ctx.appointmentId) throw new Error("ID do agendamento não encontrado na sessão");
      await cancelBotAppointment(userId, ctx.appointmentId);
      return {
        reply: `✅ Agendamento ID ${ctx.appointmentId} cancelado com sucesso.`,
        nextState: "FINALIZADO",
        contextUpdate: {},
        finalize: true,
      };
    }

    if (pendingAction === "RESCHEDULE") {
      if (!ctx.appointmentId) throw new Error("ID do agendamento original não encontrado");
      // Cancela o agendamento antigo
      await cancelBotAppointment(userId, ctx.appointmentId);
      // Cria o novo com as datas atualizadas
      const reschedCtx: BotSessionContext = {
        ...ctx,
        date: ctx.newDate ?? ctx.date,
        time: ctx.newTime ?? ctx.time,
      };
      const newAppointment = await createBotAppointment(userId, reschedCtx);
      return {
        reply:
          `✅ Reagendamento concluído!\n\n` +
          `Novo agendamento ID: ${newAppointment.id}\n` +
          `Serviço: ${ctx.serviceName}\n` +
          `Data: ${formatDatePtBR(reschedCtx.date!)}\n` +
          `Horário: ${reschedCtx.time}\n\n` +
          `Aguarde a confirmação do profissional.`,
        nextState: "FINALIZADO",
        contextUpdate: {},
        appointmentId: newAppointment.id,
        finalize: true,
      };
    }

    // CREATE (padrão)
    const appointment = await createBotAppointment(userId, ctx);
    return {
      reply:
        `✅ Agendamento criado com sucesso!\n\n` +
        `ID: ${appointment.id}\n` +
        `Serviço: ${ctx.serviceName}\n` +
        `Data: ${formatDatePtBR(ctx.date!)}\n` +
        `Horário: ${ctx.time}\n\n` +
        `Aguarde a confirmação do profissional. Você receberá uma notificação.`,
      nextState: "FINALIZADO",
      contextUpdate: {},
      appointmentId: appointment.id,
      finalize: true,
    };
  } catch (error: any) {
    logError("Bot: erro ao executar ação de confirmação", error, { userId });
    return {
      reply: `❌ ${error.message ?? "Ocorreu um erro. Por favor, tente novamente."}`,
      nextState: pendingAction === "CREATE" || pendingAction === "RESCHEDULE"
        ? "COLETANDO_HORARIO"
        : "INICIO",
      contextUpdate: { time: undefined, newTime: undefined },
    };
  }
}

async function handleAguardandoIdAgendamento(
  userMessage: string,
  nlu: NluResult,
  userId: number,
  session: BotChatSessionModel,
): Promise<HandlerResult> {
  const ctx = (session.context ?? {}) as BotSessionContext;

  const rawId = nlu.entities.appointment_id ?? parseInt(userMessage.trim(), 10);
  if (isNaN(rawId) || rawId <= 0) {
    return {
      reply: "Por favor, informe um ID de agendamento válido (número inteiro):",
      nextState: "AGUARDANDO_ID_AGENDAMENTO",
      contextUpdate: {},
    };
  }

  const clientRecord = await ClientModel.findOne({ where: { user_id: userId } });
  if (!clientRecord) {
    return {
      reply: "Você não possui perfil de cliente cadastrado.",
      nextState: "FINALIZADO",
      contextUpdate: {},
      finalize: true,
    };
  }

  const appointment = await AppointmentModel.findByPk(rawId, {
    include: [
      { model: ServiceModel, as: "Service" },
      {
        model: ProfessionalModel,
        as: "Professional",
        include: [{ model: UserModel, as: "User", attributes: ["name"] }],
      },
    ],
  });

  if (!appointment || appointment.client_id !== clientRecord.id) {
    return {
      reply: `Agendamento ID ${rawId} não encontrado ou não pertence a você. Verifique o ID e tente novamente:`,
      nextState: "AGUARDANDO_ID_AGENDAMENTO",
      contextUpdate: {},
    };
  }

  if (appointment.status === "completed") {
    return {
      reply: "Este agendamento já foi concluído e não pode ser alterado.",
      nextState: "INICIO",
      contextUpdate: {},
    };
  }
  if (appointment.status === "canceled") {
    return {
      reply: "Este agendamento já está cancelado.",
      nextState: "INICIO",
      contextUpdate: {},
    };
  }

  const apptData: any = appointment;
  const svcTitle = apptData.Service?.title ?? "Serviço";
  const profName = apptData.Professional?.User?.name ?? "Profissional";
  const startDate = new Date(appointment.start_time);
  const dateStr = startDate.toLocaleDateString("pt-BR");
  const timeStr = startDate.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

  if (ctx.pendingAction === "CANCEL") {
    return {
      reply:
        `Você quer cancelar o seguinte agendamento?\n\n` +
        `ID: ${appointment.id}\n` +
        `Serviço: ${svcTitle}\n` +
        `Profissional: ${profName}\n` +
        `Data: ${dateStr} às ${timeStr}\n` +
        `Status: ${appointment.status}\n\n` +
        `Confirma o cancelamento? (*sim* / *não*)`,
      nextState: "CONFIRMACAO",
      contextUpdate: {
        appointmentId: appointment.id,
        serviceId: appointment.service_id,
        professionalId: appointment.professional_id,
      },
    };
  }

  // RESCHEDULE
  return {
    reply:
      `Reagendando:\n\n` +
      `ID: ${appointment.id}\n` +
      `Serviço: ${svcTitle}\n` +
      `Profissional: ${profName}\n` +
      `Data atual: ${dateStr} às ${timeStr}\n\n` +
      `Qual nova data você prefere?`,
    nextState: "COLETANDO_DATA",
    contextUpdate: {
      appointmentId: appointment.id,
      serviceId: appointment.service_id,
      professionalId: appointment.professional_id,
      serviceName: svcTitle,
      professionalName: profName,
      serviceDuration: apptData.Service?.duration ?? 60,
      servicePrice: apptData.Service?.price_cents ?? Math.round((apptData.Service?.price ?? 0) * 100),
    },
  };
}

// ─── Função principal pública ───────────────────────────────────────────────

export async function processMessage(
  userId: number,
  userMessage: string,
  sessionId?: number,
  channel = "web",
): Promise<BotMessageResponse> {
  // 1. Carregar ou criar sessão
  let session: BotChatSessionModel;

  if (sessionId) {
    const found = await BotChatSessionModel.findByPk(sessionId);
    if (!found || found.user_id !== userId) {
      throw new Error("Sessão não encontrada ou não pertence a este usuário");
    }
    session = found;
  } else {
    session = await BotChatSessionModel.create({
      user_id: userId,
      channel,
      status: "active",
      state: "INICIO",
      context: {},
    });
  }

  // Sessão já encerrada — abre nova automaticamente
  if (session.status !== "active") {
    session = await BotChatSessionModel.create({
      user_id: userId,
      channel: session.channel,
      status: "active",
      state: "INICIO",
      context: {},
    });
  }

  const trimmedMessage = userMessage.trim().slice(0, 2000);

  // 2. Persiste mensagem do usuário
  const ctx = (session.context ?? {}) as BotSessionContext;
  const nlu = await analyzeMessage(trimmedMessage, ctx as Record<string, unknown>);

  await BotChatMessageModel.create({
    session_id: session.id,
    sender: "user",
    content: trimmedMessage,
    intent: nlu.intent,
    entities: nlu.entities as Record<string, unknown>,
  });

  // 3. Roteia para o handler do estado atual
  let result: HandlerResult;

  try {
    switch (session.state) {
      case "INICIO":
        result = await handleInicio(userId, nlu, session);
        break;
      case "COLETANDO_SERVICO":
        result = await handleColetandoServico(trimmedMessage, nlu, session);
        // Se o NLU detectou intenção de agendar com dados suficientes, re-processa
        if (result.nextState === "COLETANDO_SERVICO" && nlu.intent === "AGENDAR" && nlu.entities.service) {
          result = await handleColetandoServico(nlu.entities.service, nlu, session);
        }
        break;
      case "COLETANDO_DATA":
        result = await handleColetandoData(trimmedMessage, nlu, session);
        break;
      case "COLETANDO_HORARIO":
        result = await handleColetandoHorario(trimmedMessage, nlu, session);
        break;
      case "VERIFICANDO_DISPONIBILIDADE":
        // Estado transitório — retorna ao COLETANDO_HORARIO para re-processar
        result = await handleColetandoHorario(trimmedMessage, nlu, session);
        break;
      case "CONFIRMACAO":
        result = await handleConfirmacao(trimmedMessage, userId, session);
        break;
      case "AGUARDANDO_ID_AGENDAMENTO":
        result = await handleAguardandoIdAgendamento(trimmedMessage, nlu, userId, session);
        break;
      case "FINALIZADO":
        // Sessão encerrada — trata como novo INICIO
        result = await handleInicio(userId, nlu, session);
        if (result.nextState === "INICIO") {
          // Reabre com nova sessão se o usuário quiser continuar
          session.status = "completed";
          session.ended_at = new Date();
          await session.save();
          session = await BotChatSessionModel.create({
            user_id: userId,
            channel: session.channel,
            status: "active",
            state: result.nextState,
            context: result.contextUpdate,
          });
          await BotChatMessageModel.create({
            session_id: session.id,
            sender: "bot",
            content: result.reply,
          });
          return {
            sessionId: session.id,
            message: result.reply,
            state: result.nextState,
            context: result.contextUpdate as BotSessionContext,
          };
        }
        break;
      default:
        result = {
          reply: "Desculpe, houve um erro na sessão. Vamos recomeçar — o que você precisa?",
          nextState: "INICIO",
          contextUpdate: {},
        };
    }
  } catch (error: any) {
    logError("Bot: erro inesperado no processamento de mensagem", error, {
      userId,
      sessionId: session.id,
      state: session.state,
    });
    result = {
      reply: "Desculpe, ocorreu um erro inesperado. Por favor, tente novamente.",
      nextState: session.state,
      contextUpdate: {},
    };
  }

  // 4. Persiste resposta do bot
  await BotChatMessageModel.create({
    session_id: session.id,
    sender: "bot",
    content: result.reply,
  });

  // 5. Atualiza contexto e estado da sessão
  const mergedContext: BotSessionContext = {
    ...(session.context ?? {}),
    ...result.contextUpdate,
  };

  session.state = result.nextState;
  session.context = mergedContext;
  if (result.appointmentId) session.appointment_id = result.appointmentId;
  if (result.finalize) {
    session.status = "completed";
    session.ended_at = new Date();
  }
  await session.save();

  return {
    sessionId: session.id,
    message: result.reply,
    state: result.nextState,
    context: mergedContext,
  };
}

/**
 * Retorna o histórico completo de uma sessão de chatbot.
 */
export async function getSessionHistory(
  sessionId: number,
  userId: number,
): Promise<BotSessionHistory> {
  const session = await BotChatSessionModel.findByPk(sessionId);
  if (!session || session.user_id !== userId) {
    throw new Error("Sessão não encontrada ou não pertence a este usuário");
  }

  const messages = await BotChatMessageModel.findAll({
    where: { session_id: sessionId },
    order: [["created_at", "ASC"]],
  });

  return {
    session: {
      id: session.id,
      state: session.state,
      status: session.status,
      channel: session.channel,
      started_at: session.started_at,
      ended_at: session.ended_at,
      appointment_id: session.appointment_id,
    },
    messages: messages.map((m) => ({
      id: m.id,
      sender: m.sender,
      content: m.content,
      intent: m.intent,
      createdAt: m.createdAt,
    })),
  };
}
