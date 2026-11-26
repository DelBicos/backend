import {
  validateCreateLock,
  validateUpdateLock,
} from "../availabilityLock.validation";
import { mockReq, mockRes } from "../../controllers/__tests__/handlerTestUtils";

describe("validateCreateLock", () => {
  it("responde 400 quando start_time nao e data", () => {
    const res = mockRes();
    validateCreateLock(mockReq({ body: {} }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "start_time inválido" });
  });

  it("segue para o proximo quando o intervalo e valido", () => {
    const next = jest.fn();
    validateCreateLock(
      mockReq({
        body: {
          start_time: "2026-05-01T10:00:00.000Z",
          end_time: "2026-05-01T12:00:00.000Z",
        },
      }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("validateUpdateLock", () => {
  it("responde 400 sem nenhum dos novos limites", () => {
    const res = mockRes();
    validateUpdateLock(mockReq({ body: {} }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Forneça new_start_time ou new_end_time",
    });
  });

  it("segue quando so new_end_time e enviado e valido", () => {
    const next = jest.fn();
    validateUpdateLock(
      mockReq({ body: { new_end_time: "2026-05-01T12:00:00.000Z" } }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});
