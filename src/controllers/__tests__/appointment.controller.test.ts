import { Request, Response } from "express";
import { cancelBotAppointment } from "../../services/bot/states/appointmentActions";
import {
  cancelClientAppointment,
  createAppointment,
  getAllAppointments,
  reviewAppointment,
  markInTransitAppointment,
  markArrivedAppointment,
  startServiceAppointment,
  completeServiceAppointment,
  getAppointmentAuditTrail,
  getAppointmentById,
} from "../appointment.controller";
import { AppointmentModel } from "../../models/Appointment";
import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { ServiceModel } from "../../models/Service";
import { AddressModel } from "../../models/Address";
import { NotificationModel } from "../../models/Notification";
import { ensureChatRoomForAppointment } from "../../utils/chatRoom";
import { AppointmentAuditLogModel } from "../../models/AppointmentAuditLog";

jest.mock("../../config/database", () => {
  const { Sequelize } = require("sequelize");
  const sequelize = new Sequelize({ dialect: "postgres", logging: false });
  // Sem banco nos testes unitários: a transação só executa o callback.
  sequelize.transaction = jest.fn(async (cb: (t: object) => unknown) => cb({}));
  return {
    sequelize,
    chatMongoConnection: {
      model: jest.fn().mockReturnValue({}),
      on: jest.fn(),
    },
  };
});
jest.mock("../../models/Appointment");
jest.mock("../../models/User");
jest.mock("../../models/Client");
jest.mock("../../models/Professional");
jest.mock("../../models/Address");
jest.mock("../../models/Service");
jest.mock("../../models/Subcategory");
jest.mock("../../models/Notification");
jest.mock("../../models/AppointmentAuditLog", () => ({
  AppointmentAuditLogModel: {
    create: jest.fn().mockResolvedValue({}),
    findAll: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock("../../services/payment.service", () => ({ PaymentService: {} }));
jest.mock("../../utils/chatRoom", () => ({
  ensureChatRoomForAppointment: jest.fn(),
  syncChatRoomStatusForAppointment: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
  logDatabase: jest.fn(),
}));
jest.mock("../../services/bot/states/appointmentActions", () => ({
  cancelBotAppointment: jest.fn(),
}));
jest.mock("../../services/botAppointmentStatus.service", () => ({
  syncBotSessionsForAppointmentStatus: jest.fn(),
}));
jest.mock("../../services/appointmentSchedule.service", () => ({
  createAppointmentWithScheduleLock: jest.fn(async (data: unknown) => {
    const { AppointmentModel: Model } = require("../../models/Appointment");
    return Model.create(data);
  }),
  changePendingAppointmentStatus: jest.fn(),
  ScheduleConflictError: class ScheduleConflictError extends Error {},
}));

const slotStart = new Date();
slotStart.setUTCDate(slotStart.getUTCDate() + 10);
slotStart.setUTCHours(13, 0, 0, 0);
const slotEnd = new Date(slotStart.getTime() + 60 * 60 * 1000);

describe("AppointmentController - createAppointment", () => {
  let req: any;
  let res: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  const clientRecord = { id: 10, user_id: 1 };
  const professional = {
    id: 20,
    user_id: 2,
    service_radius_km: 10,
    MainAddress: { lat: "-23.5505", lng: "-46.6333" },
  };
  const service = { id: 5, title: "Limpeza Residencial", active: true };
  const validBody = {
    service_id: 5,
    professional_id: 20,
    address_id: 2,
    start_time: slotStart.toISOString(),
    end_time: slotEnd.toISOString(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    req = { user: { id: 1 }, body: { ...validBody } };
    res = { status: statusMock, json: jsonMock };

    (ClientModel.findOne as jest.Mock).mockResolvedValue(clientRecord);
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(professional);
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue(service);
    (AddressModel.findByPk as jest.Mock).mockResolvedValue({
      id: 2,
      lat: "-23.5614",
      lng: "-46.6559",
    });
    (AppointmentModel.create as jest.Mock).mockImplementation(
      async (data: any) => ({ id: 100, ...data }),
    );
    (UserModel.findByPk as jest.Mock).mockImplementation(async (id: number) =>
      id === 1
        ? { id: 1, name: "Cliente Teste" }
        : { id: 2, name: "Profissional Teste" },
    );
    (NotificationModel.create as jest.Mock).mockResolvedValue({});
  });

  describe("criação", () => {
    it("deve criar o agendamento com status pending e retornar 201", async () => {
      await createAppointment(req as Request, res as Response);

      expect(AppointmentModel.create).toHaveBeenCalledWith({
        professional_id: 20,
        client_id: 10,
        service_id: 5,
        address_id: 2,
        start_time: new Date(validBody.start_time),
        end_time: new Date(validBody.end_time),
        status: "pending",
      });
      expect(statusMock).toHaveBeenCalledWith(201);
      expect(jsonMock).toHaveBeenCalledWith(
        expect.objectContaining({ id: 100, status: "pending", client_id: 10 }),
      );
    });

    it("deve usar o client_id do usuário autenticado e ignorar o enviado no corpo", async () => {
      req.body.client_id = 999;

      await createAppointment(req as Request, res as Response);

      expect(ClientModel.findOne).toHaveBeenCalledWith({
        where: { user_id: 1 },
      });
      expect(AppointmentModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ client_id: 10 }),
      );
    });

    it("deve criar a sala de chat e notificar cliente e profissional", async () => {
      await createAppointment(req as Request, res as Response);

      expect(ensureChatRoomForAppointment).toHaveBeenCalledWith(
        expect.objectContaining({ id: 100 }),
      );
      expect(NotificationModel.create).toHaveBeenCalledTimes(2);
      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 2,
          title: "Novo Agendamento Recebido",
          related_entity_id: 100,
        }),
      );
      expect(NotificationModel.create).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: 1,
          title: "Agendamento Criado com Sucesso",
          related_entity_id: 100,
        }),
      );
    });

    it("deve aceitar coordenadas do cliente dentro do raio de atuação", async () => {
      delete req.body.address_id;
      req.body.client_lat = "-23.5614";
      req.body.client_lng = "-46.6559";

      await createAppointment(req as Request, res as Response);

      expect(AddressModel.findByPk).not.toHaveBeenCalled();
      expect(statusMock).toHaveBeenCalledWith(201);
    });

    it("deve retornar 400 quando o banco falhar ao salvar", async () => {
      (AppointmentModel.create as jest.Mock).mockRejectedValue(
        new Error("falha no banco"),
      );

      await createAppointment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({ error: "falha no banco" });
    });
  });

  describe("validação", () => {
    it("deve retornar 401 quando o usuário não estiver autenticado", async () => {
      delete req.user;

      await createAppointment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(401);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Usuário não autenticado",
      });
      expect(AppointmentModel.create).not.toHaveBeenCalled();
    });

    it("deve retornar 403 quando o usuário não tiver perfil de cliente", async () => {
      (ClientModel.findOne as jest.Mock).mockResolvedValue(null);

      await createAppointment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(403);
      expect(AppointmentModel.create).not.toHaveBeenCalled();
    });

    it.each(["service_id", "professional_id", "start_time", "end_time"])(
      "deve retornar 400 quando %s estiver ausente",
      async (field) => {
        delete req.body[field];

        await createAppointment(req as Request, res as Response);

        expect(statusMock).toHaveBeenCalledWith(400);
        expect(jsonMock).toHaveBeenCalledWith({
          error: expect.stringContaining("Campos obrigatórios"),
        });
        expect(AppointmentModel.create).not.toHaveBeenCalled();
      },
    );

    it("deve retornar 404 quando o profissional não existir", async () => {
      (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(null);

      await createAppointment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Profissional não encontrado",
      });
      expect(AppointmentModel.create).not.toHaveBeenCalled();
    });

    it("deve retornar 404 quando o serviço não existir", async () => {
      (ServiceModel.findByPk as jest.Mock).mockResolvedValue(null);

      await createAppointment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Serviço não encontrado",
      });
    });

    it("deve retornar 400 quando o serviço estiver inativo", async () => {
      (ServiceModel.findByPk as jest.Mock).mockResolvedValue({
        ...service,
        active: false,
      });

      await createAppointment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Serviço não está ativo",
      });
      expect(AppointmentModel.create).not.toHaveBeenCalled();
    });

    it("deve retornar 400 quando client_lat e client_lng forem inválidos", async () => {
      req.body.client_lat = "abc";
      req.body.client_lng = "xyz";

      await createAppointment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "client_lat e client_lng inválidos",
      });
    });

    it("deve retornar 404 quando o endereço do cliente não existir", async () => {
      (AddressModel.findByPk as jest.Mock).mockResolvedValue(null);

      await createAppointment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(404);
      expect(jsonMock).toHaveBeenCalledWith({
        error: "Endereço do cliente não encontrado",
      });
    });

    it("deve retornar 400 quando o endereço estiver fora do raio do profissional", async () => {
      (AddressModel.findByPk as jest.Mock).mockResolvedValue({
        id: 2,
        lat: "-22.9068",
        lng: "-43.1729",
      });

      await createAppointment(req as Request, res as Response);

      expect(statusMock).toHaveBeenCalledWith(400);
      expect(jsonMock).toHaveBeenCalledWith({
        error:
          "O endereço do cliente está fora do raio de atuação do profissional",
      });
      expect(AppointmentModel.create).not.toHaveBeenCalled();
    });
  });
});

