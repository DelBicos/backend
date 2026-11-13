import jwt from "jsonwebtoken";
import { generateTokenAndUserPayload } from "../authUtils";

describe("generateTokenAndUserPayload", () => {
  const user = {
    id: 4,
    name: "Ana",
    email: "ana@example.com",
    phone: "11999999999",
    avatar_uri: "https://cdn.example/a.png",
  } as any;

  const client = { id: 8, cpf: "12345678900" } as any;

  it("signs a token that includes the address when one is present", () => {
    const address = {
      lat: -23.5,
      lng: -46.6,
      city: "São Paulo",
      state: "SP",
      country_iso: "BR",
    } as any;

    const result = generateTokenAndUserPayload(user, client, address);
    const decoded = jwt.verify(
      result.token,
      process.env.SECRET_KEY || "secret",
    ) as any;

    expect(decoded.address).toEqual(address);
    expect(result.user).toMatchObject({
      id: 4,
      client_id: 8,
      cpf: "12345678900",
      address,
    });
    expect(result.address).toEqual(address);
  });

  it("omits the address claim when address is null", () => {
    const result = generateTokenAndUserPayload(user, client, null);
    const decoded = jwt.verify(
      result.token,
      process.env.SECRET_KEY || "secret",
    ) as any;

    expect(decoded.address).toBeUndefined();
    expect(result.user.address).toBeNull();
    expect(result.address).toBeNull();
  });
});
