import { UniqueConstraintError } from "sequelize";
import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/Professional");
jest.mock("../../../models/User");
jest.mock("../../../models/Address");
jest.mock("../../../models/Service");
jest.mock("../../../models/Appointment");
jest.mock("../../../models/Client");
jest.mock("../../availability.service", () => ({ getAvailableSlots: jest.fn() }));

import { ProfessionalModel } from "../../../models/Professional";
import { UserModel } from "../../../models/User";
import { AddressModel } from "../../../models/Address";
import { AppointmentModel } from "../../../models/Appointment";
import { ClientModel } from "../../../models/Client";
import { getAvailableSlots } from "../../availability.service";
import * as service from "../professional.service";

const mocked = (fn: unknown) => fn as jest.Mock;

const expectHttpError = async (promise: Promise<unknown>, status: number) => {
  const error = await promise.then(
    () => undefined,
    (e) => e,
  );
  expect(error).toBeInstanceOf(HttpError);
  expect(error.status).toBe(status);
};

const professionalRow = (overrides: Record<string, unknown> = {}) => {
  const data: Record<string, unknown> = { id: 20, user_id: 9, service_radius_km: 10, ...overrides };
  return { ...data, save: jest.fn(), toJSON: () => ({ ...data }) } as any;
};

beforeEach(() => jest.clearAllMocks());

describe("getPublicProfile", () => {
  it("nao expoe CPF/CNPJ, e-mail ou dados de clientes", async () => {
    mocked(ProfessionalModel.findByPk).mockResolvedValue(
      professionalRow({ Appointments: [{ rating: 5 }, { rating: 4 }] }),
    );

    const profile: any = await service.getPublicProfile("20");

    const options = mocked(ProfessionalModel.findByPk).mock.calls[0][1];
    expect(options.attributes).not.toContain("cpf");
    expect(options.attributes).not.toContain("cnpj");
    const user = options.include.find((i: any) => i.as === "User");
    expect(user.attributes).not.toContain("email");
    const appointments = options.include.find((i: any) => i.as === "Appointments");
    const client = appointments.include.find((i: any) => i.as === "Client");
    expect(client.attributes).toEqual(["id"]);

    expect(profile.rating).toBe(4.5);
    expect(profile.ratings_count).toBe(2);
  });

  it("rating e null sem avaliacoes", async () => {
    mocked(ProfessionalModel.findByPk).mockResolvedValue(professionalRow({ Appointments: [] }));
    const profile: any = await service.getPublicProfile("20");
    expect(profile.rating).toBeNull();
  });

  it("404 quando nao existe e 400 para id invalido", async () => {
    mocked(ProfessionalModel.findByPk).mockResolvedValue(null);
    await expectHttpError(service.getPublicProfile("20"), 404);
    await expectHttpError(service.getPublicProfile("abc"), 400);
  });
});

describe("searchAvailability", () => {
  const prof = (id: number, radius: number | null, lat: number, lng: number) => ({
    id,
    service_radius_km: radius,
    User: { name: `P${id}`, avatar_uri: null },
    MainAddress: { city: "Sorocaba", state: "SP", lat, lng },
    Services: [{ id: id * 10, title: "Corte", price: 50, duration: 30 }],
  });

  it("valida parametros obrigatorios e formato da data", async () => {
    await expectHttpError(service.searchAvailability({ date: "2026-10-05" }), 400);
    await expectHttpError(service.searchAvailability({ subCategoryId: "1", date: "5/10" }), 400);
  });

  it("filtra pelo raio, busca notas numa unica consulta e ordena por distancia", async () => {
    mocked(ProfessionalModel.findAll).mockResolvedValue([
      prof(1, 50, -23.55, -47.44), // ~6 km
      prof(2, 2, -23.40, -47.40), // fora do raio de 2 km
      prof(3, null, -23.51, -47.45), // sem raio, ~1 km
    ]);
    mocked(AppointmentModel.findAll).mockResolvedValue([
      { professional_id: 1, rating: 5 },
      { professional_id: 1, rating: 3 },
    ]);
    mocked(getAvailableSlots).mockResolvedValue(["09:00"]);

    const result = await service.searchAvailability({
      subCategoryId: "1",
      date: "2026-10-05",
      lat: "-23.5015",
      lng: "-47.4526",
    });

    expect(AppointmentModel.findAll).toHaveBeenCalledTimes(1);
    expect(result.map((r) => r.id)).toEqual([3, 1]);
    expect(result[1]).toMatchObject({ rating: 4, ratingsCount: 2, availableTimes: ["09:00"] });
  });

  it("omite profissionais sem horario livre", async () => {
    mocked(ProfessionalModel.findAll).mockResolvedValue([prof(1, null, 0, 0)]);
    mocked(AppointmentModel.findAll).mockResolvedValue([]);
    mocked(getAvailableSlots).mockResolvedValue([]);
    await expect(
      service.searchAvailability({ subCategoryId: "1", date: "2026-10-05" }),
    ).resolves.toEqual([]);
  });
});

