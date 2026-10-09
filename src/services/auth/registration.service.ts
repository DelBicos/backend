import { randomInt } from "crypto";
import bcrypt from "bcryptjs";
import { sequelize } from "../../config/database";
import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import { AddressModel } from "../../models/Address";
import { NotificationModel } from "../../models/Notification";
import { sendRegistrationCode } from "../email/registrationEmail.service";
import type { RegistrationInput } from "./registration.types";

export class RegistrationError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); }
}
interface PendingRegistration {
  codes: { value: string; expiresAt: number }[];
  userData: RegistrationInput;
  verifying: boolean;
}
// Mantém o armazenamento temporário existente: reiniciar o processo expira a sessão de cadastro.
const pending = new Map<string, PendingRegistration>();
const expiration = 10 * 60 * 1000;

export async function requestRegistration(data: RegistrationInput): Promise<void> {
  if (await UserModel.findOne({ where: { email: data.email } }))
    throw new RegistrationError("Este e-mail já está cadastrado.", 409);
  if (await ClientModel.findOne({ where: { cpf: data.cpf } }))
    throw new RegistrationError("Este CPF já está cadastrado.", 409);
  const code = String(randomInt(100000, 1000000));
  try { await sendRegistrationCode(data.email, data.name, code); }
  catch { throw new RegistrationError("Falha ao enviar o e-mail.", 503); }
  pending.set(data.email, { userData: data, codes: [{ value: code, expiresAt: Date.now() + expiration }], verifying: false });
}

export async function resendRegistration(email: string): Promise<void> {
  const entry = pending.get(email);
  if (!entry || !entry.codes.some((code) => code.expiresAt > Date.now())) {
    pending.delete(email);
    throw new RegistrationError("Sessão de cadastro expirada. Por favor, cadastre-se novamente.", 404, "SESSION_EXPIRED");
  }
  const code = String(randomInt(100000, 1000000));
  try { await sendRegistrationCode(email, entry.userData.name, code, true); }
  catch { throw new RegistrationError("Falha ao enviar o e-mail.", 503); }
  // Só registra códigos aceitos pelo provedor; falha de reenvio preserva o anterior.
  entry.codes = entry.codes.filter((item) => item.expiresAt > Date.now());
  entry.codes.push({ value: code, expiresAt: Date.now() + expiration });
}

export async function verifyRegistration(email: string, code: string) {
  const entry = pending.get(email);
  if (!entry) throw new RegistrationError("Dados de verificação não encontrados ou expirados.", 404);
  if (!entry.codes.some((item) => item.value === code && item.expiresAt > Date.now()))
    throw new RegistrationError("Código inválido ou expirado.", 400);
  if (entry.verifying) throw new RegistrationError("Verificação em andamento. Aguarde.", 409);
  entry.verifying = true;
  try {
    const data = entry.userData;
    const password = await bcrypt.hash(data.password, 10);
    const result = await sequelize.transaction(async (transaction) => {
      const user = await UserModel.create({ name: `${data.name} ${data.surname}`.trim(), email: data.email,
        phone: data.phone, password, active: true }, { transaction });
      const address = await AddressModel.create({ ...data.address, user_id: user.id,
        postal_code: data.address.postal_code.replace(/\D/g, ""), country_iso: data.address.country_iso || "BR",
        lat: 0, lng: 0, active: true }, { transaction });
      const client = await ClientModel.create({ user_id: user.id, cpf: data.cpf, main_address_id: address.id }, { transaction });
      await NotificationModel.create({ user_id: user.id, title: "Bem-vindo ao DelBicos!",
        message: "Sua conta foi criada com sucesso. Aproveite nossos serviços!", is_read: false,
        notification_type: "system" }, { transaction });
      return { user, address, client };
    });
    pending.delete(email);
    return result;
  } catch (error: unknown) {
    if (error instanceof Error && error.name === "SequelizeUniqueConstraintError")
      throw new RegistrationError("E-mail ou CPF já cadastrado.", 409);
    throw error;
  } finally { entry.verifying = false; }
}
