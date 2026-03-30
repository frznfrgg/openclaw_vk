import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  sendVkText: vi.fn(),
}));

vi.mock("./send.js", () => ({
  sendVkText: mocks.sendVkText,
}));

import { PAIRING_APPROVED_MESSAGE } from "../../../src/channels/plugins/pairing-message.js";
import { vkPlugin } from "./channel.js";
import {
  inferVkTargetChatType,
  normalizeVkTarget,
  parseVkExplicitTarget,
  parseVkTarget,
} from "./targets.js";

describe("VK target parsing", () => {
  it("normalizes canonical user and chat targets", () => {
    expect(normalizeVkTarget("vk:user:00042")).toBe("vk:user:42");
    expect(normalizeVkTarget("VK:CHAT:2000000001")).toBe("vk:chat:2000000001");
  });

  it("parses explicit targets into canonical carrier and peer identity", () => {
    expect(parseVkExplicitTarget("vk:user:00042")).toEqual({
      kind: "user",
      to: "vk:user:42",
      canonicalId: "42",
      peerId: "42",
      chatType: "direct",
      userId: "42",
    });
    expect(parseVkExplicitTarget("vk:chat:2000000001")).toEqual({
      kind: "chat",
      to: "vk:chat:2000000001",
      canonicalId: "2000000001",
      peerId: "2000000001",
      chatType: "group",
    });
  });

  it("keeps the legacy parsed-target helper aligned with explicit parsing", () => {
    expect(parseVkTarget("vk:user:42")).toEqual({
      kind: "user",
      canonicalTarget: "vk:user:42",
      canonicalId: "42",
      peerId: "42",
      userId: "42",
    });
    expect(parseVkTarget("vk:chat:2000000001")).toEqual({
      kind: "chat",
      canonicalTarget: "vk:chat:2000000001",
      canonicalId: "2000000001",
      peerId: "2000000001",
    });
  });

  it("rejects non-canonical or unsupported target forms", () => {
    expect(normalizeVkTarget("42")).toBeNull();
    expect(parseVkExplicitTarget("vk:user:2000000001")).toBeNull();
    expect(parseVkExplicitTarget("vk:chat:42")).toBeNull();
    expect(parseVkExplicitTarget("vk:room:1")).toBeNull();
  });

  it("infers the correct chat type from canonical targets", () => {
    expect(inferVkTargetChatType("vk:user:42")).toBe("direct");
    expect(inferVkTargetChatType("vk:chat:2000000001")).toBe("group");
    expect(inferVkTargetChatType("invalid")).toBeNull();
  });
});

describe("VK messaging hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sendVkText.mockResolvedValue({
      channel: "vk",
      messageId: "778",
      conversationId: "vk:user:42",
    });
  });

  it("exposes canonical target parsing through the messaging adapter", () => {
    expect(vkPlugin.messaging?.normalizeTarget?.("VK:USER:00042")).toBe("vk:user:42");
    expect(vkPlugin.messaging?.parseExplicitTarget?.({ raw: "vk:chat:2000000001" })).toEqual({
      to: "vk:chat:2000000001",
      chatType: "group",
    });
    expect(vkPlugin.messaging?.inferTargetChatType?.({ to: "vk:user:42" })).toBe("direct");
  });

  it("routes outbound user and group targets into the same session families as inbound VK conversations", () => {
    expect(
      vkPlugin.messaging?.resolveOutboundSessionRoute?.({
        cfg: {},
        agentId: "agent-1",
        accountId: "default",
        target: "vk:user:42",
      }),
    ).toMatchObject({
      peer: { kind: "direct", id: "42" },
      chatType: "direct",
      from: "vk:user:42",
      to: "vk:user:42",
    });

    expect(
      vkPlugin.messaging?.resolveOutboundSessionRoute?.({
        cfg: {},
        agentId: "agent-1",
        accountId: "default",
        target: "vk:chat:2000000001",
      }),
    ).toMatchObject({
      peer: { kind: "group", id: "2000000001" },
      chatType: "group",
      from: "vk:chat:2000000001",
      to: "vk:chat:2000000001",
    });
  });

  it("validates outbound targets before delivery", () => {
    expect(vkPlugin.outbound?.resolveTarget?.({ to: "vk:user:00042" })).toEqual({
      ok: true,
      to: "vk:user:42",
    });

    const invalid = vkPlugin.outbound?.resolveTarget?.({ to: "invalid-target" });
    expect(invalid && "ok" in invalid && invalid.ok).toBe(false);
    if (invalid && "ok" in invalid && !invalid.ok) {
      expect(invalid.error.message).toBe(
        'VK requires an explicit target in the form "vk:user:<user_id>" or "vk:chat:<peer_id>".',
      );
    }
  });

  it("delivers pairing approval through the standard VK text-send path", async () => {
    await vkPlugin.pairing?.notifyApproval?.({
      cfg: {
        channels: {
          vk: {
            enabled: true,
            communityId: "123",
            communityAccessToken: "vk-token",
          },
        },
      },
      id: "42",
    });

    expect(mocks.sendVkText).toHaveBeenCalledWith({
      cfg: {
        channels: {
          vk: {
            enabled: true,
            communityId: "123",
            communityAccessToken: "vk-token",
          },
        },
      },
      to: "vk:user:42",
      text: PAIRING_APPROVED_MESSAGE,
    });
  });
});
