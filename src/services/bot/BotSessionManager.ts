import {
  BotChatSessionModel,
  BotSessionContext,
  BotSessionState,
} from "../../models/BotChatSession";
import { BotChatMessageModel } from "../../models/BotChatMessage";
import { AppointmentModel } from "../../models/Appointment";
import { BotState } from "../../constants/botStates";
import type { BotSessionHistory } from "../botConversation.service";
import { migrateLegacyServiceOptions } from "./serviceChoice.helpers";

const configuredSessionTtlHours = Number(
  process.env.BOT_SESSION_TTL_HOURS ?? 24,
);
const SESSION_TTL_MS =
  (Number.isFinite(configuredSessionTtlHours) && configuredSessionTtlHours > 0
    ? configuredSessionTtlHours
    : 24) *
  60 *
  60 *
  1000;

export class BotSessionManager {
  private static async migrateLegacyContext(
    session: BotChatSessionModel,
  ): Promise<void> {
    if (
      session.status !== "active" ||
      session.state !== BotState.COLETANDO_SERVICO
    ) {
      return;
    }

    const current = (session.context ?? {}) as BotSessionContext;
    const migrated = migrateLegacyServiceOptions(current);
    if (migrated !== current) {
      session.context = migrated;
      await session.save();

      const choices = migrated.serviceChoicesData ?? [];
      if (choices.length > 0) {
        const prompt =
          "Atualizei as opções para seguirmos na ordem correta. Escolha primeiro o tipo de serviço:\n\n" +
          choices
            .map((choice, index) => `${index + 1}. ${choice.title}`)
            .join("\n") +
          "\n\nDepois vou pedir o dia e o horário.";
        await this.createMessage(session.id, "bot", prompt);
      }
    }
  }

  private static isExpired(session: BotChatSessionModel): boolean {
    const startedAt = new Date(session.started_at).getTime();
    return (
      Number.isFinite(startedAt) && Date.now() - startedAt > SESSION_TTL_MS
    );
  }

  private static async expireSession(
    session: BotChatSessionModel,
  ): Promise<void> {
    session.status = "completed";
    session.ended_at = new Date();
    await session.save();
  }

  /**
   * Encerra a sessão atual e cria outra sem contexto, vínculo de agendamento ou
   * mensagens. A sessão antiga é preservada como histórico do usuário.
   */
  public static async restartSession(
    session: BotChatSessionModel,
    authSessionId: string | undefined,
  ): Promise<BotChatSessionModel> {
    session.status = "completed";
    session.ended_at = new Date();
    await session.save();

    return BotChatSessionModel.create({
      user_id: session.user_id,
      auth_session_id: authSessionId ?? `user:${session.user_id}`,
      channel: session.channel,
      status: "active",
      state: BotState.INICIO,
      context: {},
      appointment_id: null,
    });
  }

  /**
   * Obtém uma sessão ativa ou cria uma nova se não existir ou se a fornecida estiver inativa.
   */
  public static async getOrCreateSession(
    userId: number,
    authSessionId: string | undefined,
    channel: string,
    sessionId?: number,
  ): Promise<BotChatSessionModel> {
    let session: BotChatSessionModel | null = null;

    if (sessionId) {
      const requested = await BotChatSessionModel.findByPk(sessionId);
      if (requested?.user_id === userId && requested.status === "active") {
        if (this.isExpired(requested)) {
          await this.expireSession(requested);
        } else {
          session = requested;
        }
      }
    }

    if (!session) {
      session = await BotChatSessionModel.findOne({
        where: { user_id: userId, status: "active" },
        order: [["id", "DESC"]],
      });
      if (session && this.isExpired(session)) {
        await this.expireSession(session);
        session = null;
      }
    }

    if (!session) {
      session = await BotChatSessionModel.create({
        user_id: userId,
        auth_session_id: authSessionId ?? `user:${userId}`,
        channel,
        status: "active",
        state: BotState.INICIO,
        context: {},
      });
    } else if (authSessionId && session.auth_session_id !== authSessionId) {
      session.auth_session_id = authSessionId;
      await session.save();
    }

    await this.migrateLegacyContext(session);
    return session;
  }

  /**
   * Salva as atualizações de estado e contexto de uma sessão.
   */
  public static async saveSession(
    session: BotChatSessionModel,
    state: BotSessionState,
    context: BotSessionContext,
    appointmentId?: number | null,
  ): Promise<void> {
    session.state = state;
    session.context = context;
    if (appointmentId !== undefined) {
      session.appointment_id = appointmentId;
    }
    await session.save();
  }

  /**
   * Salva uma mensagem no histórico do chat.
   */
  public static async createMessage(
    sessionId: number,
    sender: "user" | "bot",
    content: string,
    intent?: string | null,
    entities?: Record<string, unknown>,
  ): Promise<void> {
    await BotChatMessageModel.create({
      session_id: sessionId,
      sender,
      content,
      intent: intent || null,
      entities: entities || null,
    });
  }

  /**
   * Retorna o histórico formatado da última sessão ativa do usuário.
   */
  public static async getHistory(
    userId: number,
  ): Promise<BotSessionHistory | null> {
    const session = await BotChatSessionModel.findOne({
      where: { user_id: userId, status: "active" },
      order: [["id", "DESC"]],
    });

    if (!session) return null;
    if (this.isExpired(session)) {
      await this.expireSession(session);
      return null;
    }

    await this.migrateLegacyContext(session);
    return this.buildHistory(session);
  }

  public static async getHistoryBySessionId(
    sessionId: number,
    userId: number,
  ): Promise<BotSessionHistory | null> {
    const session = await BotChatSessionModel.findByPk(sessionId);
    if (!session || session.user_id !== userId) return null;
    await this.migrateLegacyContext(session);
    return this.buildHistory(session);
  }

  private static async buildHistory(
    session: BotChatSessionModel,
  ): Promise<BotSessionHistory> {
    const [messages, appointment] = await Promise.all([
      BotChatMessageModel.findAll({
        where: { session_id: session.id },
        order: [["createdAt", "ASC"]],
      }),
      session.appointment_id
        ? AppointmentModel.findByPk(session.appointment_id, {
            attributes: ["id", "status", "payment_intent_id", "updatedAt"],
          })
        : Promise.resolve(null),
    ]);

    const appointmentStatus = appointment?.status ?? null;
    const appointmentPaid = Boolean(appointment?.payment_intent_id);

    return {
      session: {
        id: session.id,
        state: session.state,
        status: session.status,
        channel: session.channel,
        context: session.context ?? {},
        started_at: session.started_at,
        ended_at: session.ended_at,
        appointment_id: session.appointment_id,
        appointment_status: appointmentStatus,
        appointment_paid: appointmentPaid,
        payment_pending: appointmentStatus === "confirmed" && !appointmentPaid,
        waiting_for_professional: appointmentStatus === "pending",
        poll_after_ms:
          appointmentStatus === "pending"
            ? 5000
            : appointmentStatus === "confirmed" && !appointmentPaid
              ? 10000
              : null,
      },
      messages: messages.map((message) => ({
        id: message.id,
        sender: message.sender as "user" | "bot",
        content: message.content,
        intent: message.intent,
        entities: message.entities,
        createdAt: message.createdAt,
      })),
    };
  }
}
