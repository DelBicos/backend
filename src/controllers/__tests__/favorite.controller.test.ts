import { Request, Response } from "express";
import { addFavorite, checkFavorite, getFavorites, removeFavorite } from "../favorite.controller";
import { FavoriteModel } from "../../models/Favorite";
import { ProfessionalModel } from "../../models/Professional";

jest.mock("../../config/database", () => {
  const { Sequelize } = require("sequelize");
  return { sequelize: new Sequelize({ dialect: "postgres", logging: false }) };
});
jest.mock("../../models/Favorite");
jest.mock("../../models/Professional");
jest.mock("../../models/User");
jest.mock("../../utils/logger", () => ({ logError: jest.fn() }));

const buildResponse = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const req = (overrides: Record<string, unknown> = {}) =>
  ({ user: { id: 1 }, params: {}, body: {}, ...overrides }) as unknown as Request;

const anonymous = () => req({ user: undefined });

describe("favorite.controller", () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each([
    ["getFavorites", getFavorites],
    ["addFavorite", addFavorite],
    ["removeFavorite", removeFavorite],
    ["checkFavorite", checkFavorite],
  ])("%s", (_name, handler) => {
    it("sem usuário retorna 401", async () => {
      const res = buildResponse();
      await handler(anonymous(), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(401);
    });
  });

  describe("getFavorites", () => {
    it("FAV-01: mapeia favoritos com nome e avatar, com fallback", async () => {
      const res = buildResponse();
      const addedAt = new Date("2026-01-01");
      (FavoriteModel.findAll as jest.Mock).mockResolvedValue([
        { id: 1, professional_id: 7, createdAt: addedAt, Professional: { User: { name: "Bia", avatar_uri: "a.png" } } },
        { id: 2, professional_id: 8, createdAt: addedAt },
      ]);
      await getFavorites(req(), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith({
        favorites: [
          { id: 1, professionalId: 7, professionalName: "Bia", professionalAvatar: "a.png", addedAt },
          { id: 2, professionalId: 8, professionalName: "Nome não disponível", professionalAvatar: null, addedAt },
        ],
      });
    });

    it("FAV-02: falha no banco retorna 500", async () => {
      const res = buildResponse();
      (FavoriteModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
      await getFavorites(req(), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("addFavorite", () => {
    it("FAV-03: sem professionalId retorna 400", async () => {
      const res = buildResponse();
      await addFavorite(req(), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("FAV-04: profissional inexistente retorna 404", async () => {
      const res = buildResponse();
      (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue(null);
      await addFavorite(req({ body: { professionalId: 7 } }), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("FAV-05: favorito duplicado retorna 409", async () => {
      const res = buildResponse();
      (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ id: 7 });
      (FavoriteModel.findOne as jest.Mock).mockResolvedValue({ id: 1 });
      await addFavorite(req({ body: { professionalId: 7 } }), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(409);
      expect(FavoriteModel.create).not.toHaveBeenCalled();
    });

    it("FAV-06: cria favorito e retorna 201", async () => {
      const res = buildResponse();
      (ProfessionalModel.findByPk as jest.Mock).mockResolvedValue({ id: 7 });
      (FavoriteModel.findOne as jest.Mock).mockResolvedValue(null);
      (FavoriteModel.create as jest.Mock).mockResolvedValue({ id: 3, user_id: 1, professional_id: 7, createdAt: "x" });
      await addFavorite(req({ body: { professionalId: 7 } }), res as unknown as Response);
      expect(FavoriteModel.create).toHaveBeenCalledWith({ user_id: 1, professional_id: 7 });
      expect(res.status).toHaveBeenCalledWith(201);
      expect(res.json).toHaveBeenCalledWith({ id: 3, userId: 1, professionalId: 7, createdAt: "x" });
    });

    it("FAV-07: falha no banco retorna 500", async () => {
      const res = buildResponse();
      (ProfessionalModel.findByPk as jest.Mock).mockRejectedValue(new Error("db"));
      await addFavorite(req({ body: { professionalId: 7 } }), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("removeFavorite", () => {
    it("FAV-08: nada removido retorna 404", async () => {
      const res = buildResponse();
      (FavoriteModel.destroy as jest.Mock).mockResolvedValue(0);
      await removeFavorite(req({ params: { professionalId: "7" } }), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("FAV-09: remove e retorna 200", async () => {
      const res = buildResponse();
      (FavoriteModel.destroy as jest.Mock).mockResolvedValue(1);
      await removeFavorite(req({ params: { professionalId: "7" } }), res as unknown as Response);
      expect(FavoriteModel.destroy).toHaveBeenCalledWith({ where: { user_id: 1, professional_id: "7" } });
      expect(res.status).toHaveBeenCalledWith(200);
    });

    it("FAV-10: falha no banco retorna 500", async () => {
      const res = buildResponse();
      (FavoriteModel.destroy as jest.Mock).mockRejectedValue(new Error("db"));
      await removeFavorite(req({ params: { professionalId: "7" } }), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("checkFavorite", () => {
    it.each([
      [{ id: 1 }, true],
      [null, false],
    ])("FAV-11: favorito %p resulta em isFavorite=%p", async (found, expected) => {
      const res = buildResponse();
      (FavoriteModel.findOne as jest.Mock).mockResolvedValue(found);
      await checkFavorite(req({ params: { professionalId: "7" } }), res as unknown as Response);
      expect(res.json).toHaveBeenCalledWith({ isFavorite: expected });
    });

    it("FAV-12: falha no banco retorna 500", async () => {
      const res = buildResponse();
      (FavoriteModel.findOne as jest.Mock).mockRejectedValue(new Error("db"));
      await checkFavorite(req({ params: { professionalId: "7" } }), res as unknown as Response);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
