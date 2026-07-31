import type { SpawnOptions } from "child_process";

import type { ScriptContext, TimeContext, RandomContext } from "../contexts";
import type { ToolAdapter, ToolAdapterInvokeArgs, ToolEvent, ToolTerminalEvent } from "./ToolAdapter";
import { synthesizeRateLimitEvent, UNKNOWN_TOOL_ERROR_MESSAGE } from "./toolErrorClassification";
import { ToolProcessLifecycle } from "./ToolProcessLifecycle";

const TOOL_INPUT_INLINE_MAX = 120;

// The one `rate_limit_info` status that means the request was turned away; every other value the
// field carries reports a standing the invocation is allowed to keep running under.
const REJECTED_RATE_LIMIT_STATUS = "rejected";

type ClaudeNativeContentBlock = Readonly<{
    type?:string;
    text?:string;
    thinking?:string;
    name?:string;
    id?:string;
    input?:Readonly<Record<string, unknown>>;
    tool_use_id?:string;
    content?:string|ReadonlyArray<Readonly<{ type?:string; text?:string }>>;
    is_error?:boolean;
}>;

type ClaudeRateLimitInfo = Readonly<{
    status?:string;
    resetsAt?:number;
    rateLimitType?:string;
    isUsingOverage?:boolean;
    overageStatus?:string;
    overageResetsAt?:number;
    utilization?:number;
    surpassedThreshold?:number;
}>;

type ClaudeNativeEvent = Readonly<{
    type?:string;
    subtype?:string;
    is_error?:boolean;
    api_error_status?:number|null;
    session_id?:string;
    message?:Readonly<{
        role?:string;
        content?:ReadonlyArray<ClaudeNativeContentBlock>;
        usage?:Readonly<{
            input_tokens?:number;
            output_tokens?:number;
            cache_creation_input_tokens?:number;
            cache_read_input_tokens?:number;
        }>;
    }>;
    error?:string|Readonly<{
        message?:string;
    }>;
    result?:string;
    usage?:Readonly<{
        input_tokens?:number;
        output_tokens?:number;
        cache_creation_input_tokens?:number;
        cache_read_input_tokens?:number;
    }>;
    rate_limit_info?:ClaudeRateLimitInfo;
}>;

export type ClaudeAdapterContexts = Readonly<{
    claude:ScriptContext;
    time:TimeContext;
    random:RandomContext;
}>;

function marksRejection(info:ClaudeRateLimitInfo|null|undefined):boolean {
    if (!info) {
        return false;
    }
    return (info.isUsingOverage ? info.overageStatus : info.status) === REJECTED_RATE_LIMIT_STATUS;
}

function resetInstantMs(info:ClaudeRateLimitInfo|null|undefined):number|null {
    if (!info) {
        return null;
    }
    const resetsAtSeconds = info.isUsingOverage && typeof info.overageResetsAt === "number"
        ? info.overageResetsAt
        : info.resetsAt;
    return typeof resetsAtSeconds === "number" ? resetsAtSeconds * 1000 : null;
}

export function formatToolInput(input:Readonly<Record<string, unknown>>|undefined):string {
    if (!input || typeof input !== "object") {
        return "";
    }
    const i = input as Record<string, unknown>;
    if (typeof i["command"] === "string") {
        return i["command"];
    }
    if (typeof i["file_path"] === "string") {
        return i["file_path"];
    }
    if (typeof i["path"] === "string") {
        return i["path"];
    }
    if (typeof i["pattern"] === "string") {
        return i["pattern"];
    }
    if (typeof i["url"] === "string") {
        return i["url"];
    }
    if (typeof i["query"] === "string") {
        return i["query"];
    }
    const json = JSON.stringify(input);
    if (json.length > TOOL_INPUT_INLINE_MAX) {
        return json.slice(0, TOOL_INPUT_INLINE_MAX - 3) + "...";
    }
    return json;
}

function renderToolResultContent(content:unknown):string {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        let out = "";
        for (const block of content) {
            if (block && typeof block === "object") {
                const b = block as { type?:string; text?:string };
                if (b.type === "text" && typeof b.text === "string") {
                    out += b.text;
                }
            }
        }
        return out;
    }
    return "";
}

function toolResultSummary(content:unknown):string {
    const text = renderToolResultContent(content);
    if (!text) {
        return "";
    }
    /* coverage ignore next */ // — split() on a non-empty string always yields ≥1 element; ?? is a defensive fallback.
    const firstLine = text.split("\n")[0] ?? "";
    return firstLine;
}

export class ClaudeAdapter implements ToolAdapter {
    constructor(private _contexts:ClaudeAdapterContexts) {}

    invoke(args:ToolAdapterInvokeArgs):AsyncIterable<ToolEvent> {
        const iter = new ClaudeAdapterIterator(args, this._contexts);
        return {
            [Symbol.asyncIterator]() {
                return iter;
            }
        };
    }
}

