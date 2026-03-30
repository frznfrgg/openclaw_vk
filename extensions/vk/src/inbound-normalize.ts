import { VK_GROUP_PEER_MIN } from "./targets.js";

type VkRawMessage = {
  peer_id?: unknown;
  from_id?: unknown;
  conversation_message_id?: unknown;
  text?: unknown;
  message?: unknown;
  date?: unknown;
  action?: unknown;
  attachments?: unknown;
};

export type VkNormalizedAttachment =
  | { kind: "image"; url: string; mimeType?: string; fileName?: string }
  | { kind: "document"; url: string; mimeType?: string; fileName?: string };

export type VkInboundEvent = {
  eventId: string;
  peerId: string;
  senderId: string;
  messageId: string;
  text: string;
  attachments: VkNormalizedAttachment[];
  chatType: "direct" | "group";
  timestamp: number;
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

function resolveFileNameFromUrl(url: string): string | undefined {
  try {
    const parsed = new URL(url);
    const base = parsed.pathname.split("/").at(-1)?.trim() ?? "";
    return base || undefined;
  } catch {
    return undefined;
  }
}

function resolveImageMimeType(url: string): string | undefined {
  const lower = url.toLowerCase();
  if (lower.endsWith(".gif")) {
    return "image/gif";
  }
  if (lower.endsWith(".png")) {
    return "image/png";
  }
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) {
    return "image/jpeg";
  }
  return undefined;
}

function resolveDocumentMimeType(ext: string | undefined): string | undefined {
  switch ((ext ?? "").trim().toLowerCase()) {
    case "gif":
      return "image/gif";
    case "jpeg":
    case "jpg":
      return "image/jpeg";
    case "json":
      return "application/json";
    case "pdf":
      return "application/pdf";
    case "png":
      return "image/png";
    case "txt":
      return "text/plain";
    case "zip":
      return "application/zip";
    default:
      return undefined;
  }
}

function pickBestPhotoUrl(
  raw: unknown,
): { url: string; mimeType?: string; fileName?: string } | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const sizes = Array.isArray(record.sizes) ? record.sizes : [];
  let best:
    | {
        url: string;
        score: number;
      }
    | undefined;

  for (const size of sizes) {
    if (!size || typeof size !== "object") {
      continue;
    }
    const sizeRecord = size as Record<string, unknown>;
    const url = typeof sizeRecord.url === "string" ? sizeRecord.url.trim() : "";
    if (!url) {
      continue;
    }
    const width = typeof sizeRecord.width === "number" ? sizeRecord.width : 0;
    const height = typeof sizeRecord.height === "number" ? sizeRecord.height : 0;
    const score = width > 0 && height > 0 ? width * height : 0;
    if (!best || score >= best.score) {
      best = { url, score };
    }
  }

  const legacyUrl =
    (typeof record.photo_2560 === "string" && record.photo_2560.trim()) ||
    (typeof record.photo_1280 === "string" && record.photo_1280.trim()) ||
    (typeof record.photo_807 === "string" && record.photo_807.trim()) ||
    (typeof record.photo_604 === "string" && record.photo_604.trim()) ||
    (typeof record.photo_130 === "string" && record.photo_130.trim()) ||
    (typeof record.photo_75 === "string" && record.photo_75.trim()) ||
    "";

  const resolvedUrl = best?.url ?? legacyUrl;
  if (!resolvedUrl) {
    return null;
  }

  return {
    url: resolvedUrl,
    mimeType: resolveImageMimeType(resolvedUrl),
    fileName: resolveFileNameFromUrl(resolvedUrl),
  };
}

function parseDocumentAttachment(raw: unknown): VkNormalizedAttachment | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const record = raw as Record<string, unknown>;
  const url = typeof record.url === "string" ? record.url.trim() : "";
  if (!url) {
    return null;
  }
  const title = typeof record.title === "string" ? record.title.trim() : "";
  const ext = typeof record.ext === "string" ? record.ext.trim().toLowerCase() : "";
  const fileName =
    title && ext && !title.toLowerCase().endsWith(`.${ext}`)
      ? `${title}.${ext}`
      : title || undefined;
  return {
    kind: "document",
    url,
    mimeType: resolveDocumentMimeType(ext),
    fileName: fileName ?? resolveFileNameFromUrl(url),
  };
}

function parseAttachments(raw: unknown): {
  attachments: VkNormalizedAttachment[];
  markers: string[];
} {
  const attachments: VkNormalizedAttachment[] = [];
  const markers: string[] = [];
  if (!Array.isArray(raw)) {
    return { attachments, markers };
  }

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") {
      markers.push("[vk attachment: unknown]");
      continue;
    }
    const record = entry as Record<string, unknown>;
    const type =
      typeof record.type === "string" && record.type.trim() ? record.type.trim() : "unknown";

    if (type === "photo") {
      const photo = pickBestPhotoUrl(record.photo);
      if (photo) {
        attachments.push({
          kind: "image",
          url: photo.url,
          mimeType: photo.mimeType,
          fileName: photo.fileName,
        });
      } else {
        markers.push("[vk attachment: photo]");
      }
      continue;
    }

    if (type === "doc") {
      const document = parseDocumentAttachment(record.doc);
      if (document) {
        attachments.push(document);
      } else {
        markers.push("[vk attachment: doc]");
      }
      continue;
    }

    markers.push(`[vk attachment: ${type}]`);
  }

  return { attachments, markers };
}

function appendAttachmentMarkers(text: string, markers: string[]): string {
  if (markers.length === 0) {
    return text;
  }
  return [text, ...markers].filter((entry) => entry.trim().length > 0).join("\n");
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
  const senderId = parsePositiveInteger(message.from_id);
  const messageId = parsePositiveInteger(message.conversation_message_id);
  if (!peerId || !senderId || !messageId) {
    return null;
  }
  const { attachments, markers } = parseAttachments(message.attachments);

  return {
    eventId,
    peerId,
    senderId,
    messageId,
    text: appendAttachmentMarkers(
      typeof message.text === "string"
        ? message.text
        : typeof message.message === "string"
          ? message.message
          : "",
      markers,
    ),
    attachments,
    timestamp: resolveTimestamp(message.date),
    chatType: BigInt(peerId) >= VK_GROUP_PEER_MIN ? "group" : "direct",
  };
}
