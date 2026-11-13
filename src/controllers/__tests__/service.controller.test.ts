jest.mock("../../models/Service", () => ({
  ServiceModel: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    findOne: jest.fn(),
    findAndCountAll: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock("../../models/ServiceAvailability", () => ({
  ServiceAvailabilityModel: { bulkCreate: jest.fn() },
}));
jest.mock("../../models/Professional", () => ({
  ProfessionalModel: { findOne: jest.fn(), findByPk: jest.fn() },
}));
jest.mock("../../models/Subcategory", () => ({
  SubCategoryModel: { findByPk: jest.fn() },
}));
jest.mock("../../models/User", () => ({ UserModel: {} }));
jest.mock("../../models/Address", () => ({ AddressModel: {} }));

import { ProfessionalModel } from "../../models/Professional";
import { ServiceModel } from "../../models/Service";
import { SubCategoryModel } from "../../models/Subcategory";
import {
  createService,
  createServiceSelf,
  deleteService,
  getService,
  listMyServices,
  listServices,
} from "../service.controller";
import { mockReq, mockRes } from "../../test/http";

describe("service.controller", () => {
  it("returns 400 when listing with an invalid professional id", async () => {
    const res = mockRes();
    await listServices(mockReq({ params: { professionalId: "0" }, query: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 500 when listing throws", async () => {
    (ServiceModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await listServices(mockReq({ params: { professionalId: "2" }, query: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 404 when the service does not exist", async () => {
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getService(mockReq({ params: { id: "3" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Serviço não encontrado" });
  });

  it("returns 200 with normalized availabilities", async () => {
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue({
      toJSON: () => ({ id: 3, title: "Corte" }),
      Availabilities: [
        { id: 1, day_of_week: 1, start_time: "09:00:00", end_time: "12:00:00" },
      ],
    });
    const res = mockRes();
    await getService(mockReq({ params: { id: "3" } }) as any, res);
    expect(res.json).toHaveBeenCalledWith({
      id: 3,
      title: "Corte",
      Availabilities: [
        { id: 1, day_of_week: 1, start_time: "09:00", end_time: "12:00" },
      ],
    });
  });

  it("returns 401 and 403 when the caller is not a professional", async () => {
    const unauth = mockRes();
    await createServiceSelf(mockReq({ body: {} }) as any, unauth);
    expect(unauth.status).toHaveBeenCalledWith(401);

    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue(null);
    const forbidden = mockRes();
    await listMyServices(mockReq({ user: { id: 1 }, query: {} }) as any, forbidden);
    expect(forbidden.status).toHaveBeenCalledWith(403);
  });

  it("returns 400 when the subcategory does not exist", async () => {
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue({ id: 70 });
    (SubCategoryModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await createServiceSelf(
      mockReq({
        user: { id: 1 },
        body: {
          title: "Corte",
          description: "Desc",
          price: 10,
          category_id: 1,
          subcategory_id: 99,
        },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "subcategory_id não encontrada" });
  });

  it("returns 201 when the professional creates a service", async () => {
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue({ id: 71 });
    (SubCategoryModel.findByPk as jest.Mock).mockResolvedValue({ category_id: 1 });
    (ServiceModel.create as jest.Mock).mockResolvedValue({ id: 9 });
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue({
      toJSON: () => ({
        id: 9,
        title: "Corte",
        price: 10,
        category_id: 1,
        subcategory_id: 2,
        professional_id: 71,
      }),
      Availabilities: [],
    });
    const res = mockRes();
    await createServiceSelf(
      mockReq({
        user: { id: 1 },
        body: {
          title: "Corte",
          description: "Desc",
          price: 10,
          category_id: 1,
          subcategory_id: 2,
        },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith({
      service: expect.objectContaining({ id: 9, title: "Corte", Availabilities: [] }),
    });
  });

  it("returns 403 when creating on someone else's professional profile", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 9 });
    const res = mockRes();
    await createService(
      mockReq({ user: { id: 1 }, params: { professionalId: "2" }, body: {} }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("returns 404, 403 and 204 for delete", async () => {
    const missing = mockRes();
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue(null);
    await deleteService(
      mockReq({ user: { id: 1 }, params: { id: "3" } }) as any,
      missing,
    );
    expect(missing.status).toHaveBeenCalledWith(404);

    (ServiceModel.findByPk as jest.Mock).mockResolvedValue({ professional_id: 2 });
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 9 });
    const forbidden = mockRes();
    await deleteService(
      mockReq({ user: { id: 1 }, params: { id: "3" } }) as any,
      forbidden,
    );
    expect(forbidden.status).toHaveBeenCalledWith(403);

    const service = { professional_id: 2, active: true, save: jest.fn() };
    (ServiceModel.findByPk as jest.Mock).mockResolvedValue(service);
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ user_id: 1 });
    const ok = mockRes();
    await deleteService(mockReq({ user: { id: 1 }, params: { id: "3" } }) as any, ok);
    expect(service.active).toBe(false);
    expect(ok.status).toHaveBeenCalledWith(204);
  });

  it("returns 401 when deleting without a user", async () => {
    const res = mockRes();
    await deleteService(mockReq({ params: { id: "3" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 500 when delete throws", async () => {
    (ServiceModel.findByPk as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await deleteService(mockReq({ user: { id: 1 }, params: { id: "3" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
