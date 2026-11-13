jest.mock("../../services/email.service", () => ({
  EmailService: { sendTransactionalEmail: jest.fn() },
}));
jest.mock("../../services/loginLog.service", () => ({
  saveLoginLog: jest.fn(),
}));
jest.mock("../../utils/verification", () => ({
  generateVerificationCode: jest.fn(() => "654321"),
}));
jest.mock("../../models/User", () => ({
  UserModel: { findOne: jest.fn(), create: jest.fn() },
}));
jest.mock("../../models/Client", () => ({
  ClientModel: { findOne: jest.fn(), create: jest.fn() },
}));
jest.mock("../../models/Address", () => ({
  AddressModel: { create: jest.fn() },
}));
jest.mock("../../models/Notification", () => ({
  NotificationModel: { create: jest.fn() },
}));

import { EmailService } from "../../services/email.service";
import { ClientModel } from "../../models/Client";
import { UserModel } from "../../models/User";
import { AddressModel } from "../../models/Address";
import { NotificationModel } from "../../models/Notification";
import { AuthController } from "../auth.controller";
import { mockReq, mockRes } from "../../test/http";

const sendMail = EmailService.sendTransactionalEmail as jest.Mock;

const registerBody = {
  name: "Ana",
  surname: "Silva",
  email: "ana-register@example.com",
  password: "secret123",
  cpf: "12345678900",
  phone: "11999999999",
  address: {
    postal_code: "01310-100",
    street: "Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "SP",
  },
};

describe("AuthController", () => {
  it("returns 400 when required register fields are missing", async () => {
    const res = mockRes();
    await AuthController.handleRegister(mockReq({ body: {} }) as any, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      error: "Campos obrigatórios ausentes (nome, email, senha, cpf).",
    });
  });

  it("returns 409 when the email is already registered", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue({ id: 1 });
    const res = mockRes();
    await AuthController.handleRegister(mockReq({ body: registerBody }) as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Este e-mail já está cadastrado." });
  });

  it("returns 409 when the CPF is already registered", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue(null);
    (ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 2 });
    const res = mockRes();
    await AuthController.handleRegister(mockReq({ body: registerBody }) as any, res);
    expect(res.status).toHaveBeenCalledWith(409);
    expect(res.json).toHaveBeenCalledWith({ error: "Este CPF já está cadastrado." });
  });

  it("returns 500 when the existence check throws", async () => {
    (UserModel.findOne as jest.Mock).mockRejectedValue(new Error("db"));
    const res = mockRes();
    await AuthController.handleRegister(mockReq({ body: registerBody }) as any, res);
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Erro ao verificar usuário." });
  });

  it("stores the verification code and returns 200 when the email is sent", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue(null);
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    sendMail.mockResolvedValue(true);
    const res = mockRes();
    await AuthController.handleRegister(mockReq({ body: registerBody }) as any, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(sendMail).toHaveBeenCalledWith(
      expect.objectContaining({ to: registerBody.email }),
    );
  });

  it("returns 500 when the verification email is not sent", async () => {
    (UserModel.findOne as jest.Mock).mockResolvedValue(null);
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    sendMail.mockResolvedValue(false);
    const res = mockRes();
    await AuthController.handleRegister(
      mockReq({ body: { ...registerBody, email: "fail@example.com" } }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith({ error: "Falha ao enviar o e-mail." });
  });

  it("returns 400 for an unknown verification code", async () => {
    const res = mockRes();
    await AuthController.handleVerifyCode(
      mockReq({
        body: { email: registerBody.email, code: "000000" },
      }) as any,
      res,
    );
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: "Código inválido ou expirado." });
  });

  it("creates the user when the verification code matches", async () => {
    (UserModel.create as jest.Mock).mockResolvedValue({
      id: 10,
      name: "Ana Silva",
      email: registerBody.email,
      phone: registerBody.phone,
      avatar_uri: null,
    });
    (AddressModel.create as jest.Mock).mockResolvedValue({
      id: 20,
      lat: 0,
      lng: 0,
      city: "São Paulo",
      state: "SP",
      country_iso: "BR",
    });
    (ClientModel.create as jest.Mock).mockResolvedValue({
      id: 30,
      cpf: registerBody.cpf,
    });
    (NotificationModel.create as jest.Mock).mockResolvedValue({});
    const res = mockRes();

    await AuthController.handleVerifyCode(
      mockReq({
        body: { email: registerBody.email, code: "654321" },
      }) as any,
      res,
    );

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Conta verificada e usuário criado com sucesso!",
        token: expect.any(String),
      }),
    );
  });

  it("returns 409 when saving the user hits a unique constraint", async () => {
    const error = new Error("dup");
    error.name = "SequelizeUniqueConstraintError";
    (UserModel.create as jest.Mock).mockRejectedValue(error);
    const res = mockRes();
    await AuthController.handleRegister(mockReq({ body: registerBody }) as any, res);
    (UserModel.findOne as jest.Mock).mockResolvedValue(null);
    (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
    sendMail.mockResolvedValue(true);
    await AuthController.handleRegister(
      mockReq({ body: { ...registerBody, email: "unique@example.com" } }) as any,
      res,
    );
    const verifyRes = mockRes();
    await AuthController.handleVerifyCode(
      mockReq({ body: { email: "unique@example.com", code: "654321" } }) as any,
      verifyRes,
    );
    expect(verifyRes.status).toHaveBeenCalledWith(409);
    expect(verifyRes.json).toHaveBeenCalledWith({
      error: "E-mail ou CPF já cadastrado.",
    });
  });
});
