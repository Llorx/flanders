import type { TimeContext } from "../contexts";
import type {
    ToolAdapter,
    ToolAdapterInvokeArgs,
    ToolAdapterUsageCallback,
    ToolEvent,
    ToolEventDone,
    ToolEventError,
    ToolEventOutput,
    ToolEventRateLimit,
} from "./ToolAdapter";
import { wait } from "../system/wait";

const RATE_LIMIT_CHUNK_MS = 60 * 60 * 1000;
const INITIAL_TRANSIENT_WAIT_MS = 1_000;
const TRANSIENT_WAIT_CAP_MS = 60_000;

export type RunCallbacks = Readonly<{
    onOutput(event:ToolEventOutput):void;
    onSessionId(id:string):void;
    onUsage?:ToolAdapterUsageCallback;
    onWaitStart?(kind:"rate-limit", endTimeMs:number):void;
    onWaitEnd?():void;
}>;

export type RunArgs = Readonly<{
    adapter:ToolAdapter;
    prompt:string;
    model:string;
    effort:string;
    resumeSessionId?:string;
    abortSignal:AbortSignal;
    callbacks:RunCallbacks;
    time:TimeContext;
}>;

export type RunResult = Readonly<{
    sessionId:string|null;
}>;

export async function run(args:RunArgs):Promise<RunResult> {
    const { adapter, prompt, model, effort, abortSignal, callbacks, time } = args;

    if (abortSignal.aborted) {
        throw abortError();
    }

    let capturedSessionId:string|null = null;
    let transientAttempt = 0;
    let firstInvocation = true;

    for (;;) {
        const base = { prompt, model, effort, abortSignal, onUsage: callbacks.onUsage };

        let invokeArgs:ToolAdapterInvokeArgs;
        if (firstInvocation) {
            if (args.resumeSessionId) {
                invokeArgs = { ...base, resumeSessionId: args.resumeSessionId };
            } else {
                invokeArgs = base;
            }
            firstInvocation = false;
        } else {
            const retrySessionId:string|undefined = capturedSessionId ?? args.resumeSessionId;
            if (retrySessionId) {
                invokeArgs = { ...base, resumeSessionId: retrySessionId };
            } else {
                invokeArgs = base;
            }
        }

        let terminal:ToolEventError|ToolEventRateLimit|ToolEventDone|null = null;

        const iterable:AsyncIterable<ToolEvent> = adapter.invoke(invokeArgs);
        for await (const event of iterable) {
            switch (event.type) {
                case "output":
                    callbacks.onOutput(event);
                    break;
                case "session":
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

        if (terminal.type === "done") {
            transientAttempt = 0;
            return { sessionId: capturedSessionId };
        }

        if (terminal.type === "error" && !terminal.retryable) {
            throw new Error(terminal.message);
        }

        if (terminal.type === "rate_limit") {
            const waitMs = Math.max(0, terminal.waitUntilMs - time.now());
            callbacks.onWaitStart?.("rate-limit", terminal.waitUntilMs);
            try {
                await wait(waitMs, RATE_LIMIT_CHUNK_MS, time, abortSignal);
            } finally {
                callbacks.onWaitEnd?.();
            }
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
}

function abortError():Error {
    const err = new Error("aborted");
    err.name = "AbortError";
    return err;
}
