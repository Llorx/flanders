import type { RandomContext, TimeContext } from "../contexts";
import type { ToolEventError, ToolEventRateLimit } from "./ToolAdapter";

// The recognized transient-error substring families shared by the tool adapters whose CLI exposes a
// failure only as free text, with no structured error / HTTP-status / retry-after fields: the Codex
// adapter and the Antigravity adapter. Both classify a failure by literal, case-insensitive
// substring search over the trimmed message. The set is closed; adding a substring requires updating
// src/ai/.spec/rules/runner.md first (the Codex and Antigravity adapter sections), which is why the
// families live here in one place rather than being copied per adapter.

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

// Both adapters synthesize the same wait when their CLI signals a rate-limit / quota exhaustion
// without a reset time: a uniform draw from the closed 8-to-12-minute interval, added to the current
// time. The wall clock and the random draw are obtained through the injected contexts per
// src/.spec/rules/external-access-through-contexts.md, never via Date.now() / Math.random().
export function synthesizeRateLimitEvent(time:TimeContext, random:RandomContext):ToolEventRateLimit {
    const r = EIGHT_MINUTES_MS + Math.round(random.random() * (TWELVE_MINUTES_MS - EIGHT_MINUTES_MS));
    return { type: "rate_limit", waitUntilMs: time.now() + r };
}

// The full classification the Codex adapter applies to a failure message: a rate-limit / quota
// substring yields the synthesized wait; a retryable HTTP-status or transport substring yields a
// retryable error; anything else yields a non-retryable error. The Antigravity adapter reuses the
// predicates and the synthesized wait directly rather than this function, because it additionally
// distinguishes a signal exit and an empty message.
export function classifyToolFailure(message:string, time:TimeContext, random:RandomContext):ToolEventRateLimit|ToolEventError {
    if (isRateLimitMessage(message)) {
        return synthesizeRateLimitEvent(time, random);
    }
    if (isRetryableHttpStatus(message) || isRetryableTransport(message)) {
        return { type: "error", retryable: true, message };
    }
    return { type: "error", retryable: false, message };
}
