import { BotChatSessionModel, BotSessionContext, BotSessionState } from "../../models/BotChatSession";
import { BotChatMessageModel } from "../../models/BotChatMessage";
import { BotSessionHistory } from "../botConversation.service";

export class BotSessionManager {
  /**
   * Obtém uma sessão ativa ou cria uma nova se não existir ou se a fornecida estiver inativa.
   */
  public static async getOrCreateSession(
    userId: number,
    authSessionId: string,
    channel: string,
    sessionId?: number
  ): Promise<BotChatSessionModel> {
    let session: BotChatSessionModel | undefined;

    if (sessionId) {
      const found = await BotChatSessionModel.findByPk(sessionId);
      if (found?.user_id === userId && found.auth_session_id === authSessionId) {
        session = found;
      }
    }

    if (!session) {
      session = await BotChatSessionModel.create({
        user_id: userId,
        auth_session_id: authSessionId,
        channel,
        status: "active",
        state: "INICIO" as any,
        context: {},
      });
    }

    if (session.status !== "active") {
      session = await BotChatSessionModel.create({
        user_id: userId,
        auth_session_id: authSessionId,
        channel: session.channel,
        status: "active",
        state: "INICIO" as any,
        context: {},
      });
    }

    return session;
  }

  /**
   * Salva as atualizações de estado e contexto de uma sessão.
   */
  public static async saveSession(
    session: BotChatSessionModel,
    state: BotSessionState,
    context: BotSessionContext,
    appointmentId?: number | null
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
    entities?: Record<string, unknown>
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
    authSessionId: string,
    limit = 20
  ): Promise<BotSessionHistory | null> {
    const session = await BotChatSessionModel.findOne({
      where: { user_id: userId, auth_session_id: authSessionId, status: "active" },
      order: [["id", "DESC"]],
    });

    if (!session) return null;

    const messages = await BotChatMessageModel.findAll({
      where: { session_id: session.id },
      order: [["createdAt", "ASC"]],
      limit,
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
        sender: m.sender as "user" | "bot",
        content: m.content,
        intent: m.intent,
        createdAt: m.createdAt,
      })),
    };
  }
}
