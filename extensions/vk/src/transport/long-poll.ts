import type { ChannelGatewayContext } from "../../../../src/channels/plugins/types.adapters.js";
import { VK_API_BASE, VK_API_VERSION, type ResolvedVkAccount } from "../shared.js";

type VkLongPollBootstrap = {
  server: string;
  key: string;
  ts: string;
};

type VkLongPollCheckResponse =
  | {
      ts?: unknown;
      updates?: unknown;
      failed?: undefined;
    }
  | {
      failed: unknown;
      ts?: unknown;
      updates?: unknown;
    };

export type VkLongPollUpdate = Record<string, unknown>;

const VK_LONG_POLL_WAIT_SECONDS = 25;
const VK_BACKOFF_INITIAL_MS = 1_000;
const VK_BACKOFF_MAX_MS = 30_000;
const VK_RETRY_JITTER_FACTOR = 0.1;

class VkLongPollRecoveryError extends Error {
  constructor(
    message: string,
    readonly causeError: unknown,
  ) {
    super(message);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === "AbortError") ||
    (typeof DOMException !== "undefined" &&
      error instanceof DOMException &&
      error.name === "AbortError")
  );
}

function parseRetryAfterMs(header: string | null): number | null {
  if (!header?.trim()) {
    return null;
  }
  const seconds = Number.parseFloat(header.trim());
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.round(seconds * 1000);
  }
  return null;
}

function withJitter(baseMs: number): number {
  const jitterRange = Math.max(1, Math.round(baseMs * VK_RETRY_JITTER_FACTOR));
  const delta = Math.round(Math.random() * (jitterRange * 2 + 1) - jitterRange);
  return Math.max(1, baseMs + delta);
}

function computeBackoffMs(attempt: number): number {
  const base = Math.min(VK_BACKOFF_MAX_MS, VK_BACKOFF_INITIAL_MS * 2 ** Math.max(0, attempt - 1));
  return withJitter(base);
}

async function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function normalizeBootstrap(body: Record<string, unknown>): VkLongPollBootstrap {
  const response =
    body.response && typeof body.response === "object"
      ? (body.response as Record<string, unknown>)
      : null;
  const server = typeof response?.server === "string" ? response.server.trim() : "";
  const key = typeof response?.key === "string" ? response.key.trim() : "";
  const ts = typeof response?.ts === "string" ? response.ts.trim() : "";
  if (!server || !key || !ts) {
    throw new Error("VK groups.getLongPollServer returned an incomplete response.");
  }
  return { server, key, ts };
}

async function bootstrapVkLongPoll(params: {
  account: ResolvedVkAccount;
  fetcher?: typeof fetch;
  signal: AbortSignal;
}): Promise<VkLongPollBootstrap> {
  const url = new URL(`${VK_API_BASE}/groups.getLongPollServer`);
  url.searchParams.set("group_id", params.account.communityId);
  url.searchParams.set("access_token", params.account.token);
  url.searchParams.set("v", VK_API_VERSION);

  const response = await (params.fetcher ?? fetch)(url, {
    method: "GET",
    signal: params.signal,
  });
  const body = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    const error =
      body.error && typeof body.error === "object"
        ? (body.error as Record<string, unknown>).error_msg
        : undefined;
    throw new Error(
      typeof error === "string"
        ? error
        : `VK groups.getLongPollServer failed with HTTP ${response.status}.`,
    );
  }
  if (body.error && typeof body.error === "object") {
    const error = (body.error as Record<string, unknown>).error_msg;
    throw new Error(
      typeof error === "string" ? error : "VK groups.getLongPollServer returned an API error.",
    );
  }
  return normalizeBootstrap(body);
}

async function checkVkLongPoll(params: {
  bootstrap: VkLongPollBootstrap;
  fetcher?: typeof fetch;
  signal: AbortSignal;
}): Promise<{ response: Response; body: VkLongPollCheckResponse }> {
  const url = new URL(params.bootstrap.server);
  url.searchParams.set("act", "a_check");
  url.searchParams.set("key", params.bootstrap.key);
  url.searchParams.set("ts", params.bootstrap.ts);
  url.searchParams.set("wait", String(VK_LONG_POLL_WAIT_SECONDS));

  const response = await (params.fetcher ?? fetch)(url, {
    method: "GET",
    signal: params.signal,
  });
  let body: VkLongPollCheckResponse = {};
  try {
    body = (await response.json()) as VkLongPollCheckResponse;
  } catch {
    body = {};
  }
  return { response, body };
}

function parseSuccessfulCheck(body: VkLongPollCheckResponse): {
  ts: string;
  updates: VkLongPollUpdate[];
} {
  if ("failed" in body && body.failed !== undefined) {
    throw new Error("VK long poll returned a failed response.");
  }
  const ts = typeof body.ts === "string" && body.ts.trim() ? body.ts.trim() : null;
  if (!ts || !Array.isArray(body.updates)) {
    throw new Error("VK long poll returned a malformed response.");
  }
  return {
    ts,
    updates: body.updates.filter(
      (entry): entry is VkLongPollUpdate => Boolean(entry) && typeof entry === "object",
    ),
  };
}

