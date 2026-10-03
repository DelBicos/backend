import { connectMongoWithRetry } from "../mongoConnectionRetry";

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

it("não agenda outra tentativa quando conecta de primeira", async () => {
  const connect = jest.fn().mockResolvedValue({});
  await connectMongoWithRetry(connect, "MongoDB (chat)");
  expect(connect).toHaveBeenCalledTimes(1);
  expect(jest.getTimerCount()).toBe(0);
  expect(console.warn).not.toHaveBeenCalled();
});

it("recupera falhas iniciais e para de tentar depois da conexão", async () => {
  const connect = jest.fn()
    .mockRejectedValueOnce(new Error("indisponível"))
    .mockRejectedValueOnce(new Error("ainda indisponível"))
    .mockResolvedValue({});
  const ready = connectMongoWithRetry(connect, "MongoDB (chat)");
  await jest.advanceTimersByTimeAsync(4999);
  expect(connect).toHaveBeenCalledTimes(1);
  await jest.advanceTimersByTimeAsync(1);
  expect(connect).toHaveBeenCalledTimes(2);
  await jest.advanceTimersByTimeAsync(10000);
  await ready;
  expect(connect).toHaveBeenCalledTimes(3);
  expect(jest.getTimerCount()).toBe(0);
});

it("limita a espera a 30 segundos e continua recuperável após indisponibilidade prolongada", async () => {
  const connect = jest.fn().mockRejectedValue(new Error("offline"));
  const ready = connectMongoWithRetry(connect, "MongoDB (logs)");
  for (const delay of [5000, 10000, 20000, 30000]) {
    await jest.advanceTimersByTimeAsync(delay);
  }
  expect(connect).toHaveBeenCalledTimes(5);
  connect.mockResolvedValue({});
  await jest.advanceTimersByTimeAsync(30000);
  await ready;
  expect(connect).toHaveBeenCalledTimes(6);
  expect(jest.getTimerCount()).toBe(0);
});

it("não sobrepõe tentativas enquanto uma conexão está em andamento", async () => {
  let resolveConnection!: () => void;
  const pending = new Promise<void>((resolve) => { resolveConnection = resolve; });
  const connect = jest.fn().mockReturnValue(pending);
  const ready = connectMongoWithRetry(connect, "MongoDB (chat)");
  await jest.advanceTimersByTimeAsync(120000);
  expect(connect).toHaveBeenCalledTimes(1);
  resolveConnection();
  await ready;
});
