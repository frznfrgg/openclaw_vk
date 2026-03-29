import { describe, expect, it, vi } from "vitest";
import type { ResolvedVkAccount } from "../shared.js";
import { runVkLongPoll } from "./long-poll.js";

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

describe("runVkLongPoll", () => {
  it("bootstraps, marks connected only after a successful poll, and dedupes repeated event_id values", async () => {
    const abort = new AbortController();
    const seen: string[] = [];
    const setStatus = vi.fn();
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe("/method/groups.getLongPollServer");
        expect(url.searchParams.get("group_id")).toBe("123");
        expect(url.searchParams.get("access_token")).toBe("vk-token");
        return new Response(
          JSON.stringify({
            response: {
              server: "https://lp.vk.com/check",
              key: "secret",
              ts: "10",
            },
          }),
          { status: 200 },
        );
      })
      .mockImplementationOnce(async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        expect(url.searchParams.get("act")).toBe("a_check");
        expect(url.searchParams.get("key")).toBe("secret");
        expect(url.searchParams.get("ts")).toBe("10");
        expect(url.searchParams.get("wait")).toBe("25");
        return new Response(
          JSON.stringify({
            ts: "11",
            updates: [
              { event_id: "evt-1", type: "message_new" },
              { event_id: "evt-1", type: "message_new" },
              { event_id: "evt-2", type: "message_new" },
            ],
          }),
          { status: 200 },
        );
      });

    await runVkLongPoll({
      ctx: {
        abortSignal: abort.signal,
        setStatus,
        log: { error: vi.fn() } as never,
      },
      account: baseAccount,
      fetcher: fetcher as typeof fetch,
      onEvent: async (update) => {
        seen.push(String(update.event_id));
        if (seen.length === 2) {
          abort.abort();
        }
      },
    });

    expect(seen).toEqual(["evt-1", "evt-2"]);
    expect(
      setStatus.mock.calls.some(([patch]) => patch.connected === true && patch.lastError === null),
    ).toBe(true);
  });

  it('recovers from "failed=1" by reusing the returned ts on the next poll', async () => {
    const abort = new AbortController();
    const setStatus = vi.fn();
    const polledTs: string[] = [];
    const fetcher = vi
      .fn()
      .mockImplementationOnce(
        async () =>
          new Response(
            JSON.stringify({
              response: {
                server: "https://lp.vk.com/check",
                key: "secret",
                ts: "10",
              },
            }),
            { status: 200 },
          ),
      )
      .mockImplementationOnce(async (input: RequestInfo | URL) => {
        polledTs.push(new URL(String(input)).searchParams.get("ts") ?? "");
        return new Response(
          JSON.stringify({
            failed: 1,
            ts: "99",
          }),
          { status: 200 },
        );
      })
      .mockImplementationOnce(async (input: RequestInfo | URL) => {
        polledTs.push(new URL(String(input)).searchParams.get("ts") ?? "");
        abort.abort();
        return new Response(
          JSON.stringify({
            ts: "100",
            updates: [],
          }),
          { status: 200 },
        );
      });

    await runVkLongPoll({
      ctx: {
        abortSignal: abort.signal,
        setStatus,
        log: { error: vi.fn() } as never,
      },
      account: baseAccount,
      fetcher: fetcher as typeof fetch,
      onEvent: vi.fn(),
    });

    expect(polledTs).toEqual(["10", "99"]);
    expect(
      setStatus.mock.calls.some(
        ([patch]) =>
          patch.connected === false &&
          patch.lastError === 'VK long poll cursor expired ("failed=1").',
      ),
    ).toBe(true);
    expect(
      setStatus.mock.calls.some(([patch]) => patch.connected === true && patch.lastError === null),
    ).toBe(true);
  });
});
