import {
  validateCreateAvailability,
  validateUpdateAvailability,
} from "../availability.validation";
import { mockReq, mockRes } from "../../test/http";

describe("validateCreateAvailability", () => {
  it("returns 400 when start_time is missing", () => {
    const res = mockRes();
    validateCreateAvailability(mockReq({ body: {} }) as any, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "start_time inválido (HH:MM ou HH:MM:SS)",
    });
  });

  it("calls next for a weekly payload with a valid mask", () => {
    const next = jest.fn();
    validateCreateAvailability(
      mockReq({
        body: {
          start_time: "09:00",
          end_time: "18:00",
          recurrence_pattern: "weekly",
          days_of_week: "1111100",
        },
      }) as any,
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("validateUpdateAvailability", () => {
  it("returns 400 when start_time is not before end_time", () => {
    const res = mockRes();
    validateUpdateAvailability(
      mockReq({ body: { start_time: "18:00", end_time: "09:00" } }) as any,
      res,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "start_time deve ser menor que end_time",
    });
  });

  it("calls next when no time fields are sent", () => {
    const next = jest.fn();
    validateUpdateAvailability(mockReq({ body: {} }) as any, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
