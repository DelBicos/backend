const mockGenerateSasUrl = jest.fn();
const mockCreateIfNotExists = jest.fn();
const mockListBlobsFlat = jest.fn();
const mockDeleteIfExists = jest.fn();
const mockGetBlockBlobClient = jest.fn();

jest.mock("@azure/storage-blob", () => ({
  BlobSASPermissions: { parse: (p: string) => ({ perms: p }) },
  BlobServiceClient: {
    fromConnectionString: jest.fn(() => ({
      getContainerClient: jest.fn(() => ({
        createIfNotExists: mockCreateIfNotExists,
        getBlockBlobClient: mockGetBlockBlobClient,
        listBlobsFlat: mockListBlobsFlat,
      })),
    })),
  },
}));
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import { AzureBlobStorageAdapter } from "../AzureBlobStorageAdapter";

beforeEach(() => {
  jest.clearAllMocks();
  process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
  mockCreateIfNotExists.mockResolvedValue({});
  mockGenerateSasUrl.mockResolvedValue("https://conta.blob.core.windows.net/c/k.png?sig=abc");
  mockGetBlockBlobClient.mockReturnValue({
    url: "https://conta.blob.core.windows.net/c/avatars/1/k.png",
    generateSasUrl: mockGenerateSasUrl,
    deleteIfExists: mockDeleteIfExists,
  });
});

describe("AzureBlobStorageAdapter", () => {
  it("gera URL de upload de escrita curta, URL publica e cabecalhos exigidos", async () => {
    const adapter = new AzureBlobStorageAdapter();
    const result = await adapter.generateUploadUrl("avatars/1/k.png", "image/png");

    expect(mockGetBlockBlobClient).toHaveBeenCalledWith("avatars/1/k.png");
    const options = mockGenerateSasUrl.mock.calls[0][0];
    expect(options.permissions).toEqual({ perms: "cw" });
    const ttl = options.expiresOn.getTime() - Date.now();
    expect(ttl).toBeGreaterThan(4 * 60_000);
    expect(ttl).toBeLessThanOrEqual(5 * 60_000);
    expect(options.startsOn.getTime()).toBeLessThan(Date.now());

    expect(result.uploadUrl).toContain("sig=");
    expect(result.fileUrl).toBe("https://conta.blob.core.windows.net/c/avatars/1/k.png");
    expect(result.uploadHeaders).toEqual({
      "x-ms-blob-type": "BlockBlob",
      "Content-Type": "image/png",
    });
  });

  it("cria o container com leitura publica so uma vez", async () => {
    const adapter = new AzureBlobStorageAdapter();
    await adapter.generateUploadUrl("a.png", "image/png");
    await adapter.generateUploadUrl("b.png", "image/png");
    expect(mockCreateIfNotExists).toHaveBeenCalledTimes(1);
    expect(mockCreateIfNotExists).toHaveBeenCalledWith({ access: "blob" });
  });

  it("se a conta nao permite acesso publico, cria o container privado", async () => {
    mockCreateIfNotExists.mockRejectedValueOnce(new Error("public access not permitted"));
    const adapter = new AzureBlobStorageAdapter();
    await expect(adapter.generateUploadUrl("a.png", "image/png")).resolves.toBeDefined();
    expect(mockCreateIfNotExists).toHaveBeenLastCalledWith();
  });

  it("URL de leitura assinada e somente leitura", async () => {
    const adapter = new AzureBlobStorageAdapter();
    await adapter.getFileUrl("avatars/1/k.png");
    expect(mockGenerateSasUrl.mock.calls[0][0].permissions).toEqual({ perms: "r" });
  });

  it("lista os arquivos do container", async () => {
    const date = new Date();
    mockListBlobsFlat.mockReturnValue(
      (async function* () {
        yield { name: "a.png", properties: { contentLength: 10, lastModified: date } };
      })(),
    );
    const adapter = new AzureBlobStorageAdapter();
    await expect(adapter.listFiles()).resolves.toEqual([
      { name: "a.png", size: 10, lastModified: date },
    ]);
  });

  it("falha com mensagem clara sem connection string", async () => {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    const adapter = new AzureBlobStorageAdapter();
    await expect(adapter.generateUploadUrl("a.png", "image/png")).rejects.toThrow(
      /AZURE_STORAGE_CONNECTION_STRING/,
    );
  });

  it("container privado: cria sem acesso publico e apaga arquivos", async () => {
    const adapter = new AzureBlobStorageAdapter("delbicos-private", true);
    await adapter.deleteFile("identity/1/a.jpg");

    expect(mockCreateIfNotExists).toHaveBeenCalledWith();
    expect(mockGetBlockBlobClient).toHaveBeenCalledWith("identity/1/a.jpg");
    expect(mockDeleteIfExists).toHaveBeenCalled();
  });
});
