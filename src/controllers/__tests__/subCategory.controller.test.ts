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
import { mockReq, mockRes } from "../../test/http";

describe("subCategory.controller", () => {
  it("lists every active subcategory", async () => {
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([{ id: 1 }]);
    const res = mockRes();
    await listAllSubCategories(mockReq() as any, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
  });

  it("returns 500 when the full list fails", async () => {
    (SubCategoryModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await listAllSubCategories(mockReq() as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 404 when the category does not exist", async () => {
    (CategoryModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getAllSubCategories(mockReq({ params: { id: "9" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ error: "Categoria não encontrada" });
  });

  it("returns subcategories of an existing category", async () => {
    (CategoryModel.findOne as jest.Mock).mockResolvedValue({ id: 1 });
    (SubCategoryModel.findAll as jest.Mock).mockResolvedValue([{ id: 2, title: "Elétrica" }]);
    const res = mockRes();
    await getAllSubCategories(mockReq({ params: { id: "1" } }) as any, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 2, title: "Elétrica" }]);
  });
});
