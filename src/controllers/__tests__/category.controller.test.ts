jest.mock("../../models/Category", () => ({
  CategoryModel: { findAll: jest.fn() },
}));

import { CategoryModel } from "../../models/Category";
import { getAllCategories } from "../category.controller";
import { mockReq, mockRes } from "../../test/http";

describe("getAllCategories", () => {
  it("returns the active categories", async () => {
    (CategoryModel.findAll as jest.Mock).mockResolvedValue([{ id: 1, title: "Casa" }]);
    const res = mockRes();
    await getAllCategories(mockReq() as any, res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, title: "Casa" }]);
  });

  it("returns 500 when the query fails", async () => {
    (CategoryModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getAllCategories(mockReq() as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Falha ao buscar categorias" });
  });
});
