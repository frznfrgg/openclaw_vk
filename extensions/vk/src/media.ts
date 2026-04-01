import path from "node:path";
import { fileURLToPath } from "node:url";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-runtime";
import type { ReplyPayload } from "../../../src/auto-reply/types.js";
import { createSubsystemLogger } from "../../../src/logging/subsystem.js";
import { loadOutboundMediaFromUrl } from "../../../src/plugin-sdk/outbound-media.js";
import { VK_API_BASE, VK_API_VERSION, type ResolvedVkAccount } from "./shared.js";

const log = createSubsystemLogger("vk/media");

const VK_IMAGE_MAX_BYTES = 50 * 1024 * 1024;
const VK_DOCUMENT_MAX_BYTES = 200 * 1024 * 1024;

const VK_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif"]);
const VK_EXECUTABLE_EXTENSIONS = new Set([
  ".apk",
  ".appimage",
  ".bat",
  ".cmd",
  ".com",
  ".dmg",
  ".exe",
  ".jar",
  ".msi",
  ".pkg",
  ".ps1",
  ".scr",
  ".sh",
]);
const VK_EXECUTABLE_MIME_PREFIXES = [
  "application/x-apple-diskimage",
  "application/x-bat",
  "application/x-dosexec",
  "application/x-executable",
  "application/x-msdownload",
  "application/x-msi",
  "application/x-sh",
  "application/x-shellscript",
  "application/vnd.android.package-archive",
];

type VkLoadedOutboundMedia = Awaited<ReturnType<typeof loadOutboundMediaFromUrl>>;

type VkApiResponse<T> = {
  response?: T;
  error?: {
    error_code?: number;
    error_msg?: string;
  };
};

type VkUploadPhotoResponse = {
  server?: number | string;
  photo?: string;
  hash?: string;
};

type VkSavedPhoto = {
  id?: number | string;
  owner_id?: number | string;
};

type VkSavedDocument = {
  id?: number | string;
  owner_id?: number | string;
};

function resolveFileExtension(input?: string | null): string {
  if (!input?.trim()) {
    return "";
  }
  const trimmed = input.trim();
  try {
    if (trimmed.startsWith("file://")) {
      return path.extname(fileURLToPath(trimmed)).toLowerCase();
    }
    if (/^https?:\/\//i.test(trimmed)) {
      return path.extname(new URL(trimmed).pathname).toLowerCase();
    }
  } catch {
    return "";
  }
  return path.extname(trimmed).toLowerCase();
}

function resolveMimeType(input?: string | null): string {
  return input?.split(";")[0]?.trim().toLowerCase() ?? "";
}

function isSupportedVkImage(params: {
  mimeType?: string;
  fileName?: string;
  mediaUrl?: string;
}): boolean {
  const mimeType = resolveMimeType(params.mimeType);
  if (mimeType === "image/jpeg" || mimeType === "image/png" || mimeType === "image/gif") {
    return true;
  }
  const extension =
    resolveFileExtension(params.fileName) || resolveFileExtension(params.mediaUrl) || "";
  return VK_IMAGE_EXTENSIONS.has(extension);
}

function isBlockedVkDocument(params: { mimeType?: string; fileName?: string; mediaUrl?: string }): {
  blocked: boolean;
  reason?: "mp3" | "executable";
} {
  const mimeType = resolveMimeType(params.mimeType);
  const extension =
    resolveFileExtension(params.fileName) || resolveFileExtension(params.mediaUrl) || "";
  if (mimeType === "audio/mpeg" || extension === ".mp3") {
    return { blocked: true, reason: "mp3" };
  }
  if (
    VK_EXECUTABLE_EXTENSIONS.has(extension) ||
    VK_EXECUTABLE_MIME_PREFIXES.some(
      (prefix) => mimeType === prefix || mimeType.startsWith(`${prefix};`),
    )
  ) {
    return { blocked: true, reason: "executable" };
  }
  return { blocked: false };
}

function resolveUploadFileName(params: {
  loaded: VkLoadedOutboundMedia;
  fallback: string;
}): string {
  const fileName = params.loaded.fileName?.trim();
  if (fileName) {
    return fileName;
  }
  const ext =
    resolveFileExtension(params.loaded.fileName) || resolveFileExtension(params.fallback) || "";
  return ext ? `attachment${ext}` : "attachment";
}

async function callVkMethod<T>(params: {
  account: ResolvedVkAccount;
  method: string;
  fields?: Record<string, string | number | null | undefined>;
  fetcher?: typeof fetch;
}): Promise<T> {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params.fields ?? {})) {
    if (value === null || value === undefined || value === "") {
      continue;
    }
    body.set(key, String(value));
  }
  body.set("access_token", params.account.token);
  body.set("v", VK_API_VERSION);

  const response = await (params.fetcher ?? fetch)(`${VK_API_BASE}/${params.method}`, {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    },
    body,
  });

  let payload: VkApiResponse<T> | undefined;
  try {
    payload = (await response.json()) as VkApiResponse<T>;
  } catch {
    payload = undefined;
  }

  if (!response.ok) {
    throw new Error(
      payload?.error?.error_msg ?? `VK ${params.method} failed with HTTP ${response.status}.`,
    );
  }
  if (payload?.error) {
    throw new Error(
      payload.error.error_msg ??
        `VK ${params.method} failed (${payload.error.error_code ?? "unknown"}).`,
    );
  }
  if (payload?.response === undefined) {
    throw new Error(`VK ${params.method} returned an invalid response payload.`);
  }

  return payload.response;
}