describe("cancelClientAppointment", () => {
  beforeEach(() => jest.clearAllMocks());

  it("cancela apenas a reserva pertencente ao cliente autenticado", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 10 });
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      client_id: 10,
    });
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await cancelClientAppointment(
      { user: { id: 7 }, params: { id: "ABC" } } as any,
      res as any,
    );

    expect(AppointmentModel.findOne).toHaveBeenCalledWith({
      where: { short_id: "ABC", client_id: 10 },
    });
    expect(cancelBotAppointment).toHaveBeenCalledWith(7, 100);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("não cancela quando a reserva não pertence ao cliente", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 10 });
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };

    await cancelClientAppointment(
      { user: { id: 7 }, params: { id: "ABC" } } as any,
      res as any,
    );

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
    jest.clearAllMocks();
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
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue(null);
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
          short_id: "A1B2C3",
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

    expect(AppointmentModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { client_id: 10 },
        order: [["start_time", "ASC"]],
      }),
    );
    const [result] = jsonMock.mock.calls[0][0];
    expect(result).toEqual(
      expect.objectContaining({
        id: "A1B2C3",
        numeric_id: 100,
        payment_method: "Cartão de Crédito",
        Address: expect.objectContaining({
          street: "Rua Exemplo",
          city: "São Paulo",
        }),
        Service: expect.objectContaining({
          Subcategory: { id: 1, name: "Serviços Domésticos" },
        }),
      }),
    );
    expect(result).not.toHaveProperty("short_id");
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
          short_id: "Z9Y8X7",
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

    expect(AppointmentModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { professional_id: 20 } }),
    );
    expect(jsonMock).toHaveBeenCalledWith([
      expect.objectContaining({
        id: "Z9Y8X7",
        numeric_id: 101,
        payment_method: "Cartão de Crédito",
        Address: expect.objectContaining({
          street: "Av. Paulista",
        }),
      }),
    ]);
  });

  it("deve retornar lista vazia quando o cliente não tiver agendamentos", async () => {
    req.query = { role: "client" };
    (UserModel.findByPk as jest.Mock).mockResolvedValue({ id: 1 });
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 10, user_id: 1 });
    (AppointmentModel.findAll as jest.Mock).mockResolvedValue([]);

    await getAllAppointments(req as Request, res as Response);

    expect(statusMock).not.toHaveBeenCalled();
    expect(jsonMock).toHaveBeenCalledWith([]);
  });

  it("deve retornar lista vazia sem consultar o banco quando o usuário não tiver o perfil pedido", async () => {
    req.query = { role: "professional" };
    (UserModel.findByPk as jest.Mock).mockResolvedValue({ id: 1 });

    await getAllAppointments(req as Request, res as Response);

    expect(AppointmentModel.findAll).not.toHaveBeenCalled();
    expect(jsonMock).toHaveBeenCalledWith([]);
  });

  it("deve retornar 500 quando a consulta falhar", async () => {
    req.query = { role: "client" };
    (UserModel.findByPk as jest.Mock).mockResolvedValue({ id: 1 });
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 10, user_id: 1 });
    (AppointmentModel.findAll as jest.Mock).mockRejectedValue(
      new Error("timeout"),
    );

    await getAllAppointments(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(500);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Erro interno do servidor" });
  });
});

