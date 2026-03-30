import { beforeEach, describe, expect, it, vi } from "vitest";
import { setVkRuntime } from "./runtime.js";

const mocks = vi.hoisted(() => ({
  dispatchInboundReplyWithBase: vi.fn(),
  sendVkText: vi.fn(),
  upsertChannelPairingRequest: vi.fn(),
}));

vi.mock("../../../src/plugin-sdk/inbound-reply-dispatch.js", () => ({
  dispatchInboundReplyWithBase: mocks.dispatchInboundReplyWithBase,
}));

vi.mock("./send.js", () => ({
  sendVkText: mocks.sendVkText,
}));

vi.mock("../../../src/pairing/pairing-store.js", () => ({
  upsertChannelPairingRequest: mocks.upsertChannelPairingRequest,
}));

import { routeVkInboundEvent } from "./inbound-routing.js";
import type { ResolvedVkAccount } from "./shared.js";

const baseAccount: ResolvedVkAccount = {
  accountId: "default",
  enabled: true,
  configured: true,
  communityId: "123",
  token: "vk-token",
  tokenSource: "config",
  tokenStatus: "available",
  config: {
    enabled: true,
    communityId: "123",
    communityAccessToken: "vk-token",
  },
};

function installRuntime() {
  setVkRuntime({
    channel: {
      routing: {
        resolveAgentRoute: vi.fn(({ peer }: { peer: { kind: string; id: string } }) => ({
          agentId: "agent-1",
          accountId: "default",
          sessionKey: `vk:${peer.kind}:${peer.id}`,
        })),
      },
      session: {
        resolveStorePath: vi.fn(() => "/tmp/store"),
        readSessionUpdatedAt: vi.fn(() => null),
      },
      reply: {
        resolveEnvelopeFormatOptions: vi.fn(() => ({})),
        formatAgentEnvelope: vi.fn(({ body }: { body: string }) => body),
        finalizeInboundContext: vi.fn((ctx) => ctx),
      },
      pairing: {
        readAllowFromStore: vi.fn(async () => []),
        upsertPairingRequest: vi.fn(async () => ({ code: "PAIR-1", created: true })),
      },
    },
  } as never);
}

describe("routeVkInboundEvent group routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installRuntime();
    mocks.dispatchInboundReplyWithBase.mockResolvedValue(undefined);
    mocks.sendVkText.mockResolvedValue({
      channel: "vk",
      messageId: "778",
      conversationId: "vk:chat:2000000001",
    });
    mocks.upsertChannelPairingRequest.mockResolvedValue({
      code: "PAIR-1",
      created: true,
    });
  });

  it("routes admitted group events through the group session and uses vk:chat targets for replies", async () => {
    const statusSink = vi.fn();
    mocks.dispatchInboundReplyWithBase.mockImplementation(async (params) => {
      await params.deliver({ text: "group reply" });
    });

    const event = {
      eventId: "evt-group-1",
      peerId: "2000000001",
      senderId: "77",
      messageId: "15",
      text: "hello group",
      attachments: [],
      timestamp: 1_700_000_000_000,
      chatType: "group" as const,
    };

    await routeVkInboundEvent({
      ctx: {
        cfg: {},
        accountId: "default",
        runtime: { error: vi.fn() } as never,
        log: { debug: vi.fn(), error: vi.fn() } as never,
      },
      account: {
        ...baseAccount,
        config: {
          ...baseAccount.config,
          groupPolicy: "open",
        },
      },
      event,
      statusSink,
    });

    await routeVkInboundEvent({
      ctx: {
        cfg: {},
        accountId: "default",
        runtime: { error: vi.fn() } as never,
        log: { debug: vi.fn(), error: vi.fn() } as never,
      },
      account: {
        ...baseAccount,
        config: {
          ...baseAccount.config,
          groupPolicy: "open",
        },
      },
      event: {
        ...event,
        eventId: "evt-group-2",
        messageId: "16",
      },
      statusSink,
    });

    expect(mocks.dispatchInboundReplyWithBase).toHaveBeenCalledTimes(2);
    expect(mocks.dispatchInboundReplyWithBase.mock.calls[0][0].route.sessionKey).toBe(
      "vk:group:2000000001",
    );
    expect(mocks.dispatchInboundReplyWithBase.mock.calls[1][0].route.sessionKey).toBe(
      "vk:group:2000000001",
    );
    expect(mocks.dispatchInboundReplyWithBase.mock.calls[0][0].ctxPayload).toMatchObject({
      ChatType: "group",
      To: "vk:chat:2000000001",
      OriginatingTo: "vk:chat:2000000001",
      WasMentioned: true,
      GroupSubject: "2000000001",
      SessionKey: "vk:group:2000000001",
    });
    expect(mocks.sendVkText).toHaveBeenCalledWith({
      cfg: {},
      accountId: "default",
      to: "vk:chat:2000000001",
      text: "group reply",
    });
  });

  it("blocks group chats not admitted by channels.vk.groups", async () => {
    await routeVkInboundEvent({
      ctx: {
        cfg: {},
        accountId: "default",
        runtime: { error: vi.fn() } as never,
        log: { debug: vi.fn(), error: vi.fn() } as never,
      },
      account: {
        ...baseAccount,
        config: {
          ...baseAccount.config,
          groupPolicy: "open",
          groups: {
            "2000000001": {
              enabled: true,
            },
          },
        },
      },
      event: {
        eventId: "evt-group-3",
        peerId: "2000000002",
        senderId: "77",
        messageId: "17",
        text: "hello group",
        attachments: [],
        timestamp: 1_700_000_000_000,
        chatType: "group",
      },
      statusSink: vi.fn(),
    });

    expect(mocks.dispatchInboundReplyWithBase).not.toHaveBeenCalled();
    expect(mocks.sendVkText).not.toHaveBeenCalled();
  });

  it("blocks unauthorized group senders under groupPolicy allowlist", async () => {
    await routeVkInboundEvent({
      ctx: {
        cfg: {},
        accountId: "default",
        runtime: { error: vi.fn() } as never,
        log: { debug: vi.fn(), error: vi.fn() } as never,
      },
      account: {
        ...baseAccount,
        config: {
          ...baseAccount.config,
          groupPolicy: "allowlist",
          groupAllowFrom: ["77"],
        },
      },
      event: {
        eventId: "evt-group-4",
        peerId: "2000000001",
        senderId: "88",
        messageId: "18",
        text: "hello group",
        attachments: [],
        timestamp: 1_700_000_000_000,
        chatType: "group",
      },
      statusSink: vi.fn(),
    });

    expect(mocks.dispatchInboundReplyWithBase).not.toHaveBeenCalled();
    expect(mocks.sendVkText).not.toHaveBeenCalled();
  });
});
