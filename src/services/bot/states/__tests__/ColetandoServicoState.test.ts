jest.mock("../../../../models/Appointment", () => ({
  AppointmentModel: {},
}));
jest.mock("../../../../models/Service", () => ({
  ServiceModel: { findAll: jest.fn() },
}));
jest.mock("../../../../models/Subcategory", () => ({
  SubCategoryModel: {},
}));
jest.mock("../../../../models/Category", () => ({
  CategoryModel: {},
}));
jest.mock("../../../../models/Professional", () => ({
  ProfessionalModel: {},
}));
jest.mock("../../../../models/User", () => ({
  UserModel: {},
}));
jest.mock("../../../../models/Address", () => ({
  AddressModel: {},
}));
jest.mock("../../../semanticSearch.service", () => ({
  rankSemanticCandidates: jest.fn(),
  SemanticSearchUnavailableError: class SemanticSearchUnavailableError extends Error {},
}));
jest.mock("../../../../utils/logger", () => ({
  __esModule: true,
  default: { warn: jest.fn() },
}));

import type { BotChatSessionModel } from "../../../../models/BotChatSession";
import { ServiceModel } from "../../../../models/Service";
import { rankSemanticCandidates } from "../../../semanticSearch.service";
import { ColetandoServicoState } from "../ColetandoServicoState";

function serviceFixture(id: number, professionalName: string) {
  return {
    id,
    title: "Limpeza residencial",
    description: "Limpeza completa",
    subcategory_id: 7,
    professional_id: id + 100,
    price_cents: 15000,
    duration: 120,
    Subcategory: {
      title: "Limpeza",
      Category: { title: "Casa" },
    },
    Professional: {
      User: { name: professionalName, avatar_uri: null },
      MainAddress: { city: "São Paulo", state: "SP" },
    },
    Appointments: [],
  };
}

describe("ColetandoServicoState", () => {
  beforeEach(() => jest.clearAllMocks());

  it("agrupa o mesmo serviço e pede a data antes de mostrar profissionais", async () => {
    const services = [serviceFixture(10, "Ana"), serviceFixture(11, "Bruno")];
    (ServiceModel.findAll as jest.Mock).mockResolvedValue(services);
    (rankSemanticCandidates as jest.Mock).mockResolvedValue([
      { id: 10, score: 0.98 },
      { id: 11, score: 0.97 },
    ]);

    const result = await new ColetandoServicoState().handle(
      "Limpeza residencial",
      { intent: "FALLBACK", entities: {}, confidence: 0.8 },
      {
        context: { pendingAction: "CREATE" },
      } as BotChatSessionModel,
      1,
    );

    expect(result.nextState).toBe("COLETANDO_DATA");
    expect(result.contextUpdate.matchedServiceIds).toEqual([10, 11]);
    expect(result.reply).toContain("Para qual dia");
    expect(result.reply).not.toContain("Ana");
    expect(result.reply).not.toContain("Bruno");
    expect(result.contextUpdate.professionalId).toBeUndefined();
  });
});
