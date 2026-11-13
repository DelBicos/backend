jest.mock("../storage/S3StorageAdapter", () => ({
  S3StorageAdapter: jest.fn().mockImplementation(() => ({ provider: "s3" })),
}));

jest.mock("../storage/ImgBBStorageAdapter", () => ({
  ImgBBStorageAdapter: jest.fn().mockImplementation(() => ({ provider: "imgbb" })),
}));

describe("getStorageAdapter", () => {
  const original = process.env.STORAGE_PROVIDER;

  afterEach(() => {
    if (original === undefined) delete process.env.STORAGE_PROVIDER;
    else process.env.STORAGE_PROVIDER = original;
    jest.resetModules();
  });

  function load() {
    jest.resetModules();
    return {
      getStorageAdapter: require("../storage/StorageFactory")
        .getStorageAdapter as () => { provider: string },
      S3StorageAdapter: require("../storage/S3StorageAdapter")
        .S3StorageAdapter as jest.Mock,
      ImgBBStorageAdapter: require("../storage/ImgBBStorageAdapter")
        .ImgBBStorageAdapter as jest.Mock,
    };
  }

  it("returns the S3 adapter by default and reuses the same instance", () => {
    delete process.env.STORAGE_PROVIDER;
    const { getStorageAdapter, S3StorageAdapter, ImgBBStorageAdapter } = load();

    const first = getStorageAdapter();
    const second = getStorageAdapter();

    expect(first).toBe(second);
    expect(first.provider).toBe("s3");
    expect(S3StorageAdapter).toHaveBeenCalledTimes(1);
    expect(ImgBBStorageAdapter).not.toHaveBeenCalled();
  });

  it("returns the ImgBB adapter when STORAGE_PROVIDER=imgbb", () => {
    process.env.STORAGE_PROVIDER = "imgbb";
    const { getStorageAdapter, ImgBBStorageAdapter } = load();

    expect(getStorageAdapter().provider).toBe("imgbb");
    expect(ImgBBStorageAdapter).toHaveBeenCalledTimes(1);
  });
});
