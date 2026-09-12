import { createHash, timingSafeEqual } from "node:crypto";

export function getBotServiceToken(): string | undefined {
  return process.env.BOT_SERVICE_TOKEN;
}

export function verifyBotServiceToken(presented: string): boolean {
  const expected = getBotServiceToken();
  if (!expected) {
    return false;
  }

  const presentedDigest = createHash("sha256").update(presented).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();

  return timingSafeEqual(presentedDigest, expectedDigest);
}
