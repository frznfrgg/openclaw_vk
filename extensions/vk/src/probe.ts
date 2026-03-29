import type { BaseProbeResult } from "openclaw/plugin-sdk/channel-runtime";
import { fetchWithTimeout } from "openclaw/plugin-sdk/text-runtime";
import type { ResolvedVkAccount } from "./shared.js";

export type VkProbe = BaseProbeResult & {
  status?: number | null;
  elapsedMs: number;
  longPoll?: {
    server?: string;
    ts?: string | null;
  };
};

const VK_API_BASE = "https://api.vk.com/method";
const VK_API_VERSION = "5.199";

export async function probeVkAccount(
  account: ResolvedVkAccount,
  timeoutMs = 2500,
  fetcher: typeof fetch = fetch,
): Promise<VkProbe> {
  const started = Date.now();
  try {
    const url = new URL(`${VK_API_BASE}/groups.getLongPollServer`);
    url.searchParams.set("group_id", account.communityId);
    url.searchParams.set("access_token", account.token);
    url.searchParams.set("v", VK_API_VERSION);

    const response = await fetchWithTimeout(url.toString(), {}, timeoutMs, fetcher);
    const body = (await response.json()) as {
      response?: {
        key?: string;
        server?: string;
        ts?: string;
      };
      error?: {
        error_code?: number;
        error_msg?: string;
      };
    };

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: body.error?.error_msg ?? `groups.getLongPollServer failed (${response.status})`,
        elapsedMs: Date.now() - started,
      };
    }

    if (body.error) {
      return {
        ok: false,
        status: response.status,
        error:
          body.error.error_msg ??
          `groups.getLongPollServer failed (${body.error.error_code ?? "unknown"})`,
        elapsedMs: Date.now() - started,
      };
    }

    const server = body.response?.server?.trim();
    const ts = body.response?.ts?.trim() ?? null;
    if (!server || !ts) {
      return {
        ok: false,
        status: response.status,
        error: "VK Long Poll probe returned an incomplete response.",
        elapsedMs: Date.now() - started,
      };
    }

    return {
      ok: true,
      status: response.status,
      error: null,
      elapsedMs: Date.now() - started,
      longPoll: {
        server,
        ts,
      },
    };
  } catch (error) {
    return {
      ok: false,
      status: error instanceof Response ? error.status : null,
      error: error instanceof Error ? error.message : String(error),
      elapsedMs: Date.now() - started,
    };
  }
}
