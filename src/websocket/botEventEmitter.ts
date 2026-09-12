import { getBotContext } from "@/context/botContext";

export type BotEventTable = "polls" | "votes" | "tags";
export type BotEventOperation = "create" | "update" | "delete";

export interface BotEventFrame {
  table: BotEventTable;
  operation: BotEventOperation;
  id: number;
}

type BroadcastFn = (frame: BotEventFrame) => void;

let broadcast: BroadcastFn | null = null;

export function setBroadcastFn(fn: BroadcastFn | null): void {
  broadcast = fn;
}

export function emitBotEvent(
  table: BotEventTable,
  operation: BotEventOperation,
  id: number,
): void {
  if (getBotContext()?.isBotCall === true) return;
  broadcast?.({ table, operation, id });
}
