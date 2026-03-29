import { DmPolicySchema, GroupPolicySchema } from "openclaw/plugin-sdk/channel-config-schema";
import { buildSecretInputSchema } from "openclaw/plugin-sdk/secret-input";
import { z } from "zod";
import { VK_GROUP_PEER_MIN, normalizeVkTarget } from "./targets.js";

const VK_COMMUNITY_TOKEN_SECRET_REF_ERROR =
  "channels.vk.communityAccessToken must be plaintext or an env SecretRef (source=env).";
const VK_DM_POLICY_ALLOWLIST_ERROR =
  'channels.vk.dmPolicy="allowlist" requires channels.vk.allowFrom to include at least one numeric VK user id.';
const VK_DM_POLICY_OPEN_ERROR =
  'channels.vk.dmPolicy="open" requires channels.vk.allowFrom to be exactly ["*"].';
const VK_DM_POLICY_DISALLOWED_ALLOW_FROM_ERROR =
  'channels.vk.allowFrom must be empty unless channels.vk.dmPolicy is "allowlist" or "open".';
const VK_GROUP_POLICY_ALLOWLIST_ERROR =
  'channels.vk.groupPolicy="allowlist" requires channels.vk.groupAllowFrom to include at least one numeric VK user id.';
const VK_GROUP_POLICY_OPEN_ERROR =
  'channels.vk.groupPolicy="open" requires channels.vk.groupAllowFrom to be empty.';
const VK_GROUP_POLICY_DISABLED_ERROR =
  'channels.vk.groupPolicy="disabled" requires channels.vk.groupAllowFrom to be empty.';
const VK_GROUP_POLICY_DISALLOWED_ALLOW_FROM_ERROR =
  'channels.vk.groupAllowFrom must be empty unless channels.vk.groupPolicy is "allowlist".';

const VK_USER_ID_MAX_EXCLUSIVE = VK_GROUP_PEER_MIN;
const DIGITS_RE = /^[0-9]+$/;
const VK_GROUPS_KEY_ERROR =
  "channels.vk.groups keys must be canonical VK group peer_id values (>= 2000000000).";
const VK_COMMUNITY_ID_ERROR = "channels.vk.communityId must be a positive numeric VK community id.";
const VK_ALLOW_FROM_ENTRY_ERROR =
  "channels.vk.allowFrom entries must be numeric VK user ids or '*'.";
const VK_GROUP_ALLOW_FROM_ENTRY_ERROR =
  "channels.vk.groupAllowFrom entries must be numeric VK user ids.";
const VK_DEFAULT_TO_ERROR =
  'channels.vk.defaultTo must be "vk:user:<user_id>" or "vk:chat:<peer_id>".';

type CanonicalVkId = { canonical: string; value: bigint };

function parseCanonicalVkPositiveInteger(raw: unknown): CanonicalVkId | null {
  if (typeof raw === "number") {
    if (!Number.isInteger(raw) || !Number.isSafeInteger(raw) || raw <= 0) {
      return null;
    }
    return { canonical: String(raw), value: BigInt(raw) };
  }
  if (typeof raw !== "string") {
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed || !DIGITS_RE.test(trimmed)) {
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

function normalizeVkUserId(raw: unknown): string | null {
  const parsed = parseCanonicalVkPositiveInteger(raw);
  if (!parsed || parsed.value >= VK_USER_ID_MAX_EXCLUSIVE) {
    return null;
  }
  return parsed.canonical;
}

export function normalizeVkGroupPeerIdForConfigWrite(raw: unknown): string | null {
  const parsed = parseCanonicalVkPositiveInteger(raw);
  if (!parsed || parsed.value < VK_GROUP_PEER_MIN) {
    return null;
  }
  return parsed.canonical;
}

export function normalizeVkCommunityId(raw: unknown): string | null {
  const parsed = parseCanonicalVkPositiveInteger(raw);
  return parsed?.canonical ?? null;
}

function toEntryList(raw: unknown): unknown[] {
  if (Array.isArray(raw)) {
    return raw;
  }
  return [raw];
}

function dedupeEntries(entries: string[]): string[] {
  return [...new Set(entries)];
}

export function normalizeVkAllowFromForConfigWrite(allowFrom: Array<string | number>): string[] {
  const normalized: string[] = [];
  for (const entry of allowFrom) {
    const value = String(entry).trim();
    if (!value) {
      continue;
    }
    if (value === "*") {
      normalized.push("*");
      continue;
    }
    const userId = normalizeVkUserId(value);
    if (userId) {
      normalized.push(userId);
    }
  }
  return dedupeEntries(normalized);
}

export function normalizeVkGroupAllowFromForConfigWrite(
  allowFrom: Array<string | number>,
): string[] {
  const normalized: string[] = [];
  for (const entry of allowFrom) {
    const value = String(entry).trim();
    if (!value || value === "*") {
      continue;
    }
    const userId = normalizeVkUserId(value);
    if (userId) {
      normalized.push(userId);
    }
  }
  return dedupeEntries(normalized);
}

export function normalizeVkGroupsForConfigWrite(
  groups: Record<string, { enabled?: boolean }> | undefined,
): Record<string, { enabled?: boolean }> | undefined {
  if (!groups) {
    return undefined;
  }
  const normalized: Record<string, { enabled?: boolean }> = {};
  for (const [groupId, groupConfig] of Object.entries(groups)) {
    const canonicalGroupId = normalizeVkGroupPeerIdForConfigWrite(groupId);
    if (!canonicalGroupId) {
      continue;
    }
    normalized[canonicalGroupId] = groupConfig;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function normalizeVkAllowFromInput(raw: unknown, ctx: z.RefinementCtx): string[] {
  const normalized: string[] = [];
  const entries = toEntryList(raw);
  for (const [index, entry] of entries.entries()) {
    const value = String(entry).trim();
    if (!value) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: VK_ALLOW_FROM_ENTRY_ERROR,
      });
      continue;
    }
    if (value === "*") {
      normalized.push("*");
      continue;
    }
    const userId = normalizeVkUserId(value);
    if (!userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: VK_ALLOW_FROM_ENTRY_ERROR,
      });
      continue;
    }
    normalized.push(userId);
  }
  return dedupeEntries(normalized);
}

