jest.mock("../../../config/database", () => {
  const { Sequelize } = require("sequelize");
  const sequelize = new Sequelize({ dialect: "postgres", logging: false });
  sequelize.transaction = jest.fn(async (cb: (t: object) => unknown) => cb({}));
  return { sequelize };
});
jest.mock("../../../models/Appointment");
jest.mock("../../../models/AppointmentAuditLog", () => ({
  AppointmentAuditLogModel: {
    create: jest.fn().mockResolvedValue({}),
    findAll: jest.fn().mockResolvedValue([]),
  },
}));
jest.mock("../../../models/Admin");
jest.mock("../../../models/Notification", () => ({
  NotificationModel: {
    create: jest.fn().mockResolvedValue({}),
  },
}));
jest.mock("../../../realtime/chatSocket", () => ({
  emitAppointmentStatusUpdate: jest.fn(),
}));

import {
  ensureVerificationCode,
  calculateDistanceInMeters,
  canUserAccessAuditTrail,
  processAppointmentInTransit,
  processAppointmentCheckin,
  processAppointmentCheckout,
  processAppointmentArrived,
  sendAppointmentStatusNotification,
  fetchAppointmentAuditTrail,
  findTrackingParticipant,
  AppointmentWithRelations,
} from "../checkin.service";
import { NotificationModel } from "../../../models/Notification";
import { AppointmentModel } from "../../../models/Appointment";
import { AppointmentAuditLogModel } from "../../../models/AppointmentAuditLog";
import { AdminModel } from "../../../models/Admin";
import { emitAppointmentStatusUpdate } from "../../../realtime/chatSocket";

