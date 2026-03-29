import type { ChannelGatewayContext } from "../../../src/channels/plugins/types.adapters.js";
import { issuePairingChallenge } from "../../../src/pairing/pairing-challenge.js";
import { upsertChannelPairingRequest } from "../../../src/pairing/pairing-store.js";
import { dispatchInboundReplyWithBase } from "../../../src/plugin-sdk/inbound-reply-dispatch.js";
import { createScopedPairingAccess } from "../../../src/plugin-sdk/pairing-access.js";
import {
  readStoreAllowFromForDmPolicy,
  resolveDmGroupAccessWithLists,
} from "../../../src/security/dm-policy-shared.js";
import type { VkInboundEvent } from "./inbound-normalize.js";
import { getVkRuntime } from "./runtime.js";
import { sendVkText } from "./send.js";
import type { InspectedVkAccount, ResolvedVkAccount } from "./shared.js";

const VK_CHANNEL = "vk" as const;

function formatVkRoutingError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function normalizeVkSenderMatch(allowFrom: string[], senderUserId: string): boolean {
  return allowFrom.includes("*") || allowFrom.includes(senderUserId);
}

export async function routeVkInboundEvent(params: {
  ctx: Pick<ChannelGatewayContext<InspectedVkAccount>, "cfg" | "accountId" | "runtime" | "log">;
  account: ResolvedVkAccount;
  event: VkInboundEvent;
  statusSink: (patch: {
    lastInboundAt?: number;
    lastOutboundAt?: number;
    connected?: boolean;
    lastError?: unknown;
  }) => void;
}): Promise<void> {
  const { ctx, account, event, statusSink } = params;

  if (event.chatType !== "direct") {
    ctx.log?.debug?.(
      `[${account.accountId}] VK group event deferred until Milestone 4 (peer_id=${event.peerId})`,
    );
    return;
  }

  const rawBody = event.text.trim();

  statusSink({
    lastInboundAt: event.timestamp,
  });

  const core = getVkRuntime();
  const pairing = createScopedPairingAccess({
    core,
    channel: VK_CHANNEL,
    accountId: account.accountId,
  });
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
    isSenderAllowed: (allowFrom) => normalizeVkSenderMatch(allowFrom, event.senderUserId),
  });

  if (access.decision === "pairing") {
    await issuePairingChallenge({
      channel: VK_CHANNEL,
      senderId: event.senderUserId,
      senderIdLine: `Your VK user id: ${event.senderUserId}`,
      meta: {
        vkUserId: event.senderUserId,
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
          `[${account.accountId}] VK pairing reply failed for ${event.senderUserId}: ${formatVkRoutingError(error)}`,
        );
      },
    });
    return;
  }

  if (access.decision !== "allow") {
    ctx.log?.debug?.(`[${account.accountId}] VK DM ${event.peerId} blocked (${access.reason})`);
    return;
  }

  const route = core.channel.routing.resolveAgentRoute({
    cfg: ctx.cfg,
    channel: VK_CHANNEL,
    accountId: account.accountId,
    peer: {
      kind: "direct",
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
  const body = core.channel.reply.formatAgentEnvelope({
    channel: "VK",
    from: `user ${event.senderUserId}`,
    timestamp: event.timestamp,
    previousTimestamp,
    envelope: envelopeOptions,
    body: rawBody,
  });
  const ctxPayload = core.channel.reply.finalizeInboundContext({
    Body: body,
    RawBody: rawBody,
    CommandBody: rawBody,
    From: `vk:user:${event.senderUserId}`,
    To: `vk:user:${event.peerId}`,
    SessionKey: route.sessionKey,
    AccountId: route.accountId,
    ChatType: "direct",
    ConversationLabel: `VK DM ${event.peerId}`,
    SenderId: event.senderUserId,
    MessageSid: event.conversationMessageId,
    Timestamp: event.timestamp,
    Provider: VK_CHANNEL,
    Surface: VK_CHANNEL,
    OriginatingChannel: VK_CHANNEL,
    OriginatingTo: `vk:user:${event.peerId}`,
    CommandAuthorized: false,
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
        to: `vk:user:${event.peerId}`,
        text,
      });
      statusSink({
        lastOutboundAt: Date.now(),
      });
    },
    onRecordError: (error) => {
      ctx.runtime.error?.(`vk: failed updating session meta: ${formatVkRoutingError(error)}`);
    },
    onDispatchError: (error, info) => {
      ctx.runtime.error?.(`vk ${info.kind} reply failed: ${formatVkRoutingError(error)}`);
    },
  });
}
