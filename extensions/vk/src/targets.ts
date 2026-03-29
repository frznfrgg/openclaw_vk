export const VK_GROUP_PEER_MIN = 2_000_000_000n;
export const VK_USER_ID_MAX_EXCLUSIVE = VK_GROUP_PEER_MIN;

function parseCanonicalPositiveInteger(raw: string): { canonical: string; value: bigint } | null {
  if (!/^[0-9]+$/.test(raw)) {
    return null;
  }
  const canonical = raw.replace(/^0+/, "");
  if (!canonical) {
    return null;
  }
  const value = BigInt(canonical);
  if (value <= 0n) {
    return null;
  }
  return { canonical, value };
}

export function normalizeVkTarget(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return null;
  }

  const lower = trimmed.toLowerCase();
  if (lower.startsWith("vk:user:")) {
    const parsed = parseCanonicalPositiveInteger(trimmed.slice("vk:user:".length));
    if (!parsed || parsed.value >= VK_USER_ID_MAX_EXCLUSIVE) {
      return null;
    }
    return `vk:user:${parsed.canonical}`;
  }

  if (lower.startsWith("vk:chat:")) {
    const parsed = parseCanonicalPositiveInteger(trimmed.slice("vk:chat:".length));
    if (!parsed || parsed.value < VK_GROUP_PEER_MIN) {
      return null;
    }
    return `vk:chat:${parsed.canonical}`;
  }

  return null;
}
