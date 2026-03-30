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
      senderId: "42",
      messageId: "7",
      text: "hello",
      attachments: [],
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
      senderId: "77",
      messageId: "19",
      attachments: [],
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

  it("normalizes supported photo and document attachments", () => {
    expect(
      normalizeVkLongPollUpdate({
        type: "message_new",
        event_id: "evt-5",
        object: {
          message: {
            peer_id: 42,
            from_id: 42,
            conversation_message_id: 7,
            text: "files",
            attachments: [
              {
                type: "photo",
                photo: {
                  sizes: [
                    { url: "https://cdn.example.com/thumb.jpg", width: 75, height: 75 },
                    { url: "https://cdn.example.com/full.png", width: 1200, height: 900 },
                  ],
                },
              },
              {
                type: "doc",
                doc: {
                  url: "https://cdn.example.com/report.pdf",
                  title: "report",
                  ext: "pdf",
                },
              },
            ],
          },
        },
      }),
    ).toEqual({
      eventId: "evt-5",
      peerId: "42",
      senderId: "42",
      messageId: "7",
      text: "files",
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
      timestamp: expect.any(Number),
      chatType: "direct",
    });
  });

  it("keeps otherwise valid messages even when attachments are unknown", () => {
    expect(
      normalizeVkLongPollUpdate({
        type: "message_new",
        event_id: "evt-6",
        object: {
          message: {
            peer_id: 42,
            from_id: 42,
            conversation_message_id: 7,
            text: "hello",
            attachments: [{ type: "mystery" }, { type: "doc", doc: {} }],
          },
        },
      }),
    ).toEqual({
      eventId: "evt-6",
      peerId: "42",
      senderId: "42",
      messageId: "7",
      text: "hello\n[vk attachment: mystery]\n[vk attachment: doc]",
      attachments: [],
      timestamp: expect.any(Number),
      chatType: "direct",
    });
  });
});