describe("appointment/checkin.service", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("calculateDistanceInMeters", () => {
    it("deve calcular distância próxima de zero para coordenadas idênticas", () => {
      const dist = calculateDistanceInMeters(-23.5505, -46.6333, -23.5505, -46.6333);
      expect(dist).toBeCloseTo(0, 1);
    });

    it("deve calcular a distância aproximada correta entre dois pontos", () => {
      // ~111km por grau de latitude
      const dist = calculateDistanceInMeters(0, 0, 1, 0);
      expect(dist).toBeGreaterThan(110000);
      expect(dist).toBeLessThan(112000);
    });
  });

  describe("canUserAccessAuditTrail", () => {
    const mockAppt = {
      id: 1,
      Client: { user_id: 10 },
      Professional: { user_id: 20 },
    } as unknown as AppointmentWithRelations;

    it("deve permitir acesso para cliente do agendamento", async () => {
      const allowed = await canUserAccessAuditTrail(mockAppt, 10, false);
      expect(allowed).toBe(true);
    });

    it("deve permitir acesso para profissional do agendamento", async () => {
      const allowed = await canUserAccessAuditTrail(mockAppt, 20, false);
      expect(allowed).toBe(true);
    });

    it("deve permitir acesso para admin com flag isAdmin = true", async () => {
      const allowed = await canUserAccessAuditTrail(mockAppt, 999, true);
      expect(allowed).toBe(true);
    });

    it("deve permitir acesso se o usuário for encontrado na tabela AdminModel", async () => {
      (AdminModel.findOne as jest.Mock).mockResolvedValue({ id: 1, user_id: 999 });
      const allowed = await canUserAccessAuditTrail(mockAppt, 999, false);
      expect(allowed).toBe(true);
    });

    it("deve negar acesso para usuário terceiro não admin", async () => {
      (AdminModel.findOne as jest.Mock).mockResolvedValue(null);
      const allowed = await canUserAccessAuditTrail(mockAppt, 999, false);
      expect(allowed).toBe(false);
    });
  });

  describe("processAppointmentInTransit", () => {
    it("deve retornar 403 se o solicitante não for o profissional responsável", async () => {
      const mockAppt = {
        id: 1,
        status: "confirmed",
        Professional: { user_id: 20 },
      } as unknown as AppointmentWithRelations;

      const res = await processAppointmentInTransit(mockAppt, 99);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(403);
      }
    });

    it("deve retornar 400 se o status não for confirmed nem in_transit", async () => {
      const mockAppt = {
        id: 1,
        status: "pending",
        Professional: { user_id: 20 },
      } as unknown as AppointmentWithRelations;

      const res = await processAppointmentInTransit(mockAppt, 20);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(400);
      }
    });

    it("deve atualizar status para in_transit e registrar auditoria", async () => {
      const saveMock = jest.fn().mockResolvedValue(true);
      const mockAppt = {
        id: 1,
        status: "confirmed",
        Professional: { user_id: 20, User: { name: "Carlos" } },
        Client: { User: { id: 10 } },
        Service: { title: "Pintura" },
        save: saveMock,
      } as unknown as AppointmentWithRelations;

      const res = await processAppointmentInTransit(mockAppt, 20);
      expect(res.success).toBe(true);
      expect(mockAppt.status).toBe("in_transit");
      expect(saveMock).toHaveBeenCalled();
      expect(AppointmentAuditLogModel.create).toHaveBeenCalled();
    });
  });

  describe("processAppointmentCheckin", () => {
    it("deve retornar 403 se o usuário não for o profissional", async () => {
      const mockAppt = {
        id: 1,
        status: "arrived",
        verification_code: "AB-12",
        Professional: { user_id: 20 },
      } as unknown as AppointmentWithRelations;

      const res = await processAppointmentCheckin(mockAppt, 99, "AB-12");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(403);
      }
    });

    it("deve retornar 400 se já estiver em andamento ou concluído (CHK-06)", async () => {
      const mockAppt = {
        id: 1,
        status: "in_progress",
        verification_code: "AB-12",
        Professional: { user_id: 20 },
      } as unknown as AppointmentWithRelations;

      const res = await processAppointmentCheckin(mockAppt, 20, "AB-12");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(400);
        expect(res.error).toContain("já foi utilizado");
      }
      expect(AppointmentAuditLogModel.create).toHaveBeenCalledWith(
        expect.objectContaining({ action: "check_in_failed" }),
      );
    });

    it("deve retornar 400 se o código estiver incorreto", async () => {
      const mockAppt = {
        id: 1,
        status: "arrived",
        verification_code: "AB-12",
        Professional: { user_id: 20 },
      } as unknown as AppointmentWithRelations;

      const res = await processAppointmentCheckin(mockAppt, 20, "CD-34");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(400);
        expect(res.error).toContain("Código de confirmação incorreto");
      }
    });

    it("deve realizar o check-in com sucesso quando código conferir", async () => {
      (AppointmentModel.update as jest.Mock).mockResolvedValue([1]);
      const mockAppt = {
        id: 1,
        status: "arrived",
        verification_code: "AB-12",
        Professional: { user_id: 20 },
      } as unknown as AppointmentWithRelations;

      const res = await processAppointmentCheckin(mockAppt, 20, "AB-12");
      expect(res.success).toBe(true);
      expect(mockAppt.status).toBe("in_progress");
    });
  });

  describe("processAppointmentCheckout", () => {
    it("deve retornar 400 se já estiver concluído", async () => {
      const mockAppt = {
        id: 1,
        status: "completed",
        verification_code: "AB-12",
        Professional: { user_id: 20 },
      } as unknown as AppointmentWithRelations;

      const res = await processAppointmentCheckout(mockAppt, 20, "AB-12");
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(400);
      }
    });

    it("deve realizar check-out com sucesso quando código conferir", async () => {
      (AppointmentModel.update as jest.Mock).mockResolvedValue([1]);
      const mockAppt = {
        id: 1,
        status: "in_progress",
        verification_code: "AB-12",
        Professional: { user_id: 20 },
      } as unknown as AppointmentWithRelations;

      const res = await processAppointmentCheckout(mockAppt, 20, "AB-12");
      expect(res.success).toBe(true);
      expect(mockAppt.status).toBe("completed");
    });

    it("avisa o cliente em tempo real quando o serviço é concluído", async () => {
      (AppointmentModel.update as jest.Mock).mockResolvedValue([1]);
      (emitAppointmentStatusUpdate as jest.Mock).mockClear();
      const mockAppt = {
        id: 7,
        status: "in_progress",
        verification_code: "AB-12",
        Professional: { user_id: 20 },
        Client: { User: { id: 30 } },
      } as unknown as AppointmentWithRelations;

      await processAppointmentCheckout(mockAppt, 20, "AB-12");

      expect(emitAppointmentStatusUpdate).toHaveBeenCalledWith(
        30,
        expect.objectContaining({ appointment_id: 7, status: "completed" }),
      );
    });
  });

  describe("processAppointmentArrived", () => {
    it("deve rejeitar se a distância GPS for maior que 300m", async () => {
      const mockAppt = {
        id: 1,
        status: "in_transit",
        Professional: { user_id: 20 },
        Address: { lat: -23.5505, lng: -46.6333 },
      } as unknown as AppointmentWithRelations;

      // Coordenadas a vários km de distância
      const res = await processAppointmentArrived(mockAppt, 20, -23.6000, -46.7000);
      expect(res.success).toBe(false);
      if (!res.success) {
        expect(res.status).toBe(400);
        expect(res.error).toContain("Aproxime-se");
      }
    });

    it("deve confirmar chegada se a distância estiver dentro dos 300m", async () => {
      const saveMock = jest.fn().mockResolvedValue(true);
      const mockAppt = {
        id: 1,
        status: "in_transit",
        verification_code: "AB-12",
        Professional: { user_id: 20 },
        Address: { lat: -23.5505, lng: -46.6333 },
        save: saveMock,
      } as unknown as AppointmentWithRelations;

      const res = await processAppointmentArrived(mockAppt, 20, -23.5505, -46.6333);
      expect(res.success).toBe(true);
      expect(saveMock).toHaveBeenCalled();
      expect(mockAppt.status).toBe("arrived");
    });
  });
});

