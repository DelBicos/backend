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
import { mockReq, mockRes } from "../../test/http";

const address = AddressModel as unknown as {
  findAll: jest.Mock;
  findByPk: jest.Mock;
  create: jest.Mock;
};

describe("address.controller", () => {
  it("returns 401 when the user is missing", async () => {
    const res = mockRes();
    await getAddressesForAuthenticatedUser(mockReq() as any, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: "Unauthorized" });
  });

  it("returns addresses flagged with the primary id", async () => {
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ main_address_id: 2 });
    address.findAll.mockResolvedValue([
      { id: 2, toJSON: () => ({ id: 2, street: "A" }) },
      { id: 3, toJSON: () => ({ id: 3, street: "B" }) },
    ]);
    const res = mockRes();

    await getAddressesForAuthenticatedUser(mockReq({ user: { id: 1 } }) as any, res);

    expect(res.json).toHaveBeenCalledWith([
      { id: 2, street: "A", isPrimary: true },
      { id: 3, street: "B", isPrimary: false },
    ]);
  });

  it("returns 500 when listing fails", async () => {
    (ClientModel.findOne as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getAddressesForAuthenticatedUser(mockReq({ user: { id: 1 } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("creates an address with 201", async () => {
    address.create.mockResolvedValue({ id: 4, street: "Rua" });
    const res = mockRes();
    await createAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, body: { street: "Rua" } }) as any,
      res,
    );
    expect(address.create).toHaveBeenCalledWith(
      expect.objectContaining({ street: "Rua", user_id: 1 }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("returns 400 for an invalid id on update", async () => {
    const res = mockRes();
    await updateAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, params: { id: "abc" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "ID de endereço inválido" });
  });

  it("returns 404 when the address does not exist", async () => {
    address.findByPk.mockResolvedValue(null);
    const res = mockRes();
    await updateAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, params: { id: "4" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 403 when the address belongs to someone else", async () => {
    address.findByPk.mockResolvedValue({ user_id: 9, update: jest.fn() });
    const res = mockRes();
    await deleteAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, params: { id: "4" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: "Ação não permitida" });
  });

  it("deletes an owned address", async () => {
    const destroy = jest.fn();
    address.findByPk.mockResolvedValue({ user_id: 1, destroy });
    const res = mockRes();
    await deleteAddressForAuthenticatedUser(
      mockReq({ user: { id: 1 }, params: { id: "4" } }) as any,
      res,
    );
    expect(destroy).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ message: "Endereço deletado" });
  });
});
