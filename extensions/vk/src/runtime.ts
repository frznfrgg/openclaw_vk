import type { PluginRuntime } from "openclaw/plugin-sdk/core";
import { createPluginRuntimeStore } from "openclaw/plugin-sdk/runtime-store";
import { createDefaultChannelRuntimeState } from "../../../src/plugin-sdk/status-helpers.js";
import type { VkProbe } from "./probe.js";
import { VK_DEFAULT_ACCOUNT_ID } from "./shared.js";

export type VkRuntimeSnapshot = ReturnType<typeof createDefaultVkRuntimeState>;

const { setRuntime: setVkRuntime, getRuntime: getVkRuntime } =
  createPluginRuntimeStore<PluginRuntime>("VK runtime not initialized");

const runtimeState = new Map<string, VkRuntimeSnapshot>();

export { getVkRuntime, setVkRuntime };

export function createDefaultVkRuntimeState(accountId = VK_DEFAULT_ACCOUNT_ID) {
  return createDefaultChannelRuntimeState(accountId, {
    connected: false,
    probe: undefined as VkProbe | undefined,
    lastProbeAt: null as number | null,
    lastInboundAt: null as number | null,
    lastOutboundAt: null as number | null,
  });
}

export function readVkRuntimeState(accountId = VK_DEFAULT_ACCOUNT_ID): VkRuntimeSnapshot {
  return runtimeState.get(accountId) ?? createDefaultVkRuntimeState(accountId);
}

export function writeVkRuntimeState(
  accountId: string,
  patch: Partial<VkRuntimeSnapshot>,
): VkRuntimeSnapshot {
  const next = {
    ...readVkRuntimeState(accountId),
    ...patch,
  };
  runtimeState.set(accountId, next);
  return next;
}

export function cacheVkProbe(accountId: string, probe: VkProbe): VkRuntimeSnapshot {
  return writeVkRuntimeState(accountId, {
    probe,
    lastProbeAt: Date.now(),
  });
}

export function resetVkRuntimeStateForTests(): void {
  runtimeState.clear();
}
