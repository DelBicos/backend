import { Request, Response } from "express";
jest.mock("../../services/bot/states/appointmentActions", () => ({ cancelBotAppointment: jest.fn() }));
jest.mock("../../utils/chatRoom", () => ({ syncChatRoomStatusForAppointment: jest.fn() }));
import { cancelBotAppointment } from "../../services/bot/states/appointmentActions";
import { cancelClientAppointment } from "../appointment.controller";
jest.mock("../../services/botAppointmentStatus.service", () => ({ syncBotSessionsForAppointmentStatus: jest.fn() }));
import { Sequelize } from "sequelize";
import { getAllAppointments } from "../appointment.controller";
import { AppointmentModel } from "../../models/Appointment";
import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";

jest.mock("../../config/database", () => {
  const { Sequelize } = require("sequelize");
  return {
    sequelize: new Sequelize({ dialect: "postgres", logging: false }),
  };
});
jest.mock("../../models/Appointment");
jest.mock("../../models/User");
jest.mock("../../models/Client");
jest.mock("../../models/Professional");
jest.mock("../../models/Address");
jest.mock("../../models/Service");
jest.mock("../../models/Subcategory");
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
  logDatabase: jest.fn(),
}));

describe("cancelClientAppointment", () => {
  beforeEach(() => jest.clearAllMocks());
  it("cancela apenas a reserva pertencente ao cliente autenticado", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 10 });
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({ id: 100, client_id: 10 });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await cancelClientAppointment({ user: { id: 7 }, params: { id: "ABC" } } as any, res as any);
    expect(AppointmentModel.findOne).toHaveBeenCalledWith({ where: { short_id: "ABC", client_id: 10 } });
    expect(cancelBotAppointment).toHaveBeenCalledWith(7, 100);
    expect(res.status).toHaveBeenCalledWith(200);
  });
  it("não cancela quando a reserva não pertence ao cliente", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 10 });
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await cancelClientAppointment({ user: { id: 7 }, params: { id: "ABC" } } as any, res as any);
    expect(cancelBotAppointment).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(404);
  });
});

describe("AppointmentController - getAllAppointments", () => {
  let req: Partial<Request>;
  let res: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    req = {
      params: { id: "1" },
      query: {},
    };
    res = {
      status: statusMock,
      json: jsonMock,
    };
    jest.clearAllMocks();
  });

  it("deve retornar erro 404 se o usuário não for encontrado", async () => {
    (UserModel.findByPk as jest.Mock).mockResolvedValue(null);

    await getAllAppointments(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(404);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Usuário não encontrado" });
  });

  it("deve retornar lista de agendamentos com Address, Subcategory e payment_method para perfil de cliente", async () => {
    req.query = { role: "client" };

    const mockUser = { id: 1, name: "Cliente Teste" };
    const mockClient = { id: 10, user_id: 1 };
    const mockAppointments = [
      {
        id: 100,
        professional_id: 20,
        client_id: 10,
        service_id: 5,
        address_id: 2,
        start_time: new Date("2026-09-01T10:00:00Z"),
        end_time: new Date("2026-09-01T11:00:00Z"),
        status: "pending",
        payment_intent_id: "pi_test_123",
        toJSON: () => ({
          id: 100,
          short_id: "ABC100",
          professional_id: 20,
          client_id: 10,
          service_id: 5,
          address_id: 2,
          start_time: "2026-09-01T10:00:00Z",
          end_time: "2026-09-01T11:00:00Z",
          status: "pending",
          payment_intent_id: "pi_test_123",
          Address: {
            id: 2,
            street: "Rua Exemplo",
            number: "123",
            complement: "Apto 45",
            neighborhood: "Centro",
            city: "São Paulo",
            state: "SP",
            postal_code: "01000-000",
          },
          Service: {
            id: 5,
            title: "Limpeza Residencial",
            price: "150.00",
            Subcategory: { id: 1, name: "Serviços Domésticos" },
          },
        }),
      },
    ];

    (UserModel.findByPk as jest.Mock).mockResolvedValue(mockUser);
    (ClientModel.findOne as jest.Mock).mockResolvedValue(mockClient);
    (AppointmentModel.findAll as jest.Mock).mockResolvedValue(mockAppointments);

    await getAllAppointments(req as Request, res as Response);

    expect(AppointmentModel.findAll).toHaveBeenCalled();
    expect(jsonMock).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          id: "ABC100",
          numeric_id: 100,
          payment_method: "Cartão de Crédito",
          Address: expect.objectContaining({
            street: "Rua Exemplo",
            city: "São Paulo",
          }),
        }),
      ])
    );
  });

  it("deve retornar lista de agendamentos para perfil de profissional", async () => {
    req.query = { role: "professional" };

    const mockUser = { id: 2, name: "Profissional Teste" };
    const mockProfessional = { id: 20, user_id: 2 };
    const mockAppointments = [
      {
        id: 101,
        professional_id: 20,
        client_id: 10,
        payment_intent_id: null,
        toJSON: () => ({
          id: 101,
          short_id: "ABC101",
          payment_intent_id: null,
          Address: {
            street: "Av. Paulista",
            number: "1000",
            neighborhood: "Bela Vista",
            city: "São Paulo",
            state: "SP",
            postal_code: "01310-100",
          },
        }),
      },
    ];

    (UserModel.findByPk as jest.Mock).mockResolvedValue(mockUser);
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue(mockProfessional);
    (AppointmentModel.findAll as jest.Mock).mockResolvedValue(mockAppointments);

    await getAllAppointments(req as Request, res as Response);

    expect(jsonMock).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "ABC101",
        numeric_id: 101,
        payment_method: "Cartão de Crédito",
        Address: expect.objectContaining({
          street: "Av. Paulista",
        }),
      }),
    ]);
  });
});
