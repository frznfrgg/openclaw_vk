import { createTopLevelChannelConfigAdapter } from "openclaw/plugin-sdk/channel-config-helpers";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-runtime";
import {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  createChannelPluginBase,
  getChatChannelMeta,
} from "openclaw/plugin-sdk/core";
import {
  VkConfigSchema,
  normalizeVkAllowFromForConfigWrite,
  normalizeVkCommunityId,
  normalizeVkGroupsForConfigWrite,
  normalizeVkGroupAllowFromForConfigWrite,
} from "./config-schema.js";
import { normalizeVkTarget } from "./targets.js";

export const VK_CHANNEL = "vk" as const;

type VkSecretInput = string | { source: "env"; provider: string; id: string };

export type VkAccountConfig = {
  enabled?: boolean;
  communityId?: string;
  communityAccessToken?: VkSecretInput;
  tokenFile?: string;
  defaultTo?: string;
  allowFrom?: string[];
  groupAllowFrom?: string[];
  dmPolicy?: "open" | "pairing" | "allowlist" | "disabled";
  groupPolicy?: "open" | "allowlist" | "disabled";
  groups?: Record<string, { enabled?: boolean }>;
  healthMonitor?: { enabled?: boolean };
};

export type ResolvedVkAccount = {
  accountId: "default";
  enabled: boolean;
  configured: boolean;
  config: VkAccountConfig;
};

function hasConfiguredCredential(config: Record<string, unknown>): boolean {
  const token = config.communityAccessToken;
  if (typeof token === "string" && token.trim()) {
    return true;
  }
  if (
    token &&
    typeof token === "object" &&
    (token as { source?: unknown }).source === "env" &&
    typeof (token as { provider?: unknown }).provider === "string" &&
    typeof (token as { id?: unknown }).id === "string"
  ) {
    return true;
  }
  return typeof config.tokenFile === "string" && config.tokenFile.trim().length > 0;
}

function readMixedEntries(value: unknown): Array<string | number> {
  if (Array.isArray(value)) {
    return value as Array<string | number>;
  }
  if (typeof value === "string" || typeof value === "number") {
    return [value];
  }
  return [];
}

function readDmPolicy(value: unknown): VkAccountConfig["dmPolicy"] | undefined {
  if (value === "open" || value === "pairing" || value === "allowlist" || value === "disabled") {
    return value;
  }
  return undefined;
}

function readGroupPolicy(value: unknown): VkAccountConfig["groupPolicy"] | undefined {
  if (value === "open" || value === "allowlist" || value === "disabled") {
    return value;
  }
  return undefined;
}

export function resolveVkAccount(params: {
  cfg: { channels?: Record<string, unknown> };
}): ResolvedVkAccount {
  const section = (params.cfg.channels?.[VK_CHANNEL] as Record<string, unknown> | undefined) ?? {};
  const communityId = normalizeVkCommunityId(section.communityId);
  const defaultTo =
    typeof section.defaultTo === "string"
      ? (normalizeVkTarget(section.defaultTo) ?? undefined)
      : undefined;
  const allowFrom = normalizeVkAllowFromForConfigWrite(readMixedEntries(section.allowFrom));
  const groupAllowFrom = normalizeVkGroupAllowFromForConfigWrite(
    readMixedEntries(section.groupAllowFrom),
  );
  const groups = normalizeVkGroupsForConfigWrite(
    section.groups as Record<string, { enabled?: boolean }> | undefined,
  );

  const config: VkAccountConfig = {
    enabled: typeof section.enabled === "boolean" ? section.enabled : undefined,
    communityId: communityId ?? undefined,
    communityAccessToken: section.communityAccessToken as VkSecretInput | undefined,
    tokenFile:
      typeof section.tokenFile === "string" ? section.tokenFile.trim() || undefined : undefined,
    defaultTo,
    ...(allowFrom.length > 0 ? { allowFrom } : {}),
    ...(groupAllowFrom.length > 0 ? { groupAllowFrom } : {}),
    dmPolicy: readDmPolicy(section.dmPolicy),
    groupPolicy: readGroupPolicy(section.groupPolicy),
    groups,
    healthMonitor: section.healthMonitor as VkAccountConfig["healthMonitor"],
  };

  return {
    accountId: DEFAULT_ACCOUNT_ID,
    enabled: config.enabled !== false,
    configured: Boolean(config.communityId && hasConfiguredCredential(section)),
    config,
  };
}

export const vkConfigAdapter = createTopLevelChannelConfigAdapter<ResolvedVkAccount>({
  sectionKey: VK_CHANNEL,
  resolveAccount: (cfg) => resolveVkAccount({ cfg }),
  listAccountIds: () => [DEFAULT_ACCOUNT_ID],
  defaultAccountId: () => DEFAULT_ACCOUNT_ID,
  resolveAllowFrom: (account) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) => normalizeVkAllowFromForConfigWrite(allowFrom),
  resolveDefaultTo: (account) => account.config.defaultTo,
});

export function createVkPluginBase(params: {
  setupWizard?: NonNullable<ChannelPlugin<ResolvedVkAccount>["setupWizard"]>;
  setup: NonNullable<ChannelPlugin<ResolvedVkAccount>["setup"]>;
}): Pick<
  ChannelPlugin<ResolvedVkAccount>,
  "id" | "meta" | "setupWizard" | "capabilities" | "reload" | "configSchema" | "config" | "setup"
> {
  return createChannelPluginBase({
    id: VK_CHANNEL,
    meta: {
      ...getChatChannelMeta(VK_CHANNEL),
      quickstartAllowFrom: true,
    },
    ...(params.setupWizard ? { setupWizard: params.setupWizard } : {}),
    capabilities: {
      chatTypes: ["direct", "group"],
    },
    reload: { configPrefixes: ["channels.vk"] },
    configSchema: buildChannelConfigSchema(VkConfigSchema),
    config: {
      ...vkConfigAdapter,
      isConfigured: (account) => account.configured,
      describeAccount: (account) => ({
        accountId: account.accountId,
        enabled: account.enabled,
        configured: account.configured,
        communityId: account.config.communityId,
      }),
    },
    setup: params.setup,
  }) as Pick<
    ChannelPlugin<ResolvedVkAccount>,
    "id" | "meta" | "setupWizard" | "capabilities" | "reload" | "configSchema" | "config" | "setup"
  >;
}
