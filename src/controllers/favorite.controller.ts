import { Request, Response } from "express";
import { FavoriteModel } from "../models/Favorite";
import { ProfessionalModel } from "../models/Professional";
import { UserModel } from "../models/User";
import { AuthenticatedRequest } from "../interfaces/authentication.interface";

import { logError } from "../utils/logger";
type FavoriteWithProfessional = FavoriteModel & {
  Professional?: { User?: { name: string; avatar_uri?: string | null } };
};

export const getFavorites = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const userId = authReq.user?.id;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const favorites = (await FavoriteModel.findAll({
      where: { user_id: userId },
      include: [
        {
          model: ProfessionalModel,
          as: "Professional",
          include: [
            {
              model: UserModel,
              as: "User",
              attributes: ["name", "avatar_uri"],
            },
          ],
        },
      ],
      order: [["created_at", "DESC"]],
    })) as FavoriteWithProfessional[];

    const favoritesData = favorites.map((fav) => ({
      id: fav.id,
      professionalId: fav.professional_id,
      professionalName: fav.Professional?.User?.name || "Nome não disponível",
      professionalAvatar: fav.Professional?.User?.avatar_uri || null,
      addedAt: fav.createdAt,
    }));

    return res.status(200).json({ favorites: favoritesData });
  } catch (error) {
    logError("Erro ao buscar favoritos:", error);
    return res.status(500).json({ error: "Erro ao buscar favoritos" });
  }
};

export const addFavorite = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const userId = authReq.user?.id;
    const { professionalId } = req.body;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    if (!professionalId) {
      return res.status(400).json({ error: "professionalId é obrigatório" });
    }

    const professional = await ProfessionalModel.findByPk(professionalId);

    if (!professional) {
      return res.status(404).json({ error: "Profissional não encontrado" });
    }

    const existing = await FavoriteModel.findOne({
      where: {
        user_id: userId,
        professional_id: professionalId,
      },
    });

    if (existing) {
      return res
        .status(409)
        .json({ error: "Profissional já está nos favoritos" });
    }

    const favorite = await FavoriteModel.create({
      user_id: userId,
      professional_id: professionalId,
    });

    return res.status(201).json({
      id: favorite.id,
      userId: favorite.user_id,
      professionalId: favorite.professional_id,
      createdAt: favorite.createdAt,
    });
  } catch (error) {
    logError("Erro ao adicionar favorito:", error);
    return res.status(500).json({ error: "Erro ao adicionar favorito" });
  }
};

export const removeFavorite = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const userId = authReq.user?.id;
    const { professionalId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const deleted = await FavoriteModel.destroy({
      where: {
        user_id: userId,
        professional_id: professionalId,
      },
    });

    if (deleted === 0) {
      return res.status(404).json({ error: "Favorito não encontrado" });
    }

    return res.status(200).json({ message: "Favorito removido com sucesso" });
  } catch (error) {
    logError("Erro ao remover favorito:", error);
    return res.status(500).json({ error: "Erro ao remover favorito" });
  }
};

export const checkFavorite = async (req: Request, res: Response) => {
  const authReq = req as AuthenticatedRequest;

  try {
    const userId = authReq.user?.id;
    const { professionalId } = req.params;

    if (!userId) {
      return res.status(401).json({ error: "Usuário não autenticado" });
    }

    const favorite = await FavoriteModel.findOne({
      where: {
        user_id: userId,
        professional_id: professionalId,
      },
    });

    return res.status(200).json({ isFavorite: !!favorite });
  } catch (error) {
    logError("Erro ao verificar favorito:", error);
    return res.status(500).json({ error: "Erro ao verificar favorito" });
  }
};
