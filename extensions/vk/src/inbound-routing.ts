import {
  hasControlCommand,
  shouldComputeCommandAuthorized,
} from "../../../src/auto-reply/command-detection.js";
import { resolveCommandAuthorizedFromAuthorizers } from "../../../src/channels/command-gating.js";
import type { ChannelGatewayContext } from "../../../src/channels/plugins/types.adapters.js";
import {
  resolveAllowlistProviderRuntimeGroupPolicy,
  resolveDefaultGroupPolicy,
} from "../../../src/config/runtime-group-policy.js";
import { issuePairingChallenge } from "../../../src/pairing/pairing-challenge.js";
import { upsertChannelPairingRequest } from "../../../src/pairing/pairing-store.js";
import { logTypingFailure } from "../../../src/plugin-sdk/channel-feedback.js";
import { dispatchInboundReplyWithBase } from "../../../src/plugin-sdk/inbound-reply-dispatch.js";
import { createScopedPairingAccess } from "../../../src/plugin-sdk/pairing-access.js";
import {
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithLists,
} from "../../../src/security/dm-policy-shared.js";
import { materializeVkInboundMedia } from "./inbound-media.js";
import type { VkInboundEvent } from "./inbound-normalize.js";
import { getVkRuntime } from "./runtime.js";
import { sendVkText, sendVkTyping } from "./send.js";
import type { InspectedVkAccount, ResolvedVkAccount } from "./shared.js";

const VK_CHANNEL = "vk" as const;

type VkStatusSinkPatch = {
  lastInboundAt?: number;
  lastOutboundAt?: number;
  connected?: boolean;
  lastError?: string | null;
};

type VkGroupAdmissionDecision =
  | { allowed: true; routeAllowlistConfigured: boolean }
  | {
      allowed: false;
      routeAllowlistConfigured: boolean;
      reason: "route_not_allowlisted" | "route_disabled";
    };

function formatVkRoutingError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeVkSenderMatch(allowFrom: string[], senderId: string): boolean {
  return allowFrom.includes("*") || allowFrom.includes(senderId);
}

function resolveVkOriginatingTarget(event: VkInboundEvent): string {
  return event.chatType === "group" ? `vk:chat:${event.peerId}` : `vk:user:${event.peerId}`;
}

function buildVkSelfMentionRegexes(communityId: string): RegExp[] {
  const id = communityId.trim();
  if (!id) {
    return [];
  }
  return [
    new RegExp(String.raw`\[(?:club|public|event)${id}\|[^\]]+\]`, "giu"),
    new RegExp(String.raw`@(?:club|public|event)${id}\b`, "giu"),
  ];
}

function hasVkSelfMention(text: string, communityId: string): boolean {
  return buildVkSelfMentionRegexes(communityId).some((pattern) => pattern.test(text));
}

function stripVkSelfMentions(text: string, communityId: string): string {
  let next = text;
  for (const pattern of buildVkSelfMentionRegexes(communityId)) {
    next = next.replace(pattern, " ");
  }
  return next.replace(/\s+/g, " ").trim();
}

function resolveVkCommandBody(rawBody: string): string {
  return rawBody.trim() === "/help" ? "/commands" : rawBody;
}

function resolveVkCommandAuthorization(params: {
  cfg: ChannelGatewayContext<InspectedVkAccount>["cfg"];
  rawBody: string;
  senderId: string;
  effectiveAllowFrom: string[];
  effectiveGroupAllowFrom?: string[];
}): boolean | undefined {
  const shouldComputeAuth = shouldComputeCommandAuthorized(params.rawBody, params.cfg);
  if (!shouldComputeAuth) {
    return undefined;
  }
  return resolveCommandAuthorizedFromAuthorizers({
    useAccessGroups: params.cfg.commands?.useAccessGroups !== false,
    authorizers: [
      {
        configured: params.effectiveAllowFrom.length > 0,
        allowed: normalizeVkSenderMatch(params.effectiveAllowFrom, params.senderId),
      },
      {
        configured: (params.effectiveGroupAllowFrom?.length ?? 0) > 0,
        allowed: normalizeVkSenderMatch(params.effectiveGroupAllowFrom ?? [], params.senderId),
      },
    ],
  });
}

function resolveVkGroupAdmission(params: {
  peerId: string;
  groups: ResolvedVkAccount["config"]["groups"];
}): VkGroupAdmissionDecision {
  const groups = params.groups ?? {};
  const keys = Object.keys(groups);
  if (keys.length === 0) {
    return {
      allowed: true,
      routeAllowlistConfigured: false,
    };
  }

  const groupConfig = groups[params.peerId];
  if (!groupConfig) {
    return {
      allowed: false,
      routeAllowlistConfigured: true,
      reason: "route_not_allowlisted",
    };
  }
  if (groupConfig.enabled === false) {
    return {
      allowed: false,
      routeAllowlistConfigured: true,
      reason: "route_disabled",
    };
  }

  return {
    allowed: true,
    routeAllowlistConfigured: true,
  };
}