class ClaudeAdapterIterator implements AsyncIterator<ToolEvent> {
    private _capturedSessionId:string|null = null;
    private _queue:ToolEvent[] = [];
    private _done = false;
    private _waitResolve:(() => void)|null = null;
    private _abortListener:(() => void)|null = null;
    private _pendingTerminal:ToolTerminalEvent|null = null;
    private _processLifecycle:ToolProcessLifecycle|null = null;
    private _retainedRateLimitInfo:ClaudeRateLimitInfo|null = null;

    constructor(
        private _args:ToolAdapterInvokeArgs,
        private _contexts:ClaudeAdapterContexts
    ) {
        this._start();
    }

    private _start():void {
        const argv = this._buildArgv();
        const spawnOptions:SpawnOptions = { stdio: "pipe" };
        let stderrBuf = "";
        const processLifecycle = new ToolProcessLifecycle(
            this._contexts.claude,
            "claude",
            argv,
            spawnOptions,
            this._contexts.time,
            {
                onError: error => this._handleProcessError(error),
                onExit: (code, signal) => {
                    if (stderrBuf) {
                        this._queue.push({
                            type: "output",
                            title: "stderr",
                            subtitle: "",
                            details: stderrBuf
                        });
                        stderrBuf = "";
                    }
                    if (!this._pendingTerminal) {
                        this._handleProcessExit(code, signal);
                    }
                }
            }
        );
        this._processLifecycle = processLifecycle;
        const proc = processLifecycle.process;

        const initialMessage = {
            type: "user",
            message: { role: "user", content: this._args.prompt }
        };
        proc.stdin?.write(JSON.stringify(initialMessage) + "\n");
        proc.stdin?.end();

        let buffer = "";
        proc.stdout?.on("data", (chunk:Buffer|string) => {
            buffer += String(chunk);
            for (;;) {
                const nl = buffer.indexOf("\n");
                if (nl < 0) break;
                const line = buffer.slice(0, nl).replace(/\r$/, "");
                buffer = buffer.slice(nl + 1);
                if (line) {
                    this._handleLine(line);
                }
            }
        });

        proc.stderr?.on("data", (chunk:Buffer|string) => {
            stderrBuf += String(chunk);
        });

        this._abortListener = () => {
            this._pendingTerminal = null;
            this._queue.length = 0;
            this._done = true;
            void this._processLifecycle?.dispose();
            this._wake();
        };
        if (this._args.abortSignal.aborted) {
            this._abortListener();
        } else {
            this._args.abortSignal.addEventListener("abort", this._abortListener, { once: true });
        }
    }

    private _handleProcessError(error:unknown):void {
        const err = error instanceof Error ? error : new Error(String(error));
        this._finishWithTerminal({
            type: "error",
            retryable: false,
            message: (err as { code?:string }).code === "ENOENT"
                ? "claude binary not found"
                : err.message
        });
    }

    private _handleProcessExit(code:number|null, signal:string|null):void {
        if (signal) {
            this._finishWithTerminal({
                type: "error",
                retryable: true,
                message: `claude terminated by signal ${signal}`
            });
        } else {
            this._finishWithTerminal({
                type: "error",
                retryable: true,
                message: `claude exited unexpectedly (code ${code} signal ${signal})`
            });
        }
    }

    private _buildArgv():string[] {
        const argv:string[] = [];

        if (this._args.resumeSessionId) {
            argv.push("--resume", this._args.resumeSessionId);
        }

        if (this._args.model) {
            argv.push("--model", this._args.model);
        }

        if (this._args.effort) {
            argv.push("--effort", this._args.effort);
        }

        if (this._args.fast) {
            argv.push("--settings", JSON.stringify({ fastMode: true }));
        }

        argv.push(
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--include-partial-messages",
            "--verbose",
            "--print",
            "--dangerously-skip-permissions"
        );

        return argv;
    }

    private _handleLine(line:string):void {
        if (this._done || this._pendingTerminal) return;

        let parsed:ClaudeNativeEvent|null = null;
        try {
            parsed = JSON.parse(line) as ClaudeNativeEvent;
        } catch {
            return;
        }
        if (!parsed) return;

        if (parsed.session_id) {
            if (this._capturedSessionId === null) {
                this._capturedSessionId = parsed.session_id;
                this._queue.push({ type: "session", id: parsed.session_id });
            } else if (this._capturedSessionId !== parsed.session_id) {
                this._capturedSessionId = parsed.session_id;
                this._queue.push({ type: "session", id: parsed.session_id });
            }
        }

        if (parsed.type === "rate_limit_event" && parsed.rate_limit_info) {
            this._retainedRateLimitInfo = parsed.rate_limit_info;
        }

        if (parsed.type === "assistant" && parsed.message?.content) {
            for (const block of parsed.message.content) {
                if (block.type === "tool_use" && typeof block.name === "string") {
                    this._queue.push({
                        type: "output",
                        title: block.name,
                        subtitle: formatToolInput(block.input),
                        details: ""
                    });
                } else if (block.type === "text" && typeof block.text === "string") {
                    this._queue.push({
                        type: "output",
                        title: "Assistant",
                        subtitle: "",
                        details: block.text
                    });
                } else if (block.type === "thinking" && typeof block.thinking === "string") {
                    this._queue.push({
                        type: "output",
                        title: "Thinking",
                        subtitle: "",
                        details: block.thinking
                    });
                }
            }
        }

        if (parsed.type === "user" && parsed.message?.content) {
            for (const block of parsed.message.content) {
                if (block.type === "tool_result") {
                    const text = renderToolResultContent(block.content);
                    this._queue.push({
                        type: "output",
                        title: "Result",
                        subtitle: toolResultSummary(block.content),
                        details: text
                    });
                }
            }
        }

        if (parsed.type === "result") {
            const u = parsed.usage;
            if (u && this._args.onUsage) {
                const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
                const outputTokens = u.output_tokens ?? 0;
                this._args.onUsage({ inputTokens, outputTokens });
            }

            /* coverage ignore next 4 */ // — Unreachable: the general session_id check at the top of _handleLine always captures before the result handler runs.
            if (parsed.session_id && !this._capturedSessionId) {
                this._capturedSessionId = parsed.session_id;
                this._queue.push({ type: "session", id: parsed.session_id });
            }

            if (!parsed.is_error) {
                this._finishWithTerminal({ type: "done" });
            } else {
                this._finishWithTerminal(this._classifyError(parsed));
            }
        }

        this._wake();
    }

