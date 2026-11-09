jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

import type { BlobServiceClient } from "@azure/storage-blob";
import logger from "../../../utils/logger";
import { ensureBlobCors, webOrigins } from "../blobCors";

const env = { ALLOWED_ORIGINS: "https://azure.delbicos.com.br/, https://www.delbicos.com.br" };

const rule = (allowedOrigins: string, allowedMethods = "PUT,OPTIONS") => ({
  allowedOrigins,
  allowedMethods,
  allowedHeaders: "*",
  exposedHeaders: "",
  maxAgeInSeconds: 60,
});

function fakeService(cors: ReturnType<typeof rule>[] | undefined) {
  const getProperties = jest.fn().mockResolvedValue({ cors });
  const setProperties = jest.fn().mockResolvedValue({});
  const service = { getProperties, setProperties } as unknown as BlobServiceClient;
  return { service, getProperties, setProperties };
}

describe("blobCors", () => {
  it("normaliza as origens de ALLOWED_ORIGINS", () => {
    expect(webOrigins(env)).toEqual([
      "https://azure.delbicos.com.br",
      "https://www.delbicos.com.br",
    ]);
    expect(webOrigins({})).toEqual([]);
  });

  it("cria a regra de PUT para as origens do site quando nao ha nenhuma", async () => {
    const { service, setProperties } = fakeService(undefined);
    await ensureBlobCors(service, env);

    expect(setProperties).toHaveBeenCalledTimes(1);
    const { cors } = setProperties.mock.calls[0][0];
    expect(Object.keys(setProperties.mock.calls[0][0])).toEqual(["cors"]);
    expect(cors).toHaveLength(1);
    expect(cors[0].allowedOrigins).toBe(
      "https://azure.delbicos.com.br,https://www.delbicos.com.br",
    );
    expect(cors[0].allowedMethods).toContain("PUT");
    expect(cors[0].allowedHeaders).toContain("x-ms-*");
  });

  it("mantem as regras existentes e acrescenta so a origem que falta", async () => {
    const existing = rule("https://www.delbicos.com.br");
    const { service, setProperties } = fakeService([existing]);
    await ensureBlobCors(service, env);

    const { cors } = setProperties.mock.calls[0][0];
    expect(cors[0]).toEqual(existing);
    expect(cors[1].allowedOrigins).toBe("https://azure.delbicos.com.br");
  });

  it("nao altera nada quando as origens ja estao cobertas", async () => {
    const { service, setProperties } = fakeService([rule("*")]);
    await ensureBlobCors(service, env);
    expect(setProperties).not.toHaveBeenCalled();
  });

  it("regra sem PUT nao conta como cobertura", async () => {
    const { service, setProperties } = fakeService([
      rule("https://azure.delbicos.com.br,https://www.delbicos.com.br", "GET"),
    ]);
    await ensureBlobCors(service, env);
    expect(setProperties).toHaveBeenCalledTimes(1);
  });

  it("sem ALLOWED_ORIGINS nao consulta a conta", async () => {
    const { service, getProperties } = fakeService([]);
    await ensureBlobCors(service, {});
    expect(getProperties).not.toHaveBeenCalled();
  });

  it("no limite de regras, avisa e nao sobrescreve", async () => {
    const full = Array.from({ length: 5 }, (_, i) => rule(`https://outro${i}.com`));
    const { service, setProperties } = fakeService(full);
    await ensureBlobCors(service, env);
    expect(setProperties).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("falha da conta vira aviso, sem lancar erro", async () => {
    const { service, getProperties } = fakeService([]);
    getProperties.mockRejectedValue(new Error("AuthorizationFailure"));
    await expect(ensureBlobCors(service, env)).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalled();
  });
});
