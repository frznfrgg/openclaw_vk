import { VK_GROUP_PEER_MIN } from "./targets.js";

type VkRawMessage = {
  peer_id?: unknown;
  from_id?: unknown;
  conversation_message_id?: unknown;
  text?: unknown;
  date?: unknown;
  action?: unknown;
};

export type VkInboundEvent = {
  eventId: string;
  peerId: string;
  senderUserId: string;
  conversationMessageId: string;
  text: string;
  timestamp: number;
  chatType: "direct" | "group";
};

function parsePositiveInteger(raw: unknown): string | null {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || raw <= 0) {
      return null;
    }
    return String(raw);
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!/^[1-9][0-9]*$/.test(trimmed)) {
    return null;
  }
  return trimmed;
}

function readRawMessage(update: Record<string, unknown>): VkRawMessage | null {
  const object = update.object;
  if (!object || typeof object !== "object") {
    return null;
  }
  const record = object as Record<string, unknown>;
  const message = record.message;
  if (message && typeof message === "object") {
    return message as VkRawMessage;
  }
  return record as VkRawMessage;
}

function resolveTimestamp(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return raw * 1000;
  }
  if (typeof raw === "string" && /^[1-9][0-9]*$/.test(raw.trim())) {
    return Number.parseInt(raw.trim(), 10) * 1000;
  }
  return Date.now();
}

export function normalizeVkLongPollUpdate(raw: unknown): VkInboundEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const update = raw as Record<string, unknown>;
  if (update.type !== "message_new") {
    return null;
  }

  const eventId =
    typeof update.event_id === "string" && update.event_id.trim() ? update.event_id.trim() : null;
  if (!eventId) {
    return null;
  }

  const message = readRawMessage(update);
  if (!message || message.action !== undefined) {
    return null;
  }

  const peerId = parsePositiveInteger(message.peer_id);
  const senderUserId = parsePositiveInteger(message.from_id);
  const conversationMessageId = parsePositiveInteger(message.conversation_message_id);
  if (!peerId || !senderUserId || !conversationMessageId) {
    return null;
  }

  return {
    eventId,
    peerId,
    senderUserId,
    conversationMessageId,
    text: typeof message.text === "string" ? message.text : "",
    timestamp: resolveTimestamp(message.date),
    chatType: BigInt(peerId) >= VK_GROUP_PEER_MIN ? "group" : "direct",
  };
}
