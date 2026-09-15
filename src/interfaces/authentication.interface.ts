import { Request } from "express";

export interface ITokenPayload {
  /** Unique identifier for the authentication that issued the JWT. */
  jti?: string;
  user: {
    id: number;
    name: string;
    email: string;
    phone: string;
  };
  client: {
    id: number;
    cpf: string;
  };
  address?: {
    lat: number;
    lng: number;
    city: string;
    state: string;
    country_iso: string;
  };
}

export interface AuthenticatedRequest extends Request {
  user?: ITokenPayload["user"];
  client?: ITokenPayload["client"];
  address?: ITokenPayload["address"];
  authSessionId?: string;
}
