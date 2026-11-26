jest.mock("../../config/database");

import type { AddressModel } from "../../models/Address";
import type { ClientModel } from "../../models/Client";
import type { UserModel } from "../../models/User";
import type { ITokenPayload } from "../../interfaces/authentication.interface";
import { generateTokenAndUserPayload } from "../authUtils";
import { verifyToken } from "../jwt.util";

const previousSecret = process.env.SECRET_KEY;
beforeAll(() => {
  process.env.SECRET_KEY = "test-secret-with-at-least-32-characters!!";
});
afterAll(() => {
  if (previousSecret === undefined) delete process.env.SECRET_KEY;
  else process.env.SECRET_KEY = previousSecret;
});

const user = {
  id: 4,
  name: "Ana",
  email: "ana@example.com",
  phone: "11999999999",
  avatar_uri: "https://cdn.example/a.png",
} as unknown as UserModel;

const client = { id: 8, cpf: "12345678900" } as unknown as ClientModel;

describe("generateTokenAndUserPayload", () => {
  it("assina um token com o endereco quando ele existe", () => {
    const address = {
      lat: -23.5,
      lng: -46.6,
      city: "São Paulo",
      state: "SP",
      country_iso: "BR",
    } as unknown as AddressModel;

    const result = generateTokenAndUserPayload(user, client, address);
    const decoded = verifyToken<ITokenPayload & { jti?: string }>(result.token);

    expect(decoded.address).toEqual(address);
    expect(decoded.user).toEqual({
      id: 4,
      name: "Ana",
      email: "ana@example.com",
      phone: "11999999999",
    });
    expect(decoded.jti).toEqual(expect.any(String));
    expect(result.user).toMatchObject({
      id: 4,
      client_id: 8,
      cpf: "12345678900",
      address,
    });
    expect(result.address).toEqual(address);
  });

  it("omite o endereco do token quando ele e nulo", () => {
    const result = generateTokenAndUserPayload(user, client, null);
    const decoded = verifyToken<ITokenPayload>(result.token);

    expect(decoded.address).toBeUndefined();
    expect(result.user.address).toBeNull();
    expect(result.address).toBeNull();
  });
});
