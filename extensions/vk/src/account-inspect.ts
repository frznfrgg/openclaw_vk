import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { normalizeSecretInputString } from "openclaw/plugin-sdk/secret-input";
import {
  normalizeVkAllowFromForConfigWrite,
  normalizeVkCommunityId,
  normalizeVkGroupAllowFromForConfigWrite,
  normalizeVkGroupsForConfigWrite,
} from "./config-schema.js";
import type { InspectedVkAccount, VkAccountConfig } from "./shared.js";
import { normalizeVkTarget } from "./targets.js";
import { resolveVkToken } from "./token.js";

const VK_CHANNEL = "vk" as const;
const VK_DEFAULT_ACCOUNT_ID = DEFAULT_ACCOUNT_ID;

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

function readMixedEntries(value: unknown): Array<string | number> {
  if (Array.isArray(value)) {
    return value as Array<string | number>;
  }
  if (typeof value === "string" || typeof value === "number") {
    return [value];
  }
  return [];
}

export function resolveVkAccountConfig(cfg: OpenClawConfig): VkAccountConfig {
  const section = (cfg.channels?.[VK_CHANNEL] as Record<string, unknown> | undefined) ?? {};
  const defaultTo =
    typeof section.defaultTo === "string"
      ? (normalizeVkTarget(section.defaultTo) ?? undefined)
      : undefined;

  return {
    enabled: typeof section.enabled === "boolean" ? section.enabled : undefined,
    communityId: normalizeVkCommunityId(section.communityId) ?? undefined,
    communityAccessToken: section.communityAccessToken as VkAccountConfig["communityAccessToken"],
    tokenFile: normalizeSecretInputString(section.tokenFile),
    defaultTo,
    allowFrom: normalizeVkAllowFromForConfigWrite(readMixedEntries(section.allowFrom)),
    groupAllowFrom: normalizeVkGroupAllowFromForConfigWrite(
      readMixedEntries(section.groupAllowFrom),
    ),
    dmPolicy: readDmPolicy(section.dmPolicy),
    groupPolicy: readGroupPolicy(section.groupPolicy),
    groups: normalizeVkGroupsForConfigWrite(
      section.groups as Record<string, { enabled?: boolean }> | undefined,
    ),
    healthMonitor: section.healthMonitor as VkAccountConfig["healthMonitor"],
  };
}

export function inspectVkAccount(params: {
  cfg: OpenClawConfig;
  accountId?: string | null;
}): InspectedVkAccount {
  if (params.accountId && params.accountId !== VK_DEFAULT_ACCOUNT_ID) {
    throw new Error('VK supports only the "default" account id.');
  }

  const config = resolveVkAccountConfig(params.cfg);
  const token = resolveVkToken({
    cfg: params.cfg,
    config,
  });
  const configured = Boolean(config.communityId && token.tokenSource !== "none");

  return {
    accountId: VK_DEFAULT_ACCOUNT_ID,
    enabled: config.enabled !== false,
    configured,
    communityId: config.communityId,
    token: token.token,
    tokenSource: token.tokenSource,
    tokenStatus: token.tokenStatus,
    config,
  };
}
