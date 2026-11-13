import {
  validateCreateLock,
  validateUpdateLock,
} from "../availabilityLock.validation";
import { mockReq, mockRes } from "../../test/http";

describe("validateCreateLock", () => {
  it("returns 400 when start_time is not a date", () => {
    const res = mockRes();
    validateCreateLock(mockReq({ body: {} }) as any, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "start_time inválido" });
  });

  it("calls next when the interval is valid", () => {
    const next = jest.fn();
    validateCreateLock(
      mockReq({
        body: {
          start_time: "2026-05-01T10:00:00.000Z",
          end_time: "2026-05-01T12:00:00.000Z",
        },
      }) as any,
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("validateUpdateLock", () => {
  it("returns 400 when neither new bound is sent", () => {
    const res = mockRes();
    validateUpdateLock(mockReq({ body: {} }) as any, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Forneça new_start_time ou new_end_time",
    });
  });

  it("calls next when only new_end_time is a valid date", () => {
    const next = jest.fn();
    validateUpdateLock(
      mockReq({ body: { new_end_time: "2026-05-01T12:00:00.000Z" } }) as any,
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
