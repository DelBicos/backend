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
import { mockReq, mockRes } from "./handlerTestUtils";

describe("favorite.controller", () => {
  it("exige usuario autenticado para listar (401)", async () => {
    const res = mockRes();
    await getFavorites(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it("devolve os favoritos formatados (200)", async () => {
    (FavoriteModel.findAll as jest.Mock).mockResolvedValue([
      {
        id: 1,
        professional_id: 9,
        createdAt: "2026-05-01",
        Professional: { User: { name: "Ana", avatar_uri: null } },
      },
    ]);
    const res = mockRes();
    await getFavorites(mockReq({ user: { id: 4 } }), res);
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

  it("responde 500 quando a listagem falha", async () => {
    (FavoriteModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getFavorites(mockReq({ user: { id: 4 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("responde 400 sem professionalId", async () => {
    const res = mockRes();
    await addFavorite(mockReq({ user: { id: 4 }, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("responde 404 quando o profissional nao existe", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await addFavorite(
      mockReq({ user: { id: 4 }, body: { professionalId: 9 } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("responde 409 quando o favorito ja existe", async () => {
    (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ id: 9 });
    (FavoriteModel.findOne as jest.Mock).mockResolvedValue({ id: 1 });
    const res = mockRes();
    await addFavorite(
      mockReq({ user: { id: 4 }, body: { professionalId: 9 } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
  });

  it("cria o favorito (201)", async () => {
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
      mockReq({ user: { id: 4 }, body: { professionalId: 9 } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("responde 404 ao remover favorito inexistente", async () => {
    (FavoriteModel.destroy as jest.Mock).mockResolvedValue(0);
    const res = mockRes();
    await removeFavorite(
      mockReq({ user: { id: 4 }, params: { professionalId: "9" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("informa se o profissional esta nos favoritos", async () => {
    (FavoriteModel.findOne as jest.Mock).mockResolvedValue({ id: 1 });
    const res = mockRes();
    await checkFavorite(
      mockReq({ user: { id: 4 }, params: { professionalId: "9" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ isFavorite: true });
  });
});
