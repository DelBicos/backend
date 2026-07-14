import { ClientModel } from "../../../models/Client";
import { ServiceModel } from "../../../models/Service";
import { ProfessionalModel } from "../../../models/Professional";
import { AppointmentModel } from "../../../models/Appointment";
import { UserModel } from "../../../models/User";
import { BotChatSessionModel, BotSessionContext } from "../../../models/BotChatSession";
import { NluResult } from "../../nlu.service";
import { BotStateNode, HandlerResult } from "../BotStateNode";

export class AguardandoIdAgendamentoState implements BotStateNode {
  public async handle(
    userMessage: string,
    nlu: NluResult,
    session: BotChatSessionModel,
    userId: number
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
        serviceOptions: undefined,
        serviceOptionsData: undefined,
      },
    };
  }
}