describe("ensureVerificationCode", () => {
  beforeEach(() => jest.clearAllMocks());

  it("não faz nada quando o agendamento já tem código", async () => {
    const appointment = { id: 1, verification_code: "AB-12", reload: jest.fn() };
    await ensureVerificationCode(appointment as unknown as AppointmentModel);
    expect(AppointmentModel.update).not.toHaveBeenCalled();
    expect(appointment.reload).not.toHaveBeenCalled();
  });

  it("gera e grava um código quando o agendamento está sem", async () => {
    (AppointmentModel.findOne as jest.Mock).mockResolvedValue(null);
    (AppointmentModel.update as jest.Mock).mockResolvedValue([1]);
    const appointment = { id: 7, verification_code: null, reload: jest.fn() };

    await ensureVerificationCode(appointment as unknown as AppointmentModel);

    const [changes, options] = (AppointmentModel.update as jest.Mock).mock.calls[0];
    expect(changes.verification_code).toMatch(/^[A-Z]{2}-[0-9]{2}$/);
    expect(options.where.id).toBe(7);
    expect(appointment.reload).toHaveBeenCalled();
  });

  it("tenta outro código quando o sorteado já está em uso", async () => {
    (AppointmentModel.findOne as jest.Mock)
      .mockResolvedValueOnce({ id: 99 })
      .mockResolvedValueOnce(null);
    (AppointmentModel.update as jest.Mock).mockResolvedValue([1]);
    const appointment = { id: 8, verification_code: null, reload: jest.fn() };

    await ensureVerificationCode(appointment as unknown as AppointmentModel);

    expect(AppointmentModel.findOne).toHaveBeenCalledTimes(2);
    expect(AppointmentModel.update).toHaveBeenCalledTimes(1);
  });
});

