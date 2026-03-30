import { beforeEach, describe, expect, it, vi } from "vitest";
import { readVkRuntimeState, resetVkRuntimeStateForTests } from "./runtime.js";
import { sendVkText } from "./send.js";

const baseCfg = {
  channels: {
    vk: {
      enabled: true,
      communityId: "123",
      communityAccessToken: "vk-token",
    },
  },
};

describe("sendVkText", () => {
  beforeEach(() => {
    resetVkRuntimeStateForTests();
  });

  it("sends a DM through messages.send and returns a delivery result", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.vk.com/method/messages.send");
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("peer_id")).toBe("42");
      expect(body.get("message")).toBe("hello");
      expect(body.get("random_id")).toBe("12345");
      expect(body.get("access_token")).toBe("vk-token");
      return new Response(JSON.stringify({ response: 777 }), { status: 200 });
    });

    const result = await sendVkText({
      cfg: baseCfg,
      to: "vk:user:42",
      text: "hello",
      randomId: 12345,
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({
      channel: "vk",
      messageId: "777",
      chatId: "42",
      conversationId: "vk:user:42",
    });
    expect(readVkRuntimeState("default").lastOutboundAt).toBe(result.timestamp);
  });

  it("rejects invalid canonical targets", async () => {
    await expect(
      sendVkText({
        cfg: baseCfg,
        to: "vk:not-a-target:2000000001",
        text: "hello",
        fetcher: vi.fn() as typeof fetch,
      }),
    ).rejects.toThrow(
      'VK sendText requires a canonical target in the form "vk:user:<user_id>" or "vk:chat:<peer_id>".',
    );
  });

  it("accepts canonical group peer targets for routed group replies", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("peer_id")).toBe("2000000001");
      expect(body.get("message")).toBe("hello group");
      return new Response(JSON.stringify({ response: 778 }), { status: 200 });
    });

    const result = await sendVkText({
      cfg: baseCfg,
      to: "vk:chat:2000000001",
      text: "hello group",
      randomId: 12346,
      fetcher: fetcher as typeof fetch,
    });

    expect(result).toMatchObject({
      channel: "vk",
      messageId: "778",
      chatId: "2000000001",
      conversationId: "vk:chat:2000000001",
    });
  });

  it("flattens markdown and html to plain text before sending", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("message")).toBe("Title\nbold and code");
      return new Response(JSON.stringify({ response: 779 }), { status: 200 });
    });

    await sendVkText({
      cfg: baseCfg,
      to: "vk:user:42",
      text: "## Title\n<b>**bold**</b> and `code`",
      randomId: 12347,
      fetcher: fetcher as typeof fetch,
    });
  });

  it("uses a seeded monotonic random_id sequence when the caller does not provide one", async () => {
    const randomIds: number[] = [];
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      randomIds.push(Number(body.get("random_id")));
      return new Response(JSON.stringify({ response: 780 + randomIds.length }), { status: 200 });
    });

    await sendVkText({
      cfg: baseCfg,
      to: "vk:user:42",
      text: "first",
      fetcher: fetcher as typeof fetch,
    });
    await sendVkText({
      cfg: baseCfg,
      to: "vk:user:42",
      text: "second",
      fetcher: fetcher as typeof fetch,
    });

    expect(randomIds).toHaveLength(2);
    expect(randomIds[0]).toBeGreaterThan(0);
    expect(randomIds[1]).toBeGreaterThan(0);
    expect(randomIds[1]).toBe(randomIds[0] === 2_147_483_647 ? 1 : randomIds[0] + 1);
  });

  it("surfaces VK API errors", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            error: {
              error_code: 901,
              error_msg: "Can’t send messages for users without permission",
            },
          }),
          { status: 200 },
        ),
    );

    await expect(
      sendVkText({
        cfg: baseCfg,
        to: "vk:user:42",
        text: "hello",
        fetcher: fetcher as typeof fetch,
      }),
    ).rejects.toThrow("Can’t send messages for users without permission");
  });
});
