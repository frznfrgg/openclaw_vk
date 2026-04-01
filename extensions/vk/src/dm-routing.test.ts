import { beforeEach, describe, expect, it, vi } from "vitest";
import { setVkRuntime } from "./runtime.js";

const mocks = vi.hoisted(() => ({
  dispatchInboundReplyWithBase: vi.fn(),
  materializeVkInboundMedia: vi.fn(),
  sendVkText: vi.fn(),
  sendVkTyping: vi.fn(),
  upsertChannelPairingRequest: vi.fn(),
}));

vi.mock("../../../src/plugin-sdk/inbound-reply-dispatch.js", () => ({
  dispatchInboundReplyWithBase: mocks.dispatchInboundReplyWithBase,
}));

vi.mock("./inbound-media.js", () => ({
  materializeVkInboundMedia: mocks.materializeVkInboundMedia,
}));

vi.mock("./send.js", () => ({
  sendVkText: mocks.sendVkText,
  sendVkTyping: mocks.sendVkTyping,
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

function installRuntime(params?: { storeAllowFrom?: string[] }) {
  setVkRuntime({
    channel: {
      routing: {
        resolveAgentRoute: vi.fn(() => ({
          agentId: "agent-1",
          accountId: "default",
          sessionKey: "vk:default:42",
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
        readAllowFromStore: vi.fn(async () => params?.storeAllowFrom ?? []),
        upsertPairingRequest: vi.fn(async () => ({ code: "PAIR-1", created: true })),
      },
    },
  } as never);
}

describe("routeVkInboundEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installRuntime();
    mocks.dispatchInboundReplyWithBase.mockResolvedValue(undefined);
    mocks.materializeVkInboundMedia.mockResolvedValue({});
    mocks.sendVkText.mockResolvedValue({
      channel: "vk",
      messageId: "777",
      conversationId: "vk:user:42",
    });
    mocks.sendVkTyping.mockResolvedValue(undefined);
    mocks.upsertChannelPairingRequest.mockResolvedValue({
      code: "PAIR-1",
      created: true,
    });
  });

  it("routes an allowed DM into OpenClaw and uses the canonical DM reply target", async () => {
    const statusSink = vi.fn();
    mocks.dispatchInboundReplyWithBase.mockImplementationOnce(async (params) => {
      await params.deliver({ text: "reply text" });
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
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
      event: {
        eventId: "evt-1",
        peerId: "42",
        senderId: "42",
        messageId: "7",
        text: "hello",
        attachments: [],
        timestamp: 1_700_000_000_000,
        chatType: "direct",
      },
      statusSink,
    });

    expect(mocks.dispatchInboundReplyWithBase).toHaveBeenCalledTimes(1);
    const dispatched = mocks.dispatchInboundReplyWithBase.mock.calls[0][0];
    expect(dispatched.route).toMatchObject({
      agentId: "agent-1",
      sessionKey: "vk:default:42",
    });
    expect(dispatched.ctxPayload).toMatchObject({
      From: "vk:user:42",
      To: "vk:user:42",
      OriginatingChannel: "vk",
      OriginatingTo: "vk:user:42",
      SessionKey: "vk:default:42",
      SenderId: "42",
    });

    expect(mocks.sendVkText).toHaveBeenCalledWith({
      cfg: {},
      accountId: "default",
      to: "vk:user:42",
      text: "reply text",
    });
    await dispatched.typing.start();
    expect(mocks.sendVkTyping).toHaveBeenCalledWith({
      cfg: {},
      accountId: "default",
      to: "vk:user:42",
    });
    expect(statusSink).toHaveBeenCalledWith({
      lastInboundAt: 1_700_000_000_000,
    });
    expect(
      statusSink.mock.calls.some(
        ([patch]) => patch && typeof patch === "object" && typeof patch.lastOutboundAt === "number",
      ),
    ).toBe(true);
  });

  it("passes downloaded attachment paths into the inbound agent context", async () => {
    mocks.materializeVkInboundMedia.mockResolvedValue({
      MediaPath: "/tmp/openclaw/media/inbound/report---uuid.pdf",
      MediaType: "application/pdf",
      MediaUrl: "/tmp/openclaw/media/inbound/report---uuid.pdf",
      MediaPaths: [
        "/tmp/openclaw/media/inbound/report---uuid.pdf",
        "/tmp/openclaw/media/inbound/photo---uuid.png",
      ],
      MediaUrls: [
        "/tmp/openclaw/media/inbound/report---uuid.pdf",
        "/tmp/openclaw/media/inbound/photo---uuid.png",
      ],
      MediaTypes: ["application/pdf", "image/png"],
    });

    const event = {
      eventId: "evt-media-1",
      peerId: "42",
      senderId: "42",
      messageId: "10",
      text: "read this",
      attachments: [
        {
          kind: "document" as const,
          url: "https://cdn.example.com/report.pdf",
          mimeType: "application/pdf",
          fileName: "report.pdf",
        },
        {
          kind: "image" as const,
          url: "https://cdn.example.com/photo.png",
          mimeType: "image/png",
          fileName: "photo.png",
        },
      ],
      timestamp: 1_700_000_000_000,
      chatType: "direct" as const,
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
          dmPolicy: "allowlist",
          allowFrom: ["42"],
        },
      },
      event,
      statusSink: vi.fn(),
    });

    expect(mocks.materializeVkInboundMedia).toHaveBeenCalledWith({
      attachments: event.attachments,
      log: expect.any(Object),
    });
    expect(mocks.dispatchInboundReplyWithBase.mock.calls[0][0].ctxPayload).toMatchObject({
      MediaPath: "/tmp/openclaw/media/inbound/report---uuid.pdf",
      MediaType: "application/pdf",
      MediaUrl: "/tmp/openclaw/media/inbound/report---uuid.pdf",
      MediaPaths: [
        "/tmp/openclaw/media/inbound/report---uuid.pdf",
        "/tmp/openclaw/media/inbound/photo---uuid.png",
      ],
      MediaUrls: [
        "/tmp/openclaw/media/inbound/report---uuid.pdf",
        "/tmp/openclaw/media/inbound/photo---uuid.png",
      ],
      MediaTypes: ["application/pdf", "image/png"],
    });
  });

  it("issues a standard pairing challenge for an unknown DM sender", async () => {
    const statusSink = vi.fn();

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
          dmPolicy: "pairing",
        },
      },
      event: {
        eventId: "evt-2",
        peerId: "42",
        senderId: "42",
        messageId: "8",
        text: "hello",
        attachments: [],
        timestamp: 1_700_000_000_000,
        chatType: "direct",
      },
      statusSink,
    });

    expect(mocks.dispatchInboundReplyWithBase).not.toHaveBeenCalled();
    expect(mocks.upsertChannelPairingRequest).toHaveBeenCalledWith({
      channel: "vk",
      accountId: "default",
      id: "42",
      meta: {
        vkUserId: "42",
      },
    });
    expect(mocks.sendVkText).toHaveBeenCalledTimes(1);
    expect(mocks.sendVkText.mock.calls[0][0]).toMatchObject({
      cfg: {},
      accountId: "default",
      to: "vk:user:42",
    });
    expect(mocks.sendVkText.mock.calls[0][0].text).toContain("Your VK user id: 42");
  });

  it("blocks an unauthorized allowlist DM without pairing or routing", async () => {
    const statusSink = vi.fn();

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
          dmPolicy: "allowlist",
          allowFrom: ["99"],
        },
      },
      event: {
        eventId: "evt-3",
        peerId: "42",
        senderId: "42",
        messageId: "9",
        text: "hello",
        attachments: [],
        timestamp: 1_700_000_000_000,
        chatType: "direct",
      },
      statusSink,
    });

    expect(mocks.dispatchInboundReplyWithBase).not.toHaveBeenCalled();
    expect(mocks.sendVkText).not.toHaveBeenCalled();
    expect(mocks.upsertChannelPairingRequest).not.toHaveBeenCalled();
  });
});
