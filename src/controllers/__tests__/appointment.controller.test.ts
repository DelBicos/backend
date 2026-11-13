jest.mock("../../services/payment.service", () => ({
  PaymentService: {},
}));
jest.mock("../../utils/chatRoom", () => ({
  ensureChatRoomForAppointment: jest.fn().mockResolvedValue(null),
  syncChatRoomStatusForAppointment: jest.fn(),
}));
jest.mock("../../models/Appointment", () => ({
  AppointmentModel: {
    create: jest.fn(),
    findByPk: jest.fn(),
    findAll: jest.fn(),
  },
}));
jest.mock("../../models/User", () => ({
  UserModel: { findByPk: jest.fn() },
}));
jest.mock("../../models/Client", () => ({
  ClientModel: { findOne: jest.fn() },
}));
jest.mock("../../models/Professional", () => ({
  ProfessionalModel: { findByPk: jest.fn(), findOne: jest.fn() },
}));
jest.mock("../../models/Service", () => ({
  ServiceModel: { findByPk: jest.fn() },
}));
jest.mock("../../models/Notification", () => ({
  NotificationModel: { create: jest.fn() },
}));
jest.mock("../../models/Address", () => ({
  AddressModel: { findByPk: jest.fn() },
}));
jest.mock("../../models/Subcategory", () => ({
  SubCategoryModel: {},
}));

import { AppointmentModel } from "../../models/Appointment";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { ServiceModel } from "../../models/Service";
import { UserModel } from "../../models/User";
import {
  confirmAppointment,
  createAppointment,
  getAllAppointments,
  getAppointmentInvoice,
  reviewAppointment,
  updateAppointmentStatus,
} from "../appointment.controller";
import { mockReq, mockRes } from "../../test/http";

describe("createAppointment", () => {
  it("returns 401 when the user is missing", async () => {
    const res = mockRes();
    await createAppointment(mockReq() as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Usuário não autenticado" });
  });

  it("returns 403 when the user has no client profile", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await createAppointment(mockReq({ user: { id: 1 } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 400 when required scheduling fields are missing", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 5, user_id: 1 });
    const res = mockRes();
    await createAppointment(
      mockReq({ user: { id: 1 }, body: { service_id: 1 } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the professional does not exist", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 5, user_id: 1 });
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(null);
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue({ active: true });
    const res = mockRes();
    await createAppointment(
      mockReq({
        user: { id: 1 },
        body: {
          service_id: 3,
          professional_id: 2,
          start_time: "2026-05-01T10:00:00.000Z",
          end_time: "2026-05-01T11:00:00.000Z",
        },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Profissional não encontrado" });
  });

  it("returns 201 when the appointment is stored", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 5, user_id: 1 });
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({
      id: 2,
      user_id: 9,
      service_radius_km: null,
    });
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue({
      id: 3,
      active: true,
      title: "Corte",
    });
    const created = {
      id: 10,
      client_id: 5,
      professional_id: 2,
      start_time: new Date("2026-05-01T10:00:00.000Z"),
    };
    (AppointmentModel.create as jest.Mock).mockResolvedValue(created);
    (UserModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();

    await createAppointment(
      mockReq({
        user: { id: 1 },
        body: {
          service_id: 3,
          professional_id: 2,
          start_time: "2026-05-01T10:00:00.000Z",
          end_time: "2026-05-01T11:00:00.000Z",
        },
      }) as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(created);
  });

  it("returns 400 when persistence throws", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 5, user_id: 1 });
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({
      id: 2,
      service_radius_km: null,
    });
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue({ active: true, title: "Corte" });
    (AppointmentModel.create as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await createAppointment(
      mockReq({
        user: { id: 1 },
        body: {
          service_id: 3,
          professional_id: 2,
          start_time: "2026-05-01T10:00:00.000Z",
          end_time: "2026-05-01T11:00:00.000Z",
        },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "db" });
  });
});

describe("getAllAppointments", () => {
  it("returns 404 when the user does not exist", async () => {
    (UserModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getAllAppointments(mockReq({ params: { id: "1" }, query: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns an empty list when the client profile is missing", async () => {
    (UserModel.findByPk as jest.Mock).mockResolvedValue({ id: 1 });
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getAllAppointments(
      mockReq({ params: { id: "1" }, query: { role: "client" } }) as any,
      res,
    );
    expect(res.json).toHaveBeenCalledWith([]);
  });

  it("returns 500 when the lookup throws", async () => {
    (UserModel.findByPk as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getAllAppointments(mockReq({ params: { id: "1" }, query: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});

describe("confirmAppointment", () => {
  it("returns 404 when the appointment is missing", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await confirmAppointment(mockReq({ params: { id: "1" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when the appointment is not pending", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue({ status: "canceled" });
    const res = mockRes();
    await confirmAppointment(mockReq({ params: { id: "1" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });
});

describe("updateAppointmentStatus", () => {
  it("returns 400 for an unknown status", async () => {
    const res = mockRes();
    await updateAppointmentStatus(
      mockReq({ params: { id: "1" }, body: { status: "done" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Status inválido. Use 'confirmed' ou 'canceled'.",
    });
  });
});

describe("reviewAppointment", () => {
  it("returns 400 when rating is missing", async () => {
    const res = mockRes();
    await reviewAppointment(mockReq({ params: { id: "1" }, body: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 401 when the reviewer is anonymous", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue({
      status: "completed",
      Client: { User: { id: 1 } },
    });
    const res = mockRes();
    await reviewAppointment(
      mockReq({ params: { id: "1" }, body: { rating: 5 } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 403 when another client tries to review", async () => {
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue({
      status: "completed",
      Client: { User: { id: 2 } },
    });
    const res = mockRes();
    await reviewAppointment(
      mockReq({ user: { id: 1 }, params: { id: "1" }, body: { rating: 5 } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("registers a review for the owning client", async () => {
    const appointment = {
      status: "completed",
      rating: null,
      professional_id: 9,
      Client: { User: { id: 1 } },
      save: jest.fn(),
    };
    (AppointmentModel.findByPk as jest.Mock).mockResolvedValue(appointment);
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await reviewAppointment(
      mockReq({ user: { id: 1 }, params: { id: "1" }, body: { rating: 5 } }) as any,
      res,
    );
    expect(appointment.save).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
    );
  });
});

describe("getAppointmentInvoice", () => {
  it("returns 401 without an authenticated user", async () => {
    const res = mockRes();
    await getAppointmentInvoice(mockReq({ params: { id: "1" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 400 for a non-numeric id", async () => {
    const res = mockRes();
    await getAppointmentInvoice(
      mockReq({ user: { id: 1 }, params: { id: "abc" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the client profile is missing", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getAppointmentInvoice(
      mockReq({ user: { id: 1 }, params: { id: "3" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Cliente não encontrado." });
  });
});
