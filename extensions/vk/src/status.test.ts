import { beforeEach, describe, expect, it, vi } from "vitest";
import { inspectVkAccount } from "./account-inspect.js";
import { vkPlugin } from "./channel.js";
import { resetVkRuntimeStateForTests } from "./runtime.js";

describe("VK status baseline", () => {
  beforeEach(() => {
    resetVkRuntimeStateForTests();
    vi.unstubAllGlobals();
  });

  it("reports configured_unavailable when the credential source is configured but unreadable", async () => {
    const account = inspectVkAccount({
      cfg: {
        channels: {
          vk: {
            enabled: true,
            communityId: "123",
            communityAccessToken: {
              source: "env",
              provider: "default",
              id: "VK_COMMUNITY_ACCESS_TOKEN",
            },
          },
        },
      },
    });

    const snapshot = await vkPlugin.status?.buildAccountSnapshot?.({
      account,
      cfg: {
        channels: {
          vk: {
            enabled: true,
            communityId: "123",
            communityAccessToken: {
              source: "env",
              provider: "default",
              id: "VK_COMMUNITY_ACCESS_TOKEN",
            },
          },
        },
      },
    });

    expect(snapshot).toMatchObject({
      accountId: "default",
      configured: true,
      enabled: true,
      connected: false,
      tokenStatus: "configured_unavailable",
    });
    expect(account.token).toBeUndefined();
  });

  it("caches probe results from live status probes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              response: {
                key: "secret",
                server: "https://lp.vk.com",
                ts: "42",
              },
            }),
            { status: 200 },
          ),
      ),
    );

    const cfg = {
      channels: {
        vk: {
          enabled: true,
          communityId: "123",
          communityAccessToken: "vk-token",
        },
      },
    };
    const account = inspectVkAccount({ cfg });

    const probe = await vkPlugin.status?.probeAccount?.({
      account,
      cfg,
      timeoutMs: 2500,
    });
    const snapshot = await vkPlugin.status?.buildAccountSnapshot?.({
      account,
      cfg,
    });

    expect(probe?.ok).toBe(true);
    expect(snapshot?.probe).toMatchObject({
      ok: true,
      longPoll: {
        server: "https://lp.vk.com",
        ts: "42",
      },
    });
    expect(typeof snapshot?.lastProbeAt).toBe("number");
  });
});
