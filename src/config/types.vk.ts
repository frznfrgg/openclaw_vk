import type { DmPolicy, GroupPolicy } from "./types.base.js";
import type { ChannelHealthMonitorConfig } from "./types.channels.js";
import type { SecretInput } from "./types.secrets.js";

export type VkGroupConfig = {
  enabled?: boolean;
};

export type VkConfig = {
  enabled?: boolean;
  /** VK community id (positive numeric id, canonical decimal string). */
  communityId: string;
  /** VK community access token (plaintext or env SecretRef). */
  communityAccessToken?: SecretInput;
  /** Path to a file that contains the community access token. */
  tokenFile?: string;
  /** Default delivery target for outbound sends (vk:user:<id> or vk:chat:<peer_id>). */
  defaultTo?: string;
  /** Allowed VK DM sender ids ("*" or numeric VK user ids as strings). */
  allowFrom?: string | string[];
  /** Allowed VK group sender ids (numeric VK user ids as strings). */
  groupAllowFrom?: string | string[];
  dmPolicy?: DmPolicy;
  groupPolicy?: GroupPolicy;
  /** Optional admitted VK group chats keyed by peer_id. */
  groups?: Record<string, VkGroupConfig>;
  healthMonitor?: ChannelHealthMonitorConfig;
};

declare module "./types.channels.js" {
  interface ChannelsConfig {
    vk?: VkConfig;
  }
}
