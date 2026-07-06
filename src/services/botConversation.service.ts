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
import { CategoryModel } from "../models/Category";
import { SubCategoryModel } from "../models/Subcategory";
import { analyzeMessage, NluResult, NluEntities } from "./nlu.service";
import { getAvailableSlots } from "./availability.service";
import { ensureChatRoomForAppointment } from "../utils/chatRoom";
import logger, { logError } from "../utils/logger";

// ─── Helpers de normalização e busca ────────────────────────────────────────

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-z0-9\s]/g, "")    // remove caracteres especiais e pontuação
    .replace(/\s+/g, " ")           // normaliza múltiplos espaços
    .trim();
}

function levenshteinDistance(a: string, b: string): number {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substituição
          matrix[i][j - 1] + 1,     // inserção
          matrix[i - 1][j] + 1      // deleção
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

function stringSimilarity(s1: string, s2: string): number {
  const longer = s1.length > s2.length ? s1 : s2;
  const shorter = s1.length > s2.length ? s2 : s1;
  if (longer.length === 0) return 1.0;
  return (longer.length - levenshteinDistance(longer, shorter)) / longer.length;
}

function calculateMatchScore(svc: any, normalizedSearch: string, searchKeywords: string[]): number {
  const svcTitleNorm = normalizeText(svc.title);
  const subcatTitleNorm = svc.Subcategory ? normalizeText(svc.Subcategory.title) : "";
  const catTitleNorm = svc.Subcategory && svc.Subcategory.Category ? normalizeText(svc.Subcategory.Category.title) : "";

  // 1. Exact match or full substring match in service title
  if (svcTitleNorm === normalizedSearch) return 10;
  if (svcTitleNorm.includes(normalizedSearch)) return 8;

  // 2. Exact match or full substring match in subcategory or category
  if (subcatTitleNorm === normalizedSearch) return 7;
  if (catTitleNorm === normalizedSearch) return 6;
  if (subcatTitleNorm.includes(normalizedSearch)) return 5;
  if (catTitleNorm.includes(normalizedSearch)) return 4;

  // 3. Keyword match (all keywords present in combined text)
  const combinedText = `${svcTitleNorm} ${subcatTitleNorm} ${catTitleNorm}`;
  const allKeywordsMatch = searchKeywords.length > 0 && searchKeywords.every(kw => combinedText.includes(kw));
  if (allKeywordsMatch) return 3;

  // 4. Fuzzy similarity fallback (Levenshtein)
  const svcSim = stringSimilarity(normalizedSearch, svcTitleNorm);
  const subcatSim = subcatTitleNorm ? stringSimilarity(normalizedSearch, subcatTitleNorm) : 0;
  const maxSim = Math.max(svcSim, subcatSim);

  if (maxSim >= 0.65) {
    return maxSim * 2; // will be in range [1.3, 2.0]
  }

  return 0;
}

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

/** Offset fixo do fuso de Brasília (UTC-3, sem horário de verão desde 2019). */
const BRAZIL_UTC_OFFSET_HOURS = 3;

/**
 * Converte data + horário informados pelo usuário para Date UTC no banco.
 * Alinhado ao checkout, que envia localDate.toISOString() do cliente.
 */
function parseLocalAppointmentStart(date: string, time: string): Date {
  const [year, month, day] = date.split("-").map(Number);
  const [hour, minute] = time.trim().slice(0, 5).split(":").map(Number);
  return new Date(
    Date.UTC(year, month - 1, day, hour + BRAZIL_UTC_OFFSET_HOURS, minute, 0, 0),
  );
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
  const t = text.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  // Mapeamento de números por extenso para inteiros
  const wordToNum: Record<string, number> = {
    zero: 0, uma: 1, um: 1, dois: 2, duas: 2, tres: 3, quatro: 4,
    cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10,
    onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14,
    quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18,
    dezenove: 19, vinte: 20, "vinte e um": 21, "vinte e dois": 22,
    "vinte e tres": 23,
  };

  // Mapeamento de minutos por extenso
  const minuteWords: Record<string, number> = {
    zero: 0, "e meia": 30, "e quinze": 15, "e um quarto": 15,
    "e quarenta e cinco": 45, "e trinta": 30,
  };

  // Detectar período do dia
  const isTarde = /\b(tarde|da tarde|a tarde)\b/.test(t);
  const isNoite = /\b(noite|da noite|a noite)\b/.test(t);
  const isManha = /\b(manha|da manha|a manha|manha cedo)\b/.test(t);

  // Meio-dia
  if (/\b(meio.?dia)\b/.test(t)) {
    if (/e meia/.test(t)) return "12:30";
    if (/e quinze/.test(t) || /e um quarto/.test(t)) return "12:15";
    if (/e quarenta e cinco/.test(t)) return "12:45";
    return "12:00";
  }

  // Meia-noite
  if (/\b(meia.?noite)\b/.test(t)) {
    if (/e meia/.test(t)) return "00:30";
    return "00:00";
  }

  // Número numérico seguido de "h" ou ":" com minutos opcionais: "14h30", "10:30", "9h"
  const numericMatch = t.match(/\b(\d{1,2})[h:](\d{2})?\b/i);
  if (numericMatch) {
    let h = Number(numericMatch[1]);
    const m = Number(numericMatch[2] || "0");
    // Ajustar AM/PM pelo período
    if ((isTarde || isNoite) && h < 12) h += 12;
    if (isManha && h === 12) h = 0;
    if (h < 24 && m < 60) return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }

  // Só o número seguido de "h": "9h", "14h"
  const simpleNumeric = t.match(/\b(\d{1,2})[h]\b/);
  if (simpleNumeric) {
    let h = Number(simpleNumeric[1]);
    if ((isTarde || isNoite) && h < 12) h += 12;
    if (isManha && h === 12) h = 0;
    if (h < 24) return `${String(h).padStart(2, "0")}:00`;
  }

  // Tentar "quinze para as X" → X:45 (ou ajustar)
  const quinzeParaMatch = t.match(/quinze para (?:as?|as) ([a-z]+)/);
  if (quinzeParaMatch) {
    const hw = quinzeParaMatch[1].trim();
    let h = wordToNum[hw] ?? null;
    if (h !== null) {
      if ((isTarde || isNoite) && h < 12) h += 12;
      if (isManha && h === 12) h = 0;
      return `${String(h).padStart(2, "0")}:45`;
    }
  }

  // Número por extenso: "as quatro da tarde", "quatro horas", "as quatro e meia"
  // Ordena por comprimento decrescente para casar "vinte e um" antes de "vinte"
  const sortedWords = Object.keys(wordToNum).sort((a, b) => b.length - a.length);
  for (const w of sortedWords) {
    if (t.includes(w)) {
      let h = wordToNum[w];
      // Minutos por extenso
      let m = 0;
      if (t.includes("e meia")) m = 30;
      else if (t.includes("e quinze") || t.includes("e um quarto")) m = 15;
      else if (t.includes("e quarenta e cinco")) m = 45;
      else if (t.includes("e trinta")) m = 30;
      else if (t.includes("e vinte")) m = 20;
      else if (t.includes("e dez")) m = 10;
      else if (t.includes("e cinco")) m = 5;

      // Ajustar AM/PM
      if ((isTarde || isNoite) && h < 12) h += 12;
      if (isManha && h === 12) h = 0;
      if (h >= 24) continue;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
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
  selectedTimeIso?: string,
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

  const normalizedTime = time.trim().slice(0, 5);
  let startTime: Date;
  if (selectedTimeIso) {
    const parsed = new Date(selectedTimeIso);
    startTime = isNaN(parsed.getTime())
      ? parseLocalAppointmentStart(date, normalizedTime)
      : parsed;
  } else {
    startTime = parseLocalAppointmentStart(date, normalizedTime);
  }
  const endTime = new Date(startTime.getTime() + service.duration * 60000);

  // Verificação de disponibilidade (double-booking guard)
  const slots = await getAvailableSlots(professionalId, date, service.duration, serviceId);
  if (!slots.includes(normalizedTime)) {
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
    const dateStr = startTime.toLocaleDateString("pt-BR", {
      timeZone: "America/Sao_Paulo",
    });
    const timeStr = normalizedTime;

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

  // 1. Se estamos aguardando confirmação do serviço selecionado
  if (ctx.pendingService) {
    const lower = userMessage.toLowerCase().trim();
    const confirmed = /\b(sim|s|yes|confirmar|confirmo|ok|pode|vamos)\b/.test(lower);
    const denied = /\b(n[aã]o|nao|no|cancelar|desistir|voltar)\b/.test(lower);

    if (!confirmed && !denied) {
      return {
        reply: `Por favor, responda com "sim" para confirmar o serviço "${ctx.pendingService.title}" ou "não" para buscar outro:`,
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {
          serviceOptions: ["Sim", "Não"],
          serviceOptionsData: undefined,
        },
      };
    }

    if (denied) {
      return {
        reply: "Ok, escolha cancelada. Qual serviço você gostaria de agendar? (Ex: corte de cabelo, pintura, limpeza...)",
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {
          pendingService: null,
          serviceOptions: undefined,
          serviceOptionsData: undefined,
        },
      };
    }

    // Confirmado! Transiciona para COLETANDO_DATA (pergunta dia primeiro)
    const picked = ctx.pendingService;
    
    // Busca todos os IDs de serviços ativos com o mesmo título para verificar disponibilidade de múltiplos profissionais
    const matchingServices = await ServiceModel.findAll({
      where: { title: picked.title, active: true },
    });
    const matchedServiceIds = matchingServices.map(s => s.id);

    return {
      reply: `Serviço "${picked.title}" selecionado.\n\nQual data você prefere? (Formatos aceitos: DD/MM/AAAA, AAAA-MM-DD ou texto como "amanhã", "próxima segunda")`,
      nextState: "COLETANDO_DATA",
      contextUpdate: {
        serviceName: picked.title,
        serviceDuration: picked.duration,
        matchedServiceIds,
        pendingService: null,
        serviceOptions: undefined,
        serviceOptionsData: undefined,
      },
    };
  }

  // 2. Se há opções listadas e o usuário digitou um número para selecionar
  if (ctx.serviceOptionsData && ctx.serviceOptionsData.length > 0) {
    const choice = parseInt(userMessage.trim(), 10);
    if (!isNaN(choice) && choice >= 1 && choice <= ctx.serviceOptionsData.length) {
      const picked = ctx.serviceOptionsData[choice - 1];
      return {
        reply: `Você escolheu: "${picked.title}".\n\nVocê confirma a escolha deste serviço? ("sim" / "não")`,
        nextState: "COLETANDO_SERVICO",
        contextUpdate: {
          pendingService: picked,
          serviceOptions: ["Sim", "Não"],
          serviceOptionsData: undefined,
        },
      };
    }
  }

  // 3. Caso contrário, faz a busca pelo termo
  const searchTerm = nlu.entities.service ?? userMessage.trim();
  if (!searchTerm) {
    return {
      reply: "Por favor, informe o nome ou tipo de serviço que deseja agendar.",
      nextState: "COLETANDO_SERVICO",
      contextUpdate: {},
    };
  }

  const services = await ServiceModel.findAll({
    where: { active: true },
    include: [
      {
        model: SubCategoryModel,
        as: "Subcategory",
        include: [{ model: CategoryModel, as: "Category" }],
      },
      {
        model: ProfessionalModel,
        as: "Professional",
        include: [{ model: UserModel, as: "User", attributes: ["name"] }],
      },
    ],
  });

  const normalizedSearch = normalizeText(searchTerm);
  const searchKeywords = normalizedSearch.split(" ").filter(w => w.length > 0);

  const scoredServices = services
    .map((svc: any) => {
      const score = calculateMatchScore(svc, normalizedSearch, searchKeywords);
      return { svc, score };
    })
    .filter(item => item.score > 0)
    .sort((a, b) => b.score - a.score);

  if (scoredServices.length === 0) {
    return {
      reply: `Não encontrei serviços com o nome "${searchTerm}". Tente um termo diferente ou mais genérico (ex: "cabelo", "pintura"):`,
      nextState: "COLETANDO_SERVICO",
      contextUpdate: { serviceOptions: undefined, serviceOptionsData: undefined },
    };
  }

  // Se houver apenas títulos idênticos nos resultados encontrados, pede a confirmação
  const distinctTitles = Array.from(new Set(scoredServices.map(item => item.svc.title)));
  if (distinctTitles.length === 1) {
    const svc = scoredServices[0].svc as any;
    const profName = svc.Professional?.User?.name ?? "Profissional";
    const pending = {
      id: svc.id,
      title: svc.title,
      professionalId: svc.professional_id,
      professionalName: profName,
      price: svc.price_cents ?? Math.round(svc.price * 100),
      duration: svc.duration,
    };
    return {
      reply: `Encontrei o serviço: "${svc.title}".\n\nVocê confirma a escolha deste serviço? ("sim" / "não")`,
      nextState: "COLETANDO_SERVICO",
      contextUpdate: {
        pendingService: pending,
        serviceOptions: ["Sim", "Não"],
        serviceOptionsData: undefined,
      },
    };
  }

  // Múltiplos resultados com títulos diferentes
  const uniqueOptions: any[] = [];
  const seenTitles = new Set<string>();
  for (const item of scoredServices) {
    const svc = item.svc as any;
    if (!seenTitles.has(svc.title)) {
      seenTitles.add(svc.title);
      const profName = svc.Professional?.User?.name ?? "Profissional";
      uniqueOptions.push({
        id: svc.id,
        title: svc.title,
        professionalId: svc.professional_id,
        professionalName: profName,
        price: svc.price_cents ?? Math.round(svc.price * 100),
        duration: svc.duration,
      });
      if (uniqueOptions.length >= 5) break;
    }
  }

  const serviceOptions = uniqueOptions.map(o => o.title);
  const lines = uniqueOptions.map(
    (o, i) => `${i + 1}. ${o.title}`,
  );
  
  return {
    reply: `Encontrei ${uniqueOptions.length} opções relacionadas a "${searchTerm}":\n\n${lines.join("\n")}\n\nQual delas você prefere? Responda com o número:`,
    nextState: "COLETANDO_SERVICO",
    contextUpdate: {
      serviceOptions,
      serviceOptionsData: uniqueOptions,
      pendingService: null,
    },
  };
}

function parsePortugueseDate(text: string): string | null {
  const lower = text.toLowerCase().trim();
  const today = new Date();
  const currentYear = today.getFullYear();

  const wordNumbers: Record<string, number> = {
    primeiro: 1, um: 1, dois: 2, tres: 3, três: 3, quatro: 4, cinco: 5,
    seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
    treze: 13, treza: 13,
    quatorze: 14, catorze: 14, quatorza: 14,
    quinze: 15, quinza: 15,
    dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20,
    "vinte e um": 21, "vinte e dois": 22, "vinte e três": 23, "vinte e quatro": 24,
    "vinte e cinco": 25, "vinte e seis": 26, "vinte e sete": 27,
    "vinte e oito": 28, "vinte e dezenove": 29, "vinte e nove": 29,
    trinta: 30, "trinta e um": 31
  };

  const monthsMap: Record<string, number> = {
    janeiro: 1, jan: 1,
    fevereiro: 2, fev: 2,
    março: 3, marco: 3, mar: 3,
    abril: 4, abr: 4,
    maio: 5, mai: 5,
    junho: 6, jun: 6,
    julho: 7, jul: 7,
    agosto: 8, ago: 8,
    setembro: 9, set: 9,
    outubro: 10, out: 10,
    novembro: 11, nov: 11,
    dezembro: 12, dez: 12
  };

  let normalized = lower;
  const sortedWordNumbersKeys = Object.keys(wordNumbers).sort((a, b) => b.length - a.length);
  for (const word of sortedWordNumbersKeys) {
    const num = wordNumbers[word];
    const regex = new RegExp(`\\b${word}\\b`, "g");
    normalized = normalized.replace(regex, String(num));
  }

  const matchDmy = normalized.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/);
  if (matchDmy) {
    let day = parseInt(matchDmy[1], 10);
    let month = parseInt(matchDmy[2], 10);
    let year = parseInt(matchDmy[3], 10);
    if (year < 100) year += 2000;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const matchDm = normalized.match(/\b(\d{1,2})\/(\d{1,2})\b/);
  if (matchDm) {
    let day = parseInt(matchDm[1], 10);
    let month = parseInt(matchDm[2], 10);
    let year = currentYear;
    const parsedDate = new Date(year, month - 1, day);
    if (parsedDate < today) {
      year += 1;
    }
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  const matchExt = normalized.match(/\b(?:dia\s+)?(\d{1,2})\s+(?:de|do|da)\s+([a-zçáéíóú\d]+)(?:\s+de\s+(\d{2,4}))?\b/);
  if (matchExt) {
    const day = parseInt(matchExt[1], 10);
    const monthStr = matchExt[2];
    
    let month = monthsMap[monthStr];
    if (!month && /^\d{1,2}$/.test(monthStr)) {
      month = parseInt(monthStr, 10);
    }
    
    if (month && month >= 1 && month <= 12) {
      let year = matchExt[3] ? parseInt(matchExt[3], 10) : currentYear;
      if (matchExt[3] && year < 100) year += 2000;
      if (!matchExt[3]) {
        const parsedDate = new Date(year, month - 1, day);
        if (parsedDate < today) {
          year += 1;
        }
      }
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  // Novo matcher: resolve dias avulsos (ex: "dia 13" ou "13" ou "treze") para o mês atual ou próximo
  const matchOnlyDay = normalized.match(/^(?:dia\s+)?(\d{1,2})$/i);
  if (matchOnlyDay) {
    const day = parseInt(matchOnlyDay[1], 10);
    if (day >= 1 && day <= 31) {
      let month = today.getMonth() + 1;
      let year = currentYear;
      const parsedDate = new Date(year, month - 1, day);
      // Se o dia já passou no mês atual, agenda para o próximo mês
      if (parsedDate < today) {
        month += 1;
        if (month > 12) {
          month = 1;
          year += 1;
        }
      }
      return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    }
  }

  return null;
}

async function handleColetandoData(
  userMessage: string,
  nlu: NluResult,
  session: BotChatSessionModel,
): Promise<HandlerResult> {
  const ctx = (session.context ?? {}) as BotSessionContext;

  let date: string | undefined | null;

  // Se o usuário escolheu um número de uma lista de datas sugeridas
  if (ctx.suggestedDates && ctx.suggestedDates.length > 0) {
    const choice = parseInt(userMessage.trim(), 10);
    if (!isNaN(choice) && choice >= 1 && choice <= ctx.suggestedDates.length) {
      date = ctx.suggestedDates[choice - 1];
    }
  }

  // Tenta extrair a data: primeiro do parser local (D/M/Y, D/M, extenso), depois do NLU
  if (!date) {
    date = parsePortugueseDate(userMessage) ?? nlu.entities.date;
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

  // Se for reagendamento (ALTERAR) e já temos o horário, podemos validar direto
  const chosenTime = isAlterar ? ctx.newTime : ctx.time;
  if (isAlterar && chosenTime && ctx.professionalId && ctx.serviceId) {
    const slots = await getAvailableSlots(ctx.professionalId, date, ctx.serviceDuration ?? 60, ctx.serviceId);
    if (slots.includes(chosenTime)) {
      return buildConfirmationResponse(ctx, date, chosenTime, { [field]: date, suggestedSlots: undefined });
    }
    // Caso contrário, segue o fluxo normal sugerindo alternativas para o reagendamento
  }

  // Busca todos os profissionais que oferecem o serviço selecionado e suas disponibilidades na data
  const matchedServiceIds = ctx.matchedServiceIds ?? [];
  if (matchedServiceIds.length === 0 && ctx.serviceId) {
    matchedServiceIds.push(ctx.serviceId);
  }

  const matchingServices = await ServiceModel.findAll({
    where: { id: matchedServiceIds, active: true },
    include: [
      {
        model: ProfessionalModel,
        as: "Professional",
        include: [{ model: UserModel, as: "User", attributes: ["name"] }],
      },
    ],
  });

  const duration = ctx.serviceDuration ?? 60;
  const lines: string[] = [];
  let optionIndex = 1;
  const suggestedSlotsData: Array<{
    index: number;
    serviceId: number;
    professionalId: number;
    professionalName: string;
    price: number;
    duration: number;
    time: string;
  }> = [];

  for (const svc of matchingServices) {
    const profName = (svc as any).Professional?.User?.name || "Profissional";
    const slots = await getAvailableSlots(svc.professional_id, date, duration, svc.id);
    
    if (slots.length > 0) {
      const formattedSlots = slots.map(s => {
        const idx = optionIndex++;
        suggestedSlotsData.push({
          index: idx,
          serviceId: svc.id,
          professionalId: svc.professional_id,
          professionalName: profName,
          price: svc.price_cents ?? Math.round(Number(svc.price) * 100),
          duration: svc.duration,
          time: s,
        });
        return `  ${idx} — ${s}`;
      });
      lines.push(`• ${profName}:\n${formattedSlots.join("\n")}`);
    }
  }

  if (suggestedSlotsData.length === 0) {
    // Busca dias próximos com disponibilidade (até 14 dias à frente)
    const alternativeDates: Array<{ dateStr: string; slotCount: number }> = [];
    const baseDate = new Date(date + "T12:00:00.000Z");

    for (let offset = 1; offset <= 14 && alternativeDates.length < 3; offset++) {
      const nextDate = new Date(baseDate);
      nextDate.setUTCDate(nextDate.getUTCDate() + offset);
      const nextDateStr = nextDate.toISOString().split("T")[0];

      let totalSlots = 0;
      for (const svc of matchingServices) {
        const slots = await getAvailableSlots(svc.professional_id, nextDateStr, duration, svc.id);
        totalSlots += slots.length;
        if (totalSlots > 0) break; // basta saber que tem ao menos 1 slot
      }
      if (totalSlots > 0) {
        alternativeDates.push({ dateStr: nextDateStr, slotCount: totalSlots });
      }
    }

    if (alternativeDates.length > 0) {
      const weekdayNames = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
      const suggestions = alternativeDates.map((alt, i) => {
        const d = new Date(alt.dateStr + "T12:00:00.000Z");
        const weekday = weekdayNames[d.getUTCDay()];
        return `  ${i + 1} — ${weekday}, ${formatDatePtBR(alt.dateStr)}`;
      });

      return {
        reply:
          `Infelizmente não encontrei profissionais disponíveis no dia ${formatDatePtBR(date)} para o serviço "${ctx.serviceName}".\n\n` +
          `Mas encontrei disponibilidade nos próximos dias:\n\n` +
          `${suggestions.join("\n")}\n\n` +
          `Escolha o número da data desejada, ou informe outra data:`,
        nextState: "COLETANDO_DATA",
        contextUpdate: {
          [field]: date,
          suggestedDates: alternativeDates.map(a => a.dateStr),
        },
      };
    }

    return {
      reply: `Infelizmente não encontrei profissionais disponíveis no dia ${formatDatePtBR(date)} nem nos próximos 14 dias para o serviço "${ctx.serviceName}". Por favor, informe outra data:`,
      nextState: "COLETANDO_DATA",
      contextUpdate: { [field]: date },
    };
  }

  const serviceOptions = suggestedSlotsData.map(d => String(d.index));

  return {
    reply:
      `Para ${formatDatePtBR(date)}, temos estes profissionais e horários disponíveis:\n\n` +
      `${lines.join("\n\n")}\n\n` +
      `Escolha o número correspondente à sua preferência, ou informe outro horário de preferência (ex: 'quero às 15:00'):`,
    nextState: "COLETANDO_HORARIO",
    contextUpdate: {
      [field]: date,
      suggestedSlots: serviceOptions,
      suggestedSlotsData,
    },
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

  // 1. Verifica se usuário está escolhendo de uma lista numerada de sugestões
  if (ctx.suggestedSlotsData && ctx.suggestedSlotsData.length > 0) {
    const choice = parseInt(userMessage.trim(), 10);
    if (!isNaN(choice) && choice >= 1 && choice <= ctx.suggestedSlotsData.length) {
      const pickedSlot = ctx.suggestedSlotsData[choice - 1];
      const field = isAlterar ? "newTime" : "time";
      
      const contextUpdate: Partial<BotSessionContext> = {
        [field]: pickedSlot.time,
        serviceId: pickedSlot.serviceId,
        professionalId: pickedSlot.professionalId,
        professionalName: pickedSlot.professionalName,
        servicePrice: pickedSlot.price,
        serviceDuration: pickedSlot.duration,
        suggestedSlots: undefined,
        suggestedSlotsData: undefined,
      };

      return buildConfirmationResponse({ ...ctx, ...contextUpdate }, date!, pickedSlot.time, contextUpdate);
    }
  }

  // 2. Tenta obter o horário da mensagem
  const time = nlu.entities.time ?? parseTimeFromText(userMessage);
  if (!time) {
    return {
      reply: "Não consegui identificar o horário. Por favor, escolha uma opção pelo número, ou digite outro horário (ex: 14:30):",
      nextState: "COLETANDO_HORARIO",
      contextUpdate: {},
    };
  }

  // Se não temos a data ainda (reagendamento sem data), salva horário e pede data
  if (!date) {
    const field = isAlterar ? "newTime" : "time";
    return {
      reply: `Horário registrado: ${time}.\n\nQual data você prefere? (Formatos aceitos: DD/MM/AAAA, AAAA-MM-DD ou texto como "amanhã", "próxima segunda")`,
      nextState: "COLETANDO_DATA",
      contextUpdate: { [field]: time, suggestedSlots: undefined, suggestedSlotsData: undefined },
    };
  }

  // 3. Se o usuário forneceu um horário customizado, busca profissionais disponíveis nesse horário
  const matchedServiceIds = ctx.matchedServiceIds ?? [];
  if (matchedServiceIds.length === 0 && ctx.serviceId) {
    matchedServiceIds.push(ctx.serviceId);
  }

  const matchingServices = await ServiceModel.findAll({
    where: { id: matchedServiceIds, active: true },
    include: [
      {
        model: ProfessionalModel,
        as: "Professional",
        include: [{ model: UserModel, as: "User", attributes: ["name"] }],
      },
    ],
  });

  const duration = ctx.serviceDuration ?? 60;
  const availableForTime: typeof matchingServices = [];

  for (const svc of matchingServices) {
    const slots = await getAvailableSlots(svc.professional_id, date, duration, svc.id);
    if (slots.includes(time)) {
      availableForTime.push(svc);
    }
  }

  if (availableForTime.length > 0) {
    const lines: string[] = [];
    let optionIndex = 1;
    const suggestedSlotsData: Array<{
      index: number;
      serviceId: number;
      professionalId: number;
      professionalName: string;
      price: number;
      duration: number;
      time: string;
    }> = [];

    for (const svc of availableForTime) {
      const profName = (svc as any).Professional?.User?.name ?? "Profissional";
      const idx = optionIndex++;
      suggestedSlotsData.push({
        index: idx,
        serviceId: svc.id,
        professionalId: svc.professional_id,
        professionalName: profName,
        price: svc.price_cents ?? Math.round(svc.price * 100),
        duration: svc.duration,
        time: time,
      });
      lines.push(`${idx}. ${profName}`);
    }

    const serviceOptions = suggestedSlotsData.map(d => String(d.index));

    return {
      reply:
        `Para as ${time} em ${formatDatePtBR(date)}, temos estes profissionais disponíveis:\n\n` +
        `${lines.join("\n")}\n\n` +
        `Escolha o número correspondente à sua preferência:`,
      nextState: "COLETANDO_HORARIO",
      contextUpdate: {
        suggestedSlots: serviceOptions,
        suggestedSlotsData,
      },
    };
  }

  // Se nenhum profissional estiver disponível na hora sugerida
  return {
    reply:
      `Infelizmente nenhum profissional está disponível às ${time} em ${formatDatePtBR(date)}.\n\n` +
      `Por favor, escolha uma das opções listadas anteriormente ou tente outro horário:`,
    nextState: "COLETANDO_HORARIO",
    contextUpdate: {}, // mantém as opções sugeridas anteriores
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
    contextUpdate: {
      ...ctxUpdate,
      serviceOptions: ["Sim", "Não"],
      serviceOptionsData: undefined,
    },
  };
}

async function handleConfirmacao(
  userMessage: string,
  userId: number,
  session: BotChatSessionModel,
  selectedTimeIso?: string,
): Promise<HandlerResult> {
  const ctx = (session.context ?? {}) as BotSessionContext;
  const lower = userMessage.toLowerCase().trim();
  const confirmed = /\b(sim|s|yes|confirmar|confirmo|ok|pode|vamos)\b/.test(lower);
  const denied = /\b(n[aã]o|nao|no|cancelar|desistir|voltar)\b/.test(lower);

  if (!confirmed && !denied) {
    return {
      reply: "Por favor, responda com *sim* para confirmar ou *não* para cancelar:",
      nextState: "CONFIRMACAO",
      contextUpdate: {
        serviceOptions: ["Sim", "Não"],
        serviceOptionsData: undefined,
      },
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
      const newAppointment = await createBotAppointment(userId, reschedCtx, selectedTimeIso);
      return {
        reply:
          `✅ Reagendamento concluído!\n\n` +
          `Novo agendamento ID: ${newAppointment.id}\n` +
          `Serviço: ${ctx.serviceName}\n` +
          `Data: ${formatDatePtBR(reschedCtx.date!)}\n` +
          `Horário: ${reschedCtx.time}\n\n` +
          `Aguarde a confirmação do profissional.`,
        nextState: "FINALIZADO",
        contextUpdate: {
          appointmentId: newAppointment.id,
        },
        appointmentId: newAppointment.id,
        finalize: true,
      };
    }

    // CREATE (padrão)
    const appointment = await createBotAppointment(userId, ctx, selectedTimeIso);
    return {
      reply:
        `✅ Agendamento criado com sucesso!\n\n` +
        `ID: ${appointment.id}\n` +
        `Serviço: ${ctx.serviceName}\n` +
        `Data: ${formatDatePtBR(ctx.date!)}\n` +
        `Horário: ${ctx.time}\n\n` +
        `Aguarde a confirmação do profissional. Você receberá uma notificação.`,
      nextState: "FINALIZADO",
      contextUpdate: {
        appointmentId: appointment.id,
      },
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
        serviceOptions: ["Sim", "Não"],
        serviceOptionsData: undefined,
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
  selectedTimeIso?: string,
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
  const lowerMsg = trimmedMessage.toLowerCase().trim();

  // A. Recomeçar/Reiniciar fluxo globalmente
  if (/^(recome[cç]ar|reiniciar|come[cç]ar\s+de\s+novo|limpar\s+chat|outro\s+servi[cç]o)$/i.test(lowerMsg)) {
    session.state = "INICIO";
    session.context = {};
    session.appointment_id = null;
    await session.save();

    await BotChatMessageModel.create({
      session_id: session.id,
      sender: "bot",
      content: "Entendido! Vamos recomeçar. Que tipo de serviço você precisa hoje?",
    });

    return {
      sessionId: session.id,
      message: "Entendido! Vamos recomeçar. Que tipo de serviço você precisa hoje?",
      state: "INICIO",
      context: {},
    };
  }

  // B. Escolher outro profissional
  if (/^(outro\s+profissional|mudar\s+de\s+profissional|outro\s+prestador)$/i.test(lowerMsg)) {
    const activeCtx = (session.context ?? {}) as BotSessionContext;
    if (activeCtx.serviceName) {
      session.state = "COLETANDO_SERVICO";
      await session.save();
      const nluFake = { intent: "AGENDAR" as const, entities: { service: activeCtx.serviceName }, confidence: 1.0 };
      const result = await handleColetandoServico(activeCtx.serviceName, nluFake, session);
      
      const mergedContext = {
        ...(session.context ?? {}),
        ...result.contextUpdate,
        professionalId: undefined,
        professionalName: undefined,
        date: undefined,
        time: undefined,
        newDate: undefined,
        newTime: undefined,
        suggestedDates: undefined,
        suggestedSlots: undefined,
      };

      session.state = result.nextState;
      session.context = mergedContext;
      await session.save();

      await BotChatMessageModel.create({
        session_id: session.id,
        sender: "bot",
        content: `Entendido. Vamos escolher outro profissional. Aqui estão os profissionais disponíveis:\n\n${result.reply}`,
      });

      return {
        sessionId: session.id,
        message: `Entendido. Vamos escolher outro profissional. Aqui estão os profissionais disponíveis:\n\n${result.reply}`,
        state: session.state,
        context: session.context as BotSessionContext,
      };
    } else {
      session.state = "INICIO";
      session.context = {};
      await session.save();
      
      const replyText = "Você ainda não escolheu um serviço. Vamos recomeçar — qual tipo de serviço você precisa?";
      await BotChatMessageModel.create({
        session_id: session.id,
        sender: "bot",
        content: replyText,
      });
      return {
        sessionId: session.id,
        message: replyText,
        state: "INICIO",
        context: {},
      };
    }
  }

  // 2. Persiste mensagem do usuário
  const ctx = (session.context ?? {}) as BotSessionContext;

  // Decisão dinâmica de acionar NLU (Gemini):
  // Se a entrada do usuário for uma opção padrão (ex: número do menu, data exata, etc.),
  // processamos localmente sem gastar cota de IA. Caso contrário, acionamos o Gemini para ajudar a interpretar.
  let needNlu = true;

  if (session.state === "CONFIRMACAO" || session.state === "VERIFICANDO_DISPONIBILIDADE") {
    needNlu = false;
  } else if (session.state === "COLETANDO_DATA") {
    const choice = parseInt(lowerMsg, 10);
    const isValidChoice = ctx.suggestedDates && !isNaN(choice) && choice >= 1 && choice <= ctx.suggestedDates.length;
    const isValidLocalDate = parsePortugueseDate(trimmedMessage) !== null;
    if (isValidChoice || isValidLocalDate) {
      needNlu = false;
    }
  } else if (session.state === "COLETANDO_HORARIO") {
    const choice = parseInt(lowerMsg, 10);
    const isValidChoice = ctx.suggestedSlots && !isNaN(choice) && choice >= 1 && choice <= ctx.suggestedSlots.length;
    const isValidLocalTime = parseTimeFromText(trimmedMessage) !== null;
    if (isValidChoice || isValidLocalTime) {
      needNlu = false;
    }
  }

  const nlu = needNlu
    ? await analyzeMessage(trimmedMessage, ctx as Record<string, unknown>)
    : { intent: "FALLBACK" as const, entities: {} as NluEntities, confidence: 1.0 };

  await BotChatMessageModel.create({
    session_id: session.id,
    sender: "user",
    content: trimmedMessage,
    intent: nlu.intent,
    entities: nlu.entities as Record<string, unknown>,
  });

  // 3. Roteia para o handler do estado atual
  let result: HandlerResult;

  const isExplicitIntent = ["AGENDAR", "ALTERAR", "CANCELAR", "CONSULTAR"].includes(nlu.intent);
  let shouldRedirectToInicio = false;
  if (isExplicitIntent) {
    if (nlu.intent === "AGENDAR") {
      // Se a intenção for AGENDAR, redireciona se:
      // 1. Não houver entidade de serviço (ex: "quero agendar")
      // 2. Ou se não estivermos no estado COLETANDO_SERVICO (ex: estamos em COLETANDO_DATA, e queremos buscar outro serviço)
      // 3. Ou se estivermos em COLETANDO_SERVICO mas já tivermos um pendingService ativo (quer descartar e buscar outro)
      if (!nlu.entities.service || session.state !== "COLETANDO_SERVICO" || ctx.pendingService) {
        shouldRedirectToInicio = true;
      }
    } else {
      // Para ALTERAR, CANCELAR, CONSULTAR, redireciona se não estivermos em confirmação
      if (session.state !== "CONFIRMACAO" && session.state !== "AGUARDANDO_ID_AGENDAMENTO") {
        shouldRedirectToInicio = true;
      }
    }
  }

  if (shouldRedirectToInicio) {
    session.state = "INICIO";
    session.context = {}; // Limpa o contexto para iniciar novo fluxo
  }

  try {
    switch (session.state) {
      case "INICIO":
        result = await handleInicio(userId, nlu, session);
        // Se o NLU já trouxe o serviço, podemos fazer a busca direto para economizar um turno
        if (result.nextState === "COLETANDO_SERVICO" && nlu.entities.service) {
          session.context = {
            ...session.context,
            ...result.contextUpdate,
          };
          result = await handleColetandoServico(nlu.entities.service, nlu, session);
        }
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
        result = await handleConfirmacao(trimmedMessage, userId, session, selectedTimeIso);
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
  if (result.appointmentId) {
    session.appointment_id = result.appointmentId;
    mergedContext.appointmentId = result.appointmentId;
  }
  session.context = mergedContext;
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
