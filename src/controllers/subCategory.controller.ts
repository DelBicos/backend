import { Request, Response } from "express";
import { SubCategoryModel } from "../models/Subcategory";
import { CategoryModel } from "../models/Category";

import { logError } from "../utils/logger";
import { errorMessage } from "../utils/errors.util";
export const listAllSubCategories = async (req: Request, res: Response) => {
  try {
    const subcategories = await SubCategoryModel.findAll({
      where: { active: true },
      order: [["title", "ASC"]],
    });
    return res.json(subcategories);
  } catch (error) {
    logError("Erro ao listar todas as subcategorias:", error);
    return res.status(500).json({ error: "Erro interno do servidor" });
  }
};

export const getAllSubCategories = async (req: Request, res: Response) => {
  try {
    const categoryId = req.params.id;

    // Verificar se a categoria existe
    const category = await CategoryModel.findOne({
      where: { id: categoryId, active: true },
    });

    if (!category) {
      return res.status(404).json({ error: "Categoria não encontrada" });
    }

    // Buscar subcategorias da categoria específica
    const subcategories = await SubCategoryModel.findAll({
      where: {
        category_id: categoryId,
        active: true,
      },
      order: [["title", "ASC"]],
    });

    return res.json(subcategories);
  } catch (error) {
    logError("Erro ao buscar subcategorias:", error);
    return res.status(500).json({
      error: "Erro interno do servidor",
      message: errorMessage(error),
    });
  }
};
