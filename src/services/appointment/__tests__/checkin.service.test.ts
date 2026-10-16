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
  calculateDistanceInMeters,
  canUserAccessAuditTrail,
  processAppointmentInTransit,
  processAppointmentCheckin,
  processAppointmentCheckout,
  processAppointmentArrived,
  AppointmentWithRelations,
} from "../checkin.service";
import { AppointmentModel } from "../../../models/Appointment";
import { AppointmentAuditLogModel } from "../../../models/AppointmentAuditLog";
import { AdminModel } from "../../../models/Admin";

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
