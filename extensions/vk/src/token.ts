import {
  coerceSecretRef,
  type OpenClawConfig,
} from "openclaw/plugin-sdk/config-runtime";
import { tryReadSecretFileSync } from "openclaw/plugin-sdk/core";
import { resolveDefaultSecretProviderAlias } from "openclaw/plugin-sdk/provider-auth";
import { normalizeSecretInputString } from "openclaw/plugin-sdk/secret-input";
import type { VkCredentialStatus, VkSecretInput } from "./shared.js";
import { VK_ENV_ACCESS_TOKEN, type VkAccountConfig, type ResolvedVkAccount } from "./shared.js";

export type VkResolvedToken = {
  token?: string;
  tokenSource: "config" | "env" | "tokenFile" | "none";
  tokenStatus: VkCredentialStatus;
};

function canResolveEnvSecretRefInReadOnlyPath(params: {
  cfg: OpenClawConfig;
  provider: string;
  id: string;
}): boolean {
  const providerConfig = params.cfg.secrets?.providers?.[params.provider];
  if (!providerConfig) {
    return params.provider === resolveDefaultSecretProviderAlias(params.cfg, "env");
  }
  if (providerConfig.source !== "env") {
    return false;
  }
  const allowlist = providerConfig.allowlist;
  return !allowlist || allowlist.includes(params.id);
}

function inspectTokenFile(pathValue: unknown): VkResolvedToken | null {
  const tokenFile = typeof pathValue === "string" ? pathValue.trim() : "";
  if (!tokenFile) {
    return null;
  }
  const token = tryReadSecretFileSync(tokenFile, "VK community access token", {
    rejectSymlink: true,
  });
  return {
    token: token || undefined,
    tokenSource: "tokenFile",
    tokenStatus: token ? "available" : "configured_unavailable",
  };
}

function inspectTokenValue(params: {
  cfg: OpenClawConfig;
  value: unknown;
}): VkResolvedToken | null {
  const ref = coerceSecretRef(params.value, params.cfg.secrets?.defaults);
  if (ref?.source === "env") {
    if (
      !canResolveEnvSecretRefInReadOnlyPath({
        cfg: params.cfg,
        provider: ref.provider,
        id: ref.id,
      })
    ) {
      return {
        token: undefined,
        tokenSource: "env",
        tokenStatus: "configured_unavailable",
      };
    }
    const envValue = process.env[ref.id];
    if (envValue?.trim()) {
      return {
        token: envValue.trim(),
        tokenSource: "env",
        tokenStatus: "available",
      };
    }
    return {
      token: undefined,
      tokenSource: "env",
      tokenStatus: "configured_unavailable",
    };
  }

  const token = normalizeSecretInputString(params.value);
  if (token) {
    return {
      token,
      tokenSource: "config",
      tokenStatus: "available",
    };
  }

  if (ref) {
    return {
      token: undefined,
      tokenSource: "config",
      tokenStatus: "configured_unavailable",
    };
  }

  return null;
}

export function resolveVkToken(params: {
  cfg: OpenClawConfig;
  config: VkAccountConfig;
}): VkResolvedToken {
  const fileToken = inspectTokenFile(params.config.tokenFile);
  if (fileToken) {
    return fileToken;
  }

  const configuredToken = inspectTokenValue({
    cfg: params.cfg,
    value: params.config.communityAccessToken,
  });
  if (configuredToken) {
    return configuredToken;
  }

  return {
    token: undefined,
    tokenSource: "none",
    tokenStatus: "missing",
  };
}

export function buildVkUseEnvSecretRef(): VkSecretInput {
  return {
    source: "env",
    provider: "default",
    id: VK_ENV_ACCESS_TOKEN,
  };
}

export function resolveVkCredentialSourceCount(config: VkAccountConfig): number {
  let count = 0;
  if (typeof config.tokenFile === "string" && config.tokenFile.trim()) {
    count += 1;
  }
  if (config.communityAccessToken !== undefined) {
    count += 1;
  }
  return count;
}

export function resolveVkRuntimeAccount(params: {
  cfg: OpenClawConfig;
  account: {
    accountId: "default";
    enabled: boolean;
    configured: boolean;
    communityId?: string;
    token?: string;
    tokenSource: "config" | "env" | "tokenFile" | "none";
    tokenStatus: VkCredentialStatus;
    config: VkAccountConfig;
  };
}): ResolvedVkAccount | null {
  const { account } = params;
  if (!account.enabled) {
    return null;
  }
  if (!account.communityId) {
    throw new Error("VK runtime requires channels.vk.communityId.");
  }
  if (account.tokenSource === "none") {
    throw new Error(
      "VK runtime requires exactly one credential source: communityAccessToken, tokenFile, or VK_COMMUNITY_ACCESS_TOKEN.",
    );
  }
  if (account.tokenStatus !== "available" || !account.token?.trim()) {
    throw new Error("VK runtime could not resolve the configured community access token.");
  }
  return {
    accountId: account.accountId,
    enabled: true,
    configured: true,
    communityId: account.communityId,
    token: account.token,
    tokenSource: account.tokenSource,
    tokenStatus: "available",
    config: account.config,
  };
}
