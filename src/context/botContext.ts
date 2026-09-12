import { AsyncLocalStorage } from "node:async_hooks";

export interface BotContext {
  isBotCall: true;
  userId: string | undefined;
  managementOverride: true;
}

const botContextStorage = new AsyncLocalStorage<BotContext>();

export function runBotContext<T>(store: BotContext, callback: () => T): T {
  return botContextStorage.run(store, callback);
}

export function getBotContext(): BotContext | undefined {
  return botContextStorage.getStore();
}
