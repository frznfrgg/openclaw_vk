import { randomInt } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { stripMarkdown } from "openclaw/plugin-sdk/text-runtime";
import type { ChannelOutboundContext } from "../../../src/channels/plugins/types.adapters.js";
import type { OutboundDeliveryResult } from "../../../src/infra/outbound/deliver.js";
import { sanitizeForPlainText } from "../../../src/infra/outbound/sanitize-text.js";
import { inspectVkAccount } from "./account-inspect.js";
import { resolveVkAttachmentToken } from "./media.js";
import { writeVkRuntimeState } from "./runtime.js";
import { VK_API_BASE, VK_API_VERSION, VK_DEFAULT_ACCOUNT_ID } from "./shared.js";
import { parseVkTarget } from "./targets.js";
import { resolveVkRuntimeAccount } from "./token.js";

type VkSendResponseBody = {
  response?: number | string;
  error?: {
    error_code?: number;
    error_msg?: string;
  };
};

type VkSetActivityResponseBody = {
  response?: number;
  error?: {
    error_code?: number;
    error_msg?: string;
  };
};

const MAX_VK_RANDOM_ID = 2_147_483_647;
let nextVkRandomId = randomInt(1, MAX_VK_RANDOM_ID + 1);

export const VK_CANONICAL_TARGET_ERROR =
  'VK sendText requires a canonical target in the form "vk:user:<user_id>" or "vk:chat:<peer_id>".';

export function buildVkRandomId(): number {
  const current = nextVkRandomId;
  nextVkRandomId = current >= MAX_VK_RANDOM_ID ? 1 : current + 1;
  return current;
}

function flattenVkTextSegment(text: string): string {
  return stripMarkdown(sanitizeForPlainText(text)).trim();
}

function resolveVkPeerTarget(raw: string): { canonicalTarget: string; peerId: string } {
  const parsed = parseVkTarget(raw);
  if (!parsed) {
    throw new Error(VK_CANONICAL_TARGET_ERROR);
  }
  return {
    canonicalTarget: parsed.canonicalTarget,
    peerId: parsed.peerId,
  };
}

function resolveVkSendAccount(params: { cfg: OpenClawConfig; accountId?: string | null }) {
  const accountId = params.accountId?.trim() || VK_DEFAULT_ACCOUNT_ID;
  const inspected = inspectVkAccount({
    cfg: params.cfg,
    accountId,
  });
  const account = resolveVkRuntimeAccount({
    cfg: params.cfg,
    account: inspected,
  });
  if (!account) {
    throw new Error("VK is disabled.");
  }
  return { accountId, account };
}

async function sendVkMessage(params: {
  cfg: OpenClawConfig;
  to: string;
  accountId?: string | null;
  message?: string;
  attachment?: string;
  fetcher?: typeof fetch;
  randomId?: number;
}): Promise<OutboundDeliveryResult> {
  const message = params.message?.trim() ?? "";
  const attachment = params.attachment?.trim() ?? "";
  if (!message && !attachment) {
    throw new Error("VK send requires either message text or an attachment.");
  }

  const { accountId, account } = resolveVkSendAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const target = resolveVkPeerTarget(params.to);
  const body = new URLSearchParams();
  body.set("peer_id", target.peerId);
  if (message) {
    body.set("message", message);
  }
  if (attachment) {
    body.set("attachment", attachment);
  }
  body.set("random_id", String(params.randomId ?? buildVkRandomId()));
  body.set("access_token", account.token);
  body.set("v", VK_API_VERSION);

  const response = await (params.fetcher ?? fetch)(`${VK_API_BASE}/messages.send`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body,
  });

  let payload: VkSendResponseBody | undefined;
  try {
    payload = (await response.json()) as VkSendResponseBody;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.error_msg ?? `VK messages.send failed with HTTP ${response.status}.`,
    );
  }
  if (payload?.error) {
    throw new Error(
      payload.error.error_msg ??
        `VK messages.send failed (${payload.error.error_code ?? "unknown"}).`,
    );
  }

  const messageId = payload?.response;
  if (typeof messageId !== "number" && typeof messageId !== "string") {
    throw new Error("VK messages.send returned an invalid response payload.");
  }

  const timestamp = Date.now();
  writeVkRuntimeState(accountId, {
    lastOutboundAt: timestamp,
  });

  return {
    channel: "vk",
    messageId: String(messageId),
    chatId: target.peerId,
    conversationId: target.canonicalTarget,
    timestamp,
  };
}

export async function sendVkTyping(params: {
  cfg: OpenClawConfig;
  to: string;
  accountId?: string | null;
  fetcher?: typeof fetch;
}): Promise<void> {
  const { account } = resolveVkSendAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const target = resolveVkPeerTarget(params.to);
  const body = new URLSearchParams();
  body.set("peer_id", target.peerId);
  body.set("type", "typing");
  body.set("access_token", account.token);
  body.set("v", VK_API_VERSION);

  const response = await (params.fetcher ?? fetch)(`${VK_API_BASE}/messages.setActivity`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body,
  });

  let payload: VkSetActivityResponseBody | undefined;
  try {
    payload = (await response.json()) as VkSetActivityResponseBody;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.error_msg ?? `VK messages.setActivity failed with HTTP ${response.status}.`,
    );
  }
  if (payload?.error) {
    throw new Error(
      payload.error.error_msg ??
        `VK messages.setActivity failed (${payload.error.error_code ?? "unknown"}).`,
    );
  }
  if (payload?.response !== 1) {
    throw new Error("VK messages.setActivity returned an invalid response payload.");
  }
}

export async function sendVkText(
  params: ChannelOutboundContext & {
    fetcher?: typeof fetch;
    randomId?: number;
  },
): Promise<OutboundDeliveryResult> {
  const message = flattenVkTextSegment(params.text);
  if (!message) {
    throw new Error("VK sendText requires non-empty message text.");
  }
  return await sendVkMessage({
    cfg: params.cfg,
    to: params.to,
    accountId: params.accountId,
    message,
    fetcher: params.fetcher,
    randomId: params.randomId,
  });
}

export async function sendVkMedia(
  params: ChannelOutboundContext & {
    fetcher?: typeof fetch;
    randomId?: number;
  },
): Promise<OutboundDeliveryResult> {
  if (!params.mediaUrl?.trim()) {
    throw new Error("VK sendMedia requires mediaUrl.");
  }
  const message = flattenVkTextSegment(params.text);
  const { account } = resolveVkSendAccount({
    cfg: params.cfg,
    accountId: params.accountId,
  });
  const attachment = await resolveVkAttachmentToken({
    account,
    mediaUrl: params.mediaUrl,
    cfg: params.cfg,
    mediaLocalRoots: params.mediaLocalRoots,
    fetcher: params.fetcher,
  });
  return await sendVkMessage({
    cfg: params.cfg,
    to: params.to,
    accountId: params.accountId,
    message: message || undefined,
    attachment,
    fetcher: params.fetcher,
    randomId: params.randomId,
  });
}
