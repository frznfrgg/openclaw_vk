---
summary: "VK community bot support via Bots Long Poll"
read_when:
  - You want to connect OpenClaw to a VK community
  - You need VK setup, DM/group policy, or target syntax details
title: "VK"
---

# VK

**Status:** bundled chat channel for one VK community bot per OpenClaw instance.

VK support uses the community-scoped **Bots Long Poll API**. Setup validates the configured `communityId` and token by calling `groups.getLongPollServer` before `openclaw channels add` or onboarding writes the config.

<CardGroup cols={3}>
  <Card title="Pairing" icon="link" href="/channels/pairing">
    Default VK DM policy is pairing.
  </Card>
  <Card title="Gateway configuration" icon="settings" href="/gateway/configuration">
    Full config patterns and field reference.
  </Card>
  <Card title="Channel troubleshooting" icon="wrench" href="/channels/troubleshooting">
    Cross-channel diagnostics and repair playbooks.
  </Card>
</CardGroup>

## Quick setup

<Steps>
  <Step title="Prepare the VK community">
    In the target community, enable:

    - **Messages**
    - **Bots Long Poll API**

    Then create a **community access token** in the community API settings.

  </Step>

  <Step title="Add the VK channel">

```bash
openclaw channels add --channel vk --community-id 123456 --community-access-token "$VK_COMMUNITY_ACCESS_TOKEN"
```

    Alternative credential sources:

    - `--use-env` to store an env SecretRef to `VK_COMMUNITY_ACCESS_TOKEN`
    - `--token-file /path/to/vk-token.txt` to read the token from a file

  </Step>

  <Step title="Start the Gateway">

```bash
openclaw gateway
```

    A successful setup only proves that Long Poll bootstrap works. It does **not** prove photo/document upload rights.

  </Step>

  <Step title="Approve the first DM">
    VK DMs default to pairing. Let the user message the community first, then approve the pairing code:

```bash
openclaw pairing list vk
openclaw pairing approve vk <CODE>
```

  </Step>
</Steps>

## Behavior

- One OpenClaw instance maps to one VK community.
- Direct chats route on all incoming user messages, then the configured `dmPolicy` decides whether they are admitted.
- Group chats route only when VK delivers a bot-relevant `message_new` under the default **Only mentions** access level. OpenClaw then applies `channels.vk.groups`, `groupPolicy`, and `groupAllowFrom`.
- Session identity keys on VK `peer_id` boundaries:
  - direct chat: user `peer_id`
  - group chat: conversation `peer_id`

## Supported outbound content

- Text
- Images: JPG, PNG, GIF up to 50 MB
- Documents: most formats up to 200 MB, except MP3 and executable files

Mixed text + media replies use the first text chunk as the caption for the first supported attachment, then send later text chunks as follow-up text messages.

## Target syntax

Use canonical VK targets for explicit outbound delivery:

- `vk:user:<user_id>`
- `vk:chat:<peer_id>`

Examples:

```bash
openclaw message send --to vk:user:123456 "hello"
openclaw message send --to vk:chat:2000000001 "hello group"
```

## Configuration example

```json5
{
  channels: {
    vk: {
      enabled: true,
      communityId: "123456",
      communityAccessToken: {
        source: "env",
        provider: "default",
        id: "VK_COMMUNITY_ACCESS_TOKEN",
      },
      dmPolicy: "pairing",
      groupPolicy: "allowlist",
      groups: {
        "2000000001": { enabled: true },
      },
      groupAllowFrom: ["123456789"],
      defaultTo: "vk:user:123456789",
    },
  },
}
```

## Notes

- Community messages must be enabled for normal DM replies and media upload flows.
- Users must message the community first before the bot can DM them.
- `channels.vk.groups` is config-only in v1; there is no live VK group picker yet.

## Related docs

- [Chat Channels](/channels)
- [Gateway configuration](/gateway/configuration)
- [Configuration Reference](/gateway/configuration-reference)
