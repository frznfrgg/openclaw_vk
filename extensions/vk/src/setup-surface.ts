import { DEFAULT_ACCOUNT_ID } from "openclaw/plugin-sdk/core";
import type { OpenClawConfig } from "openclaw/plugin-sdk/setup";
import type { ChannelSetupWizard } from "openclaw/plugin-sdk/setup";
import { inspectVkAccount } from "./account-inspect.js";
import { normalizeVkCommunityId } from "./config-schema.js";
import {
  applyVkCredentialSource,
  VK_COMMUNITY_ID_INPUT_ERROR,
  VK_TOKEN_FILE_INPUT_ERROR,
} from "./setup-core.js";
import { VK_ENV_ACCESS_TOKEN, type VkAccountConfig } from "./shared.js";

const channel = "vk" as const;
const CREDENTIAL_SOURCE_KEY = "__vkCredentialSource";
type CredentialSource = "inline" | "file" | "env";

function resolveCurrentCredentialSource(
  cfg: Parameters<typeof inspectVkAccount>[0]["cfg"],
): CredentialSource | undefined {
  const account = inspectVkAccount({ cfg });
  if (account.config.tokenFile?.trim()) {
    return "file";
  }
  if (
    account.config.communityAccessToken &&
    typeof account.config.communityAccessToken === "object" &&
    account.config.communityAccessToken.source === "env"
  ) {
    return "env";
  }
  if (account.config.communityAccessToken !== undefined) {
    return "inline";
  }
  return undefined;
}

function resolveChosenCredentialSource(
  credentialValues: Record<string, string | undefined>,
): CredentialSource {
  const chosen = credentialValues[CREDENTIAL_SOURCE_KEY];
  return chosen === "file" || chosen === "env" ? chosen : "inline";
}

function clearVkCredentialSources(
  cfg: Parameters<typeof inspectVkAccount>[0]["cfg"],
): OpenClawConfig {
  const current = (cfg.channels?.vk ?? {}) as VkAccountConfig & Record<string, unknown>;
  const { communityAccessToken: _token, tokenFile: _tokenFile, ...rest } = current;
  return {
    ...cfg,
    channels: {
      ...cfg.channels,
      vk: rest as NonNullable<OpenClawConfig["channels"]>["vk"],
    },
  };
}

