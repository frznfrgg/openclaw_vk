import { createTopLevelChannelConfigAdapter } from "openclaw/plugin-sdk/channel-config-helpers";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-runtime";
import {
  DEFAULT_ACCOUNT_ID,
  buildChannelConfigSchema,
  createChannelPluginBase,
  getChatChannelMeta,
} from "openclaw/plugin-sdk/core";
import type { SecretInput } from "openclaw/plugin-sdk/setup";
import { inspectVkAccount } from "./account-inspect.js";
import { VkConfigSchema } from "./config-schema.js";

export const VK_CHANNEL = "vk" as const;
export const VK_DEFAULT_ACCOUNT_ID = DEFAULT_ACCOUNT_ID;
export const VK_ENV_ACCESS_TOKEN = "VK_COMMUNITY_ACCESS_TOKEN";
export const VK_API_BASE = "https://api.vk.com/method";
export const VK_API_VERSION = "5.199";

export type VkSecretInput = SecretInput;

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

export type VkCredentialStatus = "available" | "configured_unavailable" | "missing";

export type ResolvedVkAccount = {
  accountId: "default";
  enabled: true;
  configured: true;
  communityId: string;
  token: string;
  tokenSource: "config" | "env" | "tokenFile";
  tokenStatus: "available";
  config: VkAccountConfig;
};

export type InspectedVkAccount = {
  accountId: "default";
  enabled: boolean;
  configured: boolean;
  communityId?: string;
  token?: string;
  tokenSource: "config" | "env" | "tokenFile" | "none";
  tokenStatus: VkCredentialStatus;
  config: VkAccountConfig;
};

export const vkConfigAdapter = createTopLevelChannelConfigAdapter<InspectedVkAccount>({
  sectionKey: VK_CHANNEL,
  resolveAccount: (cfg) => inspectVkAccount({ cfg }),
  listAccountIds: () => [VK_DEFAULT_ACCOUNT_ID],
  defaultAccountId: () => VK_DEFAULT_ACCOUNT_ID,
  resolveAllowFrom: (account) => account.config.allowFrom,
  formatAllowFrom: (allowFrom) => allowFrom.map((entry) => String(entry).trim()).filter(Boolean),
  resolveDefaultTo: (account) => account.config.defaultTo,
});

export function createVkPluginBase(params: {
  setupWizard?: NonNullable<ChannelPlugin<InspectedVkAccount>["setupWizard"]>;
  setup: NonNullable<ChannelPlugin<InspectedVkAccount>["setup"]>;
}): Pick<
  ChannelPlugin<InspectedVkAccount>,
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
      media: true,
    },
    reload: { configPrefixes: ["channels.vk"] },
    configSchema: buildChannelConfigSchema(VkConfigSchema),
    config: {
      ...vkConfigAdapter,
      inspectAccount: (cfg) => inspectVkAccount({ cfg }),
      isConfigured: (account) => account.configured,
      describeAccount: (account) => ({
        accountId: account.accountId,
        enabled: account.enabled,
        configured: account.configured,
        communityId: account.communityId,
        tokenSource: account.tokenSource,
        tokenStatus: account.tokenStatus,
      }),
    },
    setup: params.setup,
  }) as Pick<
    ChannelPlugin<InspectedVkAccount>,
    "id" | "meta" | "setupWizard" | "capabilities" | "reload" | "configSchema" | "config" | "setup"
  >;
}
