import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-runtime";
import { collectStatusIssuesFromLastError } from "../../../src/plugin-sdk/status-helpers.js";
import { buildPassiveProbedChannelStatusSummary } from "../../shared/channel-status-summary.js";
import { probeVkAccount, type VkProbe } from "./probe.js";
import { readVkRuntimeState, cacheVkProbe, createDefaultVkRuntimeState } from "./runtime.js";
import { vkSetupAdapter } from "./setup-core.js";
import { vkSetupWizard } from "./setup-surface.js";
import { createVkPluginBase, VK_DEFAULT_ACCOUNT_ID, type InspectedVkAccount } from "./shared.js";
import { resolveVkRuntimeAccount } from "./token.js";

export const vkPlugin: ChannelPlugin<InspectedVkAccount, VkProbe> = {
  ...createVkPluginBase({
    setupWizard: vkSetupWizard,
    setup: vkSetupAdapter,
  }),
  status: {
    defaultRuntime: createDefaultVkRuntimeState(VK_DEFAULT_ACCOUNT_ID),
    collectStatusIssues: (accounts: Array<{ accountId: string; lastError?: unknown }>) =>
      collectStatusIssuesFromLastError("vk", accounts),
    buildChannelSummary: ({ snapshot }) => buildPassiveProbedChannelStatusSummary(snapshot),
    probeAccount: async ({ account, cfg, timeoutMs }): Promise<VkProbe> => {
      const runtimeAccount = resolveVkRuntimeAccount({
        cfg,
        account,
      });
      if (!runtimeAccount) {
        return {
          ok: false,
          error: "VK is disabled.",
          elapsedMs: 0,
        };
      }
      const probe = await probeVkAccount(runtimeAccount, timeoutMs);
      cacheVkProbe(account.accountId, probe);
      return probe;
    },
    buildAccountSnapshot: ({ account, runtime, probe }) => {
      const cachedRuntime = readVkRuntimeState(account.accountId);
      const mergedRuntime = {
        ...cachedRuntime,
        ...(runtime ?? {}),
      };
      return {
        accountId: account.accountId,
        enabled: account.enabled,
        configured: account.configured,
        connected: false,
        tokenSource: account.tokenSource,
        tokenStatus: account.tokenStatus,
        running: mergedRuntime.running ?? false,
        lastStartAt: mergedRuntime.lastStartAt ?? null,
        lastStopAt: mergedRuntime.lastStopAt ?? null,
        lastError: mergedRuntime.lastError ?? null,
        probe: probe ?? mergedRuntime.probe,
        lastProbeAt: mergedRuntime.lastProbeAt ?? null,
        lastInboundAt: mergedRuntime.lastInboundAt ?? null,
        lastOutboundAt: mergedRuntime.lastOutboundAt ?? null,
      };
    },
  },
};

export const vkSetupPlugin = vkPlugin;
