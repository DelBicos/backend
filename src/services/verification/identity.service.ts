/**
 * Verificacao de identidade do profissional: documento com foto + selfie,
 * revisados manualmente por um administrador. Aprovado, o profissional ganha
 * o selo de verificado. Os arquivos ficam em container privado (URL assinada)
 * e sao apagados quando a decisao e registrada.
 */
import { randomUUID } from "crypto";
import { ProfessionalModel } from "../../models/Professional";
import { UserModel } from "../../models/User";
import {
  DOCUMENT_TYPES,
  IdentityVerificationModel,
  type DocumentType,
} from "../../models/IdentityVerification";
import { NotificationModel } from "../../models/Notification";
import { HttpError } from "../../errors/HttpError";
import logger from "../../utils/logger";
import { getPrivateStorageAdapter } from "../storage/StorageFactory";
import { assertAllowedImageType } from "../storage/uploadPolicy";

export const FILE_KINDS = ["front", "back", "selfie"] as const;
export type FileKind = (typeof FILE_KINDS)[number];
export const MAX_REJECT_REASON = 500;
export const MIN_REJECT_REASON = 5;

type IdentityWithProfessional = IdentityVerificationModel & {
  Professional: ProfessionalModel & { User?: { name: string; email: string } };
};

async function requireProfessional(userId: number) {
  const professional = await ProfessionalModel.findOne({ where: { user_id: userId } });
  if (!professional) {
    throw HttpError.forbidden("A verificação de identidade é exclusiva para profissionais.");
  }
  return professional;
}

const keyPrefix = (professionalId: number) => `identity/${professionalId}/`;

/** Chave sempre gerada no servidor e dentro da pasta do proprio profissional. */
function assertOwnKey(value: unknown, professionalId: number, field: string): string {
  const key = String(value ?? "");
  if (!key.startsWith(keyPrefix(professionalId)) || key.includes("..")) {
    throw HttpError.badRequest(`Arquivo inválido: ${field}`);
  }
  return key;
}

/** URL assinada para o app enviar UM arquivo (documento frente/verso ou selfie). */
export async function createUploadUrl(
  userId: number,
  input: { kind?: unknown; fileType?: unknown },
) {
  const professional = await requireProfessional(userId);
  if (!FILE_KINDS.includes(input.kind as FileKind)) {
    throw HttpError.badRequest(`kind inválido. Use: ${FILE_KINDS.join(", ")}`);
  }
  const ext = assertAllowedImageType(input.fileType);
  const key = `${keyPrefix(professional.id)}${input.kind}-${randomUUID()}.${ext}`;
  const { uploadUrl, uploadHeaders } = await getPrivateStorageAdapter().generateUploadUrl(
    key,
    String(input.fileType),
  );
  return { key, uploadUrl, uploadHeaders: uploadHeaders ?? {} };
}

/** Envia o pedido para analise. */
export async function submitIdentity(
  userId: number,
  input: { document_type?: unknown; front_key?: unknown; back_key?: unknown; selfie_key?: unknown },
) {
  const professional = await requireProfessional(userId);
  if (professional.identity_verified_at) {
    throw HttpError.conflict("Sua identidade já foi verificada.");
  }
  if (!DOCUMENT_TYPES.includes(input.document_type as DocumentType)) {
    throw HttpError.badRequest(`Tipo de documento inválido. Use: ${DOCUMENT_TYPES.join(", ")}`);
  }
  const front = assertOwnKey(input.front_key, professional.id, "frente do documento");
  const selfie = assertOwnKey(input.selfie_key, professional.id, "selfie");
  const back = input.back_key ? assertOwnKey(input.back_key, professional.id, "verso") : null;

  const pending = await IdentityVerificationModel.findOne({
    where: { professional_id: professional.id, status: "pending" },
  });
  if (pending) {
    throw HttpError.conflict("Você já tem um pedido em análise. Aguarde a resposta.");
  }

  const request = await IdentityVerificationModel.create({
    professional_id: professional.id,
    document_type: input.document_type as DocumentType,
    front_key: front,
    back_key: back,
    selfie_key: selfie,
  });
  logger.info("Pedido de verificação de identidade enviado", {
    professionalId: professional.id,
    verificationId: request.id,
  });
  return presentOwn(request);
}

function presentOwn(request: IdentityVerificationModel) {
  return {
    id: request.id,
    status: request.status,
    document_type: request.document_type,
    reject_reason: request.reject_reason,
    submitted_at: request.createdAt,
    reviewed_at: request.reviewed_at,
  };
}

