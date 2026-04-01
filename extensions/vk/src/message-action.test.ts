import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenClawConfig } from "../../../src/config/config.js";
import { setActivePluginRegistry } from "../../../src/plugins/runtime.js";
import { createTestRegistry } from "../../../src/test-utils/channel-plugins.js";
import { runMessageAction } from "../../../src/infra/outbound/message-action-runner.js";
import { vkPlugin } from "./channel.js";

const baseCfg = {
  channels: {
    vk: {
      enabled: true,
      communityId: "123",
      communityAccessToken: "vk-token",
    },
  },
} as OpenClawConfig;

describe("VK message action sends attachments", () => {
  beforeEach(() => {
    setActivePluginRegistry(
      createTestRegistry([
        {
          pluginId: "vk",
          source: "test",
          plugin: vkPlugin,
        },
      ]),
    );
  });

  afterEach(() => {
    setActivePluginRegistry(createTestRegistry([]));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sends a local PDF to the current VK DM through the shared message action", async () => {
    const sandboxDir = await fs.mkdtemp(path.join(os.tmpdir(), "vk-message-action-"));
    try {
      vi.stubEnv("OPENCLAW_STATE_DIR", sandboxDir);
      const pdfPath = path.join(sandboxDir, "workspace", "files", "report.pdf");
      await fs.mkdir(path.dirname(pdfPath), { recursive: true });
      await fs.writeFile(
        pdfPath,
        Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n", "utf8"),
      );

      const fetcher = vi
        .fn()
        .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = new URLSearchParams(String(init?.body));
          expect(body.get("type")).toBe("doc");
          expect(body.get("peer_id")).toBe("597545525");
          expect(body.get("access_token")).toBe("vk-token");
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
        })
        .mockImplementationOnce(async (_input: RequestInfo | URL, init?: RequestInit) => {
          const body = new URLSearchParams(String(init?.body));
          expect(body.get("peer_id")).toBe("597545525");
          expect(body.get("attachment")).toBe("doc-123_55");
          expect(body.get("message")).toBe("Here it is.");
          return new Response(JSON.stringify({ response: 777 }), { status: 200 });
        });

      vi.stubGlobal("fetch", fetcher as typeof fetch);

      const result = await runMessageAction({
        cfg: baseCfg,
        action: "send",
        params: {
          channel: "vk",
          path: pdfPath,
          caption: "Here it is.",
        },
        toolContext: {
          currentChannelId: "vk:user:597545525",
          currentChannelProvider: "vk",
        },
        dryRun: false,
      });

      expect(result.kind).toBe("send");
      expect(result.channel).toBe("vk");
      expect(result.handledBy).toBe("core");
      expect(result.to).toBe("vk:user:597545525");
      expect(result.sendResult).toMatchObject({
        channel: "vk",
        to: "vk:user:597545525",
        mediaUrl: pdfPath,
        result: {
          messageId: "777",
          chatId: "597545525",
          conversationId: "vk:user:597545525",
        },
      });
      expect(fetcher).toHaveBeenCalledTimes(4);
    } finally {
      await fs.rm(sandboxDir, { recursive: true, force: true });
    }
  });
});
