import { randomInt } from "node:crypto";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { OutboundDeliveryResult } from "../../../src/infra/outbound/deliver.js";
import { inspectVkAccount } from "./account-inspect.js";
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

export function buildVkRandomId(): number {
  return randomInt(1, 2_147_483_647);
}

function resolveVkDirectPeerTarget(raw: string): { canonicalTarget: string; peerId: string } {
  const parsed = parseVkTarget(raw);
  if (!parsed || parsed.kind !== "user") {
    throw new Error(
      'VK sendText requires a canonical direct target in the form "vk:user:<user_id>".',
    );
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
  const message = params.text.trim();
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

  const target = resolveVkDirectPeerTarget(params.to);
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

  return {
    channel: "vk",
    messageId: String(messageId),
    chatId: target.peerId,
    conversationId: target.canonicalTarget,
    timestamp: Date.now(),
  };
}
