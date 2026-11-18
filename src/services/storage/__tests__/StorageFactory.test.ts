import {
  getPrivateStorageAdapter,
  resetStorageAdapter,
  resolveStorageProvider,
} from "../StorageFactory";

describe("resolveStorageProvider", () => {
  it("respeita STORAGE_PROVIDER explicito", () => {
    expect(resolveStorageProvider({ STORAGE_PROVIDER: "azure" } as any)).toBe("azure");
    expect(resolveStorageProvider({ STORAGE_PROVIDER: " ImgBB " } as any)).toBe("imgbb");
  });

  it("sem variavel: Azure se ha connection string, senao ImgBB", () => {
    expect(
      resolveStorageProvider({ AZURE_STORAGE_CONNECTION_STRING: "UseDevelopmentStorage=true" } as any),
    ).toBe("azure");
    expect(resolveStorageProvider({} as any)).toBe("imgbb");
  });

  it("recusa provedor desconhecido, inclusive o antigo s3", () => {
    expect(() => resolveStorageProvider({ STORAGE_PROVIDER: "s3" } as any)).toThrow(/inválido/);
  });
});

describe("getPrivateStorageAdapter", () => {
  const original = process.env.AZURE_STORAGE_CONNECTION_STRING;
  afterEach(() => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = original;
    resetStorageAdapter();
  });

  it("recusa (503) sem Azure: o ImgBB e publico e nao guarda documentos", () => {
    delete process.env.AZURE_STORAGE_CONNECTION_STRING;
    expect(() => getPrivateStorageAdapter()).toThrow(/indisponível/);
  });

  it("usa o Azure quando ha connection string", () => {
    process.env.AZURE_STORAGE_CONNECTION_STRING = "UseDevelopmentStorage=true";
    expect(getPrivateStorageAdapter()).toBe(getPrivateStorageAdapter());
  });
});