function createRecentEventCache() {
  const seen = new Map<string, number>();
  const order: string[] = [];
  const ttlMs = 60 * 60 * 1000;
  const maxEntries = 10_000;

  const prune = (now: number) => {
    while (order.length > 0) {
      const first = order[0];
      const expiresAt = seen.get(first);
      if (expiresAt && expiresAt > now && seen.size <= maxEntries) {
        break;
      }
      order.shift();
      if (!expiresAt || expiresAt <= now || seen.size >= maxEntries) {
        seen.delete(first);
      }
    }
  };

  return {
    remember(eventId: string, now = Date.now()): boolean {
      prune(now);
      const expiresAt = seen.get(eventId);
      if (expiresAt && expiresAt > now) {
        return false;
      }
      seen.set(eventId, now + ttlMs);
      order.push(eventId);
      prune(now);
      return true;
    },
  };
}

function statusErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function recoverBootstrapOrThrow(params: {
  ctx: Pick<ChannelGatewayContext<ResolvedVkAccount>, "setStatus">;
  account: ResolvedVkAccount;
  message: string;
  fetcher?: typeof fetch;
  signal: AbortSignal;
}): Promise<VkLongPollBootstrap> {
  params.ctx.setStatus({
    accountId: params.account.accountId,
    connected: false,
    lastError: params.message,
  });
  try {
    return await bootstrapVkLongPoll({
      account: params.account,
      fetcher: params.fetcher,
      signal: params.signal,
    });
  } catch (error) {
    throw new VkLongPollRecoveryError(params.message, error);
  }
}

export async function runVkLongPoll(params: {
  ctx: Pick<ChannelGatewayContext<ResolvedVkAccount>, "abortSignal" | "log" | "setStatus">;
  account: ResolvedVkAccount;
  fetcher?: typeof fetch;
  onEvent: (update: VkLongPollUpdate) => Promise<void>;
}): Promise<void> {
  const { ctx, account } = params;
  const recentEvents = createRecentEventCache();
  let bootstrap = await bootstrapVkLongPoll({
    account,
    fetcher: params.fetcher,
    signal: ctx.abortSignal,
  });
  let retryAttempt = 0;

  while (!ctx.abortSignal.aborted) {
    try {
      const { response, body } = await checkVkLongPoll({
        bootstrap,
        fetcher: params.fetcher,
        signal: ctx.abortSignal,
      });

      if (response.status === 429) {
        ctx.setStatus({
          accountId: account.accountId,
          connected: false,
          lastError: "VK long poll rate limited.",
        });
        const retryAfterMs = parseRetryAfterMs(response.headers.get("retry-after"));
        retryAttempt += 1;
        await sleepWithAbort(retryAfterMs ?? computeBackoffMs(retryAttempt), ctx.abortSignal);
        continue;
      }

      if (response.status >= 500) {
        ctx.setStatus({
          accountId: account.accountId,
          connected: false,
          lastError: `VK long poll HTTP ${response.status}.`,
        });
        retryAttempt += 1;
        await sleepWithAbort(computeBackoffMs(retryAttempt), ctx.abortSignal);
        continue;
      }

      if (!response.ok) {
        throw new Error(`VK long poll failed with HTTP ${response.status}.`);
      }

      if ("failed" in body && body.failed !== undefined) {
        const failed = Number(body.failed);
        if (failed === 1) {
          const nextTs = typeof body.ts === "string" && body.ts.trim() ? body.ts.trim() : null;
          if (!nextTs) {
            throw new Error('VK long poll "failed=1" response omitted ts.');
          }
          bootstrap = { ...bootstrap, ts: nextTs };
          ctx.setStatus({
            accountId: account.accountId,
            connected: false,
            lastError: 'VK long poll cursor expired ("failed=1").',
          });
          continue;
        }
        if (failed === 2 || failed === 3) {
          bootstrap = await recoverBootstrapOrThrow({
            ctx,
            account,
            message:
              failed === 2
                ? 'VK long poll key expired ("failed=2").'
                : 'VK long poll state expired ("failed=3").',
            fetcher: params.fetcher,
            signal: ctx.abortSignal,
          });
          continue;
        }
        throw new Error(`VK long poll returned unexpected failed=${String(body.failed)}.`);
      }

      const parsed = parseSuccessfulCheck(body);
      bootstrap = { ...bootstrap, ts: parsed.ts };
      retryAttempt = 0;
      ctx.setStatus({
        accountId: account.accountId,
        connected: true,
        lastError: null,
      });

      for (const update of parsed.updates) {
        const eventId =
          typeof update.event_id === "string" && update.event_id.trim()
            ? update.event_id.trim()
            : "";
        if (eventId && !recentEvents.remember(eventId)) {
          continue;
        }
        try {
          await params.onEvent(update);
        } catch (error) {
          ctx.log?.error?.(
            `[${account.accountId}] VK inbound handler failed: ${statusErrorMessage(error)}`,
          );
        }
      }
      continue;
    } catch (error) {
      if (isAbortError(error)) {
        return;
      }
      if (error instanceof VkLongPollRecoveryError) {
        throw error.causeError;
      }

      const message = statusErrorMessage(error);

      try {
        bootstrap = await recoverBootstrapOrThrow({
          ctx,
          account,
          message,
          fetcher: params.fetcher,
          signal: ctx.abortSignal,
        });
      } catch (bootstrapError) {
        if (bootstrapError instanceof VkLongPollRecoveryError) {
          throw bootstrapError.causeError;
        }
        throw bootstrapError;
      }
    }
  }
}