describe("Caixa preta — avaliação do agendamento (reviewAppointment)", () => {
  let req: any;
  let res: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let save: jest.Mock;

  const completedAppointment = () => ({
    id: 100,
    short_id: "A1B2C3",
    status: "completed",
    professional_id: 20,
    service_id: 5,
    rating: null,
    review: null,
    Client: { User: { id: 1, name: "Cliente" } },
    save,
  });

  beforeEach(() => {
    jest.clearAllMocks();
    save = jest.fn();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    req = {
      user: { id: 1 },
      params: { id: "A1B2C3" },
      body: { rating: 5, review: "Ótimo" },
    };
    res = { status: statusMock, json: jsonMock };
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(
      completedAppointment(),
    );
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({
      id: 20,
      user_id: 2,
    });
    (UserModel.findByPk as jest.Mock).mockResolvedValue({ id: 2 });
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue({
      title: "Limpeza",
    });
    (NotificationModel.create as jest.Mock).mockResolvedValue({});
  });

  it("AG-L-10: rating=1 (mínimo válido) é aceito", async () => {
    req.body.rating = 1;

    await reviewAppointment(req as Request, res as Response);

    expect(statusMock).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalled();
  });

  it("AG-L-11: rating=5 (máximo válido) é aceito", async () => {
    req.body.rating = 5;

    await reviewAppointment(req as Request, res as Response);

    expect(save).toHaveBeenCalled();
    expect(jsonMock).toHaveBeenCalled();
  });

  it("AG-L-12: rating=0 (abaixo do mínimo) é recusado", async () => {
    req.body.rating = 0;

    await reviewAppointment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "O campo 'rating' é obrigatório",
    });
  });

  it("AG-L-13: rating=6 (acima do máximo) é recusado", async () => {
    req.body.rating = 6;

    await reviewAppointment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "A avaliação deve estar entre 1 e 5",
    });
  });

  it("AG-L-14: comentário com 500 caracteres (máximo) é aceito", async () => {
    req.body.review = "a".repeat(500);

    await reviewAppointment(req as Request, res as Response);

    expect(save).toHaveBeenCalled();
  });

  it("AG-L-15: comentário com 501 caracteres (acima do máximo) é recusado", async () => {
    req.body.review = "a".repeat(501);

    await reviewAppointment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "O comentário deve ter no máximo 500 caracteres",
    });
    expect(save).not.toHaveBeenCalled();
  });
});

