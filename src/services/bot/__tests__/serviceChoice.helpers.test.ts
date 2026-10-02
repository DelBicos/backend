import type {
  BotServiceOption,
  BotSessionContext,
} from "../../../models/BotChatSession";
import { migrateLegacyServiceOptions } from "../serviceChoice.helpers";

function legacyOption(
  id: number,
  title: string,
  subcategoryId: number,
  professionalId: number,
  professionalName: string,
): BotServiceOption {
  return {
    id,
    title,
    description: `${title} completa`,
    subcategoryId,
    subcategoryName: "Residencial",
    categoryName: "Casa",
    professionalId,
    professionalName,
    price: 15000,
    duration: 120,
    rating: 5,
    ratingsCount: 10,
  };
}

describe("migrateLegacyServiceOptions", () => {
  it("agrupa ofertas de profissionais e remove os cartões antigos do contexto", () => {
    const context: BotSessionContext = {
      serviceId: 10,
      serviceName: "Limpeza residencial",
      professionalId: 100,
      professionalName: "Ana",
      serviceOptionsData: [
        legacyOption(10, "Limpeza residencial", 7, 100, "Ana"),
        legacyOption(11, "Limpeza residencial", 7, 101, "Bruno"),
        legacyOption(12, "Limpeza pós-obra", 8, 102, "Carla"),
      ],
    };

    const migrated = migrateLegacyServiceOptions(context);

    expect(migrated).not.toBe(context);
    expect(migrated.serviceOptionsData).toBeUndefined();
    expect(migrated.serviceOptions).toEqual([
      "Limpeza residencial",
      "Limpeza pós-obra",
    ]);
    expect(migrated.serviceChoicesData).toEqual([
      expect.objectContaining({
        title: "Limpeza residencial",
        matchedServiceIds: [10, 11],
      }),
      expect.objectContaining({
        title: "Limpeza pós-obra",
        matchedServiceIds: [12],
      }),
    ]);
    expect(migrated.serviceId).toBeUndefined();
    expect(migrated.professionalId).toBeUndefined();
    expect(migrated.professionalName).toBeUndefined();
    expect(context.serviceOptionsData).toHaveLength(3);
  });
});
