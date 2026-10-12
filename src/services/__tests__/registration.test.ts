jest.mock("../../config/database", () => ({ sequelize: { transaction: jest.fn() } }));
jest.mock("../../models/User", () => ({ UserModel: { findOne: jest.fn(), create: jest.fn() } }));
jest.mock("../../models/Client", () => ({ ClientModel: { findOne: jest.fn(), create: jest.fn() } }));
jest.mock("../../models/Address", () => ({ AddressModel: { create: jest.fn() } }));
jest.mock("../../models/Notification", () => ({ NotificationModel: { create: jest.fn() } }));
jest.mock("bcryptjs", () => ({ hash: jest.fn().mockResolvedValue("hashed-password") }));
jest.mock("../email/registrationEmail.service", () => ({ sendRegistrationCode: jest.fn() }));
import { sequelize } from "../../config/database";
import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import { AddressModel } from "../../models/Address";
import { NotificationModel } from "../../models/Notification";
import { sendRegistrationCode } from "../email/registrationEmail.service";
import { requestRegistration, resendRegistration, verifyRegistration } from "../auth/registration.service";
import type { RegistrationInput } from "../auth/registration.types";
let sequence = 0;
let data: RegistrationInput;
const transaction = {};
beforeEach(() => {
  jest.clearAllMocks();
  (sendRegistrationCode as jest.Mock).mockReset().mockResolvedValue(undefined);
  (UserModel.findOne as jest.Mock).mockResolvedValue(null);
  (ClientModel.findOne as jest.Mock).mockResolvedValue(null);
  (UserModel.create as jest.Mock).mockResolvedValue({ id: 10 });
  (AddressModel.create as jest.Mock).mockResolvedValue({ id: 20 });
  (ClientModel.create as jest.Mock).mockResolvedValue({ id: 30 });
  (NotificationModel.create as jest.Mock).mockReset().mockResolvedValue({});
  (sequelize.transaction as jest.Mock).mockImplementation(async (work: (t: unknown) => Promise<unknown>) => work(transaction));
  data = { name: "Teste", surname: "Local", email: `test${sequence++}@example.com`, password: "test-password",
    phone: "15999999999", cpf: "00000000000", address: { postal_code: "18000-000", street: "Rua de teste", number: "1",
      neighborhood: "Centro", city: "Sorocaba", state: "SP" } };
});
function sentCode(index = 0): string { return (sendRegistrationCode as jest.Mock).mock.calls[index][2] as string; }
it("envia antes de criar conta e só conclui com o código correto", async () => {
  await requestRegistration(data);
  expect(UserModel.create).not.toHaveBeenCalled();
  expect(sentCode()).toMatch(/^\d{6}$/);
  await expect(verifyRegistration(data.email, "invalid")).rejects.toMatchObject({ status: 400 });
  await verifyRegistration(data.email, sentCode());
  expect(UserModel.create).toHaveBeenCalledWith(expect.objectContaining({ password: "hashed-password", email: data.email }), { transaction });
  expect(NotificationModel.create).toHaveBeenCalledWith(expect.objectContaining({ user_id: 10 }), { transaction });
  await expect(verifyRegistration(data.email, sentCode())).rejects.toMatchObject({ status: 404 });
});
it("falha inicial não cria sessão nem conta", async () => {
  (sendRegistrationCode as jest.Mock).mockRejectedValue(new Error("SMTP unavailable"));
  await expect(requestRegistration(data)).rejects.toMatchObject({ status: 503 });
  await expect(resendRegistration(data.email)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
  expect(UserModel.create).not.toHaveBeenCalled();
});
it("falha de reenvio retorna erro e preserva código anterior", async () => {
  await requestRegistration(data);
  const first = sentCode();
  (sendRegistrationCode as jest.Mock).mockRejectedValueOnce(new Error("SMTP unavailable"));
  await expect(resendRegistration(data.email)).rejects.toMatchObject({ status: 503 });
  await expect(verifyRegistration(data.email, first)).resolves.toMatchObject({ user: { id: 10 } });
});
it("reenvio aceito permite verificar o novo código", async () => {
  await requestRegistration(data);
  await resendRegistration(data.email);
  expect(sendRegistrationCode).toHaveBeenLastCalledWith(data.email, data.name, expect.any(String), true);
  await expect(verifyRegistration(data.email, sentCode(1))).resolves.toMatchObject({ client: { id: 30 } });
});
it("código expirado não cria usuário", async () => {
  await requestRegistration(data);
  const now = jest.spyOn(Date, "now").mockReturnValue(Date.now() + 600001);
  try {
    await expect(verifyRegistration(data.email, sentCode())).rejects.toMatchObject({ status: 400 });
    await expect(resendRegistration(data.email)).rejects.toMatchObject({ code: "SESSION_EXPIRED" });
    expect(UserModel.create).not.toHaveBeenCalled();
  } finally { now.mockRestore(); }
});
it("falha na notificação rejeita a transação e permite nova tentativa", async () => {
  await requestRegistration(data);
  (NotificationModel.create as jest.Mock).mockRejectedValueOnce(new Error("database unavailable"));
  await expect(verifyRegistration(data.email, sentCode())).rejects.toThrow("database unavailable");
  await expect(verifyRegistration(data.email, sentCode())).resolves.toMatchObject({ user: { id: 10 } });
});
it.each(["email", "cpf"])("duplicidade de %s não envia código", async (field) => {
  (field === "email" ? UserModel.findOne as jest.Mock : ClientModel.findOne as jest.Mock).mockResolvedValue({ id: 1 });
  await expect(requestRegistration(data)).rejects.toMatchObject({ status: 409 });
  expect(sendRegistrationCode).not.toHaveBeenCalled();
});
