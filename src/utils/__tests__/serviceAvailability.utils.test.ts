import {
  timeToMinutes,
  validateAvailabilities,
} from "../serviceAvailability.utils";

describe("timeToMinutes", () => {
  it("converte HH:MM e HH:MM:SS em minutos desde a meia-noite", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("09:30:45")).toBe(570);
  });
});

describe("validateAvailabilities", () => {
  it("aceita um intervalo valido", () => {
    expect(
      validateAvailabilities([{ day: 1, start: "09:00", end: "12:00" }]),
    ).toEqual([]);
  });

  it("recusa item que nao e objeto", () => {
    expect(validateAvailabilities(["nope"])).toEqual([
      { index: 0, message: "Item inválido (deve ser objeto)" },
    ]);
  });

  it("recusa dia fora de 0 a 6", () => {
    const errors = validateAvailabilities([
      { day: 7, start: "09:00", end: "10:00" },
    ]);
    expect(errors[0]).toEqual({
      index: 0,
      message: "day deve ser inteiro entre 0 (Domingo) e 6 (Sábado)",
    });
  });

  it("recusa fim que nao e depois do inicio", () => {
    expect(
      validateAvailabilities([{ day: 2, start: "18:00", end: "09:00" }]),
    ).toEqual([{ index: 0, message: "start deve ser anterior a end" }]);
  });

  it("recusa intervalos sobrepostos no mesmo dia", () => {
    const errors = validateAvailabilities([
      { day: 3, start: "09:00", end: "12:00" },
      { day: 3, start: "11:00", end: "13:00" },
    ]);
    expect(errors).toEqual([
      {
        index: 1,
        message: "Sobreposição de horário no dia 3 com o item 0",
      },
    ]);
  });
});
