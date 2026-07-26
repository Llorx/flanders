import type { RandomContext, TimeContext } from "../contexts";
import type { ToolEventError, ToolEventRateLimit } from "./ToolAdapter";

// What every adapter puts on an `error` event when its tool reported a failure carrying no
// human-readable text of its own.
export const UNKNOWN_TOOL_ERROR_MESSAGE = "unknown error";

// The Codex CLI exposes a failure as free text alone, so each family below is a closed set of
// literal substrings the adapter recognizes, never a fuzzy or inferred match.

// The Codex CLI emits this marker with exactly this capitalization, so this family alone matches
// case-sensitively.
const RECONNECT_SUBSTRING = "Reconnecting...";
const RECONNECT_WAIT_MS = 2 * 60_000;

const LOGIN_SUBSTRINGS = [
    "not logged in",
    "codex login",
    "not authenticated",
    "unauthorized"
];

const LOGIN_TOKEN_PATTERNS = [/\b401\b/];

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

const RATE_LIMIT_TOKEN_PATTERNS = [/\b429\b/];

const EIGHT_MINUTES_MS = 8 * 60_000;
const TWELVE_MINUTES_MS = 12 * 60_000;

const RETRYABLE_STATUS_TOKEN_PATTERNS = [/\b5\d{2}\b/, /\b408\b/, /\b425\b/];

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

function matchesFailureFamily(message:string, substrings:readonly string[], tokenPatterns:readonly RegExp[]):boolean {
    const trimmed = message.trim();
    for (const pattern of tokenPatterns) {
        if (pattern.test(trimmed)) return true;
    }
    const lower = trimmed.toLowerCase();
    for (const substring of substrings) {
        if (lower.includes(substring)) return true;
    }
    return false;
}

export function isReconnectMessage(message:string):boolean {
    return message.trim().includes(RECONNECT_SUBSTRING);
}

export function isLoginFailureMessage(message:string):boolean {
    return matchesFailureFamily(message, LOGIN_SUBSTRINGS, LOGIN_TOKEN_PATTERNS);
}

export function isRateLimitMessage(message:string):boolean {
    return matchesFailureFamily(message, RATE_LIMIT_SUBSTRINGS, RATE_LIMIT_TOKEN_PATTERNS);
}

export function isRetryableHttpStatus(message:string):boolean {
    return matchesFailureFamily(message, [], RETRYABLE_STATUS_TOKEN_PATTERNS);
}

export function isRetryableTransport(message:string):boolean {
    return matchesFailureFamily(message, TRANSPORT_SUBSTRINGS, []);
}

// The Codex adapter synthesizes this wait when its CLI signals a rate-limit / quota exhaustion
// without a reset time: a uniform draw from the closed 8-to-12-minute interval, added to the current
// time. The wall clock and the random draw are obtained through the injected contexts per
// src/.spec/rules/external-access-through-contexts.md, never via Date.now() / Math.random().
export function synthesizeRateLimitEvent(time:TimeContext, random:RandomContext):ToolEventRateLimit {
    const r = EIGHT_MINUTES_MS + Math.round(random.random() * (TWELVE_MINUTES_MS - EIGHT_MINUTES_MS));
    return { type: "rate_limit", waitUntilMs: time.now() + r };
}

export function classifyToolFailure(message:string, time:TimeContext, random:RandomContext):ToolEventRateLimit|ToolEventError {
    if (isReconnectMessage(message)) {
        return { type: "rate_limit", waitUntilMs: time.now() + RECONNECT_WAIT_MS };
    }
    if (isLoginFailureMessage(message)) {
        return { type: "error", retryable: false, fatal: true, message };
    }
    if (isRateLimitMessage(message)) {
        return synthesizeRateLimitEvent(time, random);
    }
    if (isRetryableHttpStatus(message) || isRetryableTransport(message)) {
        return { type: "error", retryable: true, message };
    }
    return { type: "error", retryable: false, message };
}
