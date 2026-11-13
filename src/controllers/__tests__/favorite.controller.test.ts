jest.mock("../../models/Favorite", () => ({
  FavoriteModel: {
    findAll: jest.fn(),
    findOne: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
    destroy: jest.fn(),
  },
}));
jest.mock("../../models/Professional", () => ({
  ProfessionalModel: { findByPk: jest.fn() },
}));
jest.mock("../../models/User", () => ({
  UserModel: {},
}));

import { FavoriteModel } from "../../models/Favorite";
import { ProfessionalModel } from "../../models/Professional";
import {
  addFavorite,
  checkFavorite,
  getFavorites,
  removeFavorite,
} from "../favorite.controller";
import { mockReq, mockRes } from "../../test/http";

describe("favorite.controller", () => {
  it("returns 401 when listing without a user", async () => {
    const res = mockRes();
    await getFavorites(mockReq() as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("returns 200 with mapped favorites", async () => {
    (FavoriteModel.findAll as jest.Mock).mockResolvedValue([
      {
        id: 1,
        professional_id: 9,
        createdAt: "2026-05-01",
        Professional: { User: { name: "Ana", avatar_uri: null } },
      },
    ]);
    const res = mockRes();
    await getFavorites(mockReq({ user: { id: 4 } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      favorites: [
        {
          id: 1,
          professionalId: 9,
          professionalName: "Ana",
          professionalAvatar: null,
          addedAt: "2026-05-01",
        },
      ],
    });
  });

  it("returns 500 when listing throws", async () => {
    (FavoriteModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getFavorites(mockReq({ user: { id: 4 } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 400 when professionalId is missing", async () => {
    const res = mockRes();
    await addFavorite(mockReq({ user: { id: 4 }, body: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the professional does not exist", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await addFavorite(
      mockReq({ user: { id: 4 }, body: { professionalId: 9 } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 409 when the favorite already exists", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ id: 9 });
    (FavoriteModel.findOne as jest.Mock).mockResolvedValue({ id: 1 });
    const res = mockRes();
    await addFavorite(
      mockReq({ user: { id: 4 }, body: { professionalId: 9 } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("returns 201 when the favorite is created", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ id: 9 });
    (FavoriteModel.findOne as jest.Mock).mockResolvedValue(null);
    (FavoriteModel.create as jest.Mock).mockResolvedValue({
      id: 3,
      user_id: 4,
      professional_id: 9,
      createdAt: "2026-05-01",
    });
    const res = mockRes();
    await addFavorite(
      mockReq({ user: { id: 4 }, body: { professionalId: 9 } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 404 when removing a missing favorite", async () => {
    (FavoriteModel.destroy as jest.Mock).mockResolvedValue(0);
    const res = mockRes();
    await removeFavorite(
      mockReq({ user: { id: 4 }, params: { professionalId: "9" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns whether the professional is a favorite", async () => {
    (FavoriteModel.findOne as jest.Mock).mockResolvedValue({ id: 1 });
    const res = mockRes();
    await checkFavorite(
      mockReq({ user: { id: 4 }, params: { professionalId: "9" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ isFavorite: true });
  });
});
