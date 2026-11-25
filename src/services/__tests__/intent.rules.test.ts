import {
  classifyClosingMessage,
  extractProblemStatement,
} from "../nlu/intent.rules";

describe("intent.rules classifyClosingMessage", () => {
  it.each([
    ["obrigado", "THANKS"],
    ["Somente, muito obrigado", "THANKS"],
    ["valeu, tchau", "THANKS"],
    ["tchau", "FAREWELL"],
    ["Somente", "FAREWELL"],
    ["é só isso", "FAREWELL"],
    ["nada mais", "FAREWELL"],
    ["Legal", "ACKNOWLEDGMENT"],
    ["ok, beleza", "ACKNOWLEDGMENT"],
    ["não", "ACKNOWLEDGMENT"],
  ] as const)("classifica %p como %s", (message, kind) => {
    expect(classifyClosingMessage(message)).toBe(kind);
  });

  it.each(["obrigado, mas o app travou", "tudo bem", "bom dia", "quero agendar"])(
    "não trata %p como encerramento",
    (message) => {
      expect(classifyClosingMessage(message)).toBeNull();
    },
  );
});

describe("intent.rules extractProblemStatement", () => {
  it.each([
    [
      "Legal, porém foi cobrado duas vezes no meu cartão, eu gostaria de suporte técnico",
      "Foi cobrado duas vezes no meu cartão",
    ],
    ["Oi, o app travou na hora de pagar. Preciso de suporte", "O app travou na hora de pagar"],
    [
      "quero abrir um chamado porque o prestador não apareceu",
      "O prestador não apareceu",
    ],
    ["Bom dia o pix não caiu, por favor", "O pix não caiu"],
    ["Fui cobrado R$ 49,90 a mais", "Fui cobrado R$ 49,90 a mais"],
  ])("extrai o problema de %p", (message, statement) => {
    expect(extractProblemStatement(message)).toBe(statement);
  });

  it.each(["quero abrir um chamado", "Olá, preciso de suporte técnico"])(
    "devolve texto vazio quando %p só pede atendimento",
    (message) => {
      expect(extractProblemStatement(message)).toBe("");
    },
  );
});
