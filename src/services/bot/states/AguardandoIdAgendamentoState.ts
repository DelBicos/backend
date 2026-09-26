import { ClientModel } from "../../../models/Client";
import { ServiceModel } from "../../../models/Service";
import { ProfessionalModel } from "../../../models/Professional";
import { AppointmentModel } from "../../../models/Appointment";
import { UserModel } from "../../../models/User";
import { BotChatSessionModel, BotSessionContext } from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";
import { appointmentCalendarDate } from "../../../utils/date.util";

export class AguardandoIdAgendamentoState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number
  ): Promise<HandlerResult> {
    const ctx = (session.context ?? {}) as BotSessionContext;

    const trimmedMsg = userMessage.trim();
    const clientRecord = await ClientModel.findOne({ where: { user_id: userId } });
    if (!clientRecord) {
      return {
        reply: "Você não possui perfil de cliente cadastrado.",
        nextState: "FINALIZADO",
        contextUpdate: {},
        finalize: true,
      };
    }

    let appointmentIdToUse: number | undefined;

    // 1. Tenta identificar se o usuário selecionou um índice da lista (ex: "1", "2")
    const parsedNum = parseInt(trimmedMsg, 10);
    const appointmentList = (ctx.userAppointmentList as Array<{ index: number; id: number; shortId?: string }>) ?? [];

    if (!isNaN(parsedNum) && appointmentList.length > 0) {
      const foundByIndex = appointmentList.find((item) => item.index === parsedNum);
      if (foundByIndex) {
        appointmentIdToUse = foundByIndex.id;
      }
    }

    // 2. Se não foi pelo índice, tenta buscar pelo ID direto (nlu ou número direto)
    if (!appointmentIdToUse) {
      const rawId = nlu.entities.appointment_id ?? (isNaN(parsedNum) ? undefined : parsedNum);
      if (typeof rawId === "number" && rawId > 0) {
        appointmentIdToUse = rawId;
      }
    }

    // 3. Tenta buscar o agendamento no banco pelo ID numérico ou pelo short_id
    let appointment: AppointmentModel | null = null;
    if (appointmentIdToUse) {
      appointment = await AppointmentModel.findByPk(appointmentIdToUse, {
        include: [
          { model: ServiceModel, as: "Service" },
          {
            model: ProfessionalModel,
            as: "Professional",
            include: [{ model: UserModel, as: "User", attributes: ["name"] }],
          },
        ],
      });
    }

    // Tenta por short_id se ainda não encontrou
    if (!appointment && trimmedMsg.length >= 4) {
      appointment = await AppointmentModel.findOne({
        where: { short_id: trimmedMsg.toUpperCase() },
        include: [
          { model: ServiceModel, as: "Service" },
          {
            model: ProfessionalModel,
            as: "Professional",
            include: [{ model: UserModel, as: "User", attributes: ["name"] }],
          },
        ],
      });
    }

    if (!appointment || appointment.client_id !== clientRecord.id) {
      const actionStr = ctx.pendingAction === "CANCEL" ? "cancelar" : "reagendar";
      return {
        reply: `Agendamento não encontrado. Por favor, escolha uma das opções ou digite um número/ID válido para ${actionStr}:`,
        nextState: "AGUARDANDO_ID_AGENDAMENTO",
        contextUpdate: {},
      };
    }

    if (appointment.status === "completed") {
      return {
        reply: "Este agendamento já foi concluído e não pode ser alterado.",
        nextState: "INICIO",
        contextUpdate: { serviceOptions: undefined, userAppointmentList: undefined },
      };
    }
    if (appointment.status === "canceled") {
      return {
        reply: "Este agendamento já está cancelado.",
        nextState: "INICIO",
        contextUpdate: { serviceOptions: undefined, userAppointmentList: undefined },
      };
    }

    const apptData: any = appointment;
    const svcTitle = apptData.Service?.title ?? "Serviço";
    const profName = apptData.Professional?.User?.name ?? "Profissional";
    const startDate = new Date(appointment.start_time);
    const dateStr = startDate.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
    const timeStr = startDate.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });

    if (ctx.pendingAction === "CANCEL") {
      return {
        reply:
          `Você quer cancelar o seguinte agendamento?\n\n` +
          `• ID: ${appointment.short_id || appointment.id}\n` +
          `• Serviço: ${svcTitle}\n` +
          `• Profissional: ${profName}\n` +
          `• Data: ${dateStr} às ${timeStr}\n` +
          `• Status: ${appointment.status}\n\n` +
          `Confirma o cancelamento?`,
        nextState: "CONFIRMACAO",
        contextUpdate: {
          appointmentId: appointment.id,
          serviceId: appointment.service_id,
          professionalId: appointment.professional_id,
          serviceOptions: ["Sim, confirmar", "Não, voltar"],
          userAppointmentList: undefined,
        },
      };
    }

    // RESCHEDULE
    return {
      reply:
        `Reagendando:\n\n` +
        `• ID: ${appointment.short_id || appointment.id}\n` +
        `• Serviço: ${svcTitle}\n` +
        `• Profissional: ${profName}\n` +
        `• Data atual: ${dateStr} às ${timeStr}\n\n` +
        `Qual nova data você prefere?`,
      nextState: "COLETANDO_DATA",
      contextUpdate: {
        appointmentId: appointment.id,
        serviceId: appointment.service_id,
        professionalId: appointment.professional_id,
        serviceName: svcTitle,
        professionalName: profName,
        serviceDuration: (new Date(appointment.end_time).getTime() - startDate.getTime()) / 60000,
        servicePrice: appointment.final_price != null
          ? Math.round(Number(appointment.final_price) * 100)
          : (apptData.Service?.price_cents ?? Math.round(Number(apptData.Service?.price ?? 0) * 100)),
        matchedServiceIds: [appointment.service_id],
        availableDayServiceIds: undefined,
        availableDayProfessionals: undefined,
        professionalOptionsData: undefined,
        suggestedDates: undefined,
        suggestedSlots: undefined,
        suggestedSlotsData: undefined,
        date: appointmentCalendarDate(startDate),
        time: timeStr,
        newDate: undefined,
        newTime: undefined,
        newTimePeriod: undefined,
        appointmentStatus: appointment.status,
        appointmentPaid: Boolean(appointment.payment_intent_id),
        timeZone: "America/Sao_Paulo",
        serviceOptions: undefined,
        userAppointmentList: undefined,
      },
    };
  }
}
