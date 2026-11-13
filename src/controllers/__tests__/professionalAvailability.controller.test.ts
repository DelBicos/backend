jest.mock("../../models/ProfessionalAvailability", () => ({
  ProfessionalAvailabilityModel: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock("../../models/Professional", () => ({
  ProfessionalModel: { findByPk: jest.fn() },
}));

import { ProfessionalAvailabilityModel } from "../../models/ProfessionalAvailability";
import { ProfessionalModel } from "../../models/Professional";
import {
  createAvailability,
  deleteAvailability,
  listAvailability,
} from "../professionalAvailability.controller";
import { mockReq, mockRes } from "../../test/http";

describe("professionalAvailability.controller", () => {
  it("returns 400 for an invalid professional id", async () => {
    const res = mockRes();
    await listAvailability(mockReq({ params: { professionalId: "0" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("lists availabilities", async () => {
    (ProfessionalAvailabilityModel.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);
    const res = mockRes();
    await listAvailability(mockReq({ params: { professionalId: "2" } }) as any, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it("returns 500 when listing throws", async () => {
    (ProfessionalAvailabilityModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await listAvailability(mockReq({ params: { professionalId: "2" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 401 when creating without a user", async () => {
    const res = mockRes();
    await createAvailability(
      mockReq({ params: { professionalId: "2" }, body: {} }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 404 when the professional does not exist", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await createAvailability(
      mockReq({ user: { id: 1 }, params: { professionalId: "2" }, body: {} }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 403 when the user does not own the professional", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 9 });
    const res = mockRes();
    await createAvailability(
      mockReq({ user: { id: 1 }, params: { professionalId: "2" }, body: {} }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 409 when the slot overlaps an existing one", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 1 });
    (ProfessionalAvailabilityModel.findOne as jest.Mock).mockResolvedValue({ id: 8 });
    const res = mockRes();
    await createAvailability(
      mockReq({
        user: { id: 1 },
        params: { professionalId: "2" },
        body: { start_time: "09:00", end_time: "12:00", recurrence_pattern: "none" },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("returns 201 when the availability is created", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 1 });
    (ProfessionalAvailabilityModel.findOne as jest.Mock).mockResolvedValue(null);
    (ProfessionalAvailabilityModel.create as jest.Mock).mockResolvedValue({ id: 4 });
    const res = mockRes();
    await createAvailability(
      mockReq({
        user: { id: 1 },
        params: { professionalId: "2" },
        body: { start_time: "09:00", end_time: "12:00" },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 4 });
  });

  it("returns 200 when an owned availability is deactivated", async () => {
    const availability = {
      professional_id: 2,
      is_available: true,
      save: jest.fn(),
    };
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 1 });
    (ProfessionalAvailabilityModel.findOne as jest.Mock).mockResolvedValue(
      availability,
    );
    const res = mockRes();
    await deleteAvailability(
      mockReq({ user: { id: 1 }, params: { professionalId: "2", id: "4" } }) as any,
      res,
    );
    expect(availability.save).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ message: "Disponibilidade desativada" });
  });
});