async function uploadVkMultipart(params: {
  uploadUrl: string;
  fieldName: "photo" | "file";
  loaded: VkLoadedOutboundMedia;
  fetcher?: typeof fetch;
  mediaUrl: string;
}): Promise<Record<string, unknown>> {
  const form = new FormData();
  const blobPart = new Uint8Array(params.loaded.buffer.byteLength);
  blobPart.set(params.loaded.buffer);
  form.set(
    params.fieldName,
    new Blob([blobPart], {
      type: params.loaded.contentType ?? "application/octet-stream",
    }),
    resolveUploadFileName({ loaded: params.loaded, fallback: params.mediaUrl }),
  );

  const response = await (params.fetcher ?? fetch)(params.uploadUrl, {
    method: "POST",
    body: form,
  });
  let payload: Record<string, unknown> | undefined;
  try {
    payload = (await response.json()) as Record<string, unknown>;
  } catch {
    payload = undefined;
  }
  if (!response.ok || !payload) {
    throw new Error(`VK upload failed with HTTP ${response.status}.`);
  }
  return payload;
}

async function loadVkOutboundMedia(params: {
  mediaUrl: string;
  maxBytes: number;
  mediaLocalRoots?: readonly string[];
}): Promise<VkLoadedOutboundMedia> {
  return await loadOutboundMediaFromUrl(params.mediaUrl, {
    maxBytes: params.maxBytes,
    mediaLocalRoots: params.mediaLocalRoots,
  });
}

async function uploadVkImageInternal(params: {
  account: ResolvedVkAccount;
  peerId: string;
  mediaUrl: string;
  cfg: OpenClawConfig;
  mediaLocalRoots?: readonly string[];
  fetcher?: typeof fetch;
  loaded?: VkLoadedOutboundMedia;
}): Promise<string> {
  void params.cfg;
  const loaded =
    params.loaded ??
    (await loadVkOutboundMedia({
      mediaUrl: params.mediaUrl,
      maxBytes: VK_DOCUMENT_MAX_BYTES,
      mediaLocalRoots: params.mediaLocalRoots,
    }));

  if (
    !isSupportedVkImage({
      mimeType: loaded.contentType,
      fileName: loaded.fileName,
      mediaUrl: params.mediaUrl,
    })
  ) {
    throw new Error("VK supports only JPG, PNG, and GIF images.");
  }
  if (loaded.buffer.length > VK_IMAGE_MAX_BYTES) {
    throw new Error("VK image uploads are limited to 50 MB.");
  }

  const uploadServer = await callVkMethod<{ upload_url?: string }>({
    account: params.account,
    method: "photos.getMessagesUploadServer",
    fields: {
      group_id: params.account.communityId,
      peer_id: params.peerId,
    },
    fetcher: params.fetcher,
  });
  const uploadUrl = uploadServer.upload_url?.trim();
  if (!uploadUrl) {
    throw new Error("VK photos.getMessagesUploadServer returned no upload URL.");
  }

  const upload = (await uploadVkMultipart({
    uploadUrl,
    fieldName: "photo",
    loaded,
    fetcher: params.fetcher,
    mediaUrl: params.mediaUrl,
  })) as VkUploadPhotoResponse;
  if (upload.server === undefined || !upload.photo || !upload.hash) {
    throw new Error("VK photo upload returned an incomplete response.");
  }

  const saved = await callVkMethod<VkSavedPhoto[]>({
    account: params.account,
    method: "photos.saveMessagesPhoto",
    fields: {
      server: upload.server,
      photo: upload.photo,
      hash: upload.hash,
    },
    fetcher: params.fetcher,
  });
  const photo = Array.isArray(saved) ? saved[0] : undefined;
  const ownerId = photo?.owner_id;
  const photoId = photo?.id;
  if (
    (typeof ownerId !== "number" && typeof ownerId !== "string") ||
    (typeof photoId !== "number" && typeof photoId !== "string")
  ) {
    throw new Error("VK photos.saveMessagesPhoto returned an invalid photo payload.");
  }

  return `photo${ownerId}_${photoId}`;
}

