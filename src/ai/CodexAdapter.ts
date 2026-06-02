import type { SpawnOptions } from "child_process";

import type { ScriptContext, SpawnedProcess, TimeContext } from "../contexts";
import type { ToolAdapter, ToolAdapterInvokeArgs, ToolEvent } from "./ToolAdapter";

const COMMAND_INLINE_MAX = 120;

const RATE_LIMIT_SUBSTRINGS = [
    "rate limit",
    "rate-limit",
    "rate_limit",
    "quota",
    "too many requests"
];

const RATE_LIMIT_429_RE = /\b429\b/;

const DURATION_RE = /(?:try again in|retry after|retry-after|wait)\s+(\d+)\s*(seconds?|minutes?|s|m)?/i;

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

type CodexNativeItem = Readonly<{
    type?:string;
    text?:string;
    command?:string;
    aggregated_output?:string;
    exit_code?:number;
    status?:string;
}>;

type CodexNativeEvent = Readonly<{
    type?:string;
    item?:CodexNativeItem;
    message?:string;
    thread_id?:string;
}>;

export type CodexAdapterContexts = Readonly<{
    script:ScriptContext;
    time:TimeContext;
}>;

export function formatCodexCommand(command:string|undefined):string {
    if (!command) return "";
    const firstLine = command.split("\n")[0]!;
    if (firstLine.length > COMMAND_INLINE_MAX) {
        return firstLine.slice(0, COMMAND_INLINE_MAX - 3) + "...";
    }
    return firstLine;
}

function isRateLimitMessage(message:string):boolean {
    const lower = message.trim().toLowerCase();
    for (const sub of RATE_LIMIT_SUBSTRINGS) {
        if (lower.includes(sub)) return true;
    }
    return RATE_LIMIT_429_RE.test(message.trim());
}

function parseDurationMs(message:string):number|null {
    const match = DURATION_RE.exec(message);
    if (!match) return null;
    const value = parseInt(match[1]!, 10);
    if (isNaN(value) || value <= 0) return null;
    const unit = (match[2] ?? "").toLowerCase();
    if (unit.startsWith("m")) {
        return value * 60_000;
    }
    return value * 1_000;
}

function isRetryableHttpStatus(message:string):boolean {
    const trimmed = message.trim();
    if (FIVE_XX_RE.test(trimmed)) return true;
    if (STATUS_408_RE.test(trimmed)) return true;
    if (STATUS_425_RE.test(trimmed)) return true;
    return false;
}

function isRetryableTransport(message:string):boolean {
    const lower = message.trim().toLowerCase();
    for (const sub of TRANSPORT_SUBSTRINGS) {
        if (lower.includes(sub)) return true;
    }
    return false;
}

export class CodexAdapter implements ToolAdapter {
    constructor(private _contexts:CodexAdapterContexts) {}

    invoke(args:ToolAdapterInvokeArgs):AsyncIterable<ToolEvent> {
        const iter = new CodexAdapterIterator(args, this._contexts);
        return {
            [Symbol.asyncIterator]() {
                return iter;
            }
        };
    }
}

class CodexAdapterIterator implements AsyncIterator<ToolEvent> {
    private _proc:SpawnedProcess|null = null;
    private _capturedSessionId:string|null = null;
    private _queue:ToolEvent[] = [];
    private _done = false;
    private _waitResolve:(() => void)|null = null;
    private _abortListener:(() => void)|null = null;
    private _exitPromise:Promise<void>|null = null;
    private _sawTurnCompleted = false;

    private _receivedAnyEvent = false;
    private _fallbackAttempted = false;
    private _usedResumeOrFork = false;

    constructor(
        private _args:ToolAdapterInvokeArgs,
        private _contexts:CodexAdapterContexts
    ) {
        this._start(false);
    }

