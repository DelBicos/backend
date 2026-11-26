jest.mock("../../config/database");
jest.mock("../../services/professional/availability.service", () => ({
  list: jest.fn(),
  get: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  disable: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import * as AvailabilityService from "../../services/professional/availability.service";
import { HttpError } from "../../errors/HttpError";
import * as controller from "../professionalAvailability.controller";
import { mockReq, mockRes, settled } from "./handlerTestUtils";

const service = AvailabilityService as unknown as Record<string, jest.Mock>;
const listAvailability = settled(controller.listAvailability);
const getAvailabilityById = settled(controller.getAvailabilityById);
const createAvailability = settled(controller.createAvailability);
const updateAvailability = settled(controller.updateAvailability);
const deleteAvailability = settled(controller.deleteAvailability);
const deleteAvailabilityById = settled(controller.deleteAvailabilityById);

const body = { start_time: "08:00", end_time: "12:00", days_of_week: "1,2,3" };

beforeEach(() => jest.clearAllMocks());

describe("professionalAvailability.controller", () => {
  it("lista as janelas do profissional da rota", async () => {
    service.list.mockResolvedValue([{ id: 1 }]);
    const res = mockRes();
    await listAvailability(mockReq({ params: { professionalId: "7" } }), res);
    expect(service.list).toHaveBeenCalledWith("7");
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it("repassa o 400 do servico para professionalId invalido", async () => {
    service.list.mockRejectedValue(
      HttpError.badRequest("professionalId inválido"),
    );
    const res = mockRes();
    await listAvailability(mockReq({ params: { professionalId: "abc" } }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("busca uma janela pelo id, sem restringir o profissional", async () => {
    service.get.mockResolvedValue({ id: 3 });
    const res = mockRes();
    await getAvailabilityById(mockReq({ params: { id: "3" } }), res);
    expect(service.get).toHaveBeenCalledWith("3");
    expect(res.json).toHaveBeenCalledWith({ id: 3 });
  });

  it("criar exige usuario autenticado (401)", async () => {
    const res = mockRes();
    await createAvailability(
      mockReq({ params: { professionalId: "7" }, body }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each([
    [HttpError.notFound("Profissional não encontrado"), 404],
    [HttpError.forbidden(), 403],
    [new HttpError(409, "Janela sobreposta"), 409],
  ])("criar repassa o erro do servico (%s)", async (error, status) => {
    service.create.mockRejectedValue(error);
    const res = mockRes();
    await createAvailability(
      mockReq({ user: { id: 1 }, params: { professionalId: "7" }, body }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(status);
  });

  it("cria a janela em nome do usuario e responde 201", async () => {
    service.create.mockResolvedValue({ id: 10, ...body });
    const res = mockRes();
    await createAvailability(
      mockReq({ user: { id: 1 }, params: { professionalId: "7" }, body }),
      res,
    );
    expect(service.create).toHaveBeenCalledWith(1, "7", body);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({ id: 10, ...body });
  });

  it("atualiza dentro do profissional da rota", async () => {
    service.update.mockResolvedValue({ id: 10 });
    const res = mockRes();
    await updateAvailability(
      mockReq({
        user: { id: 1 },
        params: { professionalId: "7", id: "10" },
        body,
      }),
      res,
    );
    expect(service.update).toHaveBeenCalledWith(1, "10", body, "7");
    expect(res.json).toHaveBeenCalledWith({ id: 10 });
  });

  it("desativa: 200 com mensagem na rota aninhada e 204 na rota direta", async () => {
    service.disable.mockResolvedValue(undefined);

    const nested = mockRes();
    await deleteAvailability(
      mockReq({ user: { id: 1 }, params: { professionalId: "7", id: "10" } }),
      nested,
    );
    expect(service.disable).toHaveBeenCalledWith(1, "10", "7");
    expect(nested.status).toHaveBeenCalledWith(200);
    expect(nested.json).toHaveBeenCalledWith({
      message: "Disponibilidade desativada",
    });

    const direct = mockRes();
    await deleteAvailabilityById(
      mockReq({ user: { id: 1 }, params: { id: "10" } }),
      direct,
    );
    expect(service.disable).toHaveBeenLastCalledWith(1, "10");
    expect(direct.status).toHaveBeenCalledWith(204);
    expect(direct.send).toHaveBeenCalled();
  });
});