function resolveVkEffectiveGroupPolicy(params: {
  cfg: ChannelGatewayContext<InspectedVkAccount>["cfg"];
  account: ResolvedVkAccount;
}) {
  return resolveAllowlistProviderRuntimeGroupPolicy({
    providerConfigPresent: params.cfg.channels?.vk !== undefined,
    groupPolicy: params.account.config.groupPolicy,
    defaultGroupPolicy: resolveDefaultGroupPolicy(params.cfg),
  }).groupPolicy;
}

async function dispatchVkInboundConversation(params: {
  ctx: Pick<ChannelGatewayContext<InspectedVkAccount>, "cfg" | "accountId" | "runtime" | "log">;
  account: ResolvedVkAccount;
  event: VkInboundEvent;
  commandAuthorized?: boolean;
  statusSink: (patch: VkStatusSinkPatch) => void;
}) {
  const { ctx, account, event, statusSink } = params;
  const core = getVkRuntime();
  const route = core.channel.routing.resolveAgentRoute({
    cfg: ctx.cfg,
    channel: VK_CHANNEL,
    accountId: account.accountId,
    peer: {
      kind: event.chatType === "group" ? "group" : "direct",
      id: event.peerId,
    },
  });
  const storePath = core.channel.session.resolveStorePath(ctx.cfg.session?.store, {
    agentId: route.agentId,
  });
  const envelopeOptions = core.channel.reply.resolveEnvelopeFormatOptions(ctx.cfg);
  const previousTimestamp = core.channel.session.readSessionUpdatedAt({
    storePath,
    sessionKey: route.sessionKey,
  });
  const mediaPayload = await materializeVkInboundMedia({
    attachments: event.attachments,
    log: ctx.log,
  });
  const wasMentioned =
    event.chatType === "group" ? hasVkSelfMention(event.text, account.communityId) : undefined;
  const rawBody =
    event.chatType === "group" && wasMentioned
      ? stripVkSelfMentions(event.text, account.communityId)
      : event.text.trim();
  const commandBody = resolveVkCommandBody(rawBody);
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "VK",
    from: `user ${event.senderId}`,
    timestamp: event.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });
  const originatingTarget = resolveVkOriginatingTarget(event);
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: commandBody,
    From: event.chatType === "group" ? `vk:chat:${event.peerId}` : `vk:user:${event.senderId}`,
    To: originatingTarget,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: event.chatType,
    ConversationLabel:
      event.chatType === "group" ? `VK chat ${event.peerId}` : `VK DM ${event.peerId}`,
    SenderId: event.senderId,
    GroupSubject: event.chatType === "group" ? event.peerId : undefined,
    MessageSid: event.messageId,
    Timestamp: event.timestamp,
    ...mediaPayload,
    Provider: VK_CHANNEL,
    Surface: VK_CHANNEL,
    WasMentioned: wasMentioned,
    OriginatingChannel: VK_CHANNEL,
    OriginatingTo: originatingTarget,
    CommandAuthorized: params.commandAuthorized === true,
  });

  await dispatchInboundReplyWithBase({
    cfg: ctx.cfg,
    channel: VK_CHANNEL,
    accountId: account.accountId,
    route,
    storePath,
    ctxPayload,
    core,
    deliver: async (payload) => {
      const text = payload.text?.trim();
      if (!text) {
        return;
      }
      await sendVkText({
        cfg: ctx.cfg,
        accountId: account.accountId,
        to: originatingTarget,
        text,
      });
      statusSink({
        lastOutboundAt: Date.now(),
      });
    },
    typing: {
      start: async () => {
        await sendVkTyping({
          cfg: ctx.cfg,
          accountId: account.accountId,
          to: originatingTarget,
        });
      },
      onStartError: (error) => {
        logTypingFailure({
          log: (message) => ctx.log?.debug?.(message),
          channel: VK_CHANNEL,
          target: originatingTarget,
          error,
        });
      },
    },
    onRecordError: (error) => {
      ctx.runtime.error?.(`vk: failed updating session meta: ${formatVkRoutingError(error)}`);
    },
    onDispatchError: (error, info) => {
      ctx.runtime.error?.(`vk ${info.kind} reply failed: ${formatVkRoutingError(error)}`);
    },
  });
}

