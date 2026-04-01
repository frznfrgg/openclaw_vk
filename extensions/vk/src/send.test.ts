import { beforeEach, describe, expect, it, vi } from "vitest";

const mediaMocks = vi.hoisted(() => ({
  resolveVkAttachmentToken: vi.fn(),
}));

vi.mock("./media.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./media.js")>();
  return {
    ...actual,
    resolveVkAttachmentToken: mediaMocks.resolveVkAttachmentToken,
  };
});

import { readVkRuntimeState, resetVkRuntimeStateForTests } from "./runtime.js";
import { sendVkMedia, sendVkText, sendVkTyping } from "./send.js";

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
    mediaMocks.resolveVkAttachmentToken.mockReset();
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

  it("strips fenced markdown formatting from approval-style replies", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("message")).toBe(`Approval required.

Run:

/approve e22d7f97 allow-once

Pending command:

sudo apt-get install -y python3.12-venv && python3 -m venv .venv

Other options:

/approve e22d7f97 allow-always
/approve e22d7f97 deny

Full id: e22d7f97-7e7c-4122-a766-7dc545e6381f`);
      return new Response(JSON.stringify({ response: 7791 }), { status: 200 });
    });

    await sendVkText({
      cfg: baseCfg,
      to: "vk:user:42",
      text: `Approval required.

Run:

\`\`\`txt
/approve e22d7f97 allow-once
\`\`\`

Pending command:

\`\`\`sh
sudo apt-get install -y python3.12-venv && python3 -m venv .venv
\`\`\`

Other options:

\`\`\`txt
/approve e22d7f97 allow-always
/approve e22d7f97 deny
\`\`\`

Full id: \`e22d7f97-7e7c-4122-a766-7dc545e6381f\``,
      randomId: 123471,
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

  it("sends typing activity through messages.setActivity", async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("https://api.vk.com/method/messages.setActivity");
      expect(init?.method).toBe("POST");
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("peer_id")).toBe("42");
      expect(body.get("type")).toBe("typing");
      expect(body.get("access_token")).toBe("vk-token");
      return new Response(JSON.stringify({ response: 1 }), { status: 200 });
    });

    await sendVkTyping({
      cfg: baseCfg,
      to: "vk:user:42",
      fetcher: fetcher as typeof fetch,
    });
  });

  it("supports group chat typing activity on canonical chat targets", async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("peer_id")).toBe("2000000001");
      expect(body.get("type")).toBe("typing");
      return new Response(JSON.stringify({ response: 1 }), { status: 200 });
    });

    await sendVkTyping({
      cfg: baseCfg,
      to: "vk:chat:2000000001",
      fetcher: fetcher as typeof fetch,
    });
  });

  it("sends supported media through messages.send with a caption", async () => {
    mediaMocks.resolveVkAttachmentToken.mockResolvedValue("photo-1_2");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("peer_id")).toBe("42");
      expect(body.get("message")).toBe("caption text");
      expect(body.get("attachment")).toBe("photo-1_2");
      return new Response(JSON.stringify({ response: 781 }), { status: 200 });
    });

    const result = await sendVkMedia({
      cfg: baseCfg,
      to: "vk:user:42",
      text: "caption text",
      mediaUrl: "file:///tmp/photo.png",
      mediaLocalRoots: ["/tmp"],
      randomId: 12348,
      fetcher: fetcher as typeof fetch,
    });

    expect(mediaMocks.resolveVkAttachmentToken).toHaveBeenCalledWith({
      account: expect.objectContaining({
        accountId: "default",
        communityId: "123",
      }),
      mediaUrl: "file:///tmp/photo.png",
      cfg: baseCfg,
      mediaLocalRoots: ["/tmp"],
      fetcher: fetcher as typeof fetch,
    });
    expect(result).toMatchObject({
      channel: "vk",
      messageId: "781",
      chatId: "42",
      conversationId: "vk:user:42",
    });
  });

  it("allows attachment-only sends when the caption flattens to empty text", async () => {
    mediaMocks.resolveVkAttachmentToken.mockResolvedValue("doc-1_3");
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = new URLSearchParams(String(init?.body));
      expect(body.get("message")).toBeNull();
      expect(body.get("attachment")).toBe("doc-1_3");
      return new Response(JSON.stringify({ response: 782 }), { status: 200 });
    });

    await sendVkMedia({
      cfg: baseCfg,
      to: "vk:chat:2000000001",
      text: "   ",
      mediaUrl: "https://example.com/report.pdf",
      randomId: 12349,
      fetcher: fetcher as typeof fetch,
    });
  });
});