describe("transicoes concorrentes e auditoria de falhas", () => {
  const visit = (overrides: Record<string, unknown> = {}) =>
    ({
      id: 3,
      status: "arrived",
      verification_code: "AB-12",
      Professional: { user_id: 20 },
      Client: { user_id: 10, User: { id: 10, name: "Ana" } },
      Service: { title: "Pintura" },
      save: jest.fn(),
      ...overrides,
    }) as unknown as AppointmentWithRelations;

  beforeEach(() => jest.clearAllMocks());

  it("responde 409 quando outro check-in venceu a corrida", async () => {
    (AppointmentModel.update as jest.Mock).mockResolvedValue([0]);

    const res = await processAppointmentCheckin(visit(), 20, "AB-12");

    expect(res).toEqual({
      success: false,
      status: 409,
      error: "Este código já foi utilizado para este agendamento.",
    });
    expect(AppointmentAuditLogModel.create).not.toHaveBeenCalled();
  });

  it("grava o log de check-in na mesma transacao da troca de status", async () => {
    (AppointmentModel.update as jest.Mock).mockResolvedValue([1]);

    const res = await processAppointmentCheckin(visit(), 20, "AB-12");

    expect(res.success).toBe(true);
    expect(AppointmentModel.update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "in_progress" }),
      expect.objectContaining({ where: { id: 3, status: "arrived" } }),
    );
    expect(AppointmentAuditLogModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ action: "check_in", from_status: "arrived", to_status: "in_progress" }),
      expect.anything(),
    );
  });

  it("registra tentativa de check-in com codigo ja usado", async () => {
    await processAppointmentCheckin(visit({ status: "completed" }), 20, "AB-12");

    const [log] = (AppointmentAuditLogModel.create as jest.Mock).mock.calls[0];
    expect(log.action).toBe("check_in_failed");
    expect(JSON.parse(log.metadata)).toEqual({ reason: "already_used", status: "completed" });
  });

  it("nao registra falha de check-in por status invalido", async () => {
    const res = await processAppointmentCheckin(visit({ status: "confirmed" }), 20, "AB-12");
    expect(res.success).toBe(false);
    expect(AppointmentAuditLogModel.create).not.toHaveBeenCalled();
  });

  it("responde 409 quando outro check-out venceu a corrida", async () => {
    (AppointmentModel.update as jest.Mock).mockResolvedValue([0]);

    const res = await processAppointmentCheckout(visit({ status: "in_progress" }), 20, "AB-12");

    expect(res).toEqual({
      success: false,
      status: 409,
      error: "Este serviço já foi concluído anteriormente.",
    });
  });

  it("registra check-out com codigo errado truncando o codigo tentado", async () => {
    await processAppointmentCheckout(visit({ status: "in_progress" }), 20, "XXXXXXXXXXXXXXX");

    const [log] = (AppointmentAuditLogModel.create as jest.Mock).mock.calls[0];
    expect(log.action).toBe("check_out_failed");
    expect(JSON.parse(log.metadata)).toEqual({ reason: "invalid_code", code_attempted: "XXXXXXXXXX" });
  });

  it("registra check-out sem codigo como codigo vazio", async () => {
    await processAppointmentCheckout(visit({ status: "in_progress" }), 20, undefined);

    const [log] = (AppointmentAuditLogModel.create as jest.Mock).mock.calls[0];
    expect(JSON.parse(log.metadata).code_attempted).toBe("");
  });

  it("nao registra falha de check-out por status invalido", async () => {
    const res = await processAppointmentCheckout(visit({ status: "arrived" }), 20, "AB-12");
    expect(res.success).toBe(false);
    expect(AppointmentAuditLogModel.create).not.toHaveBeenCalled();
  });

  it("recusa chegada fora do status a caminho", async () => {
    const res = await processAppointmentArrived(visit({ status: "confirmed" }), 20, 0, 0);
    expect(res).toMatchObject({ success: false, status: 400 });
  });

  it("marca a caminho sem avisar quando o cliente nao tem usuario carregado", async () => {
    const appt = visit({ status: "confirmed", Client: undefined });

    const res = await processAppointmentInTransit(appt, 20);

    expect(res.success).toBe(true);
    expect(NotificationModel.create).not.toHaveBeenCalled();
  });
});

