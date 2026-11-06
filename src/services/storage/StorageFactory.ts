import { StorageAdapter } from "./StorageAdapter";
import { AzureBlobStorageAdapter } from "./AzureBlobStorageAdapter";
import { ImgBBStorageAdapter } from "./ImgBBStorageAdapter";
import { HttpError } from "../../errors/HttpError";

let instance: StorageAdapter | null = null;

/**
 * Provedor escolhido por STORAGE_PROVIDER ("azure" ou "imgbb"). Sem a variavel:
 * Azure Blob quando ha connection string, senao ImgBB (util em desenvolvimento).
 */
export function resolveStorageProvider(env = process.env): "azure" | "imgbb" {
  const configured = env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (configured === "azure" || configured === "imgbb") return configured;
  if (configured) {
    throw new Error(
      `STORAGE_PROVIDER inválido: "${configured}". Use "azure" ou "imgbb".`,
    );
  }
  return env.AZURE_STORAGE_CONNECTION_STRING ? "azure" : "imgbb";
}

export function getStorageAdapter(): StorageAdapter {
  if (instance) return instance;
  instance =
    resolveStorageProvider() === "imgbb"
      ? new ImgBBStorageAdapter()
      : new AzureBlobStorageAdapter();
  return instance;
}

let privateInstance: StorageAdapter | null = null;

/**
 * Armazenamento PRIVADO (documentos de identidade): container sem leitura
 * publica, acessivel so por URL assinada. Exige Azure Blob: o ImgBB e
 * publico e nunca pode guardar documentos.
 */
export function getPrivateStorageAdapter(): StorageAdapter {
  if (privateInstance) return privateInstance;
  if (!process.env.AZURE_STORAGE_CONNECTION_STRING) {
    throw new HttpError(
      503,
      "Armazenamento seguro indisponível. Tente novamente mais tarde.",
    );
  }
  privateInstance = new AzureBlobStorageAdapter(
    process.env.AZURE_PRIVATE_CONTAINER || "delbicos-private",
    true,
  );
  return privateInstance;
}

/** Somente para testes. */
export function resetStorageAdapter(): void {
  instance = null;
  privateInstance = null;
}
