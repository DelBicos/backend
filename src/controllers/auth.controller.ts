import { Request, Response } from "express";
import { requestRegistration, resendRegistration, verifyRegistration, RegistrationError } from "../services/auth/registration.service";
import type { RegistrationInput } from "../services/auth/registration.types";
import { generateTokenAndUserPayload } from "../utils/authUtils";
import { saveLoginLog } from "../services/loginLog.service";
import logger from "../utils/logger";

function failure(res: Response, error: unknown) {
  if (error instanceof RegistrationError)
    return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) });
  logger.warn("Falha no fluxo de cadastro");
  return res.status(500).json({ error: "Não foi possível concluir o cadastro. Tente novamente." });
}

export const handleRegister = async (req: Request, res: Response) => {
  const body = req.body as Partial<RegistrationInput> | undefined;
  if (!body || ![body.name, body.email, body.password, body.cpf].every((value) => typeof value === "string" && value.trim()))
    return res.status(400).json({ error: "Campos obrigatórios ausentes (nome, email, senha, cpf)." });
  const address = body.address;
  if (!address || ![address.postal_code, address.street, address.number, address.neighborhood, address.city, address.state]
    .every((value) => typeof value === "string" && value.trim()))
    return res.status(400).json({ error: "Endereço incompleto. Confira CEP, Rua, Número, Bairro, Cidade e Estado." });
  if (typeof body.phone !== "string" || !body.phone.trim())
    return res.status(400).json({ error: "Telefone é obrigatório." });
  try {
    await requestRegistration({ name: body.name!, surname: typeof body.surname === "string" ? body.surname : "",
      email: body.email!.trim().toLowerCase(), password: body.password!, cpf: body.cpf!, phone: body.phone,
      address: { postal_code: address.postal_code, street: address.street, number: address.number,
        neighborhood: address.neighborhood, city: address.city, state: address.state,
        complement: typeof address.complement === "string" ? address.complement : undefined,
        country_iso: typeof address.country_iso === "string" ? address.country_iso : "BR" } });
    return res.status(200).json({ message: "E-mail de verificação enviado com sucesso!" });
  } catch (error: unknown) { return failure(res, error); }
};

export const handleVerifyCode = async (req: Request, res: Response) => {
  const body = req.body as { email?: unknown; code?: unknown } | undefined;
  if (typeof body?.email !== "string" || !body.email.trim() || typeof body.code !== "string" || !body.code.trim())
    return res.status(400).json({ error: 'Campos "email" e "code" são obrigatórios.' });
  try {
    const { user, client, address } = await verifyRegistration(body.email.trim().toLowerCase(), body.code.trim());
    const payload = generateTokenAndUserPayload(user, client, address);
    saveLoginLog(req, { userId: user.id, username: user.email, jwt: payload.token });
    return res.status(200).json({ message: "Conta verificada e usuário criado com sucesso!", token: payload.token, user: payload.user });
  } catch (error: unknown) { return failure(res, error); }
};

export const handleResendCode = async (req: Request, res: Response) => {
  const body = req.body as { email?: unknown } | undefined;
  if (typeof body?.email !== "string" || !body.email.trim())
    return res.status(400).json({ error: "E-mail é obrigatório." });
  try {
    await resendRegistration(body.email.trim().toLowerCase());
    return res.status(200).json({ message: "Código reenviado com sucesso!" });
  } catch (error: unknown) { return failure(res, error); }
};