describe("register", () => {
  const input = { cpf: "123.456.789-01", description: "Eletricista" };

  it("recusa quem ja e profissional", async () => {
    mocked(UserModel.findByPk).mockResolvedValue({ id: 9 });
    mocked(ProfessionalModel.findOne).mockResolvedValue(professionalRow());
    await expectHttpError(service.register(9, input), 400);
  });

  it("converte violacao de unicidade do CPF em 409", async () => {
    mocked(UserModel.findByPk).mockResolvedValue({ id: 9 });
    mocked(ProfessionalModel.findOne).mockResolvedValue(null);
    mocked(ClientModel.findOne).mockResolvedValue({ main_address_id: 3 });
    const unique = new UniqueConstraintError({
      errors: [{ path: "cpf" } as any],
    } as any);
    mocked(ProfessionalModel.create).mockRejectedValue(unique);

    const error = await service.register(9, input).catch((e) => e);
    expect(error).toBeInstanceOf(HttpError);
    expect(error.status).toBe(409);
    expect(error.message).toMatch(/CPF/);
  });

  it("cria com documento normalizado e endereco principal do cliente", async () => {
    mocked(UserModel.findByPk).mockResolvedValue({ id: 9 });
    mocked(ProfessionalModel.findOne).mockResolvedValue(null);
    mocked(ClientModel.findOne).mockResolvedValue({ main_address_id: 3 });
    mocked(ProfessionalModel.create).mockResolvedValue({ id: 20 });
    mocked(ProfessionalModel.findByPk).mockResolvedValue(professionalRow());

    await service.register(9, input);

    expect(ProfessionalModel.create).toHaveBeenCalledWith({
      user_id: 9,
      main_address_id: 3,
      cpf: "12345678901",
      cnpj: undefined,
      description: "Eletricista",
    });
  });
});

describe("update / radius", () => {
  it("so o dono altera o perfil", async () => {
    mocked(ProfessionalModel.findByPk).mockResolvedValue(professionalRow({ user_id: 999 }));
    await expectHttpError(service.update(9, "20", { description: "x" }), 403);
    await expectHttpError(service.updateRadius(9, "20", 5), 403);
  });

  it("nao aceita endereco principal de outro usuario", async () => {
    mocked(ProfessionalModel.findByPk).mockResolvedValue(professionalRow());
    mocked(AddressModel.findByPk).mockResolvedValue({ id: 3, user_id: 999 });
    await expectHttpError(service.update(9, "20", { main_address_id: 3 }), 400);
  });

  it("atualiza o raio", async () => {
    const professional = professionalRow();
    mocked(ProfessionalModel.findByPk).mockResolvedValue(professional);

    await expect(service.updateRadius(9, "20", "15.7")).resolves.toEqual({
      message: "Raio atualizado",
      service_radius_km: 15,
    });
    expect(professional.save).toHaveBeenCalled();
  });

  it("exige o raio no corpo", async () => {
    mocked(ProfessionalModel.findByPk).mockResolvedValue(professionalRow());
    await expectHttpError(service.updateRadius(9, "20", undefined), 400);
  });
});
