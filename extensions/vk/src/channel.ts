import { buildAccountScopedAllowlistConfigEditor } from "openclaw/plugin-sdk/allowlist-config-edit";
import {
  collectAllowlistProviderGroupPolicyWarnings,
  collectOpenGroupPolicyRouteAllowlistWarnings,
} from "openclaw/plugin-sdk/channel-policy";
import { createScopedDmSecurityResolver } from "openclaw/plugin-sdk/channel-config-helpers";
import { createAccountStatusSink } from "openclaw/plugin-sdk/channel-lifecycle";
import type { ChannelPlugin } from "openclaw/plugin-sdk/channel-runtime";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import {
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
} from "../../../src/config/runtime-group-policy.js";
import { collectStatusIssuesFromLastError } from "../../../src/plugin-sdk/status-helpers.js";
import { buildPassiveProbedChannelStatusSummary } from "../../shared/channel-status-summary.js";
import { normalizeVkLongPollUpdate } from "./inbound-normalize.js";
import { routeVkInboundEvent } from "./inbound-routing.js";
import { probeVkAccount, type VkProbe } from "./probe.js";
import { cacheVkProbe, createDefaultVkRuntimeState, readVkRuntimeState } from "./runtime.js";
import { sendVkText } from "./send.js";
import { vkSetupAdapter } from "./setup-core.js";
import { vkSetupWizard } from "./setup-surface.js";
import {
  createVkPluginBase,
  VK_CHANNEL,
  VK_DEFAULT_ACCOUNT_ID,
  type InspectedVkAccount,
} from "./shared.js";
import { normalizeVkUserId } from "./targets.js";
import { resolveVkRuntimeAccount } from "./token.js";
import { runVkLongPoll } from "./transport/long-poll.js";

function normalizeVkAllowEntry(entry: string): string {
  return normalizeVkUserId(entry.trim()) ?? "";
}

function resolveVkDmPolicy(
  account: InspectedVkAccount,
): NonNullable<InspectedVkAccount["config"]["dmPolicy"]> {
  return account.config.dmPolicy ?? "pairing";
}

function resolveVkGroupPolicy(params: { cfg: OpenClawConfig; account: InspectedVkAccount }) {
  return resolveAllowlistProviderRuntimeGroupPolicy({
    providerConfigPresent: params.cfg.channels?.vk !== undefined,
    groupPolicy: params.account.config.groupPolicy,
    defaultGroupPolicy: resolveDefaultGroupPolicy(params.cfg),
  }).groupPolicy;
}

function readVkAllowlistConfig(account: InspectedVkAccount) {
  return {
    dmAllowFrom: (account.config.allowFrom ?? []).map(String),
    groupAllowFrom: (account.config.groupAllowFrom ?? []).map(String),
    dmPolicy: account.config.dmPolicy,
    groupPolicy: account.config.groupPolicy,
  };
}

const applyScopedVkAllowlistEdit = buildAccountScopedAllowlistConfigEditor({
  channelId: VK_CHANNEL,
  normalize: ({ cfg, accountId, values }) =>
    values
      .map((value) => {
        const normalized = normalizeVkAllowEntry(String(value));
        return normalized || null;
      })
      .filter((value): value is string => Boolean(value)),
  resolvePaths: (scope) => ({
    readPaths: [[scope === "dm" ? "allowFrom" : "groupAllowFrom"]],
    writePath: [scope === "dm" ? "allowFrom" : "groupAllowFrom"],
  }),
});

const resolveVkDmSecurity = createScopedDmSecurityResolver<InspectedVkAccount>({
  channelKey: VK_CHANNEL,
  resolvePolicy: (account) => account.config.dmPolicy,
  resolveAllowFrom: (account) => account.config.allowFrom,
  policyPathSuffix: "dmPolicy",
  normalizeEntry: normalizeVkAllowEntry,
});

export const vkPlugin: ChannelPlugin<InspectedVkAccount, VkProbe> = {
  ...createVkPluginBase({
    setupWizard: vkSetupWizard,
    setup: vkSetupAdapter,
  }),
  pairing: {
    idLabel: "vkUserId",
    normalizeAllowEntry: normalizeVkAllowEntry,
  },
  allowlist: {
    supportsScope: ({ scope }) => scope === "dm" || scope === "group" || scope === "all",
    readConfig: ({ cfg, accountId }) =>
      readVkAllowlistConfig(vkPlugin.config.resolveAccount(cfg, accountId)),
    applyConfigEdit: (params) => {
      if (params.scope === "all") {
        return null;
      }
      if (params.entry.trim() === "*") {
        return { kind: "invalid-entry" };
      }

      const account = vkPlugin.config.resolveAccount(params.cfg, params.accountId);
      if (params.scope === "dm") {
        if (resolveVkDmPolicy(account) !== "allowlist") {
          return null;
        }
      } else {
        if (resolveVkGroupPolicy({ cfg: params.cfg, account }) !== "allowlist") {
          return null;
        }
      }

      return applyScopedVkAllowlistEdit(params);
    },
  },
  security: {
    resolveDmPolicy: resolveVkDmSecurity,
    collectWarnings: ({ account, cfg }) =>
      collectAllowlistProviderGroupPolicyWarnings({
        cfg,
        providerConfigPresent: cfg.channels?.vk !== undefined,
        configuredGroupPolicy: account.config.groupPolicy,
        collect: (groupPolicy) =>
          collectOpenGroupPolicyRouteAllowlistWarnings({
            groupPolicy,
            routeAllowlistConfigured: Boolean(
              account.config.groups && Object.keys(account.config.groups).length > 0,
            ),
            restrictSenders: {
              surface: "VK group chats",
              openScope: "any member in admitted chats",
              groupPolicyPath: "channels.vk.groupPolicy",
              groupAllowFromPath: "channels.vk.groupAllowFrom",
            },
            noRouteAllowlist: {
              surface: "VK group chats",
              routeAllowlistPath: "channels.vk.groups",
              routeScope: "group chat",
              groupPolicyPath: "channels.vk.groupPolicy",
              groupAllowFromPath: "channels.vk.groupAllowFrom",
            },
          }),
      }),
  },
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
        connected: mergedRuntime.connected ?? false,
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
  gateway: {
    startAccount: async (ctx) => {
      const runtimeAccount = resolveVkRuntimeAccount({
        cfg: ctx.cfg,
        account: ctx.account,
      });
      const statusSink = createAccountStatusSink({
        accountId: ctx.accountId,
        setStatus: ctx.setStatus,
      });

      statusSink({
        connected: false,
        lastError: null,
      });

      if (!runtimeAccount) {
        return;
      }

      ctx.log?.info?.(
        `[${ctx.accountId}] starting VK Bots Long Poll (community ${runtimeAccount.communityId})`,
      );

      try {
        await runVkLongPoll({
          ctx,
          account: runtimeAccount,
          onEvent: async (update) => {
            const event = normalizeVkLongPollUpdate(update);
            if (!event) {
              ctx.log?.debug?.(`[${ctx.accountId}] VK ignored unsupported Long Poll update`);
              return;
            }
            await routeVkInboundEvent({
              ctx,
              account: runtimeAccount,
              event,
              statusSink,
            });
          },
        });
      } finally {
        statusSink({
          connected: false,
        });
      }
    },
  },
  outbound: {
    deliveryMode: "direct",
    sendText: async ({ cfg, to, text, accountId }) =>
      await sendVkText({
        cfg,
        to,
        text,
        accountId,
      }),
  },
};

export const vkSetupPlugin = vkPlugin;
