import { sendViaAzureFunction } from "../azureEmailFunction";

describe("sendViaAzureFunction", () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AZURE_FUNCTION_URL;
    delete process.env.AZURE_FUNCTION_KEY;
    delete process.env.AZURE_FUNCTION_TIMEOUT_MS;
    process.env.NODE_ENV = "test";
    delete process.env.ENVIRONMENT;
    consoleErrorSpy = jest.spyOn(console, "error").mockImplementation();
  });

  afterEach(() => {
    jest.useRealTimers();
    global.fetch = originalFetch;
    process.env = { ...originalEnv };
    consoleErrorSpy.mockRestore();
  });

  it("envia o contrato esperado com a function key em header", async () => {
    process.env.AZURE_FUNCTION_URL =
      "https://email-function.example.test/api/send-email";
    process.env.AZURE_FUNCTION_KEY = "function-secret";
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as typeof fetch;

    await expect(
      sendViaAzureFunction({
        to: "destinatario@example.com",
        subject: "Assunto",
        html: "<p>Mensagem</p>",
      }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith(
      process.env.AZURE_FUNCTION_URL,
      expect.objectContaining({
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-functions-key": "function-secret",
        },
        body: JSON.stringify({
          to: "destinatario@example.com",
          subject: "Assunto",
          body: "<p>Mensagem</p>",
        }),
        signal: expect.any(AbortSignal),
      }),
    );
  });

  it("permite execução local sem function key", async () => {
    process.env.AZURE_FUNCTION_URL = "http://localhost:7071/api/send-email";
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });
    global.fetch = fetchMock as typeof fetch;

    await expect(
      sendViaAzureFunction({
        to: "destinatario@example.com",
        subject: "Assunto",
        html: "Mensagem",
      }),
    ).resolves.toBe(true);

    expect(fetchMock.mock.calls[0][1].headers).toEqual({
      "Content-Type": "application/json",
    });
  });

  it("retorna false e registra respostas não-2xx", async () => {
    process.env.AZURE_FUNCTION_URL = "https://email-function.example.test";
    process.env.AZURE_FUNCTION_KEY = "secret";
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 502,
      text: async () => '{"error":"SMTP indisponível"}',
    }) as typeof fetch;

    await expect(
      sendViaAzureFunction({
        to: "destinatario@example.com",
        subject: "Assunto",
        html: "Mensagem",
      }),
    ).resolves.toBe(false);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Azure Function de e-mail respondeu com status 502",
    );
  });

  it("falha de forma controlada quando a URL não está configurada", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;

    await expect(
      sendViaAzureFunction({
        to: "destinatario@example.com",
        subject: "Assunto",
        html: "Mensagem",
      }),
    ).resolves.toBe(false);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("interrompe a requisição ao atingir o timeout configurado", async () => {
    jest.useFakeTimers();
    process.env.AZURE_FUNCTION_URL = "https://email-function.example.test";
    process.env.AZURE_FUNCTION_KEY = "secret";
    process.env.AZURE_FUNCTION_TIMEOUT_MS = "50";
    global.fetch = jest.fn().mockImplementation((_url, options) => {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }) as typeof fetch;

    const result = sendViaAzureFunction({
      to: "destinatario@example.com",
      subject: "Assunto",
      html: "Mensagem",
    });
    jest.advanceTimersByTime(50);

    await expect(result).resolves.toBe(false);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Timeout ao chamar Azure Function de e-mail após 50ms",
    );
  });

  it.each([401, 500, 503])("trata HTTP %s sem repetir o envio", async (status) => {
    process.env.AZURE_FUNCTION_URL = "https://email-function.example.test/api/send-email";
    process.env.AZURE_FUNCTION_KEY = "secret";
    const fetchMock = jest.fn().mockResolvedValue({ ok: false, status });
    global.fetch = fetchMock;
    await expect(sendViaAzureFunction({ to: "user@example.com", subject: "Teste", html: "Mensagem" })).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["https://email-function.example.test", ""],
    ["http://email-function.example.test", "secret"],
    ["https://email-function.example.test?code=secret", "secret"],
    ["not-a-url", "secret"],
  ])("recusa configuração insegura (%s)", async (url, key) => {
    process.env.AZURE_FUNCTION_URL = url;
    process.env.AZURE_FUNCTION_KEY = key;
    const fetchMock = jest.fn();
    global.fetch = fetchMock;
    await expect(sendViaAzureFunction({ to: "user@example.com", subject: "Teste", html: "Mensagem" })).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("não registra detalhes sensíveis de erros de rede nem repete o envio", async () => {
    process.env.AZURE_FUNCTION_URL = "https://email-function.example.test";
    process.env.AZURE_FUNCTION_KEY = "secret";
    const fetchMock = jest.fn().mockRejectedValue(new Error("request contains secret and user@example.com"));
    global.fetch = fetchMock;
    await expect(sendViaAzureFunction({ to: "user@example.com", subject: "Teste", html: "Mensagem" })).resolves.toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(consoleErrorSpy.mock.calls)).not.toMatch(/secret|user@example/);
  });

  it.each([{ ok: false }, { statusCode: 200 }, null])("exige confirmação de envio no JSON (%p)", async (body) => {
    process.env.AZURE_FUNCTION_URL = "https://email-function.example.test";
    process.env.AZURE_FUNCTION_KEY = "secret";
    global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => body });
    await expect(sendViaAzureFunction({ to: "user@example.com", subject: "Teste", html: "Mensagem" })).resolves.toBe(false);
  });
});
