jest.mock("../../config/database");
jest.mock("../../services/professional/professional.service", () => ({
  searchPublic: jest.fn(),
  getPublicProfile: jest.fn(),
  searchAvailability: jest.fn(),
  register: jest.fn(),
  update: jest.fn(),
  getRadius: jest.fn(),
  updateRadius: jest.fn(),
}));
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import * as ProfessionalService from "../../services/professional/professional.service";
import { HttpError } from "../../errors/HttpError";
import * as controller from "../professional.controller";
import { mockReq, mockRes, settled } from "./handlerTestUtils";

const service = ProfessionalService as unknown as Record<string, jest.Mock>;

beforeEach(() => jest.clearAllMocks());

describe("professional.controller", () => {
  it("rotas publicas repassam query e params ao servico", async () => {
    service.searchPublic.mockResolvedValue({ professionals: [] });
    service.getPublicProfile.mockResolvedValue({ id: 7 });

    const list = mockRes();
    await settled(controller.getProfessionals)(
      mockReq({ query: { termo: "eletricista" } }),
      list,
    );
    expect(service.searchPublic).toHaveBeenCalledWith({ termo: "eletricista" });
    expect(list.json).toHaveBeenCalledWith({ professionals: [] });

    const one = mockRes();
    await settled(controller.getProfessionalById)(
      mockReq({ params: { id: "7" } }),
      one,
    );
    expect(service.getPublicProfile).toHaveBeenCalledWith("7");
    expect(one.json).toHaveBeenCalledWith({ id: 7 });
  });

  it("repassa o 404 de profissional inexistente", async () => {
    service.getPublicProfile.mockRejectedValue(
      HttpError.notFound("Profissional não encontrado"),
    );
    const res = mockRes();
    await settled(controller.getProfessionalById)(
      mockReq({ params: { id: "999" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it.each([
    ["createProfessional", controller.createProfessional],
    ["updateProfessional", controller.updateProfessional],
    ["getProfessionalRadius", controller.getProfessionalRadius],
    ["updateProfessionalRadius", controller.updateProfessionalRadius],
  ])("%s exige usuario autenticado (401)", async (_name, handler) => {
    const res = mockRes();
    await settled(handler)(mockReq({ params: { id: "7" } }), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("cadastra o profissional do usuario e responde 201", async () => {
    service.register.mockResolvedValue({ id: 7 });
    const body = { cpf: "12345678900", description: "Eletricista" };
    const res = mockRes();
    await settled(controller.createProfessional)(
      mockReq({ user: { id: 3 }, body }),
      res,
    );
    expect(service.register).toHaveBeenCalledWith(3, body);
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      message: "Profissional registrado com sucesso",
      professional: { id: 7 },
    });
  });

  it("atualiza e repassa o 403 de quem nao e o dono", async () => {
    service.update.mockResolvedValueOnce({ id: 7 });
    const res = mockRes();
    await settled(controller.updateProfessional)(
      mockReq({
        user: { id: 3 },
        params: { id: "7" },
        body: { description: "x" },
      }),
      res,
    );
    expect(service.update).toHaveBeenCalledWith(3, "7", { description: "x" });
    expect(res.json).toHaveBeenCalledWith({
      message: "Profissional atualizado",
      professional: { id: 7 },
    });

    service.update.mockRejectedValueOnce(HttpError.forbidden());
    const other = mockRes();
    await settled(controller.updateProfessional)(
      mockReq({ user: { id: 4 }, params: { id: "7" }, body: {} }),
      other,
    );
    expect(other.status).toHaveBeenCalledWith(403);
  });

  it("le e altera o raio de atendimento", async () => {
    service.getRadius.mockResolvedValue({ service_radius_km: 10 });
    service.updateRadius.mockResolvedValue({ service_radius_km: 15 });

    const read = mockRes();
    await settled(controller.getProfessionalRadius)(
      mockReq({ user: { id: 3 }, params: { id: "7" } }),
      read,
    );
    expect(service.getRadius).toHaveBeenCalledWith(3, "7");
    expect(read.json).toHaveBeenCalledWith({ service_radius_km: 10 });

    const write = mockRes();
    await settled(controller.updateProfessionalRadius)(
      mockReq({
        user: { id: 3 },
        params: { id: "7" },
        body: { service_radius_km: 15 },
      }),
      write,
    );
    expect(service.updateRadius).toHaveBeenCalledWith(3, "7", 15);
    expect(write.json).toHaveBeenCalledWith({ service_radius_km: 15 });
  });
});
