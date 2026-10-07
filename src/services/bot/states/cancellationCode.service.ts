import type { BotSessionContext } from "../../../models/BotChatSession";
import type { HandlerResult } from "../BotStateNode";
import { requestCancellationCode, confirmCancellationCode, abandonCancellationCode, CancellationVerificationError } from "../../appointment/cancellationVerification.service";

export async function handleCancellationCode(message: string, ctx: BotSessionContext, userId: number): Promise<HandlerResult> {
  const reply = message.toLowerCase().trim();
  try {
    if (!ctx.appointmentId) throw new CancellationVerificationError("Agendamento não encontrado");
    if (ctx.cancellationChallengeId && /^(?:n[aã]o(?:,?\s+cancelar)?|desistir|voltar|cancelar)[.!]*$/.test(reply)) {
      await abandonCancellationCode(userId, ctx.appointmentId, ctx.cancellationChallengeId);
      return { reply: "Cancelamento descartado. Seu agendamento continua ativo.", nextState: "FINALIZADO", contextUpdate: { cancellationChallengeId: undefined }, finalize: true };
    }
    if (!ctx.cancellationChallengeId || /^(?:reenviar|reenviar c[oó]digo|novo c[oó]digo)$/.test(reply)) {
      const challenge = await requestCancellationCode(userId, ctx.appointmentId);
      return {
        reply: `Enviamos um código para ${challenge.email}. Digite os seis dígitos para confirmar o cancelamento. Válido por 10 minutos. Para desistir, diga "voltar". Você pode pedir "reenviar código" após 60 segundos.`,
        nextState: "CONFIRMACAO", contextUpdate: { cancellationChallengeId: challenge.challengeId, serviceOptions: [] },
      };
    }
    await confirmCancellationCode(userId, ctx.appointmentId, ctx.cancellationChallengeId, reply);
    return { reply: `✅ Agendamento ID ${ctx.appointmentId} cancelado com sucesso.`, nextState: "FINALIZADO", contextUpdate: { cancellationChallengeId: undefined }, finalize: true };
  } catch (error: unknown) {
    return {
      reply: error instanceof CancellationVerificationError ? error.message : "Não foi possível enviar ou validar o código. O agendamento não foi cancelado. Tente novamente mais tarde.",
      nextState: "CONFIRMACAO", contextUpdate: {},
    };
  }
}
