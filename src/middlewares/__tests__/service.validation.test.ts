import {
  validateCreateService,
  validateCreateServiceTopLevel,
  validateUpdateService,
} from "../service.validation";
import { mockReq, mockRes } from "../../test/http";

const validCreate = {
  title: "Corte",
  duration: 60,
  price: 50,
  subcategory_id: 2,
};

describe("validateCreateService", () => {
  it("returns 400 when title is missing", () => {
    const res = mockRes();
    const next = jest.fn();
    validateCreateService(mockReq({ body: {} }) as any, res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "title é obrigatório" });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next for a valid payload", () => {
    const next = jest.fn();
    validateCreateService(mockReq({ body: validCreate }) as any, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("validateCreateServiceTopLevel", () => {
  it("returns 400 when description is missing", () => {
    const res = mockRes();
    validateCreateServiceTopLevel(
      mockReq({ body: { ...validCreate, category_id: 1 } }) as any,
      res,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "description é obrigatória" });
  });

  it("calls next when required fields and availabilities are valid", () => {
    const next = jest.fn();
    validateCreateServiceTopLevel(
      mockReq({
        body: {
          ...validCreate,
          description: "Descrição",
          category_id: 1,
          availabilities: [{ day: 1, start: "09:00", end: "12:00" }],
        },
      }) as any,
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("validateUpdateService", () => {
  it("returns 400 when an explicit title is blank", () => {
    const res = mockRes();
    validateUpdateService(
      mockReq({ body: { title: "  " } }) as any,
      res,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "title inválido" });
  });

  it("calls next when the body is empty", () => {
    const next = jest.fn();
    validateUpdateService(mockReq({ body: {} }) as any, mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