async function uploadVkDocumentInternal(params: {
  account: ResolvedVkAccount;
  peerId: string;
  mediaUrl: string;
  cfg: OpenClawConfig;
  mediaLocalRoots?: readonly string[];
  fetcher?: typeof fetch;
  loaded?: VkLoadedOutboundMedia;
}): Promise<string> {
  void params.cfg;
  const loaded =
    params.loaded ??
    (await loadVkOutboundMedia({
      mediaUrl: params.mediaUrl,
      maxBytes: VK_DOCUMENT_MAX_BYTES,
      mediaLocalRoots: params.mediaLocalRoots,
    }));
  const blocked = isBlockedVkDocument({
    mimeType: loaded.contentType,
    fileName: loaded.fileName,
    mediaUrl: params.mediaUrl,
  });
  if (blocked.reason === "mp3") {
    throw new Error("VK document uploads do not support MP3 files.");
  }
  if (blocked.reason === "executable") {
    throw new Error("VK document uploads do not support executable files.");
  }

  const uploadServer = await callVkMethod<{ upload_url?: string }>({
    account: params.account,
    method: "docs.getMessagesUploadServer",
    fields: {
      type: "doc",
      peer_id: params.peerId,
    },
    fetcher: params.fetcher,
  });
  const uploadUrl = uploadServer.upload_url?.trim();
  if (!uploadUrl) {
    throw new Error("VK docs.getMessagesUploadServer returned no upload URL.");
  }

  const upload = await uploadVkMultipart({
    uploadUrl,
    fieldName: "file",
    loaded,
    fetcher: params.fetcher,
    mediaUrl: params.mediaUrl,
  });
  const file = typeof upload.file === "string" ? upload.file : null;
  if (!file) {
    throw new Error("VK document upload returned no file token.");
  }

  const title = path.basename(
    resolveUploadFileName({ loaded, fallback: params.mediaUrl }),
    path.extname(resolveUploadFileName({ loaded, fallback: params.mediaUrl })),
  );
  const saved = await callVkMethod<{ doc?: VkSavedDocument }>({
    account: params.account,
    method: "docs.save",
    fields: {
      file,
      title: title || undefined,
    },
    fetcher: params.fetcher,
  });
  const document = saved.doc;
  const ownerId = document?.owner_id;
  const docId = document?.id;
  if (
    (typeof ownerId !== "number" && typeof ownerId !== "string") ||
    (typeof docId !== "number" && typeof docId !== "string")
  ) {
    throw new Error("VK docs.save returned an invalid document payload.");
  }

  return `doc${ownerId}_${docId}`;
}

function buildFilteredPayload(
  payload: ReplyPayload,
  supportedMediaUrls: string[],
): ReplyPayload | null {
  const nextText = payload.text ?? "";
  if (!nextText.trim() && supportedMediaUrls.length === 0) {
    return null;
  }
  return {
    ...payload,
    mediaUrl: supportedMediaUrls.length === 1 ? supportedMediaUrls[0] : undefined,
    mediaUrls: supportedMediaUrls.length > 0 ? supportedMediaUrls : undefined,
  };
}

export function normalizeVkOutboundPayload(payload: ReplyPayload): ReplyPayload | null {
  const mediaUrls = payload.mediaUrls ?? (payload.mediaUrl ? [payload.mediaUrl] : []);
  if (mediaUrls.length === 0) {
    return payload;
  }

  const supportedMediaUrls: string[] = [];
  const skippedKinds = new Set<string>();

  for (const mediaUrl of mediaUrls) {
    const blocked = isBlockedVkDocument({ mediaUrl });
    if (blocked.reason) {
      skippedKinds.add(blocked.reason);
      continue;
    }
    supportedMediaUrls.push(mediaUrl);
  }

  for (const kind of skippedKinds) {
    log.warn(`vk: skipping unsupported outbound attachment kind: ${kind}`);
  }

  return buildFilteredPayload(payload, supportedMediaUrls);
}

export async function uploadVkImage(params: {
  account: ResolvedVkAccount;
  peerId: string;
  mediaUrl: string;
  cfg: OpenClawConfig;
  mediaLocalRoots?: readonly string[];
  fetcher?: typeof fetch;
}): Promise<string> {
  return await uploadVkImageInternal(params);
}

export async function uploadVkDocument(params: {
  account: ResolvedVkAccount;
  peerId: string;
  mediaUrl: string;
  cfg: OpenClawConfig;
  mediaLocalRoots?: readonly string[];
  fetcher?: typeof fetch;
}): Promise<string> {
  return await uploadVkDocumentInternal(params);
}

export async function resolveVkAttachmentToken(params: {
  account: ResolvedVkAccount;
  peerId: string;
  mediaUrl: string;
  cfg: OpenClawConfig;
  mediaLocalRoots?: readonly string[];
  fetcher?: typeof fetch;
}): Promise<string> {
  const loaded = await loadVkOutboundMedia({
    mediaUrl: params.mediaUrl,
    maxBytes: VK_DOCUMENT_MAX_BYTES,
    mediaLocalRoots: params.mediaLocalRoots,
  });
  if (
    isSupportedVkImage({
      mimeType: loaded.contentType,
      fileName: loaded.fileName,
      mediaUrl: params.mediaUrl,
    })
  ) {
    return await uploadVkImageInternal({
      ...params,
      loaded,
    });
  }
  return await uploadVkDocumentInternal({
    ...params,
    loaded,
  });
}
