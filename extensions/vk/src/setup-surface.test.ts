import { describe, expect, it } from "vitest";
import { vkSetupWizard } from "./setup-surface.js";

describe("vkSetupWizard", () => {
  it("uses deferred apply so async validation runs on the full candidate", () => {
    expect(vkSetupWizard.deferApplyUntilValidated).toBe(true);
  });

  it("prepare records the chosen credential source and clears stale sources when switching", async () => {
    const prepared = await vkSetupWizard.prepare?.({
      cfg: {
        channels: {
          vk: {
            enabled: true,
            communityId: "123",
            communityAccessToken: "inline-token",
          },
        },
      },
      accountId: "default",
      credentialValues: {},
      runtime: {} as never,
      options: undefined,
      prompter: {
        select: async () => "file",
      } as never,
    });

    expect(prepared?.credentialValues).toMatchObject({
      __vkCredentialSource: "file",
    });
    expect(prepared?.cfg).toEqual({
      channels: {
        vk: {
          enabled: true,
          communityId: "123",
        },
      },
    });
  });

  it("use-env writes the shared env SecretRef and clears tokenFile", async () => {
    const credential = vkSetupWizard.credentials[0];
    if (!credential?.applyUseEnv) {
      throw new Error("VK credential applyUseEnv missing");
    }

    const next = await credential.applyUseEnv({
      cfg: {
        channels: {
          vk: {
            enabled: true,
            communityId: "123",
            tokenFile: "/tmp/vk.token",
          },
        },
      },
      accountId: "default",
    });

    expect(next.channels?.vk).toEqual({
      enabled: true,
      communityId: "123",
      communityAccessToken: {
        source: "env",
        provider: "default",
        id: "VK_COMMUNITY_ACCESS_TOKEN",
      },
    });
  });

  it("tokenFile setup clears the stale communityAccessToken", async () => {
    const tokenFileInput = vkSetupWizard.textInputs?.find(
      (input) => input.inputKey === "tokenFile",
    );
    if (!tokenFileInput?.applySet) {
      throw new Error("VK tokenFile input missing");
    }

    const next = await tokenFileInput.applySet({
      cfg: {
        channels: {
          vk: {
            enabled: true,
            communityId: "123",
            communityAccessToken: "inline-token",
          },
        },
      },
      accountId: "default",
      value: "/run/secrets/vk-token",
    });

    expect(next.channels?.vk).toEqual({
      enabled: true,
      communityId: "123",
      tokenFile: "/run/secrets/vk-token",
    });
  });
});
