jest.mock("../../../models/Appointment", () => ({
  AppointmentModel: { findAll: jest.fn() },
}));
jest.mock("../../../models/Client", () => ({
  ClientModel: { findOne: jest.fn() },
}));
jest.mock("../../../models/Service", () => ({ ServiceModel: {} }));

import { Op } from "sequelize";
import { AppointmentModel } from "../../../models/Appointment";
import { ClientModel } from "../../../models/Client";
import type { BotSessionContext } from "../../../models/BotChatSession";
import { parseAppointmentQuery } from "../appointmentQuery.rules";
import { queryBotAppointments } from "../appointmentQuery.service";

describe("CHAT-05: reconhecimento de consultas", () => {
  it.each([
    ["meus agendamentos", []],
    ["todos os meus agendamentos", []],
    ["quero ver meus serviços cancelados", ["canceled"]],
    ["serviços pendentes", ["pending"]],
    ["agendamentos confirmados", ["confirmed"]],
    ["minhas reservas concluídas", ["completed"]],
    ["meus agendamentos pendentes e confirmados", ["pending", "confirmed"]],
  ])("reconhece %s", (message, statuses) => {
    expect(parseAppointmentQuery(message as string)).toEqual({
      statuses,
      offset: 0,
      hasMore: false,
    });
  });

  it.each([
    "cancelar meus agendamentos pendentes",
    "reagendar meu serviço confirmado",
    "quero agendar limpeza",
    "mudar meus agendamentos",
    "quais horários livres",
    "sim",
  ])(
    "não transforma ação ou entrada de outro fluxo em consulta: %s",
    (message) => {
      expect(parseAppointmentQuery(message)).toBeNull();
    },
  );

  it("mantém filtro na navegação e reinicia ao trocar status", () => {
    const previous = {
      statuses: ["canceled" as const],
      offset: 5,
      hasMore: true,
    };
    expect(parseAppointmentQuery("ver mais", previous)).toMatchObject({
      statuses: ["canceled"],
      offset: 10,
    });
    expect(parseAppointmentQuery("página anterior", previous)).toMatchObject({
      offset: 0,
    });
    expect(parseAppointmentQuery("e os pendentes?", previous)).toMatchObject({
      statuses: ["pending"],
      offset: 0,
    });
    expect(parseAppointmentQuery("todos", previous)).toMatchObject({
      statuses: [],
      offset: 0,
    });
    expect(parseAppointmentQuery("ver mais")).toBeNull();
  });
});

describe("CHAT-05: histórico completo paginado", () => {
  beforeEach(() => {
    jest.resetAllMocks();
    jest
      .mocked(ClientModel.findOne)
      .mockResolvedValue({ id: 10 } as ClientModel);
  });
  const appointments = Array.from({ length: 13 }, (_, index) => ({
    id: 30 - index,
    start_time: new Date("2020-01-02T15:30:00Z"),
    status: index % 2 ? "canceled" : "completed",
    Service: { title: "Limpeza" },
  }));

  it("permite percorrer mais de duas páginas sem omitir registros antigos ou encerrados", async () => {
    jest
      .mocked(AppointmentModel.findAll)
      .mockImplementation(async (options) => {
        const offset = Number(options?.offset ?? 0);
        return appointments.slice(
          offset,
          offset + Number(options?.limit),
        ) as unknown as AppointmentModel[];
      });
    let context: BotSessionContext = {};
    const replies: string[] = [];
    for (const message of [
      "meus agendamentos",
      "ver mais agendamentos",
      "ver mais",
    ]) {
      const result = await queryBotAppointments(7, message, context);
      replies.push(result.reply);
      context = result.contextUpdate;
    }
    expect(replies[0]).toContain("Exibindo 1 a 5");
    expect(replies[0]).toContain("Há mais agendamentos");
    expect(replies[1]).toContain("Exibindo 6 a 10");
    expect(replies[2]).toContain("Exibindo 11 a 13");
    expect(replies[2]).toContain("Fim da lista");
    expect(context.appointmentQuery?.hasMore).toBe(false);
    for (const appointment of appointments) {
      expect(replies.join("\n").split(`ID ${appointment.id} —`)).toHaveLength(
        2,
      );
    }
    expect(replies[0]).toContain("02/01/2020 às 12:30");
    expect(replies[0]).toContain("Concluído");
    expect(replies[0]).toContain("Cancelado");
    expect(ClientModel.findOne).toHaveBeenCalledWith({ where: { user_id: 7 } });
    expect(AppointmentModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { client_id: 10 },
        limit: 6,
        order: [
          ["start_time", "DESC"],
          ["id", "DESC"],
        ],
      }),
    );
  });

  it.each(["pending", "confirmed", "completed", "canceled"] as const)(
    "limita a consulta ao cliente e ao status %s",
    async (status) => {
      jest.mocked(AppointmentModel.findAll).mockResolvedValue([]);
      const result = await queryBotAppointments(7, "ver mais", {
        appointmentQuery: { statuses: [status], offset: 0, hasMore: true },
      });
      expect(AppointmentModel.findAll).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { client_id: 10, status: { [Op.in]: [status] } },
          offset: 5,
        }),
      );
      expect(result.contextUpdate.appointmentQuery?.hasMore).toBe(false);
      expect(result.reply).toContain("Nenhum agendamento encontrado");
    },
  );

  it("não consulta reservas sem perfil de cliente", async () => {
    jest.mocked(ClientModel.findOne).mockResolvedValue(null);
    expect(
      (await queryBotAppointments(7, "meus agendamentos", {})).reply,
    ).toContain("perfil de cliente");
    expect(AppointmentModel.findAll).not.toHaveBeenCalled();
  });
});
