module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  roots: ["<rootDir>/src"],
  testMatch: ["**/__tests__/**/*.test.ts"],
  collectCoverage: true,
  coverageDirectory: "coverage",
  coverageProvider: "v8",
  clearMocks: true,

  // ⚙️ Opções globais (fora de projects)
  testTimeout: 60000,
  forceExit: true,
  detectOpenHandles: false,

  // Projetos separados: unit (sem banco) e integration (requer banco)
  projects: [
    // ─── UNIT ─────────────────────────────────────
    {
      displayName: "unit",
      preset: "ts-jest",
      testEnvironment: "node",
      roots: ["<rootDir>/src"],
      testMatch: ["**/__tests__/**/*.test.ts"],
      testPathIgnorePatterns: ["/integration/", "/node_modules/"],
      clearMocks: true,
    },

    // ─── INTEGRATION ──────────────────────────────
    {
      displayName: "integration",
      preset: "ts-jest",
      testEnvironment: "node",
      roots: ["<rootDir>/src"],
      testMatch: ["**/integration/**/*.test.ts"],
      testPathIgnorePatterns: [
        "/node_modules/",
        // Este teste usa sync({ force: true }) e conflita com o schema das migrations
        "appointmentSchedule.test.ts",
      ],
      clearMocks: true,
      // ✅ Setup global (conecta/desconecta do Postgres de teste)
      setupFilesAfterEnv: ["<rootDir>/src/__tests__/setup.ts"],
      // ✅ Roda 1 por vez (evita conflito de porta e de banco)
      maxWorkers: 1,
    },
  ],

  // Cobertura
  collectCoverageFrom: [
    "src/**/*.{ts,tsx}",
    "!src/**/*.d.ts",
    "!src/**/__tests__/**",
    "!src/migrations/**",
    "!src/seeders/**",
    "!src/config/**",
    "!src/jobs/**",
  ],
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80,
    },
  },
};