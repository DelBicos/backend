/**
 * Conta do usuario: login, perfil proprio, alteracao de dados e senha.
 */
import { Op, col, fn, where } from "sequelize";
import { Request } from "express";
import { UserModel } from "../../models/User";
import { AddressModel } from "../../models/Address";
import { ClientModel } from "../../models/Client";
import { ProfessionalModel } from "../../models/Professional";
import { HttpError } from "../../errors/HttpError";
import { generateTokenAndUserPayload } from "../../utils/authUtils";
import logger, { logAuth } from "../../utils/logger";
import { saveLoginLog } from "../loginLog.service";
import {
  assertPasswordPolicy,
  findUserByEmail,
  hashPassword,
  normalizeEmail,
  verifyPassword,
} from "./credentials";

/** Mensagem unica: nao revela se o e-mail existe ou se a senha esta errada. */
const INVALID_CREDENTIALS = "E-mail ou senha inválidos";

/** Resumo do perfil profissional do proprio usuario. */
function ownProfessionalSummary(professional: ProfessionalModel | null) {
  if (!professional) return {};
  return {
    professional: {
      id: professional.id,
      cpf: professional.cpf,
      cnpj: professional.cnpj,
      description: professional.description,
      main_address_id: professional.main_address_id,
    },
  };
}

export async function login(req: Request, input: { email?: unknown; password?: unknown }) {
  let email: string;
  try {
    email = normalizeEmail(input.email);
  } catch {
    throw new HttpError(401, INVALID_CREDENTIALS);
  }

  const user = await findUserByEmail(email);
  const passwordOk = await verifyPassword(input.password, user?.password);
  if (!user || !passwordOk) {
    logAuth("login", user?.id, email, false, user ? "Senha inválida" : "Usuário não encontrado");
    throw new HttpError(401, INVALID_CREDENTIALS);
  }
  if (user.active === false) {
    logAuth("login", user.id, email, false, "Usuário inativo");
    throw HttpError.forbidden("Conta desativada. Entre em contato com o suporte.");
  }

  const client = await ClientModel.findOne({ where: { user_id: user.id } });
  if (!client) {
    logAuth("login", user.id, email, false, "Cliente não encontrado");
    throw HttpError.forbidden("Cadastro de cliente não encontrado para esta conta.");
  }

  const [address, professional] = await Promise.all([
    client.main_address_id ? AddressModel.findByPk(client.main_address_id) : null,
    ProfessionalModel.findOne({ where: { user_id: user.id } }),
  ]);

  const { token, user: userPayload } = generateTokenAndUserPayload(user, client, address);
  saveLoginLog(req, { userId: user.id, username: user.email, jwt: token });
  logAuth("login", user.id, email, true);

  return {
    message: "Login realizado com sucesso",
    token,
    user: {
      ...userPayload,
      professional_id: professional?.id ?? null,
      ...ownProfessionalSummary(professional),
    },
  };
}

/** Dados do proprio usuario autenticado (GET /api/user/me). */
export async function getMe(userId: number) {
  const user = await UserModel.findByPk(userId, {
    attributes: ["id", "name", "email", "phone", "avatar_uri", "banner_uri"],
    include: [{ model: ClientModel, as: "Client", attributes: ["id", "cpf"] }],
  });
  if (!user) throw HttpError.notFound("Usuário não encontrado");

  const professional = await ProfessionalModel.findOne({ where: { user_id: userId } });
  return {
    user: {
      ...(user.toJSON() as object),
      professional_id: professional?.id ?? null,
      ...ownProfessionalSummary(professional),
    },
  };
}

/** Perfil de outro usuario; e-mail e telefone apenas para o proprio. */
export async function getUserProfile(requesterId: number | undefined, rawId: unknown) {
  const user = await UserModel.findByPk(Number(rawId));
  if (!user) throw HttpError.notFound("Usuário não encontrado");
  const isSelf = requesterId === user.id;
  return {
    id: user.id,
    name: user.name,
    avatar_uri: user.avatar_uri,
    banner_uri: user.banner_uri,
    ...(isSelf ? { email: user.email, phone: user.phone } : {}),
  };
}

export async function updateProfile(
  userId: number,
  input: { name?: unknown; email?: unknown; phone?: unknown },
) {
  const user = await UserModel.findByPk(userId);
  if (!user) throw HttpError.notFound("Usuário não encontrado.");

  if (input.name !== undefined && input.name !== null && input.name !== "") {
    const name = String(input.name).trim();
    if (!name) throw HttpError.badRequest("Nome inválido.");
    user.name = name;
  }

  if (input.email) {
    const email = normalizeEmail(input.email);
    if (email !== user.email.toLowerCase()) {
      const taken = await UserModel.findOne({
        where: {
          [Op.and]: [where(fn("lower", col("email")), email), { id: { [Op.ne]: userId } }],
        },
      });
      if (taken) throw HttpError.conflict("Este e-mail já está em uso.");
      user.email = email;
    }
  }

  if (input.phone) user.phone = String(input.phone);

  await user.save();
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    phone: user.phone,
    avatar_uri: user.avatar_uri,
    banner_uri: user.banner_uri,
  };
}

export async function changePassword(
  userId: number,
  input: { current_password?: unknown; new_password?: unknown },
) {
  if (!input.current_password || !input.new_password) {
    throw HttpError.badRequest("Senha atual e nova senha são obrigatórias");
  }
  const newPassword = assertPasswordPolicy(input.new_password, "nova senha");

  const user = await UserModel.findByPk(userId);
  if (!user) throw HttpError.notFound("Usuário não encontrado");

  if (!(await verifyPassword(input.current_password, user.password))) {
    logger.warn("Tentativa de mudança de senha com senha incorreta", { userId });
    throw HttpError.badRequest("Senha atual incorreta");
  }

  user.password = await hashPassword(newPassword);
  await user.save();
  logger.info("Senha alterada com sucesso", { userId });
}
