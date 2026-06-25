import type { SpawnOptions } from "child_process";

import type { RandomContext, ScriptContext, SpawnedProcess, TimeContext } from "../contexts";
import { classifyToolFailure } from "./toolErrorClassification";
import type { ToolAdapter, ToolAdapterInvokeArgs, ToolEvent } from "./ToolAdapter";

const COMMAND_INLINE_MAX = 120;

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
    error?:Readonly<{ message?:string }>;
    thread_id?:string;
    usage?:Readonly<{
        input_tokens?:number;
        cached_input_tokens?:number;
        output_tokens?:number;
        reasoning_output_tokens?:number;
    }>;
}>;

export type CodexAdapterContexts = Readonly<{
    script:ScriptContext;
    time:TimeContext;
    random:RandomContext;
}>;

export function formatCodexCommand(command:string|undefined):string {
    if (!command) return "";
    const firstLine = command.split("\n")[0]!;
    if (firstLine.length > COMMAND_INLINE_MAX) {
        return firstLine.slice(0, COMMAND_INLINE_MAX - 3) + "...";
    }
    return firstLine;
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
    private _usedResume = false;

    constructor(
        private _args:ToolAdapterInvokeArgs,
        private _contexts:CodexAdapterContexts
    ) {
        this._start(false);
    }

    private _start(useExecFallback:boolean):void {
        const isResume = !useExecFallback && !!this._args.resumeSessionId;
        this._usedResume = isResume;

        const argv = this._buildArgv(isResume);
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

            if (this._usedResume && !this._receivedAnyEvent && !this._fallbackAttempted) {
                this._fallbackAttempted = true;
                this._queue.push({
                    type: "output",
                    title: "Continuity lost",
                    subtitle: "",
                    details: "codex resume unavailable in installed CLI"
                });
                this._cleanup();
                this._sawTurnCompleted = false;
                this._receivedAnyEvent = false;
                this._usedResume = false;
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

    private _buildArgv(isResume:boolean):string[] {
        const argv:string[] = [];

        if (isResume) {
            argv.push("resume", this._args.resumeSessionId!);
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
            if (parsed.usage && this._args.onUsage) {
                this._args.onUsage({
                    inputTokens: parsed.usage.input_tokens ?? 0,
                    outputTokens: parsed.usage.output_tokens ?? 0
                });
            }
        } else if (parsed.type === "error") {
            this._handleFailure(typeof parsed.message === "string" ? parsed.message : "unknown error");
        } else if (parsed.type === "turn.failed") {
            this._handleFailure(typeof parsed.error?.message === "string" ? parsed.error.message : "unknown error");
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

    private _handleFailure(message:string):void {
        this._queue.push(classifyToolFailure(message, this._contexts.time, this._contexts.random));
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
