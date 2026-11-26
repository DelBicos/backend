import { Request, Response } from "express";
import { getAllCategories } from "../category.controller";
import { getAllSubCategories, listAllSubCategories } from "../subCategory.controller";
import { CategoryModel } from "../../models/Category";
import { SubCategoryModel } from "../../models/Subcategory";

jest.mock("../../config/database", () => {
  const { Sequelize } = require("sequelize");
  return { sequelize: new Sequelize({ dialect: "postgres", logging: false }) };
});
jest.mock("../../models/Category");
jest.mock("../../models/Subcategory");
jest.mock("../../utils/logger", () => ({ logError: jest.fn() }));

const buildResponse = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const req = (params: Record<string, string> = {}) => ({ params }) as unknown as Request;

describe("category.controller e subCategory.controller", () => {
  beforeEach(() => jest.clearAllMocks());

  it("CAT-01: lista só categorias ativas", async () => {
    const res = buildResponse();
    (CategoryModel.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);
    await getAllCategories(req(), res as unknown as Response);
    expect(CategoryModel.findAll).toHaveBeenCalledWith({ where: { active: true } });
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it("CAT-02: falha ao listar categorias retorna 500", async () => {
    const res = buildResponse();
    (CategoryModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    await getAllCategories(req(), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("SUB-01: lista todas as subcategorias ativas em ordem alfabética", async () => {
    const res = buildResponse();
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([{ id: 2 }]);
    await listAllSubCategories(req(), res as unknown as Response);
    expect(SubCategoryModel.findAll).toHaveBeenCalledWith({
      where: { active: true },
      order: [["title", "ASC"]],
    });
    expect(res.json).toHaveBeenCalledWith([{ id: 2 }]);
  });

  it("SUB-02: falha ao listar subcategorias retorna 500", async () => {
    const res = buildResponse();
    (SubCategoryModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    await listAllSubCategories(req(), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("SUB-03: categoria inexistente ou inativa retorna 404", async () => {
    const res = buildResponse();
    (CategoryModel.findOne as jest.Mock).mockResolvedValue(null);
    await getAllSubCategories(req({ id: "4" }), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(SubCategoryModel.findAll).not.toHaveBeenCalled();
  });

  it("SUB-04: retorna subcategorias ativas da categoria", async () => {
    const res = buildResponse();
    (CategoryModel.findOne as jest.Mock).mockResolvedValue({ id: 4 });
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([{ id: 2 }]);
    await getAllSubCategories(req({ id: "4" }), res as unknown as Response);
    expect(SubCategoryModel.findAll).toHaveBeenCalledWith(
      expect.objectContaining({ where: { category_id: "4", active: true } }),
    );
    expect(res.json).toHaveBeenCalledWith([{ id: 2 }]);
  });

  it("SUB-05: falha no banco retorna 500 com a mensagem", async () => {
    const res = buildResponse();
    (CategoryModel.findOne as jest.Mock).mockRejectedValue(new Error("db"));
    await getAllSubCategories(req({ id: "4" }), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ message: "db" }));
  });
});
