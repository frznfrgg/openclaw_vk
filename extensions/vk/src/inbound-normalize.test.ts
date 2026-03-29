import { describe, expect, it } from "vitest";
import { normalizeVkLongPollUpdate } from "./inbound-normalize.js";

describe("normalizeVkLongPollUpdate", () => {
  it("normalizes 5.103+ DM message_new envelopes", () => {
    expect(
      normalizeVkLongPollUpdate({
        type: "message_new",
        event_id: "evt-1",
        object: {
          message: {
            peer_id: 42,
            from_id: 42,
            conversation_message_id: 7,
            text: "hello",
            date: 1_700_000_000,
          },
        },
      }),
    ).toEqual({
      eventId: "evt-1",
      peerId: "42",
      senderUserId: "42",
      conversationMessageId: "7",
      text: "hello",
      timestamp: 1_700_000_000_000,
      chatType: "direct",
    });
  });

  it("normalizes older object-as-message envelopes and preserves group peer ids", () => {
    expect(
      normalizeVkLongPollUpdate({
        type: "message_new",
        event_id: "evt-2",
        object: {
          peer_id: "2000000005",
          from_id: "77",
          conversation_message_id: "19",
          text: "hey",
        },
      }),
    ).toMatchObject({
      eventId: "evt-2",
      peerId: "2000000005",
      senderUserId: "77",
      conversationMessageId: "19",
      chatType: "group",
    });
  });

  it("rejects non-message, service, and malformed updates", () => {
    expect(
      normalizeVkLongPollUpdate({
        type: "message_reply",
        event_id: "evt-3",
        object: {
          message: {
            peer_id: 42,
            from_id: 42,
            conversation_message_id: 7,
          },
        },
      }),
    ).toBeNull();

    expect(
      normalizeVkLongPollUpdate({
        type: "message_new",
        event_id: "evt-4",
        object: {
          message: {
            peer_id: 42,
            from_id: 42,
            conversation_message_id: 7,
            action: { type: "chat_invite_user" },
          },
        },
      }),
    ).toBeNull();

    expect(
      normalizeVkLongPollUpdate({
        type: "message_new",
        event_id: " ",
        object: {
          message: {
            peer_id: 42,
            from_id: 42,
            conversation_message_id: 7,
          },
        },
      }),
    ).toBeNull();
  });

  it("keeps otherwise valid messages even when attachments are unknown", () => {
    expect(
      normalizeVkLongPollUpdate({
        type: "message_new",
        event_id: "evt-5",
        object: {
          message: {
            peer_id: 42,
            from_id: 42,
            conversation_message_id: 7,
            text: "",
            attachments: [{ type: "mystery" }],
          },
        },
      }),
    ).toMatchObject({
      eventId: "evt-5",
      peerId: "42",
      senderUserId: "42",
      conversationMessageId: "7",
      chatType: "direct",
    });
  });
});
