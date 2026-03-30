export const VK_GROUP_PEER_MIN = 2_000_000_000n;
export const VK_USER_ID_MAX_EXCLUSIVE = VK_GROUP_PEER_MIN;

export type VkExplicitTarget = {
  kind: "user" | "chat";
  to: string;
  canonicalId: string;
  peerId: string;
  chatType: "direct" | "group";
  userId?: string;
};

export type VkParsedTarget =
  | {
      kind: "user";
      canonicalTarget: string;
      canonicalId: string;
      peerId: string;
      userId: string;
    }
  | {
      kind: "chat";
      canonicalTarget: string;
      canonicalId: string;
      peerId: string;
    };

function parseCanonicalPositiveInteger(raw: string): { canonical: string; value: bigint } | null {
  const trimmed = raw.trim();
  if (!/^[0-9]+$/.test(trimmed)) {
    return null;
  }
  const canonical = trimmed.replace(/^0+/, "");
  if (!canonical) {
    return null;
  }
  const value = BigInt(canonical);
  if (value <= 0n) {
    return null;
  }
  return { canonical, value };
}

export function normalizeVkUserId(raw: string): string | null {
  const parsed = parseCanonicalPositiveInteger(raw);
  if (!parsed || parsed.value >= VK_USER_ID_MAX_EXCLUSIVE) {
    return null;
  }
  return parsed.canonical;
}

export function normalizeVkChatPeerId(raw: string): string | null {
  const parsed = parseCanonicalPositiveInteger(raw);
  if (!parsed || parsed.value < VK_GROUP_PEER_MIN) {
    return null;
  }
  return parsed.canonical;
}

export function normalizeVkPeerId(raw: string): string | null {
  const userId = normalizeVkUserId(raw);
  if (userId) {
    return userId;
  }
  return normalizeVkChatPeerId(raw);
}

export function normalizeVkTarget(raw: string): string | null {
  return parseVkExplicitTarget(raw)?.to ?? null;
}

export function inferVkTargetChatType(raw: string): "direct" | "group" | null {
  return parseVkExplicitTarget(raw)?.chatType ?? null;
}

export function parseVkExplicitTarget(raw: string): VkExplicitTarget | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("vk:user:")) {
    const canonicalId = normalizeVkUserId(trimmed.slice("vk:user:".length));
    if (!canonicalId) {
      return null;
    }
    return {
      kind: "user",
      to: `vk:user:${canonicalId}`,
      canonicalId,
      peerId: canonicalId,
      chatType: "direct",
      userId: canonicalId,
    };
  }

  if (lower.startsWith("vk:chat:")) {
    const canonicalId = normalizeVkChatPeerId(trimmed.slice("vk:chat:".length));
    if (!canonicalId) {
      return null;
    }
    return {
      kind: "chat",
      to: `vk:chat:${canonicalId}`,
      canonicalId,
      peerId: canonicalId,
      chatType: "group",
    };
  }

  return null;
}

export function parseVkTarget(raw: string): VkParsedTarget | null {
  const parsed = parseVkExplicitTarget(raw);
  if (!parsed) {
    return null;
  }
  if (parsed.kind === "user") {
    return {
      kind: "user",
      canonicalTarget: parsed.to,
      canonicalId: parsed.canonicalId,
      peerId: parsed.peerId,
      userId: parsed.userId ?? parsed.peerId,
    };
  }
  return {
    kind: "chat",
    canonicalTarget: parsed.to,
    canonicalId: parsed.canonicalId,
    peerId: parsed.peerId,
  };
}
