jest.mock("../../models/Professional", () => ({
  ProfessionalModel: {
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock("../../models/User", () => ({ UserModel: { findByPk: jest.fn() } }));
jest.mock("../../models/Address", () => ({ AddressModel: {} }));
jest.mock("../../models/Service", () => ({ ServiceModel: {} }));
jest.mock("../../models/Appointment", () => ({ AppointmentModel: {} }));
jest.mock("../../models/Client", () => ({ ClientModel: { findOne: jest.fn() } }));
jest.mock("../../models/ProfessionalAvailability", () => ({
  ProfessionalAvailabilityModel: {},
}));
jest.mock("../../models/ServiceAvailability", () => ({
  ServiceAvailabilityModel: {},
}));

import { ProfessionalModel } from "../../models/Professional";
import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import {
  createProfessional,
  getProfessionalById,
  getProfessionalRadius,
  getProfessionals,
  updateProfessional,
  updateProfessionalRadius,
} from "../professional.controller";
import { mockReq, mockRes } from "../../test/http";

describe("professional.controller", () => {
  it("returns the professional list", async () => {
    (ProfessionalModel.findAndCountAll as jest.Mock).mockResolvedValue({
      count: 1,
      rows: [
        {
          id: 1,
          User: { name: "Ana", email: "a@a.com", avatar_uri: null, banner_uri: null },
          MainAddress: null,
          Services: [],
          Appointments: [{ rating: 5 }],
          dataValues: {},
        },
      ],
    });
    const res = mockRes();
    await getProfessionals(mockReq({ query: {} }) as any, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ totalCount: 1, professionals: [expect.objectContaining({ id: 1, rating: 5 })] }),
    );
  });

  it("returns 500 when the list query fails", async () => {
    (ProfessionalModel.findAndCountAll as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getProfessionals(mockReq({ query: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 401, 400, 404 and 403 for radius reads", async () => {
    const unauth = mockRes();
    await getProfessionalRadius(mockReq({ params: { id: "1" } }) as any, unauth);
    expect(unauth.status).toHaveBeenCalledWith(401);

    const badId = mockRes();
    await getProfessionalRadius(
      mockReq({ user: { id: 1 }, params: { id: "0" } }) as any,
      badId,
    );
    expect(badId.status).toHaveBeenCalledWith(400);

    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(null);
    const missing = mockRes();
    await getProfessionalRadius(
      mockReq({ user: { id: 1 }, params: { id: "2" } }) as any,
      missing,
    );
    expect(missing.status).toHaveBeenCalledWith(404);

    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 9 });
    const forbidden = mockRes();
    await getProfessionalRadius(
      mockReq({ user: { id: 1 }, params: { id: "2" } }) as any,
      forbidden,
    );
    expect(forbidden.status).toHaveBeenCalledWith(403);
    expect(forbidden.json).toHaveBeenCalledWith({ error: "Não autorizado" });
  });

  it("returns the radius for the owner", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({
      user_id: 1,
      service_radius_km: 12,
    });
    const res = mockRes();
    await getProfessionalRadius(
      mockReq({ user: { id: 1 }, params: { id: "2" } }) as any,
      res,
    );
    expect(res.json).toHaveBeenCalledWith({ service_radius_km: 12 });
  });

  it("returns 400 when service_radius_km is missing on update", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 1 });
    const res = mockRes();
    await updateProfessionalRadius(
      mockReq({ user: { id: 1 }, params: { id: "2" }, body: {} }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "service_radius_km é obrigatório" });
  });

  it("returns 404 when the professional id does not exist", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getProfessionalById(mockReq({ params: { id: "2" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 401 and 400 when creating a professional profile", async () => {
    const unauth = mockRes();
    await createProfessional(mockReq({ body: {} }) as any, unauth);
    expect(unauth.status).toHaveBeenCalledWith(401);

    const missingDoc = mockRes();
    await createProfessional(
      mockReq({ user: { id: 1 }, body: { description: "oi" } }) as any,
      missingDoc,
    );
    expect(missingDoc.status).toHaveBeenCalledWith(400);
    expect(missingDoc.json).toHaveBeenCalledWith({ error: "CPF ou CNPJ é obrigatório" });
  });

  it("returns 409 when the CPF is already registered", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    (UserModel.findByPk as jest.Mock).mockResolvedValue({ id: 1 });
    const error = new Error("dup") as any;
    error.name = "SequelizeUniqueConstraintError";
    error.errors = [{ path: "cpf" }];
    (ProfessionalModel.create as jest.Mock).mockRejectedValue(error);
    const res = mockRes();
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue(null);
    await createProfessional(
      mockReq({
        user: { id: 1 },
        body: { cpf: "123.456.789-00", description: "Pintor" },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("returns 403 when updating a professional owned by someone else", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 9 });
    const res = mockRes();
    await updateProfessional(
      mockReq({ user: { id: 1 }, params: { id: "2" }, body: {} }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({
      error: "Não autorizado a atualizar este profissional",
    });
  });
});
