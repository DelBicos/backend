import { Request, Response } from "express";
import { testEmailFallback } from "../email.controller";
import { sendViaAzureFunction } from "../../utils/azureEmailFunction";

jest.mock("../../utils/azureEmailFunction", () => ({ sendViaAzureFunction: jest.fn() }));
jest.mock("../../utils/logger", () => ({ __esModule: true, default: { error: jest.fn() } }));

const buildResponse = () => {
  const res = { status: jest.fn(), json: jest.fn() };
  res.status.mockReturnValue(res);
  return res;
};

const validBody = { to: "a@a.com", subject: "Oi", body: "<p>x</p>" };
const req = (body: unknown = validBody) => ({ body }) as unknown as Request;

describe("email.controller - testEmailFallback", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = { ...originalEnv, ENVIRONMENT: "development" };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it("EML-01: fora de development retorna 404", async () => {
    process.env = { ...originalEnv, ENVIRONMENT: "production" };
    const res = buildResponse();
    await testEmailFallback(req(), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(404);
    expect(sendViaAzureFunction).not.toHaveBeenCalled();
  });

  it("EML-02: usa NODE_ENV quando ENVIRONMENT não está definido", async () => {
    process.env = { ...originalEnv, NODE_ENV: "development" };
    delete process.env.ENVIRONMENT;
    (sendViaAzureFunction as jest.Mock).mockResolvedValue(true);
    const res = buildResponse();
    await testEmailFallback(req(), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it.each([
    [{ subject: "a", body: "b" }],
    [{ to: "a", body: "b" }],
    [{ to: "a", subject: "b" }],
    [null],
  ])("EML-03: corpo incompleto %p retorna 400", async (body) => {
    const res = buildResponse();
    await testEmailFallback(req(body), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(400);
  });

  it("EML-04: envio bem-sucedido retorna 200 e mapeia body para html", async () => {
    (sendViaAzureFunction as jest.Mock).mockResolvedValue(true);
    const res = buildResponse();
    await testEmailFallback(req(), res as unknown as Response);
    expect(sendViaAzureFunction).toHaveBeenCalledWith({ to: "a@a.com", subject: "Oi", html: "<p>x</p>" });
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it("EML-05: Azure Function sem sucesso retorna 502", async () => {
    (sendViaAzureFunction as jest.Mock).mockResolvedValue(false);
    const res = buildResponse();
    await testEmailFallback(req(), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(502);
  });

  it("EML-06: exceção no envio retorna 500", async () => {
    (sendViaAzureFunction as jest.Mock).mockRejectedValue(new Error("boom"));
    const res = buildResponse();
    await testEmailFallback(req(), res as unknown as Response);
    expect(res.status).toHaveBeenCalledWith(500);
  });
});
