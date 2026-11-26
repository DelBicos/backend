import { EventEmitter } from "events";
import type { Request, Response } from "express";
import { addSSEClient, emitSSE, removeSSEClient, sseHandler } from "../sse";

type FakeResponse = { write: jest.Mock; setHeader: jest.Mock; flushHeaders: jest.Mock };

function fakeRes(): FakeResponse {
  return { write: jest.fn(), setHeader: jest.fn(), flushHeaders: jest.fn() };
}

const asRes = (res: FakeResponse) => res as unknown as Response;

describe("utils/sse", () => {
  it("entrega o evento a todos os clientes do canal", () => {
    const a = fakeRes();
    const b = fakeRes();
    const clientA = addSSEClient("canal-emite", asRes(a));
    const clientB = addSSEClient("canal-emite", asRes(b));

    emitSSE("canal-emite", "novo", { id: 1 });

    const payload = 'event: novo\ndata: {"id":1}\n\n';
    expect(a.write).toHaveBeenCalledWith(payload);
    expect(b.write).toHaveBeenCalledWith(payload);
    expect(clientA.id).not.toBe(clientB.id);
    removeSSEClient("canal-emite", clientA.id);
    removeSSEClient("canal-emite", clientB.id);
  });

  it("ignora canal sem clientes e cliente que falha ao escrever", () => {
    expect(() => emitSSE("canal-vazio", "x", {})).not.toThrow();

    const broken = fakeRes();
    broken.write.mockImplementation(() => {
      throw new Error("desconectado");
    });
    const ok = fakeRes();
    const c1 = addSSEClient("canal-falha", asRes(broken));
    const c2 = addSSEClient("canal-falha", asRes(ok));
    expect(() => emitSSE("canal-falha", "x", 1)).not.toThrow();
    expect(ok.write).toHaveBeenCalled();
    removeSSEClient("canal-falha", c1.id);
    removeSSEClient("canal-falha", c2.id);
  });

  it("remove so o cliente informado e apaga o canal quando esvazia", () => {
    const a = fakeRes();
    const b = fakeRes();
    const clientA = addSSEClient("canal-remove", asRes(a));
    const clientB = addSSEClient("canal-remove", asRes(b));

    removeSSEClient("canal-remove", clientA.id);
    emitSSE("canal-remove", "x", 1);
    expect(a.write).not.toHaveBeenCalled();
    expect(b.write).toHaveBeenCalledTimes(1);

    removeSSEClient("canal-remove", clientB.id);
    emitSSE("canal-remove", "x", 2);
    expect(b.write).toHaveBeenCalledTimes(1);
    expect(() => removeSSEClient("canal-inexistente", "abc")).not.toThrow();
  });

  describe("sseHandler", () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it("abre o stream, envia heartbeat e limpa ao fechar", () => {
      const req = new EventEmitter();
      const res = fakeRes();
      sseHandler("canal-handler")(req as unknown as Request, asRes(res));

      expect(res.setHeader).toHaveBeenCalledWith("Content-Type", "text/event-stream");
      expect(res.setHeader).toHaveBeenCalledWith("X-Accel-Buffering", "no");
      expect(res.flushHeaders).toHaveBeenCalled();
      expect(res.write).toHaveBeenCalledWith('event: connected\ndata: {"status":"ok"}\n\n');

      jest.advanceTimersByTime(25_000);
      expect(res.write).toHaveBeenCalledWith(": heartbeat\n\n");

      emitSSE("canal-handler", "aviso", "oi");
      expect(res.write).toHaveBeenCalledWith('event: aviso\ndata: "oi"\n\n');

      req.emit("close");
      res.write.mockClear();
      jest.advanceTimersByTime(50_000);
      emitSSE("canal-handler", "aviso", "oi");
      expect(res.write).not.toHaveBeenCalled();
    });

    it("para o heartbeat quando a escrita falha", () => {
      const req = new EventEmitter();
      const res = fakeRes();
      sseHandler("canal-heartbeat")(req as unknown as Request, asRes(res));
      res.write.mockImplementation(() => {
        throw new Error("fechado");
      });

      jest.advanceTimersByTime(25_000);
      expect(res.write).toHaveBeenCalledTimes(2);
      jest.advanceTimersByTime(50_000);
      expect(res.write).toHaveBeenCalledTimes(2);
      req.emit("close");
    });
  });
});