describe("sendAppointmentStatusNotification", () => {
  beforeEach(() => jest.clearAllMocks());

  it("nao avisa quando o cliente nao tem usuario", async () => {
    await sendAppointmentStatusNotification(
      { id: 3 } as unknown as AppointmentWithRelations,
      "arrived",
      "T",
      "M",
    );
    expect(NotificationModel.create).not.toHaveBeenCalled();
    expect(emitAppointmentStatusUpdate).not.toHaveBeenCalled();
  });

  it("cria a notificacao e emite o status como pago", async () => {
    await sendAppointmentStatusNotification(
      {
        id: 3,
        payment_intent_id: "pi_1",
        Client: { user_id: 10, User: { id: 10, name: "Ana" } },
      } as unknown as AppointmentWithRelations,
      "in_progress",
      "Titulo",
      "Mensagem",
    );

    expect(NotificationModel.create).toHaveBeenCalledWith({
      user_id: 10,
      title: "Titulo",
      message: "Mensagem",
      notification_type: "appointment",
      related_entity_id: 3,
      is_read: false,
    });
    expect(emitAppointmentStatusUpdate).toHaveBeenCalledWith(
      10,
      expect.objectContaining({
        appointment_id: 3,
        status: "in_progress",
        payment_status: "paid",
        payment_pending: false,
        paid: true,
      }),
    );
  });
});

describe("fetchAppointmentAuditTrail", () => {
  it("lista os logs do agendamento em ordem cronologica com o usuario", async () => {
    (AppointmentAuditLogModel.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);

    await expect(fetchAppointmentAuditTrail(3)).resolves.toEqual([{ id: 1 }]);

    const [query] = (AppointmentAuditLogModel.findAll as jest.Mock).mock.calls[0];
    expect(query.where).toEqual({ appointment_id: 3 });
    expect(query.order).toEqual([["created_at", "ASC"]]);
    expect(query.include[0].as).toBe("User");
  });
});

describe("findTrackingParticipant", () => {
  const tracked = {
    id: 3,
    status: "in_transit",
    Client: { User: { id: 10 } },
    Professional: { User: { id: 20, location_consent_accepted: true } },
  };

  beforeEach(() => jest.clearAllMocks());

  it.each([
    ["sem agendamento", 0, 10],
    ["sem usuario", 3, 0],
    ["com id nao numerico", "abc" as unknown as number, 10],
  ])("devolve null %s sem consultar o banco", async (_label, appointmentId, userId) => {
    await expect(findTrackingParticipant(appointmentId, userId)).resolves.toBeNull();
    expect(AppointmentModel.findByPk).not.toHaveBeenCalled();
  });

  it("devolve null quando o agendamento nao existe", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(null);
    await expect(findTrackingParticipant(3, 10)).resolves.toBeNull();
  });

  it("devolve null para quem nao participa do agendamento", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(tracked);
    await expect(findTrackingParticipant(3, 99)).resolves.toBeNull();
  });

  it("identifica o cliente", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(tracked);
    await expect(findTrackingParticipant(3, 10)).resolves.toEqual({
      role: "client",
      status: "in_transit",
      clientUserId: 10,
      professionalConsent: true,
    });
  });

  it("identifica o profissional sem consentimento de localizacao", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue({
      ...tracked,
      Professional: { User: { id: 20 } },
    });
    await expect(findTrackingParticipant(3, 20)).resolves.toMatchObject({
      role: "professional",
      professionalConsent: false,
    });
  });
});

describe("ensureVerificationCode - esgotamento", () => {
  it("desiste depois de 100 codigos ja em uso", async () => {
    (AppointmentModel.findOne as jest.Mock).mockReset().mockResolvedValue({ id: 99 });
    const appointment = { id: 8, verification_code: null, reload: jest.fn() };

    await expect(
      ensureVerificationCode(appointment as unknown as AppointmentModel),
    ).rejects.toThrow("Não foi possível gerar o código de início do atendimento");
    expect(AppointmentModel.findOne).toHaveBeenCalledTimes(100);
    expect(AppointmentModel.update).not.toHaveBeenCalled();
  });
});
