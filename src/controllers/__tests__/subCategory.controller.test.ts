jest.mock("../../models/Subcategory", () => ({
  SubCategoryModel: { findAll: jest.fn() },
}));
jest.mock("../../models/Category", () => ({
  CategoryModel: { findOne: jest.fn() },
}));

import { CategoryModel } from "../../models/Category";
import { SubCategoryModel } from "../../models/Subcategory";
import {
  getAllSubCategories,
  listAllSubCategories,
} from "../subCategory.controller";
import { mockReq, mockRes } from "./handlerTestUtils";

describe("subCategory.controller", () => {
  it("lista todas as subcategorias ativas", async () => {
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);
    const res = mockRes();
    await listAllSubCategories(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it("responde 500 quando a lista completa falha", async () => {
    (SubCategoryModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await listAllSubCategories(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("responde 404 quando a categoria nao existe", async () => {
    (CategoryModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getAllSubCategories(mockReq({ params: { id: "9" } }), res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({
      error: "Categoria não encontrada",
    });
  });

  it("devolve as subcategorias de uma categoria existente", async () => {
    (CategoryModel.findOne as jest.Mock).mockResolvedValue({ id: 1 });
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([
      { id: 2, title: "Elétrica" },
    ]);
    const res = mockRes();
    await getAllSubCategories(mockReq({ params: { id: "1" } }), res);
    expect(res.json).toHaveBeenCalledWith([{ id: 2, title: "Elétrica" }]);
  });
});
