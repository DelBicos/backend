/** @type {import('jest').Config} */
const base = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  clearMocks: true,
};

// Testes de integracao usam um PostgreSQL local descartavel (banco pr2_test).
// So entram quando PR2_TEST_DATABASE_URL estiver definida.
const withIntegration = Boolean(process.env.PR2_TEST_DATABASE_URL);

module.exports = {
  // Cobertura calculada sobre TODO o codigo-fonte, nao so sobre os arquivos
  // importados pelos testes (senao o percentual fica artificialmente alto).
  collectCoverageFrom: [
    "src/**/*.ts",
    "!src/**/__tests__/**",
    "!src/**/__mocks__/**",
    "!src/**/*.d.ts",
  ],
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  coverageReporters: ["text-summary", "lcov"],
  projects: [
    {
      ...base,
      displayName: "unit",
      testMatch: ["**/__tests__/**/*.test.ts"],
      testPathIgnorePatterns: ["/node_modules/", "/integration/"],
    },
    ...(withIntegration
      ? [
          {
            ...base,
            displayName: "integration",
            testMatch: ["**/integration/**/*.test.ts"],
          },
        ]
      : []),
  ],
};
