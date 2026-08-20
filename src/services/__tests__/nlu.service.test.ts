import { analyzeMessage, isRestartCommand } from "../nlu.service";

describe("analyzeMessage", () => {
  const originalFetch = (global as any).fetch;

  function mockClassifier(intent: string, confidence = 0.92) {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        intent,
        confidence,
        model_version: "tfidf-linearsvc-test",
      }),
    });
    (global as any).fetch = fetchMock;
    return fetchMock;
  }

  afterEach(() => {
    (global as any).fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it("usa o classificador SVM interno e extrai entidades por regras", async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        intent: "AGENDAR",
        confidence: 0.92,
        model_version: "tfidf-linearsvc-test",
      }),
    });
    (global as any).fetch = fetchMock;

    const result = await analyzeMessage(
      "Preciso de uma pintura amanhã às 14:30",
    );

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/classify$/),
      expect.objectContaining({ method: "POST" }),
    );
    expect(result.intent).toBe("AGENDAR");
    expect(result.confidence).toBe(0.92);
    expect(result.entities.service).toBe("pintura");
    expect(result.entities.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.entities.time).toBe("14:30");
  });

  it.each(["sim", "Confirmar!", "confirmo", "pode ser", "fechado", "aceito"])(
    "não chama o classificador para a confirmação estruturada: %s",
    async (message) => {
      const fetchMock = jest.fn();
      (global as any).fetch = fetchMock;

      const result = await analyzeMessage(message);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toEqual({
        intent: "FALLBACK",
        entities: {},
        confidence: 1,
      });
    },
  );

  it.each([
    ["quero agendar", "AGENDAR"],
    ["pode cancelar meu agendamento", "CANCELAR"],
    ["desistir", "CANCELAR"],
    ["quero trocar o horário", "ALTERAR"],
    ["mostrar meus agendamentos", "CONSULTAR"],
    ["olá", "SAUDACAO"],
    ["Ol", "SAUDACAO"],
    ["oi", "SAUDACAO"],
  ])(
    "classifica pelo SVM e valida por regra o comando inequívoco: %s",
    async (message, intent) => {
      const fetchMock = mockClassifier(intent);

      const result = await analyzeMessage(message);

      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringMatching(/\/classify$/),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ text: message }),
        }),
      );
      expect(result.intent).toBe(intent);
      expect(result.confidence).toBe(0.92);
    },
  );

  it("usa a regra como override após consultar o SVM", async () => {
    const fetchMock = mockClassifier("FALLBACK", 0.4);

    const result = await analyzeMessage("quero agendar");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.intent).toBe("AGENDAR");
    expect(result.confidence).toBe(1);
  });

  it.each([
    "quero agenda",
    "eu queria agenda",
    "gostaria de agenda",
    "quero ageda",
    "quero agedar",
    "quero ajendar",
    "quero agendr",
    "quero fazer um agendamento",
  ])(
    "tolera flexão ou erro simples ao pedir agendamento: %s",
    async (message) => {
      mockClassifier("FALLBACK", 0.4);

      const result = await analyzeMessage(message);

      expect(result.intent).toBe("AGENDAR");
      expect(result.confidence).toBe(1);
      expect(result.entities.service).toBeUndefined();
    },
  );

  it.each([
    ["quero agenda limpeza", "limpeza"],
    ["quero ageda montagem de móveis", "montagem de móveis"],
    ["quero fazer um agendamento de pintura", "pintura"],
  ])("separa a ação digitada do serviço: %s", async (message, service) => {
    mockClassifier("FALLBACK", 0.4);

    const result = await analyzeMessage(message);

    expect(result.intent).toBe("AGENDAR");
    expect(result.entities.service).toBe(service);
  });

  it.each([
    "quero ver minha agenda",
    "consultar agenda",
    "mostre minha agenda",
    "quero consultar agendamento",
    "quero consultar um agendamento",
    "quero conferir um agendamento",
    "quero acompanhar meu agendamento",
  ])("mantém pedidos de consulta fora de AGENDAR: %s", async (message) => {
    mockClassifier("FALLBACK", 0.4);

    const result = await analyzeMessage(message);

    expect(result.intent).toBe("CONSULTAR");
  });

  it.each(["quero atender agora", "a agenda cultural foi publicada"])(
    "não aplica correção aproximada fora de um pedido de agendamento: %s",
    async (message) => {
      mockClassifier("FALLBACK", 0.4);

      const result = await analyzeMessage(message);

      expect(result.intent).toBe("FALLBACK");
    },
  );

  it.each([
    ["quero agendar limpeza na minha agenda", "limpeza"],
    ["quero agendar minha agenda", undefined],
    ["quero agenda para amanhã", undefined],
    ["quero um agendamento de limpeza", "limpeza"],
    ["quero novo agendamento", undefined],
    ["quero fazer um novo agendamento", undefined],
    ["quero iniciar um novo agendamento", undefined],
    ["quero marcar limpeza na agenda", "limpeza"],
    ["oi quero agenda", undefined],
    ["olá, quero agenda pintura", "pintura"],
  ])(
    "prioriza a ação e limpa qualificadores/preposições: %s",
    async (message, service) => {
      mockClassifier("FALLBACK", 0.4);

      const result = await analyzeMessage(message);

      expect(result.intent).toBe("AGENDAR");
      expect(result.entities.service).toBe(service);
    },
  );

  it("usa a correção de português mesmo sem o classificador", async () => {
    (global as any).fetch = jest
      .fn()
      .mockRejectedValue(new Error("connection refused"));

    const result = await analyzeMessage("quero agenda");

    expect(result).toEqual({
      intent: "AGENDAR",
      entities: {},
      confidence: 1,
    });
  });

  it.each(["Ol", "oi", "Oi!"])(
    "corrige pelo padrão explícito a saudação curta: %s",
    async (message) => {
      mockClassifier("FALLBACK", 0.4);

      const result = await analyzeMessage(message);

      expect(result.intent).toBe("SAUDACAO");
      expect(result.confidence).toBe(1);
    },
  );

  it("usa a regra como contingência quando o classificador está indisponível", async () => {
    const fetchMock = jest
      .fn()
      .mockRejectedValue(new Error("connection refused"));
    (global as any).fetch = fetchMock;

    const result = await analyzeMessage("mostrar meus agendamentos");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      intent: "CONSULTAR",
      entities: {},
      confidence: 1,
    });
  });

  it("não interpreta o verbo agendar como nome de serviço", async () => {
    const fetchMock = mockClassifier("AGENDAR");

    const result = await analyzeMessage("quero agendar");

    expect(result.intent).toBe("AGENDAR");
    expect(result.entities.service).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each(["quero agendar,", "quero agendar,&#x20;"])(
    "não interpreta espaço ou entidade HTML como serviço: %s",
    async (message) => {
      mockClassifier("AGENDAR");

      const result = await analyzeMessage(message);

      expect(result.intent).toBe("AGENDAR");
      expect(result.entities.service).toBeUndefined();
    },
  );

  it("não interpreta uma resposta de data como nome de serviço", async () => {
    mockClassifier("AGENDAR");

    const result = await analyzeMessage("quero segunda");

    expect(result.intent).toBe("AGENDAR");
    expect(result.entities.service).toBeUndefined();
  });

  it("extrai data por extenso e período sem confundir com o serviço", async () => {
    const fetchMock = mockClassifier("AGENDAR");

    const result = await analyzeMessage(
      "quero agendar limpeza dia treze de agosto de manhã",
    );

    expect(result.intent).toBe("AGENDAR");
    expect(result.entities.service).toBe("limpeza");
    expect(result.entities.date).toMatch(/^\d{4}-08-13$/);
    expect(result.entities.time_period).toBe("MORNING");
    expect(result.entities.time).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("extrai dia da semana abreviado e horário coloquial", async () => {
    const fetchMock = mockClassifier("AGENDAR");

    const result = await analyzeMessage(
      "quero agendar limpeza sex que vem às duas e meia da tarde",
    );

    expect(result.intent).toBe("AGENDAR");
    expect(result.entities.service).toBe("limpeza");
    expect(result.entities.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(result.entities.time).toBe("14:30");
    expect(result.entities.time_period).toBe("AFTERNOON");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('extrai "duas e meia" como horário sem inventar uma data', async () => {
    const fetchMock = mockClassifier("AGENDAR");

    const result = await analyzeMessage("duas e meia");

    expect(result.entities.time).toBe("02:30");
    expect(result.entities.date).toBeUndefined();
    expect(result.entities.service).toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    "reiniciar",
    "recomeçar",
    "começar de novo",
    "novo atendimento",
    "limpar conversa",
    "voltar ao início",
  ])("identifica o comando de reinício: %s", (message) => {
    expect(isRestartCommand(message)).toBe(true);
  });

  it("retorna fallback quando o classificador responde com intenção inválida", async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ intent: "RESERVAR", confidence: 0.9 }),
    });

    const result = await analyzeMessage("pode me ajudar");

    expect(result).toEqual({
      intent: "FALLBACK",
      entities: {},
      confidence: 0.9,
    });
  });
});
