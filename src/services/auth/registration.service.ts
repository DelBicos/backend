/**
 * Cadastro de cliente com confirmacao de e-mail por codigo (6 digitos).
 */
import { UniqueConstraintError } from "sequelize";
import { Request } from "express";
import { sequelize } from "../../config/database";
import { UserModel } from "../../models/User";
import { ClientModel } from "../../models/Client";
import { AddressModel } from "../../models/Address";
import { NotificationModel } from "../../models/Notification";
import { HttpError } from "../../errors/HttpError";
import { EmailService } from "../email.service";
import { verificationCodeEmail } from "../../templates/emails/verificationCode";
import { generateVerificationCode } from "../../utils/verification";
import { generateTokenAndUserPayload } from "../../utils/authUtils";
import logger, { logError } from "../../utils/logger";
import { saveLoginLog } from "../loginLog.service";
import { onlyDigits } from "../professional/professional.rules";
import {
  assertPasswordPolicy,
  findUserByEmail,
  hashPassword,
  normalizeEmail,
} from "./credentials";
import {
  CODE_TTL_MS,
  PendingRegistrationStore,
  PendingUserData,
} from "./pendingRegistration.store";

export const pendingRegistrations = new PendingRegistrationStore();

const CODE_TTL_MINUTES = CODE_TTL_MS / 60_000;

function fullName(name: unknown, surname: unknown): string {
  return [name, surname]
    .map((part) => (typeof part === "string" ? part.trim() : ""))
    .filter(Boolean)
    .join(" ");
}

async function sendCode(email: string, name: string, code: string, resend = false) {
  const { subject, html } = verificationCodeEmail({
    name,
    code,
    expiresInMinutes: CODE_TTL_MINUTES,
    resend,
  });
  return EmailService.sendTransactionalEmail({ to: email, subject, html });
}

export interface RegistrationInput {
  name?: unknown;
  surname?: unknown;
  email?: unknown;
  password?: unknown;
  phone?: unknown;
  cpf?: unknown;
  address?: any;
}

/** Valida os dados, guarda o cadastro pendente e envia o codigo por e-mail. */
export async function startRegistration(input: RegistrationInput) {
  if (!input.name || !input.email || !input.password || !input.cpf) {
    throw HttpError.badRequest("Campos obrigatórios ausentes (nome, email, senha, cpf).");
  }
  const address = input.address;
  if (!address || !address.postal_code || !address.street || !address.number) {
    throw HttpError.badRequest("Endereço incompleto. CEP, Rua e Número são obrigatórios.");
  }

  const email = normalizeEmail(input.email);
  const password = assertPasswordPolicy(input.password);
  const cpf = onlyDigits(input.cpf);
  if (!cpf || cpf.length !== 11) throw HttpError.badRequest("CPF deve ter 11 dígitos.");

  if (await findUserByEmail(email)) {
    throw HttpError.conflict("Este e-mail já está cadastrado.");
  }
  if (await ClientModel.findOne({ where: { cpf } })) {
    throw HttpError.conflict("Este CPF já está cadastrado.");
  }

  const name = fullName(input.name, input.surname);
  const data: PendingUserData = {
    name,
    email,
    phone: input.phone ? String(input.phone) : undefined,
    // A senha nunca fica em texto puro, nem em memoria.
    passwordHash: await hashPassword(password),
    cpf,
    address,
  };

  const code = generateVerificationCode();
  pendingRegistrations.start(email, data, code);

  if (!(await sendCode(email, String(input.name), code))) {
    pendingRegistrations.delete(email);
    logger.error("Falha ao enviar e-mail de verificação", { email });
    throw new HttpError(502, "Falha ao enviar o e-mail.");
  }
  logger.info("E-mail de verificação enviado", { email });
  return { message: "E-mail de verificação enviado com sucesso!" };
}

/** Confere o codigo e cria usuario, endereco e cliente numa transacao. */
export async function verifyRegistration(req: Request, input: { email?: unknown; code?: unknown }) {
  if (!input.email || !input.code) {
    throw HttpError.badRequest('Campos "email" e "code" são obrigatórios.');
  }
  const email = normalizeEmail(input.email);
  const result = pendingRegistrations.verify(email, String(input.code).trim());

  if (result.status === "not_found") {
    throw HttpError.notFound("Dados de verificação não encontrados ou expirados.");
  }
  if (result.status === "locked") {
    throw new HttpError(
      429,
      "Muitas tentativas inválidas. Faça o cadastro novamente para receber um novo código.",
    );
  }
  if (result.status === "invalid") {
    throw HttpError.badRequest("Código inválido ou expirado.");
  }

  const data = result.data;
  let created: { user: UserModel; client: ClientModel; address: AddressModel };
  try {
    created = await sequelize.transaction(async (transaction) => {
      const user = await UserModel.create(
        {
          name: data.name,
          email: data.email,
          phone: data.phone as string,
          password: data.passwordHash,
          active: true,
        },
        { transaction },
      );
      const address = await AddressModel.create(
        {
          user_id: user.id,
          postal_code: String(data.address.postal_code).replace(/\D/g, ""),
          street: data.address.street,
          number: String(data.address.number),
          complement: data.address.complement,
          neighborhood: data.address.neighborhood,
          city: data.address.city,
          state: data.address.state,
          country_iso: data.address.country_iso || "BR",
          lat: 0,
          lng: 0,
          active: true,
        },
        { transaction },
      );
      const client = await ClientModel.create(
        { user_id: user.id, cpf: data.cpf, main_address_id: address.id },
        { transaction },
      );
      return { user, client, address };
    });
  } catch (error) {
    if (error instanceof UniqueConstraintError) {
      throw HttpError.conflict("E-mail ou CPF já cadastrado.");
    }
    logError("Erro ao criar usuário após verificação", error, { email });
    throw error;
  }

  pendingRegistrations.delete(email);

  try {
    await NotificationModel.create({
      user_id: created.user.id,
      title: "Bem-vindo ao DelBicos!",
      message: "Sua conta foi criada com sucesso. Aproveite nossos serviços!",
      is_read: false,
      notification_type: "system",
    });
  } catch (error) {
    logger.warn("Falha ao criar notificação de boas-vindas", { userId: created.user.id });
  }

  const { token, user } = generateTokenAndUserPayload(
    created.user,
    created.client,
    created.address,
  );
  saveLoginLog(req, { userId: created.user.id, username: created.user.email, jwt: token });

  return { message: "Conta verificada e usuário criado com sucesso!", token, user };
}

/** Reenvia um novo codigo para um cadastro ainda pendente. */
export async function resendCode(input: { email?: unknown }) {
  if (!input.email) throw HttpError.badRequest("E-mail é obrigatório.");
  const email = normalizeEmail(input.email);

  const pending = pendingRegistrations.get(email);
  const code = generateVerificationCode();
  if (!pending || !pendingRegistrations.addCode(email, code)) {
    throw HttpError.notFound(
      "Sessão de cadastro expirada. Por favor, cadastre-se novamente.",
    ).withCode("SESSION_EXPIRED");
  }

  const firstName = pending.name.split(" ")[0] || pending.name;
  if (!(await sendCode(email, firstName, code, true))) {
    throw new HttpError(502, "Falha ao enviar o e-mail.");
  }
  return { message: "Código reenviado com sucesso!" };
}
