jest.mock("../../models/Category", () => ({
  CategoryModel: { findAll: jest.fn() },
}));

import { CategoryModel } from "../../models/Category";
import { getAllCategories } from "../category.controller";
import { mockReq, mockRes } from "./handlerTestUtils";

describe("getAllCategories", () => {
  it("devolve as categorias ativas", async () => {
    (CategoryModel.findAll as jest.Mock).mockResolvedValue([
      { id: 1, title: "Casa" },
    ]);
    const res = mockRes();
    await getAllCategories(mockReq(), res);
    expect(res.json).toHaveBeenCalledWith([{ id: 1, title: "Casa" }]);
  });

  it("responde 500 quando a consulta falha", async () => {
    (CategoryModel.findAll as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getAllCategories(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({
      error: "Falha ao buscar categorias",
    });
  });
});
