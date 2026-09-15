import {
  rankSemanticCandidates,
  SemanticSearchUnavailableError,
} from "../semanticSearch.service";

describe("rankSemanticCandidates", () => {
  const originalFetch = (global as any).fetch;

  afterEach(() => {
    (global as any).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("envia os candidatos ao nlp-service e mantém somente resultados válidos", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        results: [
          { id: 2, score: 0.87 },
          { id: 999, score: 0.99 },
          { id: 2, score: 0.7 },
        ],
      }),
    });
    (global as any).fetch = fetchMock;

    const results = await rankSemanticCandidates("montar um armário", [
      { id: 1, text: "Limpeza residencial" },
      { id: 2, text: "Montagem de móveis" },
    ]);

    expect(results).toEqual([{ id: 2, score: 0.87 }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/semantic-search$/),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("falha de forma controlada quando o nlp-service não está disponível", async () => {
    (global as any).fetch = jest.fn().mockRejectedValue(new Error("connection refused"));

    await expect(
      rankSemanticCandidates("montar um armário", [{ id: 2, text: "Montagem" }]),
    ).rejects.toBeInstanceOf(SemanticSearchUnavailableError);
  });

  it("processa lotes grandes em sequência para não sobrecarregar o nlp-service", async () => {
    let resolveFirstResponse!: (value: unknown) => void;
    const firstResponse = new Promise((resolve) => { resolveFirstResponse = resolve; });
    const fetchMock = jest
      .fn()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    (global as any).fetch = fetchMock;

    const candidates = Array.from({ length: 501 }, (_, index) => ({
      id: index + 1,
      text: `Serviço ${index + 1}`,
    }));
    const ranking = rankSemanticCandidates("montagem", candidates);
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    resolveFirstResponse({ ok: true, json: async () => ({ results: [] }) });
    await expect(ranking).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
