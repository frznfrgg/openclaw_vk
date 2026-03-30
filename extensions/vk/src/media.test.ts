import { beforeEach, describe, expect, it, vi } from "vitest";

const outboundMediaMocks = vi.hoisted(() => ({
  loadOutboundMediaFromUrl: vi.fn(),
}));

vi.mock("../../../src/plugin-sdk/outbound-media.js", () => ({
  loadOutboundMediaFromUrl: outboundMediaMocks.loadOutboundMediaFromUrl,
}));

import {
  normalizeVkOutboundPayload,
  resolveVkAttachmentToken,
  uploadVkDocument,
  uploadVkImage,
} from "./media.js";
import type { ResolvedVkAccount } from "./shared.js";

const baseCfg = {
  channels: {
    vk: {
      enabled: true,
      communityId: "123",
      communityAccessToken: "vk-token",
    },
  },
};

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

describe("VK media helpers", () => {
  beforeEach(() => {
    outboundMediaMocks.loadOutboundMediaFromUrl.mockReset();
  });

  it("uploads images with the official messages photo flow", async () => {
    outboundMediaMocks.loadOutboundMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("image-bytes"),
      contentType: "image/png",
      fileName: "photo.png",
      kind: "image",
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("group_id")).toBe("123");
        return new Response(
          JSON.stringify({ response: { upload_url: "https://upload.vk.test/photo" } }),
          { status: 200 },
        );
      })
      .mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://upload.vk.test/photo");
        const form = init?.body as FormData;
        expect(form.get("photo")).toBeTruthy();
        return new Response(JSON.stringify({ server: 11, photo: "[{}]", hash: "hash-1" }), {
          status: 200,
        });
      })
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("server")).toBe("11");
        expect(body.get("photo")).toBe("[{}]");
        expect(body.get("hash")).toBe("hash-1");
        return new Response(JSON.stringify({ response: [{ id: 22, owner_id: -123 }] }), {
          status: 200,
        });
      });

    await expect(
      uploadVkImage({
        account: baseAccount,
        mediaUrl: "file:///tmp/photo.png",
        cfg: baseCfg,
        mediaLocalRoots: ["/tmp"],
        fetcher: fetcher as typeof fetch,
      }),
    ).resolves.toBe("photo-123_22");

    expect(outboundMediaMocks.loadOutboundMediaFromUrl).toHaveBeenCalledWith(
      "file:///tmp/photo.png",
      {
        maxBytes: 200 * 1024 * 1024,
        mediaLocalRoots: ["/tmp"],
      },
    );
  });

  it("uploads documents with the official docs flow", async () => {
    outboundMediaMocks.loadOutboundMediaFromUrl.mockResolvedValue({
      buffer: Buffer.from("pdf-bytes"),
      contentType: "application/pdf",
      fileName: "report.pdf",
      kind: "document",
    });
    const fetcher = vi
      .fn()
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("type")).toBe("doc");
        return new Response(
          JSON.stringify({ response: { upload_url: "https://upload.vk.test/doc" } }),
          { status: 200 },
        );
      })
      .mockImplementationOnce(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("https://upload.vk.test/doc");
        const form = init?.body as FormData;
        expect(form.get("file")).toBeTruthy();
        return new Response(JSON.stringify({ file: "file-token-1" }), { status: 200 });
      })
      .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
        const body = new URLSearchParams(String(init?.body));
        expect(body.get("file")).toBe("file-token-1");
        expect(body.get("title")).toBe("report");
        return new Response(JSON.stringify({ response: { doc: { id: 55, owner_id: -123 } } }), {
          status: 200,
        });
      });

    await expect(
      uploadVkDocument({
        account: baseAccount,
        mediaUrl: "https://example.com/report.pdf",
        cfg: baseCfg,
        fetcher: fetcher as typeof fetch,
      }),
    ).resolves.toBe("doc-123_55");
  });

  it("classifies image media into photo uploads and everything else into documents", async () => {
    outboundMediaMocks.loadOutboundMediaFromUrl
      .mockResolvedValueOnce({
        buffer: Buffer.from("img"),
        contentType: "image/jpeg",
        fileName: "photo.jpg",
        kind: "image",
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from("doc"),
        contentType: "application/pdf",
        fileName: "report.pdf",
        kind: "document",
      });
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ response: { upload_url: "https://upload.vk.test/photo" } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ server: 11, photo: "[{}]", hash: "hash-1" }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ response: [{ id: 22, owner_id: -123 }] }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ response: { upload_url: "https://upload.vk.test/doc" } }), {
          status: 200,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ file: "file-token-1" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ response: { doc: { id: 55, owner_id: -123 } } }), {
          status: 200,
        }),
      );

    await expect(
      resolveVkAttachmentToken({
        account: baseAccount,
        mediaUrl: "https://example.com/photo.jpg",
        cfg: baseCfg,
        fetcher: fetcher as typeof fetch,
      }),
    ).resolves.toBe("photo-123_22");

    await expect(
      resolveVkAttachmentToken({
        account: baseAccount,
        mediaUrl: "https://example.com/report.pdf",
        cfg: baseCfg,
        fetcher: fetcher as typeof fetch,
      }),
    ).resolves.toBe("doc-123_55");
  });

  it("drops unsupported-only outbound payloads and preserves text when supported media remain", () => {
    expect(
      normalizeVkOutboundPayload({
        text: "",
        mediaUrls: ["https://example.com/track.mp3", "https://example.com/setup.exe"],
      }),
    ).toBeNull();

    expect(
      normalizeVkOutboundPayload({
        text: "hello",
        mediaUrls: [
          "https://example.com/track.mp3",
          "https://example.com/report.pdf",
          "https://example.com/setup.exe",
        ],
      }),
    ).toEqual({
      text: "hello",
      mediaUrls: ["https://example.com/report.pdf"],
      mediaUrl: "https://example.com/report.pdf",
    });
  });
});
