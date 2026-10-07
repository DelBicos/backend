import {
  BlobSASPermissions,
  BlobServiceClient,
  ContainerClient,
} from "@azure/storage-blob";
import { StorageAdapter, UploadUrlResult } from "./StorageAdapter";
import logger from "../../utils/logger";

import { errorMessage } from "../../utils/errors.util";
/** Validade da URL de upload (o app usa logo em seguida). */
const UPLOAD_URL_TTL_MS = 5 * 60 * 1000;
/** Validade da URL de leitura assinada. */
const READ_URL_TTL_MS = 60 * 60 * 1000;
/** Tolerancia de relogio entre servidor e Azure. */
const CLOCK_SKEW_MS = 5 * 60 * 1000;
const LIST_LIMIT = 500;

/**
 * Armazenamento de imagens no Azure Blob Storage.
 *
 * O backend nunca recebe o arquivo: gera uma URL SAS de curta duracao, de
 * escrita para UM blob (nome definido pelo servidor), e o app envia direto
 * para a Azure. A leitura e publica no nivel de blob do container.
 *
 * Variaveis: AZURE_STORAGE_CONNECTION_STRING (obrigatoria) e
 * AZURE_STORAGE_CONTAINER (padrao "delbicos-uploads").
 */
export class AzureBlobStorageAdapter implements StorageAdapter {
  private container: ContainerClient | null = null;
  private ready: Promise<ContainerClient> | null = null;

  /**
   * @param containerName Container usado (padrao: AZURE_STORAGE_CONTAINER).
   * @param isPrivate Sem leitura publica: arquivos so abrem por URL assinada.
   */
  constructor(
    private readonly containerName?: string,
    private readonly isPrivate = false,
  ) {}

  private getContainer(): Promise<ContainerClient> {
    if (this.ready) return this.ready;

    const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
    if (!connectionString) {
      return Promise.reject(
        new Error("AZURE_STORAGE_CONNECTION_STRING não configurada"),
      );
    }
    const name =
      this.containerName || process.env.AZURE_STORAGE_CONTAINER || "delbicos-uploads";

    this.ready = (async () => {
      const service = BlobServiceClient.fromConnectionString(connectionString);
      const container = service.getContainerClient(name);
      if (this.isPrivate) {
        await container.createIfNotExists();
        this.container = container;
        return container;
      }
      try {
        // Leitura publica so dos blobs (nao lista o container).
        await container.createIfNotExists({ access: "blob" });
      } catch (error) {
        // Contas com acesso publico desativado recusam; cria privado e avisa.
        logger.warn(
          "Container criado sem leitura pública (acesso público desativado na conta?)",
          { reason: errorMessage(error) },
        );
        await container.createIfNotExists();
      }
      this.container = container;
      return container;
    })().catch((error) => {
      this.ready = null; // permite tentar de novo na proxima chamada
      throw error;
    });

    return this.ready;
  }

  async generateUploadUrl(
    fileName: string,
    fileType: string,
  ): Promise<UploadUrlResult> {
    const container = await this.getContainer();
    const blob = container.getBlockBlobClient(fileName);
    const now = Date.now();
    const uploadUrl = await blob.generateSasUrl({
      permissions: BlobSASPermissions.parse("cw"),
      startsOn: new Date(now - CLOCK_SKEW_MS),
      expiresOn: new Date(now + UPLOAD_URL_TTL_MS),
    });
    return {
      uploadUrl,
      fileUrl: blob.url,
      uploadHeaders: {
        "x-ms-blob-type": "BlockBlob",
        "Content-Type": fileType,
      },
    };
  }

  async getFileUrl(key: string): Promise<string> {
    const container = await this.getContainer();
    return container.getBlockBlobClient(key).generateSasUrl({
      permissions: BlobSASPermissions.parse("r"),
      startsOn: new Date(Date.now() - CLOCK_SKEW_MS),
      expiresOn: new Date(Date.now() + READ_URL_TTL_MS),
    });
  }

  async deleteFile(key: string): Promise<void> {
    const container = await this.getContainer();
    await container.getBlockBlobClient(key).deleteIfExists();
  }

  async listFiles() {
    const container = await this.getContainer();
    const files: {
      name: string | undefined;
      size: number | undefined;
      lastModified: Date | undefined;
    }[] = [];
    for await (const blob of container.listBlobsFlat()) {
      files.push({
        name: blob.name,
        size: blob.properties.contentLength,
        lastModified: blob.properties.lastModified,
      });
      if (files.length >= LIST_LIMIT) break;
    }
    return files;
  }
}
