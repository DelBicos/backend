jest.mock("../../config/database");
jest.mock("../../services/professional/availabilityLock.service", () => ({
  list: jest.fn(),
  create: jest.fn(),
  remove: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import * as LockService from "../../services/professional/availabilityLock.service";
import { HttpError } from "../../errors/HttpError";
import * as controller from "../professionalAvailabilityLock.controller";
import { mockReq, mockRes, settled } from "./handlerTestUtils";

const service = LockService as unknown as Record<string, jest.Mock>;
const listLocks = settled(controller.listLocks);
const createLock = settled(controller.createLock);
const deleteLockById = settled(controller.deleteLockById);

const body = {
  start_date: "2026-12-24",
  end_date: "2026-12-26",
  reason: "Feriado",
};

beforeEach(() => jest.clearAllMocks());

describe("professionalAvailabilityLock.controller", () => {
  it("lista os bloqueios do profissional", async () => {
    service.list.mockResolvedValue([{ id: 1 }]);
    const res = mockRes();
    await listLocks(mockReq({ params: { professionalId: "7" } }), res);
    expect(service.list).toHaveBeenCalledWith("7");
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it("falha inesperada ao listar vira 500 generico", async () => {
    service.list.mockRejectedValue(new Error("db fora"));
    const res = mockRes();
    await listLocks(mockReq({ params: { professionalId: "7" } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("criar exige usuario autenticado (401)", async () => {
    const res = mockRes();
    await createLock(mockReq({ params: { professionalId: "7" }, body }), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(service.create).not.toHaveBeenCalled();
  });

  it.each([
    [HttpError.notFound("Profissional não encontrado"), 404],
    [HttpError.forbidden(), 403],
    [HttpError.badRequest("Período inválido"), 400],
  ])("criar repassa o erro do servico (%s)", async (error, status) => {
    service.create.mockRejectedValue(error);
    const res = mockRes();
    await createLock(
      mockReq({ user: { id: 1 }, params: { professionalId: "7" }, body }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(status);
  });

  it("cria o bloqueio em nome do usuario e responde 201", async () => {
    service.create.mockResolvedValue({ id: 3, ...body });
    const res = mockRes();
    await createLock(
      mockReq({ user: { id: 1 }, params: { professionalId: "7" }, body }),
      res,
    );
    expect(service.create).toHaveBeenCalledWith(1, "7", body);
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("remove o bloqueio (204) e repassa o 404 quando nao existe", async () => {
    service.remove.mockResolvedValueOnce(undefined);
    const res = mockRes();
    await deleteLockById(
      mockReq({ user: { id: 1 }, params: { id: "3" } }),
      res,
    );
    expect(service.remove).toHaveBeenCalledWith(1, "3");
    expect(res.status).toHaveBeenCalledWith(204);
    expect(res.send).toHaveBeenCalled();

    service.remove.mockRejectedValueOnce(
      HttpError.notFound("Bloqueio não encontrado"),
    );
    const missing = mockRes();
    await deleteLockById(
      mockReq({ user: { id: 1 }, params: { id: "9" } }),
      missing,
    );
    expect(missing.status).toHaveBeenCalledWith(404);
  });
});
