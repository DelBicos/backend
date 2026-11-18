import {
  calculateDistanceInMeters,
  validateArrivedDistance,
  validateConfirmationCode,
  validateInTransitTransition,
  validateArrivedTransition,
  validateCheckinTransition,
  validateCheckoutTransition,
  canAccessAuditTrailRule,
  MAX_ARRIVAL_DISTANCE_METERS,
} from "../checkin.rules";

describe("appointment/checkin.rules", () => {
  describe("calculateDistanceInMeters", () => {
    it("deve retornar 0 para mesmos pontos", () => {
      expect(calculateDistanceInMeters(0, 0, 0, 0)).toBe(0);
    });
  });

  describe("validateArrivedDistance", () => {
    it("deve retornar válido se lat ou lng forem nulos", () => {
      const res = validateArrivedDistance(-23.55, -46.63, null, null);
      expect(res.valid).toBe(true);
    });

    it("deve retornar inválido se além do raio máximo", () => {
      const res = validateArrivedDistance(-23.55, -46.63, -23.65, -46.73, 300);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("Aproxime-se");
    });

    it("deve retornar válido se dentro do raio", () => {
      const res = validateArrivedDistance(-23.5505, -46.6333, -23.5505, -46.6333, 300);
      expect(res.valid).toBe(true);
    });
  });

  describe("validateConfirmationCode", () => {
    it("deve validar igualdade exata de código", () => {
      expect(validateConfirmationCode("AB-12", "AB-12")).toBe(true);
      expect(validateConfirmationCode("ab-12", "AB-12")).toBe(false);
      expect(validateConfirmationCode(undefined, "AB-12")).toBe(false);
    });
  });

  describe("validateInTransitTransition", () => {
    it("deve rejeitar se não for o profissional", () => {
      const res = validateInTransitTransition("confirmed", 10, 20);
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.status).toBe(403);
    });

    it("deve rejeitar status diferente de confirmed ou in_transit", () => {
      const res = validateInTransitTransition("pending", 10, 10);
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.status).toBe(400);
    });

    it("deve aceitar quando válido", () => {
      const res = validateInTransitTransition("confirmed", 10, 10);
      expect(res.valid).toBe(true);
    });
  });

  describe("validateArrivedTransition", () => {
    it("deve aceitar status in_transit ou arrived", () => {
      expect(validateArrivedTransition("in_transit", 10, 10).valid).toBe(true);
      expect(validateArrivedTransition("arrived", 10, 10).valid).toBe(true);
      expect(validateArrivedTransition("pending", 10, 10).valid).toBe(false);
    });
  });

  describe("validateCheckinTransition", () => {
    it("deve rejeitar se já foi utilizado", () => {
      const res = validateCheckinTransition("in_progress", 10, 10, "AB-12", "AB-12");
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.reason).toBe("already_used");
    });

    it("deve rejeitar status que não seja arrived", () => {
      const res = validateCheckinTransition("in_transit", 10, 10, "AB-12", "AB-12");
      expect(res.valid).toBe(false);
    });

    it("deve rejeitar código incorreto", () => {
      const res = validateCheckinTransition("arrived", 10, 10, "WRONG", "AB-12");
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.reason).toBe("invalid_code");
    });

    it("deve aceitar quando tudo correto", () => {
      const res = validateCheckinTransition("arrived", 10, 10, "AB-12", "AB-12");
      expect(res.valid).toBe(true);
    });
  });

  describe("validateCheckoutTransition", () => {
    it("deve rejeitar se já completed", () => {
      const res = validateCheckoutTransition("completed", 10, 10, "AB-12", "AB-12");
      expect(res.valid).toBe(false);
      if (!res.valid) expect(res.reason).toBe("already_completed");
    });

    it("deve rejeitar se status diferente de in_progress", () => {
      const res = validateCheckoutTransition("arrived", 10, 10, "AB-12", "AB-12");
      expect(res.valid).toBe(false);
    });

    it("deve aceitar quando válido", () => {
      const res = validateCheckoutTransition("in_progress", 10, 10, "AB-12", "AB-12");
      expect(res.valid).toBe(true);
    });
  });

  describe("canAccessAuditTrailRule", () => {
    it("deve permitir para admin ou participantes", () => {
      expect(canAccessAuditTrailRule(1, 2, 99, true)).toBe(true);
      expect(canAccessAuditTrailRule(1, 2, 1, false)).toBe(true);
      expect(canAccessAuditTrailRule(1, 2, 2, false)).toBe(true);
      expect(canAccessAuditTrailRule(1, 2, 3, false)).toBe(false);
    });
  });
});