export const vkSetupWizard: ChannelSetupWizard = {
  channel,
  deferApplyUntilValidated: true,
  stepOrder: "text-first",
  resolveAccountIdForConfigure: () => DEFAULT_ACCOUNT_ID,
  resolveShouldPromptAccountIds: () => false,
  status: {
    configuredLabel: "configured",
    unconfiguredLabel: "needs community id + credential",
    configuredHint: "configured",
    unconfiguredHint: "needs VK community setup",
    configuredScore: 1,
    unconfiguredScore: 0,
    resolveConfigured: ({ cfg }) => inspectVkAccount({ cfg }).configured,
    resolveStatusLines: ({ cfg, configured }) => {
      const account = inspectVkAccount({ cfg });
      return [
        `VK: ${configured ? "configured" : "needs community id + credential"}`,
        `Community: ${account.communityId ?? "not set"}`,
      ];
    },
  },
  introNote: {
    title: "VK setup",
    lines: [
      "Configure a VK community bot for Bots Long Poll.",
      "v1 uses one logical VK account: default.",
      "Setup validates the community id and Long Poll access before finishing.",
    ],
  },
  prepare: async ({ cfg, credentialValues, prompter }) => {
    const currentSource = resolveCurrentCredentialSource(cfg);
    const envValue = process.env[VK_ENV_ACCESS_TOKEN]?.trim();
    const choice = await prompter.select<CredentialSource>({
      message: "How do you want to provide the VK community access token?",
      options: [
        { value: "inline", label: "Paste token" },
        { value: "file", label: "Read from token file" },
        ...(envValue || currentSource === "env"
          ? [{ value: "env" as const, label: `Use ${VK_ENV_ACCESS_TOKEN}` }]
          : []),
      ],
      initialValue: currentSource ?? "inline",
    });

    return {
      cfg: choice !== currentSource ? clearVkCredentialSources(cfg) : cfg,
      credentialValues: {
        ...credentialValues,
        [CREDENTIAL_SOURCE_KEY]: choice,
      },
    };
  },
  credentials: [
    {
      inputKey: "communityAccessToken",
      providerHint: channel,
      credentialLabel: "VK community access token",
      secretInputMode: "plaintext",
      preferredEnvVar: VK_ENV_ACCESS_TOKEN,
      helpTitle: "VK community token",
      helpLines: [
        "Use the access token from the VK community that will receive bot messages.",
        "groups.getLongPollServer requires a community token with manage scope.",
      ],
      envPrompt: `${VK_ENV_ACCESS_TOKEN} detected. Use it?`,
      keepPrompt: "VK community access token already configured. Keep it?",
      inputPrompt: "Enter VK community access token",
      allowEnv: ({ accountId }) => accountId === DEFAULT_ACCOUNT_ID,
      inspect: ({ cfg }) => {
        const account = inspectVkAccount({ cfg });
        return {
          accountConfigured: account.configured,
          hasConfiguredValue: account.tokenSource !== "none",
          resolvedValue: account.token?.trim() || undefined,
          envValue: process.env[VK_ENV_ACCESS_TOKEN]?.trim() || undefined,
        };
      },
      shouldPrompt: ({ credentialValues }) =>
        resolveChosenCredentialSource(credentialValues) !== "file",
      applyUseEnv: async ({ cfg }) => {
        const account = inspectVkAccount({ cfg });
        return applyVkCredentialSource({
          cfg,
          communityId: account.communityId,
          useEnv: true,
        });
      },
      applySet: async ({ cfg, resolvedValue }) => {
        const account = inspectVkAccount({ cfg });
        return applyVkCredentialSource({
          cfg,
          communityId: account.communityId,
          communityAccessToken: resolvedValue,
        });
      },
    },
  ],
  textInputs: [
    {
      inputKey: "communityId",
      message: "VK community id",
      required: true,
      keepPrompt: (value) => `VK community id set (${value}). Keep it?`,
      currentValue: ({ cfg }) => inspectVkAccount({ cfg }).communityId,
      validate: ({ value }) =>
        normalizeVkCommunityId(value.trim()) ? undefined : VK_COMMUNITY_ID_INPUT_ERROR,
      normalizeValue: ({ value }) => normalizeVkCommunityId(value.trim()) ?? value.trim(),
      applySet: async ({ cfg, value }) => {
        const account = inspectVkAccount({ cfg });
        return applyVkCredentialSource({
          cfg,
          communityId: normalizeVkCommunityId(value.trim()) ?? value.trim(),
          ...(account.config.tokenFile?.trim()
            ? { tokenFile: account.config.tokenFile }
            : account.config.communityAccessToken !== undefined
              ? { communityAccessToken: account.config.communityAccessToken }
              : {}),
        });
      },
    },
    {
      inputKey: "tokenFile",
      message: "Path to the file containing the VK community access token",
      placeholder: "/run/secrets/vk-community-token",
      keepPrompt: (value) => `VK token file set (${value}). Keep it?`,
      currentValue: ({ cfg }) => inspectVkAccount({ cfg }).config.tokenFile,
      shouldPrompt: ({ credentialValues }) =>
        resolveChosenCredentialSource(credentialValues) === "file",
      validate: ({ value }) => (value.trim() ? undefined : VK_TOKEN_FILE_INPUT_ERROR),
      normalizeValue: ({ value }) => value.trim(),
      applySet: async ({ cfg, value }) => {
        const account = inspectVkAccount({ cfg });
        return applyVkCredentialSource({
          cfg,
          communityId: account.communityId,
          tokenFile: value.trim(),
        });
      },
    },
  ],
};
