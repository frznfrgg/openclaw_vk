import { describe, expect, it } from "vitest";
import pluginEntry from "../index.js";
import setupEntry from "../setup-entry.js";
import { vkApprovalAuth } from "./approval-auth.js";
import { vkPlugin, vkSetupPlugin } from "./channel.js";

const DEFAULT_ACCOUNT_ID = "default";

describe("VK plugin entrypoints", () => {
  it("publishes the bundled VK channel plugin entry", () => {
    expect(pluginEntry.id).toBe("vk");
    expect(pluginEntry.name).toBe("VK");
    expect(pluginEntry.description).toBe("VK channel plugin");
  });

  it("publishes the VK setup entry", () => {
    expect(setupEntry.plugin).toBe(vkSetupPlugin);
    expect(vkSetupPlugin.id).toBe("vk");
  });

  it("wires same-chat approval auth through the live VK plugin", () => {
    expect(vkPlugin.auth).toBe(vkApprovalAuth);
  });
});

describe("VK single-account setup/config contract", () => {
  it("always exposes only the default logical account id", () => {
    expect(vkPlugin.config.listAccountIds({})).toEqual([DEFAULT_ACCOUNT_ID]);
    expect(vkPlugin.config.listAccountIds({ channels: { vk: { communityId: "1" } } })).toEqual([
      DEFAULT_ACCOUNT_ID,
    ]);
    expect(
      vkPlugin.config.defaultAccountId?.({
        channels: { vk: { communityId: "1", enabled: false } },
      }),
    ).toBe(DEFAULT_ACCOUNT_ID);
  });

  it("normalizes omitted/empty/default account id to default", () => {
    const resolver = vkPlugin.setup?.resolveAccountId;
    if (!resolver) {
      throw new Error("VK setup resolver is missing");
    }
    expect(resolver({ cfg: {}, accountId: undefined, input: {} })).toBe(DEFAULT_ACCOUNT_ID);
    expect(resolver({ cfg: {}, accountId: "", input: {} })).toBe(DEFAULT_ACCOUNT_ID);
    expect(resolver({ cfg: {}, accountId: "default", input: {} })).toBe(DEFAULT_ACCOUNT_ID);
    expect(resolver({ cfg: {}, accountId: "DEFAULT", input: {} })).toBe(DEFAULT_ACCOUNT_ID);
  });

  it("rejects non-default account ids before config write", () => {
    const resolver = vkPlugin.setup?.resolveAccountId;
    if (!resolver) {
      throw new Error("VK setup resolver is missing");
    }
    expect(() => resolver({ cfg: {}, accountId: "ops", input: {} })).toThrowError(
      'VK supports only the "default" account id.',
    );
  });
});
