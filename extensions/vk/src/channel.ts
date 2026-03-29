import type {
  ChannelPlugin,
  ChannelSetupAdapter,
  ChannelSetupInput,
} from "openclaw/plugin-sdk/channel-runtime";
import { normalizeVkCommunityId } from "./config-schema.js";
import type { ResolvedVkAccount } from "./shared.js";
import { createVkPluginBase, resolveVkAccount } from "./shared.js";

const DEFAULT_ACCOUNT_ID = "default" as const;

const VK_ACCOUNT_ID_ERROR = 'VK supports only the "default" account id.';
const VK_COMMUNITY_ID_INPUT_ERROR = "VK community id must be a positive numeric id.";
const VK_COMMUNITY_TOKEN_INPUT_ERROR = "VK community access token must be a non-empty string.";
const VK_TOKEN_FILE_INPUT_ERROR = "VK token file must be a non-empty path.";
const VK_USE_ENV_NOT_SUPPORTED_ERROR =
  "VK --use-env setup is not supported yet. Use --community-access-token or --token-file.";

function resolveSetupCommunityId(raw: unknown): string | undefined {
  if (raw == null) {
    return undefined;
  }
  if (typeof raw !== "string") {
    return normalizeVkCommunityId(raw) ?? undefined;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    return undefined;
  }
  return normalizeVkCommunityId(trimmed) ?? undefined;
}

function resolveSetupToken(raw: unknown): string | undefined {
  if (typeof raw !== "string") {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed ? trimmed : undefined;
}

function resolveVkSetupAccountId(accountId?: string): "default" {
  const trimmed = accountId?.trim();
  if (!trimmed || trimmed.toLowerCase() === DEFAULT_ACCOUNT_ID) {
    return DEFAULT_ACCOUNT_ID;
  }
  throw new Error(VK_ACCOUNT_ID_ERROR);
}

function patchVkTopLevelConfigSection<
  TConfig extends { channels?: Record<string, unknown> },
>(params: { cfg: TConfig; patch: Record<string, unknown>; enabled?: boolean }): TConfig {
  const section = (params.cfg.channels as Record<string, unknown> | undefined)?.vk as
    | Record<string, unknown>
    | undefined;
  return {
    ...params.cfg,
    channels: {
      ...(params.cfg.channels as Record<string, unknown> | undefined),
      vk: {
        ...(section ?? {}),
        ...(params.enabled ? { enabled: true } : {}),
        ...params.patch,
      },
    },
  } as TConfig;
}

function validateVkSetupInput(input: ChannelSetupInput): string | null {
  if (input.useEnv === true) {
    return VK_USE_ENV_NOT_SUPPORTED_ERROR;
  }

  if (input.communityId !== undefined && !resolveSetupCommunityId(input.communityId)) {
    return VK_COMMUNITY_ID_INPUT_ERROR;
  }
  if (input.communityAccessToken !== undefined && !resolveSetupToken(input.communityAccessToken)) {
    return VK_COMMUNITY_TOKEN_INPUT_ERROR;
  }
  if (input.tokenFile !== undefined && !resolveSetupToken(input.tokenFile)) {
    return VK_TOKEN_FILE_INPUT_ERROR;
  }
  return null;
}

const vkSetupAdapter: ChannelSetupAdapter = {
  resolveAccountId: ({ accountId }) => resolveVkSetupAccountId(accountId),
  validateInput: ({ input }) => validateVkSetupInput(input),
  applyAccountConfig: ({ cfg, input }) => {
    const communityId = resolveSetupCommunityId(input.communityId);
    const communityAccessToken = resolveSetupToken(input.communityAccessToken);
    const tokenFile = resolveSetupToken(input.tokenFile);

    return patchVkTopLevelConfigSection({
      cfg,
      enabled: true,
      patch: {
        ...(communityId !== undefined ? { communityId } : {}),
        ...(communityAccessToken !== undefined ? { communityAccessToken } : {}),
        ...(tokenFile !== undefined ? { tokenFile } : {}),
      },
    });
  },
};

const vkSetupWizard: NonNullable<ChannelPlugin<ResolvedVkAccount>["setupWizard"]> = {
  channel: "vk",
  resolveAccountIdForConfigure: () => DEFAULT_ACCOUNT_ID,
  resolveShouldPromptAccountIds: () => false,
  status: {
    configuredLabel: "configured",
    unconfiguredLabel: "needs community id + token",
    configuredHint: "configured",
    unconfiguredHint: "needs community credentials",
    configuredScore: 1,
    unconfiguredScore: 0,
    resolveConfigured: ({ cfg }) => resolveVkAccount({ cfg }).configured,
    resolveStatusLines: ({ cfg, configured }) => {
      const account = resolveVkAccount({ cfg });
      return [
        `VK: ${configured ? "configured" : "needs community id + token"}`,
        `Community: ${account.config.communityId ?? "not set"}`,
      ];
    },
  },
  introNote: {
    title: "VK setup",
    lines: [
      "Configure a VK community id and community access token.",
      "v1 uses a single logical account id: default.",
      "Docs: https://docs.openclaw.ai/channels/vk",
    ],
  },
  credentials: [],
  textInputs: [
    {
      inputKey: "communityId",
      message: "VK community id",
      required: true,
      keepPrompt: (value) => `VK community id set (${value}). Keep it?`,
      currentValue: ({ cfg }) => resolveVkAccount({ cfg }).config.communityId,
      validate: ({ value }) =>
        resolveSetupCommunityId(value) ? undefined : VK_COMMUNITY_ID_INPUT_ERROR,
      normalizeValue: ({ value }) => resolveSetupCommunityId(value) ?? value.trim(),
      applySet: async ({ cfg, value }) =>
        patchVkTopLevelConfigSection({
          cfg,
          enabled: true,
          patch: {
            communityId: resolveSetupCommunityId(value),
          },
        }),
    },
    {
      inputKey: "communityAccessToken",
      message: "VK community access token",
      required: true,
      validate: ({ value }) =>
        resolveSetupToken(value) ? undefined : VK_COMMUNITY_TOKEN_INPUT_ERROR,
      applySet: async ({ cfg, value }) =>
        patchVkTopLevelConfigSection({
          cfg,
          enabled: true,
          patch: {
            communityAccessToken: resolveSetupToken(value),
          },
        }),
    },
  ],
};

export const vkPlugin: ChannelPlugin<ResolvedVkAccount> = {
  ...createVkPluginBase({
    setupWizard: vkSetupWizard,
    setup: vkSetupAdapter,
  }),
};

export const vkSetupPlugin: ChannelPlugin<ResolvedVkAccount> = vkPlugin;

export { vkSetupAdapter, vkSetupWizard, resolveVkSetupAccountId, validateVkSetupInput };
