import request from "supertest";
import type { Express } from "express";

jest.mock("../config/database");

let app: Express;

beforeAll(() => {
  process.env.SECRET_KEY = "test-secret-with-at-least-32-characters!!";
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy";
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  app = require("../app").createApp();
});

describe("createApp", () => {
  it("responde /health", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("aplica headers de seguranca e oculta x-powered-by", async () => {
    const res = await request(app).get("/health");
    expect(res.headers["x-powered-by"]).toBeUndefined();
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("retorna 404 em JSON para rota inexistente", async () => {
    const res = await request(app).get("/api/nao-existe");
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Rota não encontrada/);
  });

  it("retorna 400 para JSON malformado", async () => {
    const res = await request(app)
      .post("/api/user/login")
      .set("Content-Type", "application/json")
      .send("{invalido");
    expect(res.status).toBe(400);
  });

  it("rejeita token assinado com outro segredo", async () => {
    const jwt = require("jsonwebtoken");
    const forged = jwt.sign({ user: { id: 1 } }, "secret");
    const res = await request(app)
      .get("/api/user/me")
      .set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(403);
  });

  it("exige autenticacao para listar agendamentos de um usuario", async () => {
    const res = await request(app).get("/api/appointments/user/1");
    expect(res.status).toBe(401);
  });
});
