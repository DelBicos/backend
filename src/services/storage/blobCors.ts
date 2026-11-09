import type { BlobServiceClient } from "@azure/storage-blob";
import logger from "../../utils/logger";
import { errorMessage } from "../../utils/errors.util";

/** A Azure aceita no maximo 5 regras de CORS por servico. */
const MAX_CORS_RULES = 5;

interface CorsRule {
  allowedOrigins: string;
  allowedMethods: string;
  allowedHeaders: string;
  exposedHeaders: string;
  maxAgeInSeconds: number;
}

const splitList = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

/** Origens do site (ALLOWED_ORIGINS), so protocolo + host, sem barra final. */
export function webOrigins(env = process.env): string[] {
  const origins = splitList(env.ALLOWED_ORIGINS).map((origin) => {
    try {
      const url = new URL(origin);
      return `${url.protocol}//${url.host}`;
    } catch {
      return origin.replace(/\/+$/, "");
    }
  });
  return [...new Set(origins)];
}

function allowsUpload(rule: CorsRule, origin: string): boolean {
  const origins = splitList(rule.allowedOrigins);
  const methods = splitList(rule.allowedMethods);
  return (
    (origins.includes("*") || origins.includes(origin)) && methods.includes("put")
  );
}

/**
 * O site envia a imagem direto para o Blob Storage (PUT na URL SAS). Sem uma
 * regra de CORS na conta, o navegador barra o envio no preflight e o upload
 * falha so na web. Garante a regra para as origens de ALLOWED_ORIGINS,
 * mantendo as regras que ja existem. Nunca derruba o upload: se a conta nao
 * deixar alterar as propriedades, registra o aviso e segue.
 */
export async function ensureBlobCors(
  service: BlobServiceClient,
  env = process.env,
): Promise<void> {
  const origins = webOrigins(env);
  if (origins.length === 0) return;

  try {
    const { cors = [] } = await service.getProperties();
    const missing = origins.filter(
      (origin) => !cors.some((rule) => allowsUpload(rule, origin)),
    );
    if (missing.length === 0) return;

    if (cors.length >= MAX_CORS_RULES) {
      logger.warn(
        "CORS do Blob Storage: limite de regras atingido; ajuste a regra pelo portal",
        { missing },
      );
      return;
    }

    // Passa so `cors`: as demais propriedades do servico ficam como estao.
    await service.setProperties({
      cors: [
        ...cors,
        {
          allowedOrigins: missing.join(","),
          allowedMethods: "PUT,OPTIONS",
          allowedHeaders: "content-type,x-ms-*",
          exposedHeaders: "",
          maxAgeInSeconds: 3600,
        },
      ],
    });
    logger.info("CORS do Blob Storage configurado para upload pelo site", {
      origins: missing,
    });
  } catch (error) {
    logger.warn("Não foi possível configurar o CORS do Blob Storage", {
      reason: errorMessage(error),
    });
  }
}
