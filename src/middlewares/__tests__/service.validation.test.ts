import {
  validateCreateService,
  validateCreateServiceTopLevel,
  validateUpdateService,
} from "../service.validation";
import { mockReq, mockRes } from "../../controllers/__tests__/handlerTestUtils";

const validCreate = {
  title: "Corte",
  duration: 60,
  price: 50,
  subcategory_id: 2,
};

describe("validateCreateService", () => {
  it("responde 400 sem titulo", () => {
    const res = mockRes();
    const next = jest.fn();
    validateCreateService(mockReq({ body: {} }), res, next);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "title é obrigatório" });
    expect(next).not.toHaveBeenCalled();
  });

  it("segue para o proximo com corpo valido", () => {
    const next = jest.fn();
    validateCreateService(mockReq({ body: validCreate }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("validateCreateServiceTopLevel", () => {
  it("responde 400 sem descricao", () => {
    const res = mockRes();
    validateCreateServiceTopLevel(
      mockReq({ body: { ...validCreate, category_id: 1 } }),
      res,
      jest.fn(),
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "description é obrigatória",
    });
  });

  it("segue quando campos obrigatorios e disponibilidades sao validos", () => {
    const next = jest.fn();
    validateCreateServiceTopLevel(
      mockReq({
        body: {
          ...validCreate,
          description: "Descrição",
          category_id: 1,
          availabilities: [{ day: 1, start: "09:00", end: "12:00" }],
        },
      }),
      mockRes(),
      next,
    );
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("validateUpdateService", () => {
  it("responde 400 para titulo enviado em branco", () => {
    const res = mockRes();
    validateUpdateService(mockReq({ body: { title: "  " } }), res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "title inválido" });
  });

  it("segue quando o corpo vem vazio", () => {
    const next = jest.fn();
    validateUpdateService(mockReq({ body: {} }), mockRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });
});
