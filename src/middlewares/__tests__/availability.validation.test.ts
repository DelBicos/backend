import {
  validateCreateAvailability,
  validateUpdateAvailability,
} from "../availability.validation";
import { mockReq, mockRes } from "../../controllers/__tests__/handlerTestUtils";

describe("validateCreateAvailability", () => {
  it("responde 400 sem start_time", () => {
    const res = mockRes();
    validateCreateAvailability(mockReq({ body: {} }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "start_time inválido (HH:MM ou HH:MM:SS)",
    });
  });

  it("segue com recorrencia semanal e mascara valida", () => {
    const next = jest.fn();
    validateCreateAvailability(
      mockReq({
        body: {
          start_time: "09:00",
          end_time: "18:00",
          recurrence_pattern: "weekly",
          days_of_week: "1111100",
        },
      }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("validateUpdateAvailability", () => {
  it("responde 400 quando start_time nao vem antes de end_time", () => {
    const res = mockRes();
    validateUpdateAvailability(
      mockReq({ body: { start_time: "18:00", end_time: "09:00" } }),
      res,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "start_time deve ser menor que end_time",
    });
  });

  it("segue quando nenhum horario e enviado", () => {
    const next = jest.fn();
    validateUpdateAvailability(mockReq({ body: {} }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