    private _classifyError(parsed:ClaudeNativeEvent):ToolTerminalEvent {
        const status = parsed.api_error_status;
        const subtype = parsed.subtype;
        const errorDetail = typeof parsed.error === "object" ? parsed.error : undefined;
        const message = errorDetail?.message ?? UNKNOWN_TOOL_ERROR_MESSAGE;

        // Claude emits `rate_limit_event` to report where the invocation stands against its usage
        // limits whatever that standing is, so a retained info object is a utilization reading as
        // often as a rejection and never says why this result failed. The result decides; the
        // retained object only supplies the reset instant the result itself does not carry.
        if (status === 429 || marksRejection(parsed.rate_limit_info)) {
            const resetMs = resetInstantMs(parsed.rate_limit_info) ?? resetInstantMs(this._retainedRateLimitInfo);
            if (resetMs !== null) {
                return { type: "rate_limit", waitUntilMs: resetMs };
            }
            return synthesizeRateLimitEvent(this._contexts.time, this._contexts.random);
        }

        // Claude signals a login failure as the `authentication_failed` identifier standing in place of
        // the error detail object, or as a 401 — and may carry it with no HTTP status at all, the shape
        // the ladder below reads as a retryable transport error and would re-invoke against forever.
        // Standing in place of the detail object, the identifier leaves the turn's human-readable text
        // in the result's own `result` string.
        if (parsed.error === "authentication_failed" || status === 401) {
            const loginMessage = errorDetail?.message ?? parsed.result ?? UNKNOWN_TOOL_ERROR_MESSAGE;
            return { type: "error", retryable: false, fatal: true, message: loginMessage };
        }

        if (typeof status === "number" && status >= 500) {
            return { type: "error", retryable: true, message };
        }
        if (status === 408 || status === 425) {
            return { type: "error", retryable: true, message };
        }
        if (status === null) {
            return { type: "error", retryable: true, message };
        }

        if (subtype === "error_during_execution") {
            return { type: "error", retryable: true, message };
        }
        if (subtype === "error_max_turns" || subtype === "error_max_budget_usd" || subtype === "error_max_structured_output_retries") {
            return { type: "error", retryable: false, message };
        }

        return { type: "error", retryable: false, message };
    }

    private _finishWithTerminal(terminal:ToolTerminalEvent):void {
        if (this._done || this._pendingTerminal || this._args.abortSignal.aborted) {
            return;
        }
        this._pendingTerminal = terminal;
        this._processLifecycle!.finishAfterExit(() => {
            this._queue.push(this._pendingTerminal!);
            this._pendingTerminal = null;
            this._done = true;
            this._wake();
        });
    }

    private _wake():void {
        if (this._waitResolve) {
            const resolve = this._waitResolve;
            this._waitResolve = null;
            resolve();
        }
    }

    private _wait():Promise<void> {
        return new Promise<void>(resolve => {
            this._waitResolve = resolve;
        });
    }

    async next():Promise<IteratorResult<ToolEvent>> {
        for (;;) {
            if (this._queue.length > 0) {
                return { value: this._queue.shift()!, done: false };
            }
            if (this._done && this._queue.length === 0) {
                this._cleanup();
                if (this._processLifecycle) {
                    await this._processLifecycle.dispose();
                }
                return { value: undefined as unknown as ToolEvent, done: true };
            }
            await this._wait();
        }
    }

    async return():Promise<IteratorResult<ToolEvent>> {
        this._pendingTerminal = null;
        this._done = true;
        this._cleanup();
        if (this._processLifecycle) {
            await this._processLifecycle.dispose();
        }
        return { value: undefined as unknown as ToolEvent, done: true };
    }

    private _cleanup():void {
        if (this._abortListener) {
            this._args.abortSignal.removeEventListener("abort", this._abortListener);
            this._abortListener = null;
        }
    }
}
