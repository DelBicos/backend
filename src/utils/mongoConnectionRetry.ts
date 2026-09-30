/** O driver reconecta após uma conexão estabelecida, mas a falha inicial
 * precisa de retentativa explícita. Não iniciar vários loops por conexão.
 */
export async function connectMongoWithRetry(
  connect: () => Promise<unknown>,
  label: string,
): Promise<void> {
  let delayMs = 5000;
  let attempt = 0;
  for (;;) {
    try {
      await connect();
      return;
    } catch (error) {
      attempt += 1;
      console.warn(
        `⚠️ ${label}: conexão inicial falhou (tentativa ${attempt}). Nova tentativa em ${delayMs / 1000}s.`,
        error instanceof Error ? error.name : "Erro desconhecido",
      );
      await new Promise<void>((resolve) => {
        // A espera não deve manter um processo encerrado artificialmente ativo.
        const timer = setTimeout(resolve, delayMs);
        timer.unref();
      });
      delayMs = Math.min(delayMs * 2, 30000);
    }
  }
}
