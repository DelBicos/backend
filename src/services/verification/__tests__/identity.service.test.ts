import { HttpError } from "../../../errors/HttpError";

jest.mock("../../../config/database");
jest.mock("../../../models/User");
jest.mock("../../../models/Professional");
jest.mock("../../../models/IdentityVerification", () => ({
  DOCUMENT_TYPES: ["rg", "cnh"],
  IdentityVerificationModel: { findOne: jest.fn(), findAll: jest.fn(), findByPk: jest.fn(), create: jest.fn() },
}));
jest.mock("../../../models/Notification");
jest.mock("../../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
}));

const storage = {
  generateUploadUrl: jest.fn(),
  getFileUrl: jest.fn(async (k: string) => `https://signed/${k}`),
  deleteFile: jest.fn().mockResolvedValue(undefined),
};
jest.mock("../../storage/StorageFactory", () => ({ getPrivateStorageAdapter: () => storage }));

import { ProfessionalModel } from "../../../models/Professional";
import { UserModel } from "../../../models/User";
import { IdentityVerificationModel } from "../../../models/IdentityVerification";
import { NotificationModel } from "../../../models/Notification";
import * as identity from "../identity.service";

const mocked = (fn: unknown) => fn as jest.Mock;
const status = async (p: Promise<unknown>) =>
  (await p.then(() => undefined, (e) => e)) as HttpError;

const professional = (extra = {}) => ({
  id: 20,
  user_id: 5,
  identity_verified_at: null,
  save: jest.fn().mockResolvedValue(undefined),
  ...extra,
});

beforeEach(() => {
  jest.clearAllMocks();
  mocked(ProfessionalModel.findOne).mockResolvedValue(professional());
});

describe("createUploadUrl", () => {
  it("gera chave dentro da pasta do profissional", async () => {
    storage.generateUploadUrl.mockResolvedValue({ uploadUrl: "https://up", uploadHeaders: { a: "b" } });
    const res = await identity.createUploadUrl(5, { kind: "front", fileType: "image/jpeg" });
    expect(res.key).toMatch(/^identity\/20\/front-[0-9a-f-]+\.jpg$/);
    expect(res).toMatchObject({ uploadUrl: "https://up", uploadHeaders: { a: "b" } });
  });

  it("recusa quem nao e profissional, tipo de arquivo e kind invalidos", async () => {
    mocked(ProfessionalModel.findOne).mockResolvedValue(null);
    expect((await status(identity.createUploadUrl(5, { kind: "front", fileType: "image/png" }))).status).toBe(403);
    mocked(ProfessionalModel.findOne).mockResolvedValue(professional());
    expect((await status(identity.createUploadUrl(5, { kind: "x", fileType: "image/png" }))).status).toBe(400);
    expect((await status(identity.createUploadUrl(5, { kind: "front", fileType: "application/pdf" }))).status).toBe(400);
  });
});

describe("submitIdentity", () => {
  const valid = {
    document_type: "cnh",
    front_key: "identity/20/front-a.jpg",
    selfie_key: "identity/20/selfie-b.jpg",
  };

  it("cria o pedido pendente", async () => {
    mocked(IdentityVerificationModel.findOne).mockResolvedValue(null);
    mocked(IdentityVerificationModel.create).mockResolvedValue({ id: 1, status: "pending", document_type: "cnh" });
    const res = await identity.submitIdentity(5, valid);
    expect(res).toMatchObject({ id: 1, status: "pending" });
    expect(IdentityVerificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ professional_id: 20, back_key: null }),
    );
  });

  it("recusa chaves de outra pasta, traversal e documento invalido", async () => {
    mocked(IdentityVerificationModel.findOne).mockResolvedValue(null);
    for (const front_key of ["identity/99/front-a.jpg", "identity/20/../99/x.jpg", "uploads/1/a.jpg"]) {
      expect((await status(identity.submitIdentity(5, { ...valid, front_key }))).status).toBe(400);
    }
    expect((await status(identity.submitIdentity(5, { ...valid, document_type: "cpf" }))).status).toBe(400);
    expect((await status(identity.submitIdentity(5, { ...valid, selfie_key: undefined }))).status).toBe(400);
  });

  it("nao aceita segundo pedido pendente nem quem ja e verificado", async () => {
    mocked(IdentityVerificationModel.findOne).mockResolvedValue({ id: 3 });
    expect((await status(identity.submitIdentity(5, valid))).status).toBe(409);
    mocked(ProfessionalModel.findOne).mockResolvedValue(professional({ identity_verified_at: new Date() }));
    expect((await status(identity.submitIdentity(5, valid))).status).toBe(409);
  });
});

