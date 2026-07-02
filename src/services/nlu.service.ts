import logger from "../utils/logger";

export type NluIntent =
  | "AGENDAR"
  | "ALTERAR"
  | "CANCELAR"
  | "CONSULTAR"
  | "SAUDACAO"
  | "FALLBACK";

export interface NluEntities {
  service?: string;
  date?: string;        // YYYY-MM-DD ou texto relativo como "amanhã"
  time?: string;        // HH:MM
  professional?: string;
  appointment_id?: number;
}

export interface NluResult {
  intent: NluIntent;
  entities: NluEntities;
  confidence: number;
}

const SYSTEM_PROMPT = `Você é um módulo de NLU para um marketplace de serviços chamado DelBicos.
Analise a mensagem do usuário e retorne um JSON com:
1. "intent": uma das opções abaixo (apenas uma):
   - AGENDAR: usuário quer marcar/agendar um serviço
   - ALTERAR: usuário quer remarcar/alterar data ou horário de agendamento existente
   - CANCELAR: usuário quer cancelar um agendamento existente
   - CONSULTAR: usuário quer ver seus agendamentos ou verificar disponibilidade
   - SAUDACAO: cumprimento (oi, olá, bom dia, etc.)
   - FALLBACK: mensagem não se encaixa em nenhuma das anteriores

2. "entities": objeto com zero ou mais dos campos abaixo (inclua apenas o que foi mencionado):
   - "service": nome ou tipo do serviço (ex: "corte de cabelo", "pintura de parede")
   - "date": data mencionada em formato YYYY-MM-DD; se relativa (amanhã, hoje, próxima segunda), resolva para YYYY-MM-DD considerando que hoje é ${new Date().toISOString().split("T")[0]}
   - "time": horário em formato HH:MM (24h)
   - "professional": nome do profissional mencionado
   - "appointment_id": ID numérico inteiro do agendamento mencionado

3. "confidence": número entre 0 e 1 indicando a confiança na classificação

Responda SOMENTE com JSON válido, sem markdown, sem explicações. Exemplo:
{"intent":"AGENDAR","entities":{"service":"corte de cabelo","date":"2026-07-05","time":"14:00"},"confidence":0.95}`;

/**
 * Resolve texto de data relativo para YYYY-MM-DD.
 * Lida com casos simples que o LLM possa não ter resolvido.
 */
function resolveRelativeDate(text: string): string {
  const lower = text.toLowerCase().trim();
  const today = new Date();
  const addDays = (n: number) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().split("T")[0];
  };

  if (lower === "hoje") return addDays(0);
  if (lower === "amanhã" || lower === "amanha") return addDays(1);
  if (lower === "depois de amanhã" || lower === "depois de amanha") return addDays(2);

  const weekdays = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];
  const nextWeekdayMatch = lower.match(
    /próxima?\s+(domingo|segunda|terça|terca|quarta|quinta|sexta|sábado|sabado)/,
  );
  if (nextWeekdayMatch) {
    const target = weekdays.findIndex((d) =>
      nextWeekdayMatch[1].startsWith(d.slice(0, 4)),
    );
    if (target >= 0) {
      const current = today.getDay();
      let diff = target - current;
      if (diff <= 0) diff += 7;
      return addDays(diff);
    }
  }

  return text;
}

/**
 * Analisa a mensagem do usuário e retorna intenção + entidades.
 * Usa a API OpenAI via fetch nativo (Node 18+).
 * Se OPENAI_API_KEY não estiver configurada, retorna FALLBACK silenciosamente.
 */
export async function analyzeMessage(
  message: string,
  sessionContext?: Record<string, unknown>,
): Promise<NluResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    logger.warn("NLU: OPENAI_API_KEY não configurada — retornando FALLBACK");
    return { intent: "FALLBACK", entities: {}, confidence: 0 };
  }

  const userContent =
    sessionContext && Object.keys(sessionContext).length > 0
      ? `Contexto atual da conversa: ${JSON.stringify(sessionContext)}\n\nMensagem do usuário: ${message}`
      : `Mensagem do usuário: ${message}`;

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
        temperature: 0.1,
        max_tokens: 300,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      logger.error("NLU: erro na API OpenAI", { status: response.status, body });
      return { intent: "FALLBACK", entities: {}, confidence: 0 };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data?.choices?.[0]?.message?.content;
    if (!content) {
      logger.warn("NLU: resposta vazia da API OpenAI");
      return { intent: "FALLBACK", entities: {}, confidence: 0 };
    }

    const parsed = JSON.parse(content) as NluResult;

    // Normaliza data relativa que o LLM pode não ter resolvido
    if (parsed.entities?.date && !/^\d{4}-\d{2}-\d{2}$/.test(parsed.entities.date)) {
      parsed.entities.date = resolveRelativeDate(parsed.entities.date);
    }

    return parsed;
  } catch (error) {
    logger.error("NLU: erro ao processar mensagem", error as Error);
    return { intent: "FALLBACK", entities: {}, confidence: 0 };
  }
}
