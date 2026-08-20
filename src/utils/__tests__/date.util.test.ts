import {
  filterTimesByPeriod,
  isValidBookingDate,
  parseLocalAppointmentStart,
  parsePortugueseDate,
  parseTimeFromText,
  parseTimePeriodFromText,
  resolveAmbiguousTimeFromAvailableSlots,
  resolveBotTimeZone,
  selectSuggestedDateByWeekday,
} from "../date.util";

describe("parsePortugueseDate", () => {
  const now = new Date("2026-08-06T01:30:00.000Z");
  const options = { now, timeZone: "America/Sao_Paulo" };

  it.each([
    ["próxima segunda", "2026-08-10"],
    ["segunda-feira", "2026-08-10"],
    ["segunda feira", "2026-08-10"],
    ["seg-feira", "2026-08-10"],
    ["2ª feira", "2026-08-10"],
    ["sexta", "2026-08-07"],
    ["sexta que vem", "2026-08-07"],
    ["sex", "2026-08-07"],
    ["próxima sexta", "2026-08-14"],
    ["prox. sexta-feira", "2026-08-14"],
    ["sexta da próxima semana", "2026-08-14"],
    ["semana que vem na sexta", "2026-08-14"],
    ["sexta próxima", "2026-08-14"],
    ["dia 13", "2026-08-13"],
    ["13 de agosto", "2026-08-13"],
    ["treze do 09", "2026-09-13"],
    ["13/08", "2026-08-13"],
    ["dps de amnh", "2026-08-07"],
    ["1 de janeiro", "2027-01-01"],
  ])("normaliza %s para %s", (text, expected) => {
    expect(parsePortugueseDate(text, options)).toBe(expected);
  });

  it("usa o dia local de São Paulo perto da virada em UTC", () => {
    expect(parsePortugueseDate("hoje", options)).toBe("2026-08-05");
    expect(parsePortugueseDate("amanhã", options)).toBe("2026-08-06");
  });

  it.each(["31/02/2026", "dia 32", "2026-13-10"])(
    "rejeita a data impossível %s",
    (text) => {
      expect(parsePortugueseDate(text, options)).toBeNull();
    },
  );

  it.each([
    "duas e meia",
    "duas e quinze",
    "duas e quarenta e cinco",
    "duas da tarde",
    "seis horas",
    "2:30",
  ])("não interpreta a expressão de horário como data: %s", (text) => {
    expect(parsePortugueseDate(text, options)).toBeNull();
  });

  it("valida a antecedência de 48 horas pelo calendário local", () => {
    expect(isValidBookingDate("2026-08-06", options)).toBe(false);
    expect(isValidBookingDate("2026-08-07", options)).toBe(true);
  });

  it.each(["terça", "terça-feira", "terca feira", "na terça", "ter"])(
    "seleciona a data sugerida pelo dia contextual: %s",
    (text) => {
      const suggestions = ["2026-08-15", "2026-08-18", "2026-08-20"];
      expect(selectSuggestedDateByWeekday(text, suggestions)).toBe(
        "2026-08-18",
      );
    },
  );

  it("não aplica a seleção contextual a expressões relativas ou dias não listados", () => {
    const suggestions = ["2026-08-15", "2026-08-18", "2026-08-20"];
    expect(
      selectSuggestedDateByWeekday("próxima terça", suggestions),
    ).toBeNull();
    expect(selectSuggestedDateByWeekday("sexta", suggestions)).toBeNull();
  });
});

describe("parseTimeFromText", () => {
  it.each([
    ["14:30", "14:30"],
    ["14h30", "14:30"],
    ["duas e meia da tarde", "14:30"],
    ["duas e quarenta e cinco", "02:45"],
    ["duas da tarde", "14:00"],
    ["seis horas", "06:00"],
    ["quinze pras três da tarde", "14:45"],
    ["sete horas da manhã", "07:00"],
    ["meio-dia", "12:00"],
    ["meia-noite e meia", "00:30"],
    ["2 pm", "14:00"],
  ])("normaliza %s para %s", (text, expected) => {
    expect(parseTimeFromText(text)).toBe(expected);
  });

  it("não inventa um horário quando foi informado somente o período", () => {
    expect(parseTimeFromText("quero de tarde")).toBeNull();
  });

  it.each([
    ["seis horas", "06:00", ["09:00", "18:00"], "18:00"],
    ["às seis", "06:00", ["18:00"], "18:00"],
    ["seis e meia", "06:30", ["18:30"], "18:30"],
    ["duas e meia", "02:30", ["09:00", "14:30"], "14:30"],
  ])(
    "resolve a hora ambígua %s pelo contexto dos horários disponíveis",
    (text, parsedTime, availableTimes, expected) => {
      expect(
        resolveAmbiguousTimeFromAvailableSlots(
          text,
          parsedTime,
          availableTimes as string[],
        ),
      ).toBe(expected);
    },
  );

  it("entende duas e meia como 14:30 no contexto comercial, mesmo sem um slot exato", () => {
    expect(
      resolveAmbiguousTimeFromAvailableSlots("duas e meia", "02:30", [
        "08:00",
        "08:30",
        "09:00",
        "09:30",
        "10:00",
        "10:30",
        "11:00",
      ]),
    ).toBe("14:30");
  });

  it.each([
    ["duas e meia da manhã", "02:30", ["14:30"], "02:30"],
    ["duas e meia da tarde", "14:30", ["02:30"], "14:30"],
  ])(
    "preserva o período explícito em %s",
    (text, parsedTime, availableTimes, expected) => {
      expect(
        resolveAmbiguousTimeFromAvailableSlots(
          text,
          parsedTime,
          availableTimes as string[],
        ),
      ).toBe(expected);
    },
  );

  it.each([
    ["seis horas", ["06:00", "18:00"]],
    ["06:00", ["18:00"]],
    ["6h", ["18:00"]],
    ["seis horas da manhã", ["18:00"]],
    ["seis horas", ["17:30"]],
  ])(
    "preserva 06:00 quando a expressão %s não permite inferir 18:00",
    (text, availableTimes) => {
      expect(
        resolveAmbiguousTimeFromAvailableSlots(
          text,
          "06:00",
          availableTimes as string[],
        ),
      ).toBe("06:00");
    },
  );

  it.each([
    ["pela manhã", "MORNING"],
    ["de tarde", "AFTERNOON"],
    ["horário noturno", "EVENING"],
  ] as const)("identifica o período em %s", (text, expected) => {
    expect(parseTimePeriodFromText(text)).toBe(expected);
  });

  it("filtra horários usando faixas locais determinísticas", () => {
    const slots = [
      "05:30",
      "08:00",
      "11:30",
      "12:00",
      "17:30",
      "18:00",
      "21:00",
    ];
    expect(filterTimesByPeriod(slots, "MORNING")).toEqual(["08:00", "11:30"]);
    expect(filterTimesByPeriod(slots, "AFTERNOON")).toEqual(["12:00", "17:30"]);
    expect(filterTimesByPeriod(slots, "EVENING")).toEqual(["18:00", "21:00"]);
  });

  it("converte o horário local de São Paulo para UTC", () => {
    expect(
      parseLocalAppointmentStart("2026-08-13", "14:30").toISOString(),
    ).toBe("2026-08-13T17:30:00.000Z");
  });

  it("aceita somente identificadores IANA válidos para o fuso", () => {
    expect(resolveBotTimeZone("America/Manaus")).toBe("America/Manaus");
    expect(resolveBotTimeZone("fuso-invalido")).toBe("America/Sao_Paulo");
  });
});