describe("markArrivedAppointment", () => {
  let req: any;
  let res: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let saveMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    saveMock = jest.fn();
    req = {
      user: { id: 2 },
      params: { id: "100" },
      body: { latitude: -23.5505, longitude: -46.6333 },
    };
    res = { status: statusMock, json: jsonMock };
  });

  it("deve recusar se coordenadas latitude e longitude não forem informadas", async () => {
    req.body = {};
    await markArrivedAppointment(req as Request, res as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Coordenadas (latitude e longitude) são obrigatórias para confirmar a chegada.",
    });
  });

  it("deve recusar se o agendamento não estiver em status in_transit ou arrived", async () => {
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      status: "canceled",
      Professional: { user_id: 2 },
      Address: { lat: -23.5505, lng: -46.6333 },
    });

    await markArrivedAppointment(req as Request, res as Response);
    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Não é possível marcar chegada em um agendamento com status 'canceled'",
    });
  });

  it("deve retornar verification_code no JSON de resposta para o profissional (CHK-02)", async () => {
    const mockAppt = {
      id: 100,
      status: "in_transit",
      verification_code: "1234",
      Professional: { user_id: 2, User: { id: 2, name: "Prof" } },
      Client: { User: { id: 1, name: "Cli" } },
      Service: { title: "Serviço" },
      Address: { lat: -23.5505, lng: -46.6333 },
      save: saveMock,
      toJSON: () => ({ id: 100, status: "arrived", verification_code: "1234" }),
    };
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(mockAppt);

    await markArrivedAppointment(req as Request, res as Response);

    expect(saveMock).toHaveBeenCalled();
    const result = jsonMock.mock.calls[0][0];
    expect(result.success).toBe(true);
    expect(result.appointment).toHaveProperty("verification_code");
    expect(result).toHaveProperty("verification_code");
  });
});

