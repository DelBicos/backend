jest.mock("dotenv", () => ({ config: jest.fn() }));

import * as dotenv from "dotenv";

describe("config/loadEnv", () => {
  it("carrega o .env sem sobrescrever variaveis do ambiente", () => {
    jest.isolateModules(() => {
      require("../loadEnv");
    });
    expect(dotenv.config).toHaveBeenCalledWith({ override: false });
  });
});