export async function routeVkInboundEvent(params: {
  ctx: Pick<ChannelGatewayContext<InspectedVkAccount>, "cfg" | "accountId" | "runtime" | "log">;
  account: ResolvedVkAccount;
  event: VkInboundEvent;
  statusSink: (patch: VkStatusSinkPatch) => void;
}): Promise<void> {
  const { ctx, account, event, statusSink } = params;

  statusSink({
    lastInboundAt: event.timestamp,
  });

  const core = getVkRuntime();
  const pairing = createScopedPairingAccess({
    core,
    channel: VK_CHANNEL,
    accountId: account.accountId,
  });
  const rawBody =
    event.chatType === "group" ? stripVkSelfMentions(event.text, account.communityId) : event.text.trim();
  const hasControl = hasControlCommand(rawBody, ctx.cfg);

  if (event.chatType === "group") {
    if (!hasVkSelfMention(event.text, account.communityId)) {
      ctx.log?.debug?.(
        `[${account.accountId}] VK group ${event.peerId} ignored (community not mentioned)`,
      );
      return;
    }

    const groupAdmission = resolveVkGroupAdmission({
      peerId: event.peerId,
      groups: account.config.groups,
    });
    if (!groupAdmission.allowed) {
      ctx.log?.debug?.(
        groupAdmission.reason === "route_disabled"
          ? `[${account.accountId}] VK group ${event.peerId} blocked (disabled in channels.vk.groups)`
          : `[${account.accountId}] VK group ${event.peerId} blocked (not admitted in channels.vk.groups)`,
      );
      return;
    }

    const groupPolicy = resolveVkEffectiveGroupPolicy({
      cfg: ctx.cfg,
      account,
    });
    const access = resolveDmGroupAccessWithLists({
      isGroup: true,
      dmPolicy: account.config.dmPolicy,
      groupPolicy,
      allowFrom: account.config.allowFrom,
      groupAllowFrom: account.config.groupAllowFrom,
      storeAllowFrom: [],
      groupAllowFromFallbackToAllowFrom: false,
      isSenderAllowed: (allowFrom) => normalizeVkSenderMatch(allowFrom, event.senderId),
    });

    if (access.decision !== "allow") {
      ctx.log?.debug?.(
        `[${account.accountId}] VK group ${event.peerId} sender ${event.senderId} blocked (${access.reason})`,
      );
      return;
    }

    const commandAuthorized = resolveVkCommandAuthorization({
      cfg: ctx.cfg,
      rawBody,
      senderId: event.senderId,
      effectiveAllowFrom: access.effectiveAllowFrom,
      effectiveGroupAllowFrom: access.effectiveGroupAllowFrom,
    });
    if (hasControl && commandAuthorized !== true) {
      ctx.log?.debug?.(
        `[${account.accountId}] VK control command from unauthorized group sender ${event.senderId} blocked`,
      );
      return;
    }

    await dispatchVkInboundConversation({
      ctx,
      account,
      event,
      commandAuthorized,
      statusSink,
    });
    return;
  }

  const dmPolicy = account.config.dmPolicy ?? "pairing";
  const storeAllowFrom = await readStoreAllowFromForDmPolicy({
    provider: VK_CHANNEL,
    accountId: account.accountId,
    dmPolicy,
    readStore: pairing.readStoreForDmPolicy,
  });
  const access = resolveDmGroupAccessWithLists({
    isGroup: false,
    dmPolicy,
    groupPolicy: account.config.groupPolicy,
    allowFrom: account.config.allowFrom,
    groupAllowFrom: account.config.groupAllowFrom,
    storeAllowFrom,
    groupAllowFromFallbackToAllowFrom: false,
    isSenderAllowed: (allowFrom) => normalizeVkSenderMatch(allowFrom, event.senderId),
  });

  if (access.decision === "pairing") {
    await issuePairingChallenge({
      channel: VK_CHANNEL,
      senderId: event.senderId,
      senderIdLine: `Your VK user id: ${event.senderId}`,
      meta: {
        vkUserId: event.senderId,
      },
      upsertPairingRequest: async ({ id, meta }) =>
        await upsertChannelPairingRequest({
          channel: VK_CHANNEL,
          accountId: account.accountId,
          id,
          meta,
        }),
      sendPairingReply: async (text) => {
        await sendVkText({
          cfg: ctx.cfg,
          accountId: account.accountId,
          to: `vk:user:${event.peerId}`,
          text,
        });
        statusSink({
          lastOutboundAt: Date.now(),
        });
      },
      onReplyError: (error) => {
        ctx.log?.error?.(
          `[${account.accountId}] VK pairing reply failed for ${event.senderId}: ${formatVkRoutingError(error)}`,
        );
      },
    });
    return;
  }

  if (access.decision !== "allow") {
    ctx.log?.debug?.(`[${account.accountId}] VK DM ${event.peerId} blocked (${access.reason})`);
    return;
  }

  const commandAuthorized = resolveVkCommandAuthorization({
    cfg: ctx.cfg,
    rawBody,
    senderId: event.senderId,
    effectiveAllowFrom: access.effectiveAllowFrom,
    effectiveGroupAllowFrom: access.effectiveGroupAllowFrom,
  });

  await dispatchVkInboundConversation({
    ctx,
    account,
    event,
    commandAuthorized,
    statusSink,
  });
}