describe("getAppointmentById", () => {
  let req: any;
  let res: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    req = { user: { id: 1 }, params: { id: "100" } };
    res = { status: statusMock, json: jsonMock };
  });

  it("deve retornar 401 se usuário não estiver autenticado", async () => {
    req.user = undefined;
    await getAppointmentById(req as Request, res as Response);
    expect(statusMock).toHaveBeenCalledWith(401);
  });

  it("deve retornar 403 se o usuário não for nem cliente nem profissional do agendamento", async () => {
    req.user = { id: 99 };
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      Client: { User: { id: 1 } },
      Professional: { User: { id: 2 } },
    });

    await getAppointmentById(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(403);
    expect(jsonMock).toHaveBeenCalledWith({ error: "Acesso negado a este agendamento" });
  });

  it("deve incluir verification_code quando a requisição for feita pelo profissional (CHK-02)", async () => {
    req.user = { id: 2 };
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      verification_code: "9876",
      Client: { User: { id: 1 } },
      Professional: { User: { id: 2 } },
      toJSON: () => ({ id: 100, verification_code: "9876" }),
    });

    await getAppointmentById(req as Request, res as Response);

    const result = jsonMock.mock.calls[0][0];
    expect(result).toHaveProperty("verification_code", "9876");
  });

  it("deve incluir verification_code quando a requisição for feita pelo cliente (CHK-02)", async () => {
    req.user = { id: 1 };
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      verification_code: "9876",
      Client: { User: { id: 1 } },
      Professional: { User: { id: 2 } },
      toJSON: () => ({ id: 100, verification_code: "9876" }),
    });

    await getAppointmentById(req as Request, res as Response);

    const result = jsonMock.mock.calls[0][0];
    expect(result).toHaveProperty("verification_code", "9876");
  });
});

describe("startServiceAppointment (CHK-03 e CHK-06)", () => {
  let req: any;
  let res: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let saveMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    saveMock = jest.fn().mockResolvedValue(true);
    req = { user: { id: 2 }, params: { id: "100" }, body: { code: "AB-12" } };
    res = { status: statusMock, json: jsonMock };
  });

  it("deve rejeitar se o código já tiver sido utilizado (CHK-06)", async () => {
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      status: "in_progress",
      verification_code: "AB-12",
      Professional: { user_id: 2 },
    });

    await startServiceAppointment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Este código já foi utilizado para este agendamento.",
    });
  });

  it("deve rejeitar se o código for inválido ou incorreto (CHK-06)", async () => {
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      status: "arrived",
      verification_code: "AB-12",
      Professional: { user_id: 2 },
    });
    req.body = { code: "XX-99" };

    await startServiceAppointment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Código de confirmação incorreto. Verifique o código com o cliente.",
    });
  });

  it("deve recusar código com letras minúsculas (validação case-sensitive)", async () => {
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      status: "arrived",
      verification_code: "AB-12",
      Professional: { user_id: 2 },
    });
    req.body = { code: "ab-12" };

    await startServiceAppointment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(AppointmentModel.update).not.toHaveBeenCalled();
  });

  it("deve realizar check-in com sucesso quando código conferir (CHK-03)", async () => {
    (AppointmentModel.update as jest.Mock).mockResolvedValue([1]);
    const mockAppt = {
      id: 100,
      status: "arrived",
      verification_code: "AB-12",
      Professional: { user_id: 2, User: { id: 2, name: "Profissional" } },
      Client: { User: { id: 1, name: "Cliente" } },
      Service: { title: "Pintura" },
      save: saveMock,
      toJSON: () => ({ id: 100, status: "in_progress", verification_code: "AB-12" }),
    };
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(mockAppt);

    await startServiceAppointment(req as Request, res as Response);

    expect(AppointmentModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress", started_at: expect.any(Date) }),
      expect.objectContaining({ where: { id: 100, status: "arrived" } }),
    );
    expect(AppointmentAuditLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "check_in", from_status: "arrived", to_status: "in_progress" }),
      expect.objectContaining({ transaction: expect.anything() }),
    );
    expect(mockAppt.status).toBe("in_progress");
    const result = jsonMock.mock.calls[0][0];
    expect(result.success).toBe(true);
    expect(result.message).toContain("Check-in realizado com sucesso");
  });

  it("deve retornar 409 se outra requisição fizer o check-in antes (concorrência)", async () => {
    (AppointmentModel.update as jest.Mock).mockResolvedValue([0]);
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      status: "arrived",
      verification_code: "AB-12",
      Professional: { user_id: 2 },
    });

    await startServiceAppointment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(409);
    expect(AppointmentAuditLogModel.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "check_in" }),
      expect.anything(),
    );
  });
});