function normalizeVkGroupAllowFromInput(raw: unknown, ctx: z.RefinementCtx): string[] {
  const normalized: string[] = [];
  const entries = toEntryList(raw);
  for (const [index, entry] of entries.entries()) {
    const value = String(entry).trim();
    if (!value || value === "*") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: VK_GROUP_ALLOW_FROM_ENTRY_ERROR,
      });
      continue;
    }
    const userId = normalizeVkUserId(value);
    if (!userId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [index],
        message: VK_GROUP_ALLOW_FROM_ENTRY_ERROR,
      });
      continue;
    }
    normalized.push(userId);
  }
  return dedupeEntries(normalized);
}

const VkHealthMonitorSchema = z
  .object({
    enabled: z.boolean().optional(),
  })
  .strict()
  .optional();

const VkCommunityAccessTokenSchema = buildSecretInputSchema().superRefine((value, ctx) => {
  if (typeof value === "string") {
    return;
  }
  if (value.source !== "env") {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: VK_COMMUNITY_TOKEN_SECRET_REF_ERROR,
    });
  }
});

const VkAllowFromSchema = z
  .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
  .transform((raw, ctx) => normalizeVkAllowFromInput(raw, ctx))
  .optional();

const VkGroupAllowFromSchema = z
  .union([z.string(), z.number(), z.array(z.union([z.string(), z.number()]))])
  .transform((raw, ctx) => normalizeVkGroupAllowFromInput(raw, ctx))
  .optional();

const VkGroupsSchema = z
  .record(
    z.string(),
    z
      .object({
        enabled: z.boolean().optional(),
      })
      .strict(),
  )
  .transform((raw, ctx) => {
    const normalized: Record<string, { enabled?: boolean }> = {};
    for (const [groupId, groupCfg] of Object.entries(raw)) {
      const normalizedGroupId = normalizeVkGroupPeerIdForConfigWrite(groupId);
      if (!normalizedGroupId) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [groupId],
          message: VK_GROUPS_KEY_ERROR,
        });
        continue;
      }
      normalized[normalizedGroupId] = groupCfg as { enabled?: boolean };
    }
    return normalized;
  })
  .optional();

export const VkConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    communityId: z.union([z.string(), z.number()]).transform((raw, ctx) => {
      const normalized = normalizeVkCommunityId(raw);
      if (!normalized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: VK_COMMUNITY_ID_ERROR,
        });
        return z.NEVER;
      }
      return normalized;
    }),
    communityAccessToken: VkCommunityAccessTokenSchema.optional(),
    tokenFile: z.string().trim().min(1).optional(),
    defaultTo: z
      .string()
      .transform((raw, ctx) => {
        const normalized = normalizeVkTarget(raw);
        if (!normalized) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: VK_DEFAULT_TO_ERROR,
          });
          return z.NEVER;
        }
        return normalized;
      })
      .optional(),
    allowFrom: VkAllowFromSchema,
    groupAllowFrom: VkGroupAllowFromSchema,
    dmPolicy: DmPolicySchema.optional(),
    groupPolicy: GroupPolicySchema.optional(),
    groups: VkGroupsSchema,
    healthMonitor: VkHealthMonitorSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const dmPolicy = value.dmPolicy ?? "pairing";
    const allowFrom = value.allowFrom ?? [];
    if (dmPolicy === "allowlist") {
      if (allowFrom.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowFrom"],
          message: VK_DM_POLICY_ALLOWLIST_ERROR,
        });
      }
      if (allowFrom.includes("*")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowFrom"],
          message: VK_DM_POLICY_ALLOWLIST_ERROR,
        });
      }
    } else if (dmPolicy === "open") {
      if (!(allowFrom.length === 1 && allowFrom[0] === "*")) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["allowFrom"],
          message: VK_DM_POLICY_OPEN_ERROR,
        });
      }
    } else if (allowFrom.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["allowFrom"],
        message: VK_DM_POLICY_DISALLOWED_ALLOW_FROM_ERROR,
      });
    }

    const groupPolicy = value.groupPolicy ?? "open";
    const groupAllowFrom = value.groupAllowFrom ?? [];
    if (groupPolicy === "allowlist") {
      if (groupAllowFrom.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groupAllowFrom"],
          message: VK_GROUP_POLICY_ALLOWLIST_ERROR,
        });
      }
    } else if (groupPolicy === "open") {
      if (groupAllowFrom.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groupAllowFrom"],
          message: VK_GROUP_POLICY_OPEN_ERROR,
        });
      }
    } else if (groupPolicy === "disabled") {
      if (groupAllowFrom.length > 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["groupAllowFrom"],
          message: VK_GROUP_POLICY_DISABLED_ERROR,
        });
      }
    } else if (groupAllowFrom.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["groupAllowFrom"],
        message: VK_GROUP_POLICY_DISALLOWED_ALLOW_FROM_ERROR,
      });
    }
  });

export type VkConfig = z.infer<typeof VkConfigSchema>;
