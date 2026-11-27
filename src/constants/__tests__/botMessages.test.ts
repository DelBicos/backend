import { BotMessages } from "../botMessages";

describe("constants/botMessages", () => {
  it("expoe as mensagens fixas do chatbot", () => {
    expect(Object.keys(BotMessages)).toEqual(
      expect.arrayContaining(["GREETING", "DEFAULT_FALLBACK", "ERROR_GENERIC"]),
    );
    for (const message of Object.values(BotMessages)) expect(message.length).toBeGreaterThan(0);
  });
});
