import { afterEach, describe, expect, it } from "vitest";

import { verifyBotServiceToken } from "@/auth/botServiceToken";

const TOKEN = "a".repeat(64); // 32 bytes hex-encoded

describe("verifyBotServiceToken", () => {
  afterEach(() => {
    process.env.BOT_SERVICE_TOKEN = TOKEN;
  });

  it("accepts the correct token", () => {
    process.env.BOT_SERVICE_TOKEN = TOKEN;
    expect(verifyBotServiceToken(TOKEN)).toBe(true);
  });

  it("rejects a wrong token of the same length", () => {
    process.env.BOT_SERVICE_TOKEN = TOKEN;
    expect(verifyBotServiceToken("b".repeat(64))).toBe(false);
  });

  it("rejects a short junk token without throwing", () => {
    process.env.BOT_SERVICE_TOKEN = TOKEN;
    expect(verifyBotServiceToken("short")).toBe(false);
  });

  it("rejects when no token is configured", () => {
    delete process.env.BOT_SERVICE_TOKEN;
    expect(verifyBotServiceToken(TOKEN)).toBe(false);
  });
});