describe("getStatus", () => {
  it("cliente sem perfil profissional", async () => {
    mocked(UserModel.findByPk).mockResolvedValue({ id: 5, mfa_enabled: true });
    mocked(ProfessionalModel.findOne).mockResolvedValue(null);
    expect(await identity.getStatus(5)).toMatchObject({
      email_verified: true,
      mfa_enabled: true,
      is_professional: false,
      identity: null,
      verified: false,
    });
  });

  it("profissional com pedido recusado", async () => {
    mocked(UserModel.findByPk).mockResolvedValue({ id: 5, mfa_enabled: false });
    mocked(IdentityVerificationModel.findOne).mockResolvedValue({
      id: 2, status: "rejected", document_type: "rg", reject_reason: "Foto borrada",
    });
    const res = await identity.getStatus(5);
    expect(res.identity).toMatchObject({ status: "rejected", reject_reason: "Foto borrada" });
    expect(res.verified).toBe(false);
  });
});

describe("reviewIdentity", () => {
  const pending = (extra = {}) => {
    const prof = professional();
    return {
      request: {
        id: 9, status: "pending", Professional: prof,
        front_key: "identity/20/f.jpg", back_key: null, selfie_key: "identity/20/s.jpg",
        save: jest.fn().mockResolvedValue(undefined),
        ...extra,
      } as any,
      prof,
    };
  };

  it("aprova: marca o selo, apaga os arquivos e notifica", async () => {
    const { request, prof } = pending();
    mocked(IdentityVerificationModel.findByPk).mockResolvedValue(request);

    await identity.reviewIdentity(1, 9, { decision: "approve" });

    expect(prof.identity_verified_at).toBeInstanceOf(Date);
    expect(request).toMatchObject({ status: "approved", front_key: null, selfie_key: null });
    expect(storage.deleteFile).toHaveBeenCalledTimes(2);
    expect(NotificationModel.create).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 5, title: "Identidade verificada" }),
    );
  });

  it("recusa exige motivo e nao marca o selo", async () => {
    const { request, prof } = pending();
    mocked(IdentityVerificationModel.findByPk).mockResolvedValue(request);
    expect((await status(identity.reviewIdentity(1, 9, { decision: "reject" }))).status).toBe(400);

    await identity.reviewIdentity(1, 9, { decision: "reject", reason: "Foto ilegível" });
    expect(request).toMatchObject({ status: "rejected", reject_reason: "Foto ilegível" });
    expect(prof.identity_verified_at).toBeNull();
  });

  it("nao reanalisa nem aceita decisao invalida", async () => {
    mocked(IdentityVerificationModel.findByPk).mockResolvedValue(pending({ status: "approved" }).request);
    expect((await status(identity.reviewIdentity(1, 9, { decision: "approve" }))).status).toBe(409);
    mocked(IdentityVerificationModel.findByPk).mockResolvedValue(pending().request);
    expect((await status(identity.reviewIdentity(1, 9, { decision: "talvez" }))).status).toBe(400);
    mocked(IdentityVerificationModel.findByPk).mockResolvedValue(null);
    expect((await status(identity.reviewIdentity(1, 9, { decision: "approve" }))).status).toBe(404);
  });
});

describe("listForReview", () => {
  it("assina links so para pedidos pendentes", async () => {
    mocked(IdentityVerificationModel.findAll).mockResolvedValue([
      {
        id: 1, status: "pending", document_type: "rg", front_key: "identity/20/f.jpg",
        back_key: null, selfie_key: "identity/20/s.jpg",
        Professional: { id: 20, cpf: "1", User: { name: "Isabel", email: "i@x.com" } },
      },
    ]);
    const [item] = await identity.listForReview();
    expect(item).toMatchObject({
      front_url: "https://signed/identity/20/f.jpg",
      back_url: null,
      selfie_url: "https://signed/identity/20/s.jpg",
      professional: { name: "Isabel" },
    });
  });
});
