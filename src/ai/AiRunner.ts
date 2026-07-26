import type { TimeContext } from "../contexts";
import type {
    ToolAdapter,
    ToolAdapterInvokeArgs,
    ToolAdapterUsageCallback,
    ToolTokenUsage,
    ToolEvent,
    ToolEventDone,
    ToolEventError,
    ToolEventOutput,
    ToolEventRateLimit,
} from "./ToolAdapter";
import { wait } from "../system/wait";
import { abortError } from "../abortError";

const RATE_LIMIT_RETRY_INTERVAL_MS = 30 * 60 * 1000;
const INITIAL_TRANSIENT_WAIT_MS = 1_000;
const TRANSIENT_WAIT_CAP_MS = 60_000;

export type RateLimitWaitStartCallback = (kind:"rate-limit", endTimeMs:number, nextRetryAtMs:number) => void;
export type RateLimitWaitUpdateCallback = (endTimeMs:number, nextRetryAtMs:number) => void;
export type RateLimitWaitEndCallback = () => void;

export type RunCallbacks = Readonly<{
    onOutput(event:ToolEventOutput):void;
    onSessionId(id:string):void;
    onUsage?:ToolAdapterUsageCallback;
    onWaitStart?:RateLimitWaitStartCallback;
    onWaitUpdate?:RateLimitWaitUpdateCallback;
    onWaitEnd?:RateLimitWaitEndCallback;
}>;

export type RunArgs = Readonly<{
    adapter:ToolAdapter;
    prompt:string;
    model:string;
    effort:string;
    fast:boolean;
    resumeSessionId?:string;
    priorSessionUsage?:ToolTokenUsage;
    abortSignal:AbortSignal;
    callbacks:RunCallbacks;
    time:TimeContext;
}>;

export type RunResult = Readonly<{
    sessionId:string|null;
}>;

export async function run(args:RunArgs):Promise<RunResult> {
    const { adapter, prompt, model, effort, fast, abortSignal, callbacks, time } = args;

    if (abortSignal.aborted) {
        throw abortError();
    }

    let capturedSessionId:string|null = null;
    let transientAttempt = 0;
    let firstInvocation = true;
    let inRateLimitWait = false;
    const baseInvokeArgs = { prompt, model, effort, fast, abortSignal, onUsage: callbacks.onUsage, priorSessionUsage: args.priorSessionUsage };

    const leaveRateLimitWait = () => {
        if (inRateLimitWait) {
            inRateLimitWait = false;
            callbacks.onWaitEnd?.();
        }
    };

    try {
        for (;;) {
            const resumeSessionId = firstInvocation ? args.resumeSessionId : capturedSessionId ?? args.resumeSessionId;
            const invokeArgs:ToolAdapterInvokeArgs = resumeSessionId
                ? { ...baseInvokeArgs, resumeSessionId }
                : baseInvokeArgs;
            firstInvocation = false;

            let terminal:ToolEventError|ToolEventRateLimit|ToolEventDone|null = null;

            const attemptStartedAtMs = time.now();
            const iterable:AsyncIterable<ToolEvent> = adapter.invoke(invokeArgs);
            for await (const event of iterable) {
                switch (event.type) {
                    case "output":
                        leaveRateLimitWait();
                        callbacks.onOutput(event);
                        break;
                    case "session":
                        leaveRateLimitWait();
                        capturedSessionId = event.id;
                        callbacks.onSessionId(event.id);
                        break;
                    case "error":
                    case "rate_limit":
                    case "done":
                        terminal = event;
                        break;
                }
                if (terminal) break;
            }

            if (!terminal && abortSignal.aborted) {
                throw abortError();
            }
            /* coverage ignore next 3 */ // Unreachable: tool-interface invariant guarantees exactly one terminal event per invocation.
            if (!terminal) {
                throw new Error("adapter closed without terminal event");
            }

            if (terminal.type !== "rate_limit") {
                leaveRateLimitWait();
            }

            if (terminal.type === "done") {
                transientAttempt = 0;
                return { sessionId: capturedSessionId };
            }

            if (terminal.type === "error" && !terminal.retryable) {
                if (terminal.fatal) {
                    throw fatalLoginError(terminal.message);
                }
                throw new Error(terminal.message);
            }

            if (terminal.type === "rate_limit") {
                const retryIntervalStartedAtMs = inRateLimitWait ? attemptStartedAtMs : time.now();
                const nextRetryAtMs = Math.min(terminal.waitUntilMs, retryIntervalStartedAtMs + RATE_LIMIT_RETRY_INTERVAL_MS);
                if (inRateLimitWait) {
                    callbacks.onWaitUpdate?.(terminal.waitUntilMs, nextRetryAtMs);
                } else {
                    inRateLimitWait = true;
                    callbacks.onWaitStart?.("rate-limit", terminal.waitUntilMs, nextRetryAtMs);
                }
                await wait(nextRetryAtMs - time.now(), RATE_LIMIT_RETRY_INTERVAL_MS, time, abortSignal);
                if (abortSignal.aborted) {
                    throw abortError();
                }
                continue;
            }

            transientAttempt++;
            const waitMs = Math.min(TRANSIENT_WAIT_CAP_MS, INITIAL_TRANSIENT_WAIT_MS * 2 ** (transientAttempt - 1));
            await wait(waitMs, waitMs, time, abortSignal);
            if (abortSignal.aborted) {
                throw abortError();
            }
        }
    } finally {
        leaveRateLimitWait();
    }
}

const FATAL_LOGIN_ERROR_NAME = "FatalLoginError";

export function isFatalLoginError(e:unknown):boolean {
    return e instanceof Error && e.name === FATAL_LOGIN_ERROR_NAME;
}

function fatalLoginError(message:string):Error {
    const err = new Error(message);
    err.name = FATAL_LOGIN_ERROR_NAME;
    return err;
}
