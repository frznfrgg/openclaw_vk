export type { ChannelPlugin } from "./channel-plugin-common.js";
export type { ChannelSetupAdapter } from "../channels/plugins/types.adapters.js";
export type { OpenClawConfig } from "../config/config.js";
export type { PluginRuntime } from "../plugins/runtime/types.js";
export type { OpenClawPluginApi } from "../plugins/types.js";
export type { VkConfig } from "../config/types.vk.js";
export type {
  InspectedVkAccount,
  ResolvedVkAccount,
  VkAccountConfig,
  VkCredentialStatus,
  VkResolvedToken,
  VkRuntimeSnapshot,
  VkProbe,
} from "../../extensions/vk/api.js";

export { emptyPluginConfigSchema } from "../plugins/config-schema.js";
export { DEFAULT_ACCOUNT_ID, normalizeAccountId } from "../routing/session-key.js";
export { buildChannelConfigSchema, getChatChannelMeta } from "./channel-plugin-common.js";

export {
  VK_CHANNEL,
  VK_DEFAULT_ACCOUNT_ID,
  VK_ENV_ACCESS_TOKEN,
  createVkPluginBase,
  vkConfigAdapter,
} from "../../extensions/vk/api.js";
export {
  VkConfigSchema,
  normalizeVkAllowFromForConfigWrite,
  normalizeVkCommunityId,
  normalizeVkGroupAllowFromForConfigWrite,
  normalizeVkGroupPeerIdForConfigWrite,
  normalizeVkGroupsForConfigWrite,
} from "../../extensions/vk/api.js";
export {
  VK_GROUP_PEER_MIN,
  VK_USER_ID_MAX_EXCLUSIVE,
  inferVkTargetChatType,
  parseVkExplicitTarget,
  parseVkTarget,
  normalizeVkTarget,
} from "../../extensions/vk/api.js";
export {
  applyVkCredentialSource,
  buildVkUseEnvSecretRef,
  inspectVkAccount,
  probeVkAccount,
  readVkRuntimeState,
  cacheVkProbe,
  createDefaultVkRuntimeState,
  resolveVkAccountConfig,
  resolveVkRuntimeAccount,
  resolveVkToken,
  resolveVkSetupAccountId,
  validateVkSetupInput,
  vkSetupAdapter,
  vkSetupWizard,
} from "../../extensions/vk/api.js";
