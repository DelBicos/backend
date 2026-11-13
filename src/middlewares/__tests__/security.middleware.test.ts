import { sqlInjectionGuard, xssSanitizer } from "../security.middleware";
import { mockReq, mockRes } from "../../test/http";

describe("xssSanitizer", () => {
  it("escapes HTML in body, query and params before calling next", () => {
    const req = mockReq({
      body: { name: `<script>alert("x")</script>` },
      query: { q: "a/b" },
      params: { id: "1<2" },
    });
    const next = jest.fn();

    xssSanitizer(req as any, mockRes(), next);

    expect((req as any).body.name).toBe(
      "&lt;script&gt;alert(&quot;x&quot;)&lt;&#x2F;script&gt;",
    );
    expect((req as any).query.q).toBe("a&#x2F;b");
    expect((req as any).params.id).toBe("1&lt;2");
    expect(next).toHaveBeenCalledTimes(1);
  });
});

describe("sqlInjectionGuard", () => {
  it("returns 400 with msg when the body matches an injection pattern", () => {
    const req = mockReq({
      body: { name: "1 OR 1=1" },
      method: "POST",
      originalUrl: "/api/users",
      ip: "127.0.0.1",
    });
    const res = mockRes();
    const next = jest.fn();

    sqlInjectionGuard(req as any, res, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({
      msg: "Requisição bloqueada: entrada inválida detectada.",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next for ordinary input", () => {
    const req = mockReq({ body: { name: "Maria Silva" }, query: {}, params: {} });
    const next = jest.fn();

    sqlInjectionGuard(req as any, mockRes(), next);

    expect(next).toHaveBeenCalledTimes(1);
  });
});
