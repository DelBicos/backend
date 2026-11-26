import type { Server, Socket } from "socket.io";

jest.mock("../../config/database");
jest.mock("../../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  logError: jest.fn(),
}));
jest.mock("../../services/appointment/checkin.service", () => ({
  findTrackingParticipant: jest.fn(),
}));

import { findTrackingParticipant } from "../../services/appointment/checkin.service";
import logger from "../../utils/logger";
import { registerLocationTracking } from "../locationTracking";

type Handler = (...args: unknown[]) => unknown;

const mockedFindParticipant = findTrackingParticipant as jest.Mock;

function setup(userId?: number) {
  const handlers: Record<string, Handler> = {};
  const emit = jest.fn();
  const to = jest.fn(() => ({ emit }));
  const socket = {
    userId,
    on: jest.fn((event: string, fn: Handler) => {
      handlers[event] = fn;
    }),
    join: jest.fn(),
  };
  const io = { to };
  registerLocationTracking(
    io as unknown as Server,
    socket as unknown as Socket & { userId?: number },
  );
  return { handlers, emit, to, socket };
}

const professionalInTransit = {
  role: "professional",
  professionalConsent: true,
  status: "in_transit",
  clientUserId: 50,
};

// Destino a ~111 m do ponto de partida (0,001 grau de latitude).
const nearPayload = {
  appointment_id: 8,
  latitude: -23.5,
  longitude: -46.6,
  dest_lat: -23.501,
  dest_lng: -46.6,
  heading: 90,
  speed: 12,
};

describe("locationTracking appointment:join", () => {
  it("recusa usuário não autenticado ou sem ID", async () => {
    const { handlers } = setup();
    const ack = jest.fn();
    await handlers["appointment:join"](8, ack);
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: "Não autenticado ou ID inválido",
    });

    const authed = setup(3);
    const ack2 = jest.fn();
    await authed.handlers["appointment:join"](0, ack2);
    expect(ack2).toHaveBeenCalledWith({
      ok: false,
      error: "Não autenticado ou ID inválido",
    });
    expect(mockedFindParticipant).not.toHaveBeenCalled();
  });

  it("nega acesso a quem não participa do agendamento", async () => {
    mockedFindParticipant.mockResolvedValue(null);
    const { handlers, socket } = setup(3);
    const ack = jest.fn();
    await handlers["appointment:join"](8, ack);
    expect(mockedFindParticipant).toHaveBeenCalledWith(8, 3);
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: "Acesso negado ao agendamento",
    });
    expect(socket.join).not.toHaveBeenCalled();
  });

  it("entra no canal do agendamento", async () => {
    mockedFindParticipant.mockResolvedValue({ role: "client" });
    const { handlers, socket } = setup(3);
    const ack = jest.fn();
    await handlers["appointment:join"](8, ack);
    expect(socket.join).toHaveBeenCalledWith("appointment:8");
    expect(ack).toHaveBeenCalledWith({ ok: true });
  });

  it("funciona sem ack e responde erro quando a busca falha", async () => {
    mockedFindParticipant.mockResolvedValueOnce({ role: "client" });
    const { handlers } = setup(3);
    await expect(handlers["appointment:join"](8)).resolves.toBeUndefined();

    mockedFindParticipant.mockRejectedValueOnce(new Error("db fora"));
    const ack = jest.fn();
    await handlers["appointment:join"](8, ack);
    expect(logger.error).toHaveBeenCalledWith(
      "Erro em appointment:join",
      expect.any(Object),
    );
    expect(ack).toHaveBeenCalledWith({
      ok: false,
      error: "Erro ao entrar na sala do agendamento",
    });
  });
});

