import type { SpawnOptions } from "child_process";

import type { RandomContext, ScriptContext, TimeContext } from "../contexts";
import { classifyToolFailure, UNKNOWN_TOOL_ERROR_MESSAGE } from "./toolErrorClassification";
import type { ToolAdapter, ToolAdapterInvokeArgs, ToolEvent, ToolTerminalEvent } from "./ToolAdapter";
import { ToolProcessLifecycle } from "./ToolProcessLifecycle";

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
    private _capturedSessionId:string|null = null;
    private _queue:ToolEvent[] = [];
    private _done = false;
    private _waitResolve:(() => void)|null = null;
    private _abortListener:(() => void)|null = null;
    private _pendingTerminal:ToolTerminalEvent|null = null;
    private _processLifecycle:ToolProcessLifecycle|null = null;

    private _receivedAnyEvent = false;
    private _usedResume = false;

    constructor(
        private _args:ToolAdapterInvokeArgs,
        private _contexts:CodexAdapterContexts
    ) {
        this._start();
    }

    private _start():void {
        const isResume = !!this._args.resumeSessionId;
        this._usedResume = isResume;

        const argv = this._buildArgv(isResume);
        const spawnOptions:SpawnOptions = { stdio: "pipe" };
        const processLifecycle = new ToolProcessLifecycle(
            this._contexts.script,
            "codex",
            argv,
            spawnOptions,
            this._contexts.time,
            {
                onExit: (code, signal) => this._handleProcessExit(code, signal),
                onError: error => this._handleProcessError(error)
            }
        );
        this._processLifecycle = processLifecycle;
        const proc = processLifecycle.process;

        proc.stdin?.write(this._args.prompt);
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
        if ((err as {code?:string}).code === "ENOENT") {
            this._finishWithTerminal({ type: "error", retryable: false, message: "codex binary not found" });
        } else {
            this._finishWithTerminal({ type: "error", retryable: false, message: err.message });
        }
    }

    private _handleProcessExit(code:number|null, signal:string|null):void {
        if (this._done || this._pendingTerminal) {
            return;
        }
        if (signal) {
            this._finishWithTerminal({
                type: "error",
                retryable: true,
                message: `codex terminated by signal ${signal}`
            });
        } else if (this._usedResume && !this._receivedAnyEvent) {
            this._finishWithTerminal({
                type: "error",
                retryable: false,
                message: "codex exec resume unavailable in installed CLI"
            });
        } else {
            this._finishWithTerminal({
                type: "error",
                retryable: true,
                message: `codex exited unexpectedly (code ${code} signal ${signal})`
            });
        }
    }

    private _buildArgv(isResume:boolean):string[] {
        const argv:string[] = [];

        if (isResume) {
            argv.push("exec", "resume", this._args.resumeSessionId!);
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
        if (this._done || this._pendingTerminal) return;

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
            if (parsed.usage && this._args.onUsage) {
                // `turn.completed.usage` is a session-cumulative running total. On a resumed
                // invocation it already includes every token the session's prior invocations
                // consumed, so the prior cumulative (priorSessionUsage) is subtracted to report
                // this invocation's own consumption. A fresh invocation has no baseline to subtract.
                const base = this._usedResume ? this._args.priorSessionUsage : undefined;
                this._args.onUsage({
                    inputTokens: (parsed.usage.input_tokens ?? 0) - (base?.inputTokens ?? 0),
                    outputTokens: (parsed.usage.output_tokens ?? 0) - (base?.outputTokens ?? 0)
                });
            }
            this._finishWithTerminal({ type: "done" });
        } else if (parsed.type === "error") {
            this._handleFailure(typeof parsed.message === "string" ? parsed.message : UNKNOWN_TOOL_ERROR_MESSAGE);
        } else if (parsed.type === "turn.failed") {
            this._handleFailure(typeof parsed.error?.message === "string" ? parsed.error.message : UNKNOWN_TOOL_ERROR_MESSAGE);
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
        this._finishWithTerminal(classifyToolFailure(message, this._contexts.time, this._contexts.random));
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