describe("completeServiceAppointment (CHK-04 e CHK-06)", () => {
  let req: any;
  let res: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;
  let saveMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    saveMock = jest.fn().mockResolvedValue(true);
    req = { user: { id: 2 }, params: { id: "100" }, body: { code: "AB-12" } };
    res = { status: statusMock, json: jsonMock };
  });

  it("deve rejeitar se o serviço já estiver concluído (CHK-06)", async () => {
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      status: "completed",
      verification_code: "AB-12",
      Professional: { user_id: 2 },
    });

    await completeServiceAppointment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Este serviço já foi concluído anteriormente.",
    });
  });

  it("deve rejeitar se o código para check-out estiver incorreto (CHK-06)", async () => {
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      status: "in_progress",
      verification_code: "AB-12",
      Professional: { user_id: 2 },
    });
    req.body = { code: "WR-00" };

    await completeServiceAppointment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(400);
    expect(jsonMock).toHaveBeenCalledWith({
      error: "Código de confirmação incorreto. Verifique o código com o cliente.",
    });
  });

  it("deve realizar check-out com sucesso quando código conferir (CHK-04)", async () => {
    (AppointmentModel.update as jest.Mock).mockResolvedValue([1]);
    const mockAppt = {
      id: 100,
      status: "in_progress",
      verification_code: "AB-12",
      Professional: { user_id: 2, User: { id: 2, name: "Profissional" } },
      Client: { User: { id: 1, name: "Cliente" } },
      Service: { title: "Pintura" },
      save: saveMock,
      toJSON: () => ({ id: 100, status: "completed", verification_code: "AB-12" }),
    };
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(mockAppt);

    await completeServiceAppointment(req as Request, res as Response);

    expect(AppointmentModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "completed", completed_at: expect.any(Date) }),
      expect.objectContaining({ where: { id: 100, status: "in_progress" } }),
    );
    expect(AppointmentAuditLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "check_out", from_status: "in_progress", to_status: "completed" }),
      expect.objectContaining({ transaction: expect.anything() }),
    );
    expect(mockAppt.status).toBe("completed");
    const result = jsonMock.mock.calls[0][0];
    expect(result.success).toBe(true);
    expect(result.message).toContain("Check-out realizado com sucesso");
  });

  it("deve retornar 409 se outra requisição fizer o check-out antes (concorrência)", async () => {
    (AppointmentModel.update as jest.Mock).mockResolvedValue([0]);
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      status: "in_progress",
      verification_code: "AB-12",
      Professional: { user_id: 2 },
    });

    await completeServiceAppointment(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(409);
  });
});

describe("getAppointmentAuditTrail (CHK-05 e CHK-07)", () => {
  let req: any;
  let res: Partial<Response>;
  let jsonMock: jest.Mock;
  let statusMock: jest.Mock;

  beforeEach(() => {
    jest.clearAllMocks();
    jsonMock = jest.fn();
    statusMock = jest.fn().mockReturnValue({ json: jsonMock });
    req = { user: { id: 1 }, params: { id: "100" } };
    res = { status: statusMock, json: jsonMock };
  });

  it("deve retornar 403 se usuário não fizer parte do agendamento", async () => {
    req.user = { id: 99 };
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      Client: { user_id: 1 },
      Professional: { user_id: 2 },
    });

    await getAppointmentAuditTrail(req as Request, res as Response);

    expect(statusMock).toHaveBeenCalledWith(403);
  });

  it("deve retornar os registros de auditoria ordenados para o cliente (CHK-07)", async () => {
    req.user = { id: 1 };
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue({
      id: 100,
      Client: { user_id: 1 },
      Professional: { user_id: 2 },
    });

    await getAppointmentAuditTrail(req as Request, res as Response);

    const result = jsonMock.mock.calls[0][0];
    expect(result.success).toBe(true);
    expect(result).toHaveProperty("audit_trail");
  });
});