describe("locationTracking location:send", () => {
  it("ignora socket sem usuário ou payload sem agendamento", async () => {
    await setup().handlers["location:send"](nearPayload);
    await setup(3).handlers["location:send"](undefined);
    await setup(3).handlers["location:send"]({ latitude: 1, longitude: 1 });
    expect(mockedFindParticipant).not.toHaveBeenCalled();
  });

  it.each([
    ["não participante", null],
    ["cliente", { ...professionalInTransit, role: "client" }],
    [
      "profissional sem consentimento",
      { ...professionalInTransit, professionalConsent: false },
    ],
    [
      "agendamento fora do deslocamento",
      { ...professionalInTransit, status: "confirmed" },
    ],
  ])("não repassa a posição (%s)", async (_label, participant) => {
    mockedFindParticipant.mockResolvedValue(participant);
    const { handlers, emit } = setup(3);
    await handlers["location:send"](nearPayload);
    expect(emit).not.toHaveBeenCalled();
  });

  it("repassa a posição ao agendamento e ao cliente, com aviso de proximidade uma única vez", async () => {
    mockedFindParticipant.mockResolvedValue(professionalInTransit);
    const { handlers, emit, to } = setup(3);

    await handlers["location:send"](nearPayload);

    expect(to).toHaveBeenCalledWith("appointment:8");
    expect(to).toHaveBeenCalledWith("user:50");
    expect(emit).toHaveBeenCalledWith(
      "location:update",
      expect.objectContaining({
        appointment_id: 8,
        latitude: -23.5,
        longitude: -46.6,
        heading: 90,
        speed: 12,
        timestamp: expect.any(String),
      }),
    );
    expect(emit).toHaveBeenCalledWith(
      "location:proximity_warning",
      expect.objectContaining({
        appointment_id: 8,
        estimated_minutes: 1,
        distance_meters: 111,
      }),
    );

    emit.mockClear();
    await handlers["location:send"](nearPayload);
    expect(emit).toHaveBeenCalledWith("location:update", expect.any(Object));
    expect(emit).not.toHaveBeenCalledWith(
      "location:proximity_warning",
      expect.any(Object),
    );
  });

  it("não avisa quando o prestador ainda está longe e preenche heading/speed com zero", async () => {
    mockedFindParticipant.mockResolvedValue({
      ...professionalInTransit,
      status: "arrived",
      clientUserId: undefined,
    });
    const { handlers, emit, to } = setup(3);

    // ~11 km de distância (0,1 grau de latitude).
    await handlers["location:send"]({
      appointment_id: 8,
      latitude: -23.5,
      longitude: -46.6,
      dest_lat: -23.6,
      dest_lng: -46.6,
    });

    expect(to).toHaveBeenCalledTimes(1);
    expect(to).toHaveBeenCalledWith("appointment:8");
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith(
      "location:update",
      expect.objectContaining({ heading: 0, speed: 0 }),
    );
  });

  it("não calcula proximidade sem destino", async () => {
    mockedFindParticipant.mockResolvedValue(professionalInTransit);
    const { handlers, emit } = setup(3);
    await handlers["location:send"]({
      appointment_id: 8,
      latitude: -23.5,
      longitude: -46.6,
    });
    expect(emit).not.toHaveBeenCalledWith(
      "location:proximity_warning",
      expect.any(Object),
    );
  });

  it("registra erro quando a busca falha", async () => {
    mockedFindParticipant.mockRejectedValue(new Error("db fora"));
    const { handlers } = setup(3);
    await handlers["location:send"](nearPayload);
    expect(logger.error).toHaveBeenCalledWith(
      "Erro em location:send",
      expect.any(Object),
    );
  });
});

describe("locationTracking location:arrived", () => {
  it("ignora socket sem usuário ou payload sem agendamento", async () => {
    await setup().handlers["location:arrived"]({ appointment_id: 8 });
    await setup(3).handlers["location:arrived"](undefined);
    expect(mockedFindParticipant).not.toHaveBeenCalled();
  });

  it.each([
    ["não participante", null],
    ["cliente", { ...professionalInTransit, role: "client" }],
    [
      "agendamento fora do deslocamento",
      { ...professionalInTransit, status: "completed" },
    ],
  ])("não avisa a chegada (%s)", async (_label, participant) => {
    mockedFindParticipant.mockResolvedValue(participant);
    const { handlers, emit } = setup(3);
    await handlers["location:arrived"]({ appointment_id: 8 });
    expect(emit).not.toHaveBeenCalled();
  });

  it("avisa o cliente que o prestador chegou", async () => {
    mockedFindParticipant.mockResolvedValue(professionalInTransit);
    const { handlers, emit, to } = setup(3);
    await handlers["location:arrived"]({ appointment_id: 8 });
    expect(to).toHaveBeenCalledWith("appointment:8");
    expect(to).toHaveBeenCalledWith("user:50");
    expect(emit).toHaveBeenCalledWith(
      "location:arrived",
      expect.objectContaining({
        appointment_id: 8,
        message: "Prestador no local. Rastreamento encerrado.",
      }),
    );
  });

  it("registra erro quando a busca falha", async () => {
    mockedFindParticipant.mockRejectedValue(new Error("db fora"));
    const { handlers } = setup(3);
    await handlers["location:arrived"]({ appointment_id: 8 });
    expect(logger.error).toHaveBeenCalledWith(
      "Erro em location:arrived",
      expect.any(Object),
    );
  });
});
