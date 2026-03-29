import { describe, expect, it } from "vitest";
import {
  VkConfigSchema,
  normalizeVkAllowFromForConfigWrite,
  normalizeVkGroupAllowFromForConfigWrite,
  normalizeVkGroupsForConfigWrite,
} from "./config-schema.js";

function collectIssueMessages(result: ReturnType<typeof VkConfigSchema.safeParse>): string[] {
  if (result.success) {
    return [];
  }
  return result.error.issues.map((issue) => issue.message);
}

describe("VkConfigSchema", () => {
  it("accepts valid config and normalizes ids/targets", () => {
    const parsed = VkConfigSchema.parse({
      enabled: true,
      communityId: " 000123 ",
      communityAccessToken: {
        source: "env",
        provider: "default",
        id: "VK_COMMUNITY_ACCESS_TOKEN",
      },
      tokenFile: " /tmp/vk.token ",
      defaultTo: " VK:USER:000456 ",
      dmPolicy: "open",
      allowFrom: "*",
      groupPolicy: "allowlist",
      groupAllowFrom: [" 000789 "],
      groups: {
        "2000000015": { enabled: true },
      },
    });

    expect(parsed.communityId).toBe("123");
    expect(parsed.tokenFile).toBe("/tmp/vk.token");
    expect(parsed.defaultTo).toBe("vk:user:456");
    expect(parsed.allowFrom).toEqual(["*"]);
    expect(parsed.groupAllowFrom).toEqual(["789"]);
    expect(parsed.groups).toEqual({
      "2000000015": { enabled: true },
    });
  });

  it("rejects invalid communityId", () => {
    const result = VkConfigSchema.safeParse({
      communityId: "club123",
    });
    expect(result.success).toBe(false);
    expect(collectIssueMessages(result)).toContain(
      "channels.vk.communityId must be a positive numeric VK community id.",
    );
  });

  it("rejects invalid defaultTo shape", () => {
    const result = VkConfigSchema.safeParse({
      communityId: "123",
      defaultTo: "vk:user:2000000000",
    });
    expect(result.success).toBe(false);
    expect(collectIssueMessages(result)).toContain(
      'channels.vk.defaultTo must be "vk:user:<user_id>" or "vk:chat:<peer_id>".',
    );
  });

  it("rejects vk:user style entries inside allowFrom", () => {
    const result = VkConfigSchema.safeParse({
      communityId: "123",
      dmPolicy: "allowlist",
      allowFrom: ["vk:user:123"],
    });
    expect(result.success).toBe(false);
    expect(collectIssueMessages(result)).toContain(
      "channels.vk.allowFrom entries must be numeric VK user ids or '*'.",
    );
  });

  it("rejects invalid groupAllowFrom entries", () => {
    const result = VkConfigSchema.safeParse({
      communityId: "123",
      groupPolicy: "allowlist",
      groupAllowFrom: ["*"],
    });
    expect(result.success).toBe(false);
    expect(collectIssueMessages(result)).toContain(
      "channels.vk.groupAllowFrom entries must be numeric VK user ids.",
    );
  });

  it("rejects non-canonical groups keys", () => {
    const result = VkConfigSchema.safeParse({
      communityId: "123",
      groups: {
        "12345": { enabled: true },
      },
    });
    expect(result.success).toBe(false);
    expect(collectIssueMessages(result)).toContain(
      "channels.vk.groups keys must be canonical VK group peer_id values (>= 2000000000).",
    );
  });

  it("enforces dmPolicy=open to require allowFrom exactly ['*']", () => {
    const result = VkConfigSchema.safeParse({
      communityId: "123",
      dmPolicy: "open",
      allowFrom: ["123"],
    });
    expect(result.success).toBe(false);
    expect(collectIssueMessages(result)).toContain(
      'channels.vk.dmPolicy="open" requires channels.vk.allowFrom to be exactly ["*"].',
    );
  });

  it("enforces omitted/pairing dmPolicy to reject allowFrom entries", () => {
    const result = VkConfigSchema.safeParse({
      communityId: "123",
      allowFrom: ["123"],
    });
    expect(result.success).toBe(false);
    expect(collectIssueMessages(result)).toContain(
      'channels.vk.allowFrom must be empty unless channels.vk.dmPolicy is "allowlist" or "open".',
    );
  });

  it("enforces groupPolicy=allowlist to require non-empty numeric groupAllowFrom", () => {
    const result = VkConfigSchema.safeParse({
      communityId: "123",
      groupPolicy: "allowlist",
      groupAllowFrom: [],
    });
    expect(result.success).toBe(false);
    expect(collectIssueMessages(result)).toContain(
      'channels.vk.groupPolicy="allowlist" requires channels.vk.groupAllowFrom to include at least one numeric VK user id.',
    );
  });

  it("enforces omitted/open groupPolicy to reject non-empty groupAllowFrom", () => {
    const result = VkConfigSchema.safeParse({
      communityId: "123",
      groupAllowFrom: ["123"],
    });
    expect(result.success).toBe(false);
    expect(collectIssueMessages(result)).toContain(
      'channels.vk.groupPolicy="open" requires channels.vk.groupAllowFrom to be empty.',
    );
  });

  it("rejects non-env SecretRef for communityAccessToken", () => {
    const result = VkConfigSchema.safeParse({
      communityId: "123",
      communityAccessToken: {
        source: "file",
        provider: "default",
        id: "/tmp/vk-token",
      },
    });
    expect(result.success).toBe(false);
    expect(collectIssueMessages(result)).toContain(
      "channels.vk.communityAccessToken must be plaintext or an env SecretRef (source=env).",
    );
  });
});

describe("VK config write normalizers", () => {
  it("normalizes allowFrom and groupAllowFrom entries to canonical user ids", () => {
    expect(normalizeVkAllowFromForConfigWrite([" 00012 ", "*", "abc", "0012"])).toEqual([
      "12",
      "*",
    ]);
    expect(normalizeVkGroupAllowFromForConfigWrite(["00034", "*", "vk:user:99"])).toEqual(["34"]);
  });

  it("normalizes groups keys to canonical VK peer_ids", () => {
    expect(
      normalizeVkGroupsForConfigWrite({
        " 2000000015 ": { enabled: true },
        "0000000000": { enabled: true },
      }),
    ).toEqual({
      "2000000015": { enabled: true },
    });
  });
});