/** Situacao da conta para a tela "Verificacao de conta". */
export async function getStatus(userId: number) {
  const user = await UserModel.findByPk(userId, { attributes: ["id", "mfa_enabled"] });
  if (!user) throw HttpError.notFound("Usuário não encontrado");
  const professional = await ProfessionalModel.findOne({ where: { user_id: userId } });

  let identity: ReturnType<typeof presentOwn> | null = null;
  if (professional) {
    const latest = await IdentityVerificationModel.findOne({
      where: { professional_id: professional.id },
      order: [["created_at", "DESC"]],
    });
    identity = latest ? presentOwn(latest) : null;
  }

  return {
    email_verified: true, // todo cadastro confirma o e-mail por codigo
    mfa_enabled: Boolean(user.mfa_enabled),
    is_professional: Boolean(professional),
    identity,
    verified: Boolean(professional?.identity_verified_at),
    verified_at: professional?.identity_verified_at ?? null,
  };
}

// ---------------------------------------------------------------------------
// Administrador
// ---------------------------------------------------------------------------

/** Pedidos para analise (ou de um status), com links de leitura temporarios. */
export async function listForReview(status: unknown = "pending") {
  const wanted = String(status);
  const requests = (await IdentityVerificationModel.findAll({
    where: { status: wanted === "all" ? ["pending", "approved", "rejected"] : wanted },
    include: [
      {
        model: ProfessionalModel,
        as: "Professional",
        attributes: ["id", "user_id", "cpf"],
        include: [{ model: UserModel, as: "User", attributes: ["id", "name", "email"] }],
      },
    ],
    order: [["created_at", "ASC"]],
    limit: 100,
  })) as IdentityWithProfessional[];

  const storage = requests.some((r) => r.status === "pending") ? getPrivateStorageAdapter() : null;
  return Promise.all(
    requests.map(async (r) => {
      const sign = (key: string | null) =>
        storage && key && r.status === "pending" ? storage.getFileUrl(key) : null;
      return {
        id: r.id,
        status: r.status,
        document_type: r.document_type,
        submitted_at: r.createdAt,
        reviewed_at: r.reviewed_at,
        reject_reason: r.reject_reason,
        professional: {
          id: r.Professional?.id,
          name: r.Professional?.User?.name,
          email: r.Professional?.User?.email,
          cpf: r.Professional?.cpf,
        },
        front_url: await sign(r.front_key),
        back_url: await sign(r.back_key),
        selfie_url: await sign(r.selfie_key),
      };
    }),
  );
}

async function deleteFiles(request: IdentityVerificationModel) {
  const storage = getPrivateStorageAdapter();
  for (const key of [request.front_key, request.back_key, request.selfie_key]) {
    if (!key) continue;
    try {
      await storage.deleteFile?.(key);
    } catch (error) {
      logger.warn("Falha ao apagar arquivo de verificação", {
        key,
        reason: (error as Error).message,
      });
    }
  }
}

async function notifyDecision(userId: number, approved: boolean, reason?: string) {
  try {
    await NotificationModel.create({
      user_id: userId,
      title: approved ? "Identidade verificada" : "Verificação recusada",
      message: approved
        ? "Seu perfil agora exibe o selo de profissional verificado."
        : `Não conseguimos verificar seus documentos: ${reason}. Você pode enviar novamente.`,
      notification_type: "system",
      is_read: false,
    });
  } catch (error) {
    logger.warn("Falha ao notificar decisão da verificação", { userId });
  }
}

/** Administrador aprova ou recusa (com motivo). */
export async function reviewIdentity(
  adminUserId: number,
  id: unknown,
  input: { decision?: unknown; reason?: unknown },
) {
  const request = await IdentityVerificationModel.findByPk(Number(id), {
    include: [{ model: ProfessionalModel, as: "Professional" }],
  });
  if (!request) throw HttpError.notFound("Pedido não encontrado");
  if (request.status !== "pending") throw HttpError.conflict("Este pedido já foi analisado.");

  const professional = (request as IdentityWithProfessional).Professional;
  const approved = input.decision === "approve";
  if (!approved && input.decision !== "reject") {
    throw HttpError.badRequest('decision deve ser "approve" ou "reject"');
  }

  let reason: string | undefined;
  if (!approved) {
    reason = String(input.reason ?? "").trim();
    if (reason.length < MIN_REJECT_REASON || reason.length > MAX_REJECT_REASON) {
      throw HttpError.badRequest(
        `Informe o motivo da recusa (${MIN_REJECT_REASON} a ${MAX_REJECT_REASON} caracteres)`,
      );
    }
  }

  await deleteFiles(request);
  request.status = approved ? "approved" : "rejected";
  request.reject_reason = reason ?? null;
  request.reviewed_by_user_id = adminUserId;
  request.reviewed_at = new Date();
  request.front_key = null;
  request.back_key = null;
  request.selfie_key = null;
  await request.save();

  if (approved) {
    professional.identity_verified_at = new Date();
    await professional.save();
  }
  await notifyDecision(professional.user_id, approved, reason);
  logger.info("Verificação de identidade analisada", { id: request.id, approved });
  return { id: request.id, status: request.status };
}
