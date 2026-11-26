jest.mock("../../models/Address", () => ({
  AddressModel: {
    findAll: jest.fn(),
    findByPk: jest.fn(),
    create: jest.fn(),
  },
}));
jest.mock("../../models/Client", () => ({
  ClientModel: { findOne: jest.fn() },
}));

import { AddressModel } from "../../models/Address";
import { ClientModel } from "../../models/Client";
import {
  createAddressForAuthenticatedUser,
  deleteAddressForAuthenticatedUser,
  getAddressesForAuthenticatedUser,
  updateAddressForAuthenticatedUser,
} from "../address.controller";
import { mockReq, mockRes } from "./handlerTestUtils";

const address = AddressModel as unknown as {
  findAll: jest.Mock;
  findByPk: jest.Mock;
  create: jest.Mock;
};

describe("address.controller", () => {
  it("exige usuario autenticado (401)", async () => {
    const res = mockRes();
    await getAddressesForAuthenticatedUser(mockReq(), res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("devolve os enderecos marcando o principal", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({
      main_address_id: 2,
    });
    address.findAll.mockResolvedValue([
      { id: 2, toJSON: () => ({ id: 2, street: "A" }) },
      { id: 3, toJSON: () => ({ id: 3, street: "B" }) },
    ]);
    const res = mockRes();

    await getAddressesForAuthenticatedUser(mockReq({ user: { id: 1 } }), res);

    expect(res.json).toHaveBeenCalledWith([
      { id: 2, street: "A", isPrimary: true },
      { id: 3, street: "B", isPrimary: false },
    ]);
  });

  it("responde 500 quando a listagem falha", async () => {
    (ClientModel.findOne as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getAddressesForAuthenticatedUser(mockReq({ user: { id: 1 } }), res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("cria o endereco (201)", async () => {
    address.create.mockResolvedValue({ id: 4, street: "Rua" });
    const res = mockRes();
    await createAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, body: { street: "Rua" } }),
      res,
    );
    expect(address.create).toHaveBeenCalledWith(
      expect.objectContaining({ street: "Rua", user_id: 1 }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("responde 400 para id invalido ao atualizar", async () => {
    const res = mockRes();
    await updateAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, params: { id: "abc" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "ID de endereço inválido" });
  });

  it("responde 404 quando o endereco nao existe", async () => {
    address.findByPk.mockResolvedValue(null);
    const res = mockRes();
    await updateAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, params: { id: "4" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("responde 403 para endereco de outra pessoa", async () => {
    address.findByPk.mockResolvedValue({ user_id: 9, update: jest.fn() });
    const res = mockRes();
    await deleteAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, params: { id: "4" } }),
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Ação não permitida" });
  });

  it("apaga o proprio endereco", async () => {
    const destroy = jest.fn();
    address.findByPk.mockResolvedValue({ user_id: 1, destroy });
    const res = mockRes();
    await deleteAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, params: { id: "4" } }),
      res,
    );
    expect(destroy).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: "Endereço deletado" });
  });
});
