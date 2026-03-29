import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import { normalizeSecretInputString } from "openclaw/plugin-sdk/secret-input";
import {
  patchTopLevelChannelConfigSection,
  type ChannelSetupAdapter,
  type ChannelSetupInput,
} from "openclaw/plugin-sdk/setup";
import { inspectVkAccount } from "./account-inspect.js";
import { normalizeVkCommunityId } from "./config-schema.js";
import { probeVkAccount } from "./probe.js";
import { VK_DEFAULT_ACCOUNT_ID, type VkSecretInput } from "./shared.js";
import {
  buildVkUseEnvSecretRef,
  resolveVkCredentialSourceCount,
  resolveVkRuntimeAccount,
} from "./token.js";

export const VK_ACCOUNT_ID_ERROR = 'VK supports only the "default" account id.';
export const VK_COMMUNITY_ID_INPUT_ERROR = "VK community id must be a positive numeric id.";
export const VK_COMMUNITY_TOKEN_INPUT_ERROR =
  "VK community access token must be a non-empty string.";
export const VK_TOKEN_FILE_INPUT_ERROR = "VK token file must be a non-empty path.";
export const VK_USE_ENV_ACCOUNT_ERROR = "VK --use-env can only be used for the default account.";
export const VK_SETUP_MISSING_COMMUNITY_ID_ERROR = "VK setup requires a community id.";
export const VK_SETUP_CREDENTIAL_ERROR =
  "VK setup requires exactly one credential source: communityAccessToken, tokenFile, or VK_COMMUNITY_ACCESS_TOKEN.";

function normalizeSetupString(value: unknown): string | undefined {
  const normalized = normalizeSecretInputString(value);
  return normalized?.trim() || undefined;
}

function normalizeSetupCommunityId(value: unknown): string | undefined {
  if (value == null) {
    return undefined;
  }
  return normalizeVkCommunityId(value) ?? undefined;
}

function patchVkConfig(params: {
  cfg: OpenClawConfig;
  patch?: Partial<{
    communityId: string;
    communityAccessToken: VkSecretInput;
    tokenFile: string;
  }>;
  clearFields?: string[];
}): OpenClawConfig {
  return patchTopLevelChannelConfigSection({
    cfg: params.cfg,
    channel: "vk",
    enabled: true,
    clearFields: params.clearFields,
    patch: params.patch ?? {},
  });
}

export function resolveVkSetupAccountId(accountId?: string): "default" {
  const trimmed = accountId?.trim();
  if (!trimmed || trimmed.toLowerCase() === DEFAULT_ACCOUNT_ID) {
    return VK_DEFAULT_ACCOUNT_ID;
  }
  throw new Error(VK_ACCOUNT_ID_ERROR);
}

export function validateVkSetupInput(
  input: ChannelSetupInput,
  accountId = VK_DEFAULT_ACCOUNT_ID,
): string | null {
  if (input.useEnv === true && accountId !== VK_DEFAULT_ACCOUNT_ID) {
    return VK_USE_ENV_ACCOUNT_ERROR;
  }
  if (input.communityId !== undefined && !normalizeSetupCommunityId(input.communityId)) {
    return VK_COMMUNITY_ID_INPUT_ERROR;
  }
  if (
    input.communityAccessToken !== undefined &&
    typeof input.communityAccessToken === "string" &&
    !normalizeSetupString(input.communityAccessToken)
  ) {
    return VK_COMMUNITY_TOKEN_INPUT_ERROR;
  }
  if (input.tokenFile !== undefined && !normalizeSetupString(input.tokenFile)) {
    return VK_TOKEN_FILE_INPUT_ERROR;
  }
  return null;
}

export const vkSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => resolveVkSetupAccountId(accountId),
  validateInput: ({ input, accountId }) => validateVkSetupInput(input, accountId),
  applyAccountConfig: ({ cfg, input }) => {
    const communityId = normalizeSetupCommunityId(input.communityId);
    const inlineToken =
      typeof input.communityAccessToken === "string"
        ? normalizeSetupString(input.communityAccessToken)
        : input.communityAccessToken;
    const tokenFile = normalizeSetupString(input.tokenFile);

    if (input.useEnv === true) {
      return patchVkConfig({
        cfg,
        patch: {
          ...(communityId ? { communityId } : {}),
          communityAccessToken: buildVkUseEnvSecretRef(),
        },
        clearFields: ["tokenFile"],
      });
    }

    if (tokenFile) {
      return patchVkConfig({
        cfg,
        patch: {
          ...(communityId ? { communityId } : {}),
          tokenFile,
        },
        clearFields: ["communityAccessToken"],
      });
    }

    if (inlineToken !== undefined) {
      return patchVkConfig({
        cfg,
        patch: {
          ...(communityId ? { communityId } : {}),
          communityAccessToken: inlineToken,
        },
        clearFields: ["tokenFile"],
      });
    }

    return patchVkConfig({
      cfg,
      patch: {
        ...(communityId ? { communityId } : {}),
      },
    });
  },
  validateCompleteInput: ({ candidateCfg }) => {
    const inspected = inspectVkAccount({ cfg: candidateCfg });
    if (!inspected.communityId) {
      return VK_SETUP_MISSING_COMMUNITY_ID_ERROR;
    }
    const credentialSources = resolveVkCredentialSourceCount(inspected.config);
    if (credentialSources !== 1) {
      return VK_SETUP_CREDENTIAL_ERROR;
    }
    return null;
  },
  validateInputAsync: async ({ candidateCfg }) => {
    try {
      const inspected = inspectVkAccount({ cfg: candidateCfg });
      const runtimeAccount = resolveVkRuntimeAccount({
        cfg: candidateCfg,
        account: inspected,
      });
      if (!runtimeAccount) {
        return VK_SETUP_CREDENTIAL_ERROR;
      }
      const probe = await probeVkAccount(runtimeAccount);
      return probe.ok ? null : `VK Long Poll probe failed: ${probe.error ?? "unknown error"}`;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  },
};

export function applyVkCredentialSource(params: {
  cfg: OpenClawConfig;
  communityId?: string;
  communityAccessToken?: VkSecretInput;
  tokenFile?: string;
  useEnv?: boolean;
}): OpenClawConfig {
  return vkSetupAdapter.applyAccountConfig({
    cfg: params.cfg,
    accountId: VK_DEFAULT_ACCOUNT_ID,
    input: {
      communityId: params.communityId,
      communityAccessToken: params.communityAccessToken,
      tokenFile: params.tokenFile,
      useEnv: params.useEnv,
    },
  });
}
