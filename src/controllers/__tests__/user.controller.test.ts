import bcrypt from "bcryptjs";

const generateUploadUrl = jest.fn();

jest.mock("../../services/s3Service", () => ({
  S3Service: jest.fn().mockImplementation(() => ({ generateUploadUrl })),
}));
jest.mock("../../services/loginLog.service", () => ({
  saveLoginLog: jest.fn(),
}));
jest.mock("../../models/User", () => ({
  UserModel: {
    findOne: jest.fn(),
    findByPk: jest.fn(),
    destroy: jest.fn(),
  },
}));
jest.mock("../../models/Client", () => ({
  ClientModel: { findOne: jest.fn() },
}));
jest.mock("../../models/Address", () => ({
  AddressModel: { findByPk: jest.fn() },
}));
jest.mock("../../models/Professional", () => ({
  ProfessionalModel: { findOne: jest.fn() },
}));

import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import { AddressModel } from "../../models/Address";
import { ProfessionalModel } from "../../models/Professional";
import {
  changePassword,
  deleteUser,
  getAvatarUploadUrl,
  getUserById,
  getUserByToken,
  logInUser,
  updateUserAvatarUri,
  updateUserProfile,
} from "../user.controller";
import { mockReq, mockRes } from "../../test/http";

describe("user.controller", () => {
  it("returns 404 when the login email is unknown", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await logInUser(mockReq({ body: { email: "a@a.com", password: "x" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "Usuário não encontrado" });
  });

  it("returns 401 when the password is wrong", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue({
      id: 1,
      password: await bcrypt.hash("right", 4),
    });
    const res = mockRes();
    await logInUser(
      mockReq({ body: { email: "a@a.com", password: "wrong" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ message: "Senha inválida" });
  });

  it("returns 404 when the user has no client profile", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue({
      id: 1,
      email: "a@a.com",
      password: await bcrypt.hash("right", 4),
    });
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await logInUser(
      mockReq({ body: { email: "a@a.com", password: "right" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith({ message: "Cliente não encontrado" });
  });

  it("returns 200 and a token on login", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue({
      id: 1,
      name: "Ana",
      email: "a@a.com",
      phone: "11999",
      avatar_uri: null,
      password: await bcrypt.hash("right", 4),
    });
    (ClientModel.findOne as jest.Mock).mockResolvedValue({
      id: 2,
      cpf: "123",
      main_address_id: 3,
    });
    (AddressModel.findByPk as jest.Mock).mockResolvedValue(null);
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await logInUser(
      mockReq({ body: { email: "a@a.com", password: "right" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Login realizado com sucesso",
        token: expect.any(String),
      }),
    );
  });

  it("returns 500 when login throws", async () => {
    (UserModel.findOne as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await logInUser(mockReq({ body: { email: "a@a.com", password: "x" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("returns 404 and the public profile", async () => {
    (UserModel.findByPk as jest.Mock).mockResolvedValueOnce(null);
    const missing = mockRes();
    await getUserById(mockReq({ params: { id: "1" } }) as any, missing);
    expect(missing.status).toHaveBeenCalledWith(404);

    (UserModel.findByPk as jest.Mock).mockResolvedValueOnce({
      id: 1,
      name: "Ana",
      email: "a@a.com",
      phone: "1",
      avatar_uri: null,
      banner_uri: null,
    });
    const res = mockRes();
    await getUserById(mockReq({ params: { id: "1" } }) as any, res);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ id: 1, name: "Ana" }),
    );
  });

  it("returns 500 when getUserById throws", async () => {
    (UserModel.findByPk as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await getUserById(mockReq({ params: { id: "1" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
  });

  it("covers changePassword validation and success", async () => {
    const missingFields = mockRes();
    await changePassword(mockReq({ user: { id: 1 }, body: {} }) as any, missingFields);
    expect(missingFields.status).toHaveBeenCalledWith(400);

    const unauth = mockRes();
    await changePassword(
      mockReq({ body: { current_password: "a", new_password: "b" } }) as any,
      unauth,
    );
    expect(unauth.status).toHaveBeenCalledWith(401);

    (UserModel.findByPk as jest.Mock).mockResolvedValueOnce(null);
    const missing = mockRes();
    await changePassword(
      mockReq({
        user: { id: 1 },
        body: { current_password: "a", new_password: "b" },
      }) as any,
      missing,
    );
    expect(missing.status).toHaveBeenCalledWith(404);

    const hash = await bcrypt.hash("right", 4);
    const user = { id: 1, password: hash, save: jest.fn() };
    (UserModel.findByPk as jest.Mock).mockResolvedValue(user);
    const wrong = mockRes();
    await changePassword(
      mockReq({
        user: { id: 1 },
        body: { current_password: "nope", new_password: "new-secret" },
      }) as any,
      wrong,
    );
    expect(wrong.status).toHaveBeenCalledWith(400);

    const ok = mockRes();
    await changePassword(
      mockReq({
        user: { id: 1 },
        body: { current_password: "right", new_password: "new-secret" },
      }) as any,
      ok,
    );
    expect(user.save).toHaveBeenCalled();
    expect(ok.status).toHaveBeenCalledWith(204);
  });

  it("returns 404 when delete removes nothing", async () => {
    (UserModel.destroy as jest.Mock).mockResolvedValue(0);
    const res = mockRes();
    await deleteUser(mockReq({ params: { id: "1" } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(404);
  });

  it("returns 401 and 200 for the token profile", async () => {
    const unauth = mockRes();
    await getUserByToken(mockReq() as any, unauth);
    expect(unauth.status).toHaveBeenCalledWith(401);

    (UserModel.findByPk as jest.Mock).mockResolvedValue({
      toJSON: () => ({ id: 1, name: "Ana", email: "a@a.com" }),
    });
    (ProfessionalModel.findOne as jest.Mock).mockResolvedValue(null);
    const res = mockRes();
    await getUserByToken(mockReq({ user: { id: 1 } }) as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({
      user: expect.objectContaining({ id: 1, professional_id: null }),
    });
  });

  it("returns 409 when the new email is taken", async () => {
    (UserModel.findByPk as jest.Mock).mockResolvedValue({
      id: 1,
      email: "old@a.com",
      name: "Ana",
      phone: "1",
      save: jest.fn(),
    });
    (UserModel.findOne as jest.Mock).mockResolvedValue({ id: 9 });
    const res = mockRes();
    await updateUserProfile(
      mockReq({ user: { id: 1 }, body: { email: "new@a.com" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Este e-mail já está em uso." });
  });

  it("returns 200 when the profile is updated", async () => {
    const user = {
      id: 1,
      email: "old@a.com",
      name: "Ana",
      phone: "1",
      avatar_uri: null,
      banner_uri: null,
      save: jest.fn(),
    };
    (UserModel.findByPk as jest.Mock).mockResolvedValue(user);
    const res = mockRes();
    await updateUserProfile(
      mockReq({ user: { id: 1 }, body: { name: "Ana Maria" } }) as any,
      res,
    );
    expect(user.name).toBe("Ana Maria");
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("returns 400 and the avatar upload url", async () => {
    const missing = mockRes();
    await getAvatarUploadUrl(mockReq({ body: {} }) as any, missing);
    expect(missing.status).toHaveBeenCalledWith(400);

    generateUploadUrl.mockResolvedValue("https://signed");
    const res = mockRes();
    await getAvatarUploadUrl(
      mockReq({ body: { fileName: "a.png", fileType: "image/png" } }) as any,
      res,
    );
    expect(res.json).toHaveBeenCalledWith({
      uploadUrl: "https://signed",
      fileUrl: `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/a.png`,
    });
  });

  it("returns 400 when avatar_uri is missing and 200 when it is saved", async () => {
    const missing = mockRes();
    await updateUserAvatarUri(mockReq({ user: { id: 1 }, body: {} }) as any, missing);
    expect(missing.status).toHaveBeenCalledWith(400);

    const update = jest.fn();
    (UserModel.findByPk as jest.Mock).mockResolvedValue({
      id: 1,
      avatar_uri: "https://cdn/a.png",
      update,
    });
    const res = mockRes();
    await updateUserAvatarUri(
      mockReq({ user: { id: 1 }, body: { avatar_uri: "https://cdn/a.png" } }) as any,
      res,
    );
    expect(update).toHaveBeenCalledWith({ avatar_uri: "https://cdn/a.png" });
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: "URI do avatar atualizada com sucesso!" }),
    );
  });
});
