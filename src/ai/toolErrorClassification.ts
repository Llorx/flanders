import type { RandomContext, TimeContext } from "../contexts";
import type { ToolEventError, ToolEventRateLimit } from "./ToolAdapter";

// What every adapter puts on an `error` event when its tool reported a failure carrying no
// human-readable text of its own.
export const UNKNOWN_TOOL_ERROR_MESSAGE = "unknown error";

// The recognized transient-error substring families used by the Codex adapter, whose CLI exposes a
// failure only as free text, with no structured error / HTTP-status / retry-after fields. The
// adapter classifies a failure by literal substring search over the trimmed message — case-insensitive
// for the families below, case-sensitive for the reconnect substring, which matches only the exact
// capitalization the CLI emits. The set is closed; adding a substring requires updating
// src/ai/.spec/rules/runner.md first (the Codex adapter section), which is why the families live here
// rather than being inlined into the adapter.

// The Codex CLI surfaces its reconnect / high-demand transient as free text carrying this exact-cased
// marker and no structured code, so the match is a case-sensitive literal.
const RECONNECT_SUBSTRING = "Reconnecting...";
const RECONNECT_WAIT_MS = 2 * 60_000;

const RATE_LIMIT_SUBSTRINGS = [
    "out of credits",
    "refill",
    "usage limit",
    "rate limit",
    "rate-limit",
    "rate_limit",
    "quota",
    "too many requests"
];

const RATE_LIMIT_429_RE = /\b429\b/;

const EIGHT_MINUTES_MS = 8 * 60_000;
const TWELVE_MINUTES_MS = 12 * 60_000;

const FIVE_XX_RE = /\b5\d{2}\b/;
const STATUS_408_RE = /\b408\b/;
const STATUS_425_RE = /\b425\b/;

const TRANSPORT_SUBSTRINGS = [
    "timeout",
    "timed out",
    "connection reset",
    "connection refused",
    "socket hang up",
    "temporarily unavailable",
    "service unavailable",
    "gateway",
    "network",
    "econnreset",
    "econnrefused",
    "enotfound",
    "etimedout",
    "eai_again"
];

export function isReconnectMessage(message:string):boolean {
    return message.trim().includes(RECONNECT_SUBSTRING);
}

export function isRateLimitMessage(message:string):boolean {
    const lower = message.trim().toLowerCase();
    for (const sub of RATE_LIMIT_SUBSTRINGS) {
        if (lower.includes(sub)) return true;
    }
    return RATE_LIMIT_429_RE.test(message.trim());
}

export function isRetryableHttpStatus(message:string):boolean {
    const trimmed = message.trim();
    if (FIVE_XX_RE.test(trimmed)) return true;
    if (STATUS_408_RE.test(trimmed)) return true;
    if (STATUS_425_RE.test(trimmed)) return true;
    return false;
}

export function isRetryableTransport(message:string):boolean {
    const lower = message.trim().toLowerCase();
    for (const sub of TRANSPORT_SUBSTRINGS) {
        if (lower.includes(sub)) return true;
    }
    return false;
}

// The Codex adapter synthesizes this wait when its CLI signals a rate-limit / quota exhaustion
// without a reset time: a uniform draw from the closed 8-to-12-minute interval, added to the current
// time. The wall clock and the random draw are obtained through the injected contexts per
// src/.spec/rules/external-access-through-contexts.md, never via Date.now() / Math.random().
export function synthesizeRateLimitEvent(time:TimeContext, random:RandomContext):ToolEventRateLimit {
    const r = EIGHT_MINUTES_MS + Math.round(random.random() * (TWELVE_MINUTES_MS - EIGHT_MINUTES_MS));
    return { type: "rate_limit", waitUntilMs: time.now() + r };
}

// The full classification the Codex adapter applies to a failure message: the reconnect substring
// yields a fixed two-minute wait and is tested first, so a message carrying it takes that wait even
// when a later family's token co-occurs; a rate-limit / quota substring yields the synthesized 8-to-12
// minute wait; a retryable HTTP-status or transport substring yields a retryable error; anything else
// yields a non-retryable error.
export function classifyToolFailure(message:string, time:TimeContext, random:RandomContext):ToolEventRateLimit|ToolEventError {
    if (isReconnectMessage(message)) {
        return { type: "rate_limit", waitUntilMs: time.now() + RECONNECT_WAIT_MS };
    }
    if (isRateLimitMessage(message)) {
        return synthesizeRateLimitEvent(time, random);
    }
    if (isRetryableHttpStatus(message) || isRetryableTransport(message)) {
        return { type: "error", retryable: true, message };
    }
    return { type: "error", retryable: false, message };
}
