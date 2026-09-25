interface EmailPayload {
  to: string;
  subject: string;
  html: string;
}

const DEFAULT_TIMEOUT_MS = 20_000;

function getTimeoutMs(): number {
  const configuredTimeout = Number(process.env.AZURE_FUNCTION_TIMEOUT_MS);

  if (
    !Number.isInteger(configuredTimeout) ||
    configuredTimeout <= 0 ||
    configuredTimeout > 120_000
  ) {
    return DEFAULT_TIMEOUT_MS;
  }

  return configuredTimeout;
}

export async function sendViaAzureFunction(
  payload: EmailPayload,
): Promise<boolean> {
  const functionUrl = process.env.AZURE_FUNCTION_URL?.trim();
  const functionKey = process.env.AZURE_FUNCTION_KEY?.trim();

  if (!functionUrl) {
    console.error(
      "Fallback de e-mail não configurado: AZURE_FUNCTION_URL ausente",
    );
    return false;
  }

  let endpoint: URL;
  try {
    endpoint = new URL(functionUrl);
  } catch {
    console.error("AZURE_FUNCTION_URL inválida");
    return false;
  }
  const localDevelopment =
    process.env.NODE_ENV !== "production" &&
    process.env.ENVIRONMENT !== "production" &&
    ["localhost", "127.0.0.1", "[::1]"].includes(endpoint.hostname);
  if (
    (!localDevelopment && (endpoint.protocol !== "https:" || !functionKey)) ||
    !["https:", "http:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    console.error(
      "Configure HTTPS e AZURE_FUNCTION_KEY separada da URL para a Azure Function",
    );
    return false;
  }

  const timeoutMs = getTimeoutMs();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (functionKey) {
      headers["x-functions-key"] = functionKey;
    }

    const response = await fetch(functionUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: payload.to,
        subject: payload.subject,
        body: payload.html,
      }),
      signal: controller.signal,
      redirect: "error",
    });

    if (response.ok) {
      const result: unknown = await response.json();
      return (
        typeof result === "object" &&
        result !== null &&
        "ok" in result &&
        result.ok === true
      );
    }

    await response.body?.cancel();
    console.error(
      `Azure Function de e-mail respondeu com status ${response.status}`,
    );
    return false;
  } catch {
    if (controller.signal.aborted) {
      console.error(
        `Timeout ao chamar Azure Function de e-mail após ${timeoutMs}ms`,
      );
      return false;
    }

    // Erros do fetch podem conter a URL, headers e dados da mensagem.
    console.error(
      "Falha de rede ou resposta inválida da Azure Function de e-mail",
    );
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