    private _start(useExecFallback:boolean):void {
        const isResume = !useExecFallback && !!this._args.resumeSessionId;
        const isFork = !useExecFallback && !!this._args.forkParentSessionId;
        this._usedResumeOrFork = isResume || isFork;

        const argv = this._buildArgv(isResume, isFork);
        const spawnOptions:SpawnOptions = { stdio: "pipe" };
        const proc = this._contexts.script.spawn("codex", argv, spawnOptions);
        this._proc = proc;

        proc.stdin?.write(this._args.prompt);
        proc.stdin?.end();

        let exitResolve:(() => void)|null = null;
        this._exitPromise = new Promise<void>(resolve => { exitResolve = resolve; });

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

        proc.on("error", (e:unknown) => {
            if (this._done) {
                exitResolve?.();
                return;
            }
            this._done = true;
            const err = e instanceof Error ? e : new Error(String(e));
            if ((err as {code?:string}).code === "ENOENT") {
                this._queue.push({ type: "error", retryable: false, message: "codex binary not found" });
            } else {
                this._queue.push({ type: "error", retryable: false, message: err.message });
            }
            this._wake();
            exitResolve?.();
        });

        proc.on("exit", (code:number|null, signal:string|null) => {
            if (this._done) {
                exitResolve?.();
                return;
            }

            if (this._usedResumeOrFork && !this._receivedAnyEvent && !this._fallbackAttempted) {
                this._fallbackAttempted = true;
                this._queue.push({
                    type: "output",
                    title: "Continuity lost",
                    subtitle: "",
                    details: "codex resume/fork unavailable in installed CLI"
                });
                this._cleanup();
                this._sawTurnCompleted = false;
                this._receivedAnyEvent = false;
                this._usedResumeOrFork = false;
                exitResolve?.();
                this._start(true);
                this._wake();
                return;
            }

            if (this._sawTurnCompleted) {
                this._queue.push({ type: "done" });
            } else if (signal) {
                this._queue.push({
                    type: "error",
                    retryable: true,
                    message: `codex terminated by signal ${signal}`
                });
            } else {
                this._queue.push({
                    type: "error",
                    retryable: true,
                    message: `codex exited unexpectedly (code ${code} signal ${signal})`
                });
            }

            this._done = true;
            this._wake();
            exitResolve?.();
        });

        this._abortListener = () => {
            if (this._proc) {
                this._proc.kill("SIGINT");
            }
            this._done = true;
            this._wake();
        };
        if (this._args.abortSignal.aborted) {
            this._abortListener();
        } else {
            this._args.abortSignal.addEventListener("abort", this._abortListener, { once: true });
        }
    }

    private _buildArgv(isResume:boolean, isFork:boolean):string[] {
        const argv:string[] = [];

        if (isResume) {
            argv.push("resume", this._args.resumeSessionId!);
        } else if (isFork) {
            argv.push("fork", this._args.forkParentSessionId!);
        } else {
            argv.push("exec");
        }

        argv.push("--json");
        argv.push("-c", "approval_policy=never");
        argv.push("-c", "sandbox_mode=danger-full-access");

        if (this._args.model) {
            argv.push("-m", this._args.model);
        }
        if (this._args.effort) {
            argv.push("-c", `model_reasoning_effort=${this._args.effort}`);
        }

        argv.push("-");

        return argv;
    }

    private _handleLine(line:string):void {
        if (this._done) return;

        let parsed:CodexNativeEvent|null = null;
        try {
            parsed = JSON.parse(line) as CodexNativeEvent;
        } catch {
            return;
        }
        if (!parsed) return;

        this._receivedAnyEvent = true;

        if (parsed.thread_id && parsed.thread_id !== this._capturedSessionId) {
            this._capturedSessionId = parsed.thread_id;
            this._queue.push({ type: "session", id: parsed.thread_id });
        }

        if (parsed.type === "item.completed" && parsed.item) {
            this._handleItemCompleted(parsed.item);
        } else if (parsed.type === "turn.completed") {
            this._sawTurnCompleted = true;
        } else if (parsed.type === "error") {
            this._handleErrorEvent(parsed);
        }

        this._wake();
    }

    private _handleItemCompleted(item:CodexNativeItem):void {
        if (item.type === "agent_message") {
            this._queue.push({
                type: "output",
                title: "Assistant",
                subtitle: "",
                details: typeof item.text === "string" ? item.text : ""
            });
        } else if (item.type === "command_execution") {
            this._queue.push({
                type: "output",
                title: "command",
                subtitle: formatCodexCommand(item.command),
                details: typeof item.aggregated_output === "string" ? item.aggregated_output : ""
            });
        } else if (item.type === "reasoning") {
            this._queue.push({
                type: "output",
                title: "Thinking",
                subtitle: "",
                details: typeof item.text === "string" ? item.text : ""
            });
        }
    }

    private _handleErrorEvent(parsed:CodexNativeEvent):void {
        const message = typeof parsed.message === "string" ? parsed.message : "unknown error";

        if (isRateLimitMessage(message)) {
            const durationMs = parseDurationMs(message);
            if (durationMs !== null) {
                this._queue.push({
                    type: "rate_limit",
                    waitUntilMs: this._contexts.time.now() + durationMs
                });
            } else {
                this._queue.push({ type: "error", retryable: true, message });
            }
        } else if (isRetryableHttpStatus(message)) {
            this._queue.push({ type: "error", retryable: true, message });
        } else if (isRetryableTransport(message)) {
            this._queue.push({ type: "error", retryable: true, message });
        } else {
            this._queue.push({ type: "error", retryable: false, message });
        }

        this._done = true;
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
                if (this._exitPromise) {
                    await this._exitPromise;
                }
                return { value: undefined as unknown as ToolEvent, done: true };
            }
            await this._wait();
        }
    }

    async return():Promise<IteratorResult<ToolEvent>> {
        this._done = true;
        this._cleanup();
        if (this._proc) {
            this._proc.kill("SIGINT");
            if (this._exitPromise) {
                await this._exitPromise;
            }
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
