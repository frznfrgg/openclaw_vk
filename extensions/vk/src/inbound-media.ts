import {
  fetchRemoteMedia,
  saveMediaBuffer,
  type FetchLike,
} from "openclaw/plugin-sdk/media-runtime";
import { buildMediaPayload } from "openclaw/plugin-sdk/reply-payload";
import type { VkNormalizedAttachment } from "./inbound-normalize.js";

const VK_INBOUND_IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const VK_INBOUND_DOCUMENT_MAX_BYTES = 200 * 1024 * 1024;
const VK_INBOUND_MEDIA_IDLE_TIMEOUT_MS = 30_000;

type VkInboundMediaLog = {
  debug?: (message: string) => void;
};

function resolveVkInboundAttachmentMaxBytes(attachment: VkNormalizedAttachment): number {
  return attachment.kind === "image" ? VK_INBOUND_IMAGE_MAX_BYTES : VK_INBOUND_DOCUMENT_MAX_BYTES;
}

export async function materializeVkInboundMedia(params: {
  attachments: VkNormalizedAttachment[];
  fetcher?: FetchLike;
  log?: VkInboundMediaLog;
}) {
  const mediaList: Array<{ path: string; contentType?: string }> = [];

  for (const attachment of params.attachments) {
    try {
      const maxBytes = resolveVkInboundAttachmentMaxBytes(attachment);
      const fetched = await fetchRemoteMedia({
        url: attachment.url,
        fetchImpl: params.fetcher,
        requestInit: { method: "GET" },
        filePathHint: attachment.fileName ?? attachment.url,
        maxBytes,
        readIdleTimeoutMs: VK_INBOUND_MEDIA_IDLE_TIMEOUT_MS,
      });
      const saved = await saveMediaBuffer(
        fetched.buffer,
        fetched.contentType ?? attachment.mimeType,
        "inbound",
        maxBytes,
        attachment.fileName ?? fetched.fileName,
      );
      mediaList.push({
        path: saved.path,
        contentType: saved.contentType ?? fetched.contentType ?? attachment.mimeType,
      });
    } catch (error) {
      params.log?.debug?.(
        `VK inbound ${attachment.kind} attachment download failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  return buildMediaPayload(mediaList, {
    preserveMediaTypeCardinality: true,
  });
}
