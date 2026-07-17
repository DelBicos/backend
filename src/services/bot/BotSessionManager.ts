import { BotChatSessionModel, BotSessionContext, BotSessionState } from "../../models/BotChatSession";
import { BotChatMessageModel } from "../../models/BotChatMessage";
import { AppointmentModel } from "../../models/Appointment";
import { BotState } from "../../constants/botStates";
import { BotSessionHistory } from "../botConversation.service";

export class BotSessionManager {
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
        session = requested;
      }
    }

    if (!session) {
      session = await BotChatSessionModel.findOne({
        where: { user_id: userId, status: "active" },
        order: [["id", "DESC"]],
      });
    }

    if (!session) {
      const latest = await BotChatSessionModel.findOne({
        where: { user_id: userId },
        order: [["id", "DESC"]],
      });
      const appointment = latest?.appointment_id
        ? await AppointmentModel.findByPk(latest.appointment_id)
        : null;

      if (latest && appointment && ["pending", "confirmed"].includes(appointment.status)) {
        const context = (latest.context ?? {}) as BotSessionContext;
        latest.status = "active";
        latest.ended_at = null;
        latest.state = appointment.status === "pending"
          ? BotState.AGUARDANDO_CONFIRMACAO
          : BotState.INICIO;
        latest.context = {
          ...context,
          appointmentId: appointment.id,
          appointmentStatus: appointment.status,
        };
        await latest.save();
        session = latest;
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
  ): Promise<BotSessionHistory | null> {
    let session = await BotChatSessionModel.findOne({
      where: { user_id: userId, status: "active" },
      order: [["id", "DESC"]],
    });

    if (!session) {
      session = await BotChatSessionModel.findOne({
        where: { user_id: userId },
        order: [["id", "DESC"]],
      });
    }

    return session ? this.buildHistory(session) : null;
  }

  public static async getHistoryBySessionId(
    sessionId: number,
    userId: number,
  ): Promise<BotSessionHistory | null> {
    const session = await BotChatSessionModel.findByPk(sessionId);
    if (!session || session.user_id !== userId) return null;
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
            attributes: ["id", "status", "updatedAt"],
          })
        : Promise.resolve(null),
    ]);

    const appointmentStatus = appointment?.status ?? null;

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
        waiting_for_professional: appointmentStatus === "pending",
        poll_after_ms: appointmentStatus === "pending" ? 5000 : null,
      },
      messages: messages.map((message) => ({
        id: message.id,
        sender: message.sender as "user" | "bot",
        content: message.content,
        intent: message.intent,
        createdAt: message.createdAt,
      })),
    };
  }
}
