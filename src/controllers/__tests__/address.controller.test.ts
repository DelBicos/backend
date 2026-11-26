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

jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));

import { AddressModel } from "../../models/Address";
import { ClientModel } from "../../models/Client";
import {
  getAllAddressByUserId,
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

  describe("getAllAddressByUserId", () => {
    it("responde 401 sem usuario", async () => {
      const res = mockRes();
      await getAllAddressByUserId(mockReq({ params: { userId: "1" } }), res);
      expect(res.status).toHaveBeenCalledWith(401);
    });

    it("responde 403 quando o id da rota e de outro usuario", async () => {
      const res = mockRes();
      await getAllAddressByUserId(mockReq({ user: { id: 1 }, params: { userId: "2" } }), res);
      expect(res.status).toHaveBeenCalledWith(403);
      expect(address.findAll).not.toHaveBeenCalled();
    });

    it("lista so os enderecos ativos do proprio usuario", async () => {
      address.findAll.mockResolvedValue([{ id: 1 }]);
      const res = mockRes();
      await getAllAddressByUserId(mockReq({ user: { id: 1 }, params: { userId: "1" } }), res);
      expect(address.findAll).toHaveBeenCalledWith(
        expect.objectContaining({ where: { user_id: 1, active: true } }),
      );
      expect(res.json).toHaveBeenCalledWith([{ id: 1 }]);
    });

    it("responde 500 quando a busca falha", async () => {
      address.findAll.mockRejectedValue(new Error("db"));
      const res = mockRes();
      await getAllAddressByUserId(mockReq({ user: { id: 1 }, params: { userId: "1" } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  it("exige usuario ao criar, atualizar e apagar", async () => {
    for (const handler of [
      createAddressForAuthenticatedUser,
      updateAddressForAuthenticatedUser,
      deleteAddressForAuthenticatedUser,
    ]) {
      const res = mockRes();
      await handler(mockReq({ params: { id: "1" } }), res);
      expect(res.status).toHaveBeenCalledWith(401);
    }
  });

  it("ignora id, dono e flag de principal enviados no corpo ao criar", async () => {
    address.create.mockResolvedValue({ id: 5 });
    const res = mockRes();
    await createAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, body: { id: 99, user_id: 7, isPrimary: true, street: "Rua" } }),
      res,
    );
    expect(address.create).toHaveBeenCalledWith({ street: "Rua", user_id: 1 });
  });

  it("responde 400 com a mensagem quando a criacao falha", async () => {
    address.create.mockRejectedValue(new Error("cep obrigatorio"));
    const res = mockRes();
    await createAddressForAuthenticatedUser(mockReq({ user: { id: 1 }, body: {} }), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "cep obrigatorio" });
  });

  describe("updateAddressForAuthenticatedUser", () => {
    it("responde 403 para endereco de outra pessoa", async () => {
      address.findByPk.mockResolvedValue({ user_id: 9, update: jest.fn() });
      const res = mockRes();
      await updateAddressForAuthenticatedUser(mockReq({ user: { id: 1 }, params: { id: "4" } }), res);
      expect(res.status).toHaveBeenCalledWith(403);
    });

    it("atualiza os campos e marca como principal", async () => {
      const update = jest.fn();
      const clientUpdate = jest.fn();
      const row = { id: 4, user_id: 1, update };
      address.findByPk.mockResolvedValue(row);
      (ClientModel.findOne as jest.Mock).mockResolvedValue({ update: clientUpdate });
      const res = mockRes();
      await updateAddressForAuthenticatedUser(
        mockReq({ user: { id: 1 }, params: { id: "4" }, body: { street: "Nova", user_id: 3, isPrimary: true } }),
        res,
      );
      expect(update).toHaveBeenCalledWith({ street: "Nova" });
      expect(clientUpdate).toHaveBeenCalledWith({ main_address_id: 4 });
      expect(res.json).toHaveBeenCalledWith(row);
    });

    it("nao falha quando o usuario nao tem cliente ao marcar principal", async () => {
      const row = { id: 4, user_id: 1, update: jest.fn() };
      address.findByPk.mockResolvedValue(row);
      (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
      const res = mockRes();
      await updateAddressForAuthenticatedUser(
        mockReq({ user: { id: 1 }, params: { id: "4" }, body: { isPrimary: true } }),
        res,
      );
      expect(res.json).toHaveBeenCalledWith(row);
    });

    it("responde 500 quando a atualizacao falha", async () => {
      address.findByPk.mockRejectedValue(new Error("db"));
      const res = mockRes();
      await updateAddressForAuthenticatedUser(mockReq({ user: { id: 1 }, params: { id: "4" } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });

  describe("deleteAddressForAuthenticatedUser", () => {
    it("responde 400 para id invalido", async () => {
      const res = mockRes();
      await deleteAddressForAuthenticatedUser(mockReq({ user: { id: 1 }, params: { id: "0" } }), res);
      expect(res.status).toHaveBeenCalledWith(400);
    });

    it("responde 404 quando o endereco nao existe", async () => {
      address.findByPk.mockResolvedValue(null);
      const res = mockRes();
      await deleteAddressForAuthenticatedUser(mockReq({ user: { id: 1 }, params: { id: "4" } }), res);
      expect(res.status).toHaveBeenCalledWith(404);
    });

    it("responde 500 quando a exclusao falha", async () => {
      address.findByPk.mockRejectedValue(new Error("db"));
      const res = mockRes();
      await deleteAddressForAuthenticatedUser(mockReq({ user: { id: 1 }, params: { id: "4" } }), res);
      expect(res.status).toHaveBeenCalledWith(500);
    });
  });
});
