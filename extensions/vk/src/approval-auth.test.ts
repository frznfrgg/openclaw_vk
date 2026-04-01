import { beforeEach, describe, expect, it, vi } from "vitest";
import { vkApprovalAuth } from "./approval-auth.js";

const { readChannelAllowFromStoreSyncMock } = vi.hoisted(() => ({
  readChannelAllowFromStoreSyncMock: vi.fn(() => [] as string[]),
}));

vi.mock("../../../src/pairing/pairing-store.js", () => ({
  readChannelAllowFromStoreSync: readChannelAllowFromStoreSyncMock,
}));

describe("vkApprovalAuth", () => {
  beforeEach(() => {
    readChannelAllowFromStoreSyncMock.mockReset();
    readChannelAllowFromStoreSyncMock.mockReturnValue([]);
  });

  it("authorizes paired VK users from the pairing allow-from store", () => {
    readChannelAllowFromStoreSyncMock.mockReturnValue(["42"]);

    expect(
      vkApprovalAuth.authorizeActorAction({
        cfg: {
          channels: {
            vk: {
              communityId: "1",
              dmPolicy: "pairing",
            },
          },
        },
        accountId: "default",
        senderId: "42",
        action: "approve",
        approvalKind: "exec",
      }),
    ).toEqual({ authorized: true });
  });

  it("authorizes configured direct default targets and ignores group targets", () => {
    expect(
      vkApprovalAuth.authorizeActorAction({
        cfg: {
          channels: {
            vk: {
              communityId: "1",
              defaultTo: "vk:user:77",
            },
          },
        },
        senderId: "77",
        action: "approve",
        approvalKind: "plugin",
      }),
    ).toEqual({ authorized: true });

    expect(
      vkApprovalAuth.authorizeActorAction({
        cfg: {
          channels: {
            vk: {
              communityId: "1",
              defaultTo: "vk:chat:2000000001",
            },
          },
        },
        senderId: "77",
        action: "approve",
        approvalKind: "plugin",
      }),
    ).toEqual({ authorized: true });
  });

  it("rejects non-approvers when config or store resolves an explicit VK approver list", () => {
    readChannelAllowFromStoreSyncMock.mockReturnValue(["42"]);

    expect(
      vkApprovalAuth.authorizeActorAction({
        cfg: {
          channels: {
            vk: {
              communityId: "1",
              allowFrom: ["42"],
              dmPolicy: "pairing",
            },
          },
        },
        senderId: "99",
        action: "approve",
        approvalKind: "exec",
      }),
    ).toEqual({
      authorized: false,
      reason: "❌ You are not authorized to approve exec requests on VK.",
    });
  });
});
