import {
  calculateMatchScore,
  findBestOptionMatch,
  levenshteinDistance,
  normalizeText,
  stringSimilarity,
} from "../nlp.util";

describe("normalizeText", () => {
  it("remove acentos, pontuação e espaços repetidos", () => {
    expect(normalizeText("  Elétrica,   Hidráulica!! ")).toBe("eletrica hidraulica");
  });

  it("mantém números", () => {
    expect(normalizeText("Opção 2")).toBe("opcao 2");
  });
});

describe("levenshteinDistance", () => {
  it("é zero para textos iguais", () => {
    expect(levenshteinDistance("pintura", "pintura")).toBe(0);
  });

  it("conta inserções, remoções e trocas", () => {
    expect(levenshteinDistance("kitten", "sitting")).toBe(3);
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });
});

describe("stringSimilarity", () => {
  it("é 1 para dois textos vazios", () => {
    expect(stringSimilarity("", "")).toBe(1);
  });

  it("é proporcional à distância sobre o texto mais longo", () => {
    expect(stringSimilarity("pintura", "pinturas")).toBeCloseTo(7 / 8);
    expect(stringSimilarity("pinturas", "pintura")).toBeCloseTo(7 / 8);
  });
});

describe("calculateMatchScore", () => {
  const service = {
    title: "Limpeza de Sofá",
    Subcategory: { title: "Limpeza Residencial", Category: { title: "Casa" } },
  };

  it("dá 10 para título idêntico", () => {
    expect(calculateMatchScore(service, "limpeza de sofa", [])).toBe(10);
  });

  it("dá 8 quando o título contém a busca", () => {
    expect(calculateMatchScore(service, "sofa", [])).toBe(8);
  });

  it("dá 7 para subcategoria idêntica", () => {
    expect(calculateMatchScore(service, "limpeza residencial", [])).toBe(7);
  });

  it("dá 6 para categoria idêntica", () => {
    expect(calculateMatchScore(service, "casa", [])).toBe(6);
  });

  it("dá 5 quando a subcategoria contém a busca", () => {
    expect(calculateMatchScore(service, "residencial", [])).toBe(5);
  });

  it("dá 4 quando a categoria contém a busca", () => {
    const svc = {
      title: "Reparo",
      Subcategory: { title: "Geral", Category: { title: "Manutenção predial" } },
    };
    expect(calculateMatchScore(svc, "predial", [])).toBe(4);
  });

  it("dá 3 quando todas as palavras aparecem no texto combinado", () => {
    expect(calculateMatchScore(service, "sofa residencial", ["sofa", "residencial"])).toBe(3);
  });

  it("usa a similaridade quando ela passa de 0,65", () => {
    const score = calculateMatchScore({ title: "Pintura" }, "pinturx", ["pinturx"]);
    expect(score).toBeCloseTo((6 / 7) * 2);
  });

  it("considera a similaridade com a subcategoria", () => {
    const svc = { title: "Serviço X", Subcategory: { title: "Jardinagem", Category: null } };
    const score = calculateMatchScore(svc, "jardinajem", ["jardinajem"]);
    expect(score).toBeCloseTo(0.9 * 2);
  });

  it("dá 0 quando nada combina", () => {
    expect(calculateMatchScore({ title: "Pintura", Subcategory: null }, "encanador", ["encanador"])).toBe(0);
  });
});

describe("findBestOptionMatch", () => {
  const options = [
    { title: "Limpeza geral" },
    { title: "Pintura de parede" },
    { title: "Reparos gerais elétricos" },
  ];

  it("prefere a correspondência exata", () => {
    expect(findBestOptionMatch("Pintura de Parede", options)).toBe(options[1]);
  });

  it("aceita o texto contido na opção", () => {
    expect(findBestOptionMatch("pintura", options)).toBe(options[1]);
  });

  it("aceita a opção contida no texto", () => {
    expect(findBestOptionMatch("quero limpeza geral amanhã", options)).toBe(options[0]);
  });

  it("aceita palavras com o mesmo prefixo", () => {
    expect(findBestOptionMatch("reparo eletrico", options)).toBe(options[2]);
  });

  it("aceita palavras idênticas fora de ordem", () => {
    expect(findBestOptionMatch("parede nova", [{ title: "Pintura de parede" }])).toEqual({
      title: "Pintura de parede",
    });
  });

  it("devolve null abaixo do limite mínimo", () => {
    expect(findBestOptionMatch("encanador urgente agora", options)).toBeNull();
  });

  it("devolve null sem opções", () => {
    expect(findBestOptionMatch("pintura", [])).toBeNull();
  });
});
