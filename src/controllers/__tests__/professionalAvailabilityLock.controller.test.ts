jest.mock("../../models/ProfessionalAvailabilityLock", () => ({
  ProfessionalAvailabilityLockModel: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock("../../models/Professional", () => ({
  ProfessionalModel: { findByPk: jest.fn() },
}));

import { ProfessionalAvailabilityLockModel } from "../../models/ProfessionalAvailabilityLock";
import { ProfessionalModel } from "../../models/Professional";
import {
  createLock,
  deleteLockById,
  listLocks,
} from "../professionalAvailabilityLock.controller";
import { mockReq, mockRes } from "../../test/http";

describe("professionalAvailabilityLock.controller", () => {
  it("returns 400 for an invalid professional id", async () => {
    const res = mockRes();
    await listLocks(mockReq({ params: { professionalId: "no" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("lists locks", async () => {
    (ProfessionalAvailabilityLockModel.findAll as jest.Mock).mockResolvedValue([
      { id: 1 },
    ]);
    const res = mockRes();
    await listLocks(mockReq({ params: { professionalId: "2" } }) as any, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it("returns 500 when listing throws", async () => {
    (ProfessionalAvailabilityLockModel.findAll as jest.Mock).mockRejectedValue(
      new Error("db"),
    );
    const res = mockRes();
    await listLocks(mockReq({ params: { professionalId: "2" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 401, 404 and 403 while creating a lock", async () => {
    const unauth = mockRes();
    await createLock(mockReq({ params: { professionalId: "2" } }) as any, unauth);
    expect(unauth.status).toHaveBeenCalledWith(401);

    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(null);
    const missing = mockRes();
    await createLock(
      mockReq({ user: { id: 1 }, params: { professionalId: "2" }, body: {} }) as any,
      missing,
    );
    expect(missing.status).toHaveBeenCalledWith(404);

    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 9 });
    const forbidden = mockRes();
    await createLock(
      mockReq({ user: { id: 1 }, params: { professionalId: "2" }, body: {} }) as any,
      forbidden,
    );
    expect(forbidden.status).toHaveBeenCalledWith(403);
  });

  it("returns 201 when the owner creates a lock", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 1 });
    (ProfessionalAvailabilityLockModel.create as jest.Mock).mockResolvedValue({
      id: 6,
    });
    const res = mockRes();
    await createLock(
      mockReq({
        user: { id: 1 },
        params: { professionalId: "2" },
        body: {
          start_time: "2026-05-01T10:00:00.000Z",
          end_time: "2026-05-01T12:00:00.000Z",
        },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 404 when the lock does not exist", async () => {
    (ProfessionalAvailabilityLockModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await deleteLockById(
      mockReq({ user: { id: 1 }, params: { id: "6" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Bloqueio não encontrado" });
  });

  it("returns 204 when the owner deletes a lock", async () => {
    const destroy = jest.fn();
    (ProfessionalAvailabilityLockModel.findByPk as jest.Mock).mockResolvedValue({
      professional_id: 2,
      destroy,
    });
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 1 });
    const res = mockRes();
    await deleteLockById(
      mockReq({ user: { id: 1 }, params: { id: "6" } }) as any,
      res,
    );
    expect(destroy).toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(204);
  });
});
