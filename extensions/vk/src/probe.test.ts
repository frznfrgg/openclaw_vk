import { describe, expect, it, vi } from "vitest";
import { probeVkAccount } from "./probe.js";
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

describe("probeVkAccount", () => {
  it("calls groups.getLongPollServer and returns the bootstrap fields", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/method/groups.getLongPollServer");
      expect(url.searchParams.get("group_id")).toBe("123");
      expect(url.searchParams.get("access_token")).toBe("vk-token");
      return new Response(
        JSON.stringify({
          response: {
            key: "secret",
            server: "https://lp.vk.com",
            ts: "42",
          },
        }),
        { status: 200 },
      );
    });

    const probe = await probeVkAccount(baseAccount, 2500, fetcher as typeof fetch);

    expect(probe.ok).toBe(true);
    expect(probe.longPoll).toEqual({
      server: "https://lp.vk.com",
      ts: "42",
    });
  });

  it("surfaces VK API errors", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              error_code: 5,
              error_msg: "User authorization failed: invalid access_token.",
            },
          }),
          { status: 200 },
        ),
    );

    const probe = await probeVkAccount(baseAccount, 2500, fetcher as typeof fetch);

    expect(probe.ok).toBe(false);
    expect(probe.error).toContain("invalid access_token");
  });

  it("rejects incomplete responses", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            response: {
              server: "https://lp.vk.com",
            },
          }),
          { status: 200 },
        ),
    );

    const probe = await probeVkAccount(baseAccount, 2500, fetcher as typeof fetch);

    expect(probe.ok).toBe(false);
    expect(probe.error).toBe("VK Long Poll probe returned an incomplete response.");
  });
});
