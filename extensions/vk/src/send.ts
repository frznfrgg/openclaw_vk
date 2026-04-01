import { randomInt } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { stripMarkdown } from "openclaw/plugin-sdk/text-runtime";
import type { OutboundDeliveryResult } from "../../../src/infra/outbound/deliver.js";
import { sanitizeForPlainText } from "../../../src/infra/outbound/sanitize-text.js";
import { inspectVkAccount } from "./account-inspect.js";
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

export async function sendVkText(params: {
  cfg: OpenClawConfig;
  to: string;
  text: string;
  accountId?: string | null;
  fetcher?: typeof fetch;
  randomId?: number;
}): Promise<OutboundDeliveryResult> {
  const message = flattenVkTextSegment(params.text);
  if (!message) {
    throw new Error("VK sendText requires non-empty message text.");
  }

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

  const target = resolveVkPeerTarget(params.to);
  const body = new URLSearchParams();
  body.set("peer_id", target.peerId);
  body.set("message", message);
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
