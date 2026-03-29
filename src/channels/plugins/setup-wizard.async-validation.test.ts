import { beforeEach, describe, expect, it, vi } from "vitest";
import { createWizardPrompter } from "../../commands/test-wizard-helpers.js";
import { createChannelTestPluginBase } from "../../test-utils/channel-plugins.js";
import { buildChannelSetupWizardAdapterFromSetupWizard } from "./setup-wizard.js";
import type { ChannelSetupWizard } from "./setup-wizard.js";

function createDeferredTestAdapter(params?: {
  asyncValidationError?: string | null;
  envValue?: string;
}) {
  const validateInputAsync = vi.fn(async ({ candidateCfg }) => {
    void candidateCfg;
    return params?.asyncValidationError ?? null;
  });

  const plugin = {
    ...createChannelTestPluginBase({
      id: "vk",
      label: "VK",
      docsPath: "/channels/vk",
    }),
    setup: {
      resolveAccountId: () => "default",
      applyAccountConfig: vi.fn(({ cfg, input }) => ({
        ...cfg,
        channels: {
          ...cfg.channels,
          vk: {
            ...cfg.channels?.vk,
            enabled: true,
            ...(input.communityId !== undefined ? { communityId: input.communityId } : {}),
            ...(input.communityAccessToken !== undefined
              ? { communityAccessToken: input.communityAccessToken }
              : {}),
            ...(input.useEnv === true
              ? {
                  communityAccessToken: {
                    source: "env",
                    provider: "default",
                    id: "VK_COMMUNITY_ACCESS_TOKEN",
                  },
                }
              : {}),
          },
        },
      })),
      validateInput: vi.fn(() => null),
      validateCompleteInput: vi.fn(({ candidateCfg }) =>
        candidateCfg.channels?.vk?.communityId && candidateCfg.channels?.vk?.communityAccessToken
          ? null
          : "complete input missing",
      ),
      validateInputAsync,
    },
  };

  const wizard: ChannelSetupWizard = {
    channel: "vk",
    deferApplyUntilValidated: true,
    stepOrder: "text-first",
    status: {
      configuredLabel: "configured",
      unconfiguredLabel: "missing",
      resolveConfigured: () => false,
    },
    credentials: [
      {
        inputKey: "communityAccessToken",
        providerHint: "vk",
        credentialLabel: "VK token",
        secretInputMode: "plaintext",
        envPrompt: "Use env?",
        keepPrompt: "Keep token?",
        inputPrompt: "Token",
        allowEnv: () => true,
        inspect: () => ({
          accountConfigured: false,
          hasConfiguredValue: false,
          envValue: params?.envValue,
        }),
        applyUseEnv: async ({ cfg }) => ({
          ...cfg,
          channels: {
            ...cfg.channels,
            vk: {
              ...cfg.channels?.vk,
              enabled: true,
              communityAccessToken: {
                source: "env",
                provider: "default",
                id: "VK_COMMUNITY_ACCESS_TOKEN",
              },
            },
          },
        }),
      },
    ],
    textInputs: [
      {
        inputKey: "communityId",
        message: "Community id",
        required: true,
        applySet: async ({ cfg, value }) => ({
          ...cfg,
          channels: {
            ...cfg.channels,
            vk: {
              ...cfg.channels?.vk,
              enabled: true,
              communityId: value,
            },
          },
        }),
      },
    ],
  };

  return {
    adapter: buildChannelSetupWizardAdapterFromSetupWizard({
      plugin: plugin as never,
      wizard,
    }),
    validateInputAsync,
  };
}

describe("setup wizard async validation", () => {
  beforeEach(() => {
    delete process.env.VK_COMMUNITY_ACCESS_TOKEN;
  });

  it("runs async validation only after the full candidate input is assembled", async () => {
    const { adapter, validateInputAsync } = createDeferredTestAdapter();
    const text = vi.fn().mockResolvedValueOnce("123").mockResolvedValueOnce("vk-token");

    const result = await adapter.configure({
      cfg: {},
      runtime: {} as never,
      prompter: createWizardPrompter({
        text,
        confirm: vi.fn(async () => false),
      }),
      options: undefined,
      accountOverrides: {},
      shouldPromptAccountIds: false,
      forceAllowFrom: false,
    });

    expect(validateInputAsync).toHaveBeenCalledTimes(1);
    expect(validateInputAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          communityId: "123",
          communityAccessToken: "vk-token",
        }),
        candidateCfg: expect.objectContaining({
          channels: {
            vk: {
              enabled: true,
              communityId: "123",
              communityAccessToken: "vk-token",
            },
          },
        }),
      }),
    );
    expect(result.cfg).toEqual({
      channels: {
        vk: {
          enabled: true,
          communityId: "123",
          communityAccessToken: "vk-token",
        },
      },
    });
  });

  it("accepts env-backed credentials through the shared useEnv path", async () => {
    const { adapter, validateInputAsync } = createDeferredTestAdapter({
      envValue: "env-token",
    });
    const text = vi.fn().mockResolvedValueOnce("123");

    const result = await adapter.configure({
      cfg: {},
      runtime: {} as never,
      prompter: createWizardPrompter({
        text,
        confirm: vi.fn(async () => true),
      }),
      options: undefined,
      accountOverrides: {},
      shouldPromptAccountIds: false,
      forceAllowFrom: false,
    });

    expect(validateInputAsync).toHaveBeenCalledTimes(1);
    expect(result.cfg).toEqual({
      channels: {
        vk: {
          enabled: true,
          communityId: "123",
          communityAccessToken: {
            source: "env",
            provider: "default",
            id: "VK_COMMUNITY_ACCESS_TOKEN",
          },
        },
      },
    });
  });

  it("refuses async validation failures without writing the config", async () => {
    const { adapter, validateInputAsync } = createDeferredTestAdapter({
      asyncValidationError: "bad token",
    });
    const text = vi.fn().mockResolvedValueOnce("123").mockResolvedValueOnce("vk-token");
    const cfg = {};

    await expect(
      adapter.configure({
        cfg,
        runtime: {} as never,
        prompter: createWizardPrompter({
          text,
          confirm: vi.fn(async () => false),
        }),
        options: undefined,
        accountOverrides: {},
        shouldPromptAccountIds: false,
        forceAllowFrom: false,
      }),
    ).rejects.toThrow("bad token");

    expect(validateInputAsync).toHaveBeenCalledTimes(1);
    expect(cfg).toEqual({});
  });
});
