import {
  timeToMinutes,
  validateAvailabilities,
} from "../serviceAvailability.utils";

describe("timeToMinutes", () => {
  it("converts HH:MM and HH:MM:SS to minutes from midnight", () => {
    expect(timeToMinutes("00:00")).toBe(0);
    expect(timeToMinutes("09:30")).toBe(570);
    expect(timeToMinutes("09:30:45")).toBe(570);
  });
});

describe("validateAvailabilities", () => {
  it("accepts a valid range", () => {
    expect(
      validateAvailabilities([{ day: 1, start: "09:00", end: "12:00" }]),
    ).toEqual([]);
  });

  it("rejects a non-object item", () => {
    expect(validateAvailabilities(["nope"])).toEqual([
      { index: 0, message: "Item inválido (deve ser objeto)" },
    ]);
  });

  it("rejects a day outside 0-6", () => {
    const errors = validateAvailabilities([
      { day: 7, start: "09:00", end: "10:00" },
    ]);
    expect(errors[0]).toEqual({
      index: 0,
      message: "day deve ser inteiro entre 0 (Domingo) e 6 (Sábado)",
    });
  });

  it("rejects an end time that is not after start", () => {
    expect(
      validateAvailabilities([{ day: 2, start: "18:00", end: "09:00" }]),
    ).toEqual([{ index: 0, message: "start deve ser anterior a end" }]);
  });

  it("rejects overlapping ranges on the same day", () => {
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
