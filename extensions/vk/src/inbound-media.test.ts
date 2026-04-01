import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("openclaw/plugin-sdk/media-runtime", async (importOriginal) => {
  const actual = await importOriginal<typeof import("openclaw/plugin-sdk/media-runtime")>();
  return {
    ...actual,
    fetchRemoteMedia: vi.fn(),
    saveMediaBuffer: vi.fn(),
  };
});

describe("materializeVkInboundMedia", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("downloads supported attachments into the shared inbound media store", async () => {
    const mediaRuntime = await import("openclaw/plugin-sdk/media-runtime");
    const { materializeVkInboundMedia } = await import("./inbound-media.js");
    const fetchRemoteMedia = vi.mocked(mediaRuntime.fetchRemoteMedia);
    const saveMediaBuffer = vi.mocked(mediaRuntime.saveMediaBuffer);

    fetchRemoteMedia
      .mockResolvedValueOnce({
        buffer: Buffer.from("png-data"),
        contentType: "image/png",
        fileName: "full.png",
      })
      .mockResolvedValueOnce({
        buffer: Buffer.from("pdf-data"),
        contentType: "application/pdf",
        fileName: "report.pdf",
      });
    saveMediaBuffer
      .mockResolvedValueOnce({
        id: "full---uuid.png",
        path: "/tmp/openclaw/media/inbound/full---uuid.png",
        size: 8,
        contentType: "image/png",
      })
      .mockResolvedValueOnce({
        id: "report---uuid.pdf",
        path: "/tmp/openclaw/media/inbound/report---uuid.pdf",
        size: 8,
        contentType: "application/pdf",
      });

    const result = await materializeVkInboundMedia({
      attachments: [
        {
          kind: "image",
          url: "https://cdn.example.com/full.png",
          mimeType: "image/png",
          fileName: "full.png",
        },
        {
          kind: "document",
          url: "https://cdn.example.com/report.pdf",
          mimeType: "application/pdf",
          fileName: "report.pdf",
        },
      ],
    });

    expect(fetchRemoteMedia).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        url: "https://cdn.example.com/full.png",
        requestInit: { method: "GET" },
        filePathHint: "full.png",
        maxBytes: 50 * 1024 * 1024,
        readIdleTimeoutMs: 30_000,
      }),
    );
    expect(fetchRemoteMedia).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        url: "https://cdn.example.com/report.pdf",
        requestInit: { method: "GET" },
        filePathHint: "report.pdf",
        maxBytes: 200 * 1024 * 1024,
        readIdleTimeoutMs: 30_000,
      }),
    );
    expect(saveMediaBuffer).toHaveBeenNthCalledWith(
      1,
      Buffer.from("png-data"),
      "image/png",
      "inbound",
      50 * 1024 * 1024,
      "full.png",
    );
    expect(saveMediaBuffer).toHaveBeenNthCalledWith(
      2,
      Buffer.from("pdf-data"),
      "application/pdf",
      "inbound",
      200 * 1024 * 1024,
      "report.pdf",
    );
    expect(result).toEqual({
      MediaPath: "/tmp/openclaw/media/inbound/full---uuid.png",
      MediaType: "image/png",
      MediaUrl: "/tmp/openclaw/media/inbound/full---uuid.png",
      MediaPaths: [
        "/tmp/openclaw/media/inbound/full---uuid.png",
        "/tmp/openclaw/media/inbound/report---uuid.pdf",
      ],
      MediaUrls: [
        "/tmp/openclaw/media/inbound/full---uuid.png",
        "/tmp/openclaw/media/inbound/report---uuid.pdf",
      ],
      MediaTypes: ["image/png", "application/pdf"],
    });
  });

  it("skips failed downloads without dropping successful attachments", async () => {
    const mediaRuntime = await import("openclaw/plugin-sdk/media-runtime");
    const { materializeVkInboundMedia } = await import("./inbound-media.js");
    const fetchRemoteMedia = vi.mocked(mediaRuntime.fetchRemoteMedia);
    const saveMediaBuffer = vi.mocked(mediaRuntime.saveMediaBuffer);
    const log = {
      debug: vi.fn(),
    };

    fetchRemoteMedia
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce({
        buffer: Buffer.from("pdf-data"),
        contentType: "application/pdf",
        fileName: "report.pdf",
      });
    saveMediaBuffer.mockResolvedValueOnce({
      id: "report---uuid.pdf",
      path: "/tmp/openclaw/media/inbound/report---uuid.pdf",
      size: 8,
      contentType: "application/pdf",
    });

    const result = await materializeVkInboundMedia({
      attachments: [
        {
          kind: "image",
          url: "https://cdn.example.com/full.png",
          mimeType: "image/png",
          fileName: "full.png",
        },
        {
          kind: "document",
          url: "https://cdn.example.com/report.pdf",
          mimeType: "application/pdf",
          fileName: "report.pdf",
        },
      ],
      log,
    });

    expect(log.debug).toHaveBeenCalledWith(
      expect.stringContaining("VK inbound image attachment download failed: boom"),
    );
    expect(result).toEqual({
      MediaPath: "/tmp/openclaw/media/inbound/report---uuid.pdf",
      MediaType: "application/pdf",
      MediaUrl: "/tmp/openclaw/media/inbound/report---uuid.pdf",
      MediaPaths: ["/tmp/openclaw/media/inbound/report---uuid.pdf"],
      MediaUrls: ["/tmp/openclaw/media/inbound/report---uuid.pdf"],
      MediaTypes: ["application/pdf"],
    });
  });
});
