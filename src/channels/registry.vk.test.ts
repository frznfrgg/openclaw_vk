import { describe, expect, it } from "vitest";
import { getChatChannelMeta, listChatChannels, normalizeChatChannelId } from "./registry.js";

describe("VK channel registry metadata", () => {
  it("exposes VK as a built-in chat channel", () => {
    const channels = listChatChannels();
    expect(channels.some((channel) => channel.id === "vk")).toBe(true);
    expect(normalizeChatChannelId("vk")).toBe("vk");
  });

  it("publishes expected VK docs and selection metadata", () => {
    const meta = getChatChannelMeta("vk");
    expect(meta.label).toBe("VK");
    expect(meta.selectionLabel).toBe("VK (Community Bot)");
    expect(meta.docsPath).toBe("/channels/vk");
    expect(meta.docsLabel).toBe("vk");
    expect(meta.blurb).toContain("Long Poll");
  });
});
