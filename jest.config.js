module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  testMatch: [
    "**/__tests__/**/*.test.ts",
    "**/tests/**/*.test.ts",
  ],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  clearMocks: true,
  // Projetos separados: unit (sem banco) e integration (requer banco)
  projects: [
    {
      displayName: "unit",
      preset: "ts-jest",
      testEnvironment: "node",
      roots: ["<rootDir>/src"],
      testMatch: ["**/__tests__/**/*.test.ts"],
      clearMocks: true,
      setupFiles: ["<rootDir>/tests/setup/env.ts"],
      setupFilesAfterEnv: ["<rootDir>/tests/setup/afterEnv.ts"],
      moduleNameMapper: {
        "^(?:.*[\\\\/])?config/database(?:\\.ts)?$":
          "<rootDir>/tests/mocks/database.ts",
      },
    },
    {
      displayName: "integration",
      preset: "ts-jest",
      testEnvironment: "node",
      roots: ["<rootDir>/tests"],
      testMatch: ["**/tests/**/*.test.ts"],
      clearMocks: true,
    },
  ],
};
