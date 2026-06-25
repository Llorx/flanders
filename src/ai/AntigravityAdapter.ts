import type { SpawnOptions } from "child_process";

import type { FsContext, RandomContext, ScriptContext, SpawnedProcess, TimeContext } from "../contexts";
import { joinPath } from "../system/fsUtils";
import type { PlatformContext } from "../workspace/Workspace";
import {
    isRateLimitMessage,
    isRetryableHttpStatus,
    isRetryableTransport,
    synthesizeRateLimitEvent
} from "./toolErrorClassification";
import type { ToolAdapter, ToolAdapterInvokeArgs, ToolEvent } from "./ToolAdapter";

export type AntigravityAdapterContexts = Readonly<{
    script:ScriptContext;
    fs:FsContext;
    time:TimeContext;
    random:RandomContext;
    platform:PlatformContext;
}>;

// agy print mode bounds the prompt by the OS command-line length limit and exposes no stdin or
// prompt-file flag, so the adapter writes the full prompt to a file and passes agy a short directive
// (the --print value) that points it at the prompt file and names a sibling file to deposit its
// response in. Capturing the response from that file — rather than from agy's stdout, which agy
// suppresses when stdout is not a TTY — is the "other capture path" left to the implementer by
// src/ai/.spec/rules/runner.md. The directive carries no part of the prompt itself, so the prompt is
// never placed on the command line regardless of its size. Module-private: the directive is an
// implementation detail observed through the spawned argv, not part of the adapter's public surface.
function buildPromptDirective(promptPath:string, outputPath:string):string {
    return `Your full task instructions are in the file at "${promptPath}". Read that file and carry out everything it asks. When you have completely finished, write your complete final response as plain text to the file at "${outputPath}", and write nothing else to that file.`;
}

export class AntigravityAdapter implements ToolAdapter {
    constructor(private _contexts:AntigravityAdapterContexts) {}

    invoke(args:ToolAdapterInvokeArgs):AsyncIterable<ToolEvent> {
        const iter = new AntigravityAdapterIterator(args, this._contexts);
        return {
            [Symbol.asyncIterator]() {
                return iter;
            }
        };
    }
}

class AntigravityAdapterIterator implements AsyncIterator<ToolEvent> {
    private _proc:SpawnedProcess|null = null;
    private _queue:ToolEvent[] = [];
    private _done = false;
    private _aborted = false;
    private _exited = false;
    private _waitResolve:(() => void)|null = null;
    private _abortListener:(() => void)|null = null;
    private _exitPromise:Promise<void>|null = null;
    private _settlePromise:Promise<void>|null = null;
    private _writePromise:Promise<void>|null = null;
    private _stderrBuf = "";
    private _promptPath:string|null = null;
    private _outputPath:string|null = null;

    constructor(
        private _args:ToolAdapterInvokeArgs,
        private _contexts:AntigravityAdapterContexts
    ) {
        void this._start();
    }

    private async _start():Promise<void> {
        // Register the abort listener before any await so a cancellation that arrives during the
        // asynchronous prompt-file write is honored: it marks the call aborted and, if the child has
        // already been spawned, terminates its whole tree through the spawn handle.
        this._abortListener = () => {
            this._aborted = true;
            if (this._proc) {
                this._proc.kill("SIGINT");
            }
            this._done = true;
            this._wake();
        };
        if (this._args.abortSignal.aborted) {
            this._abortListener();
            return;
        }
        this._args.abortSignal.addEventListener("abort", this._abortListener, { once: true });

        const tmp = this._contexts.platform.tmpdir();
        const token = `${this._contexts.time.now().toString(36)}-${Math.floor(this._contexts.random.random() * 0x100000000).toString(36)}`;
        this._promptPath = joinPath(tmp, `flanders-agy-${token}.prompt.txt`);
        this._outputPath = joinPath(tmp, `flanders-agy-${token}.response.txt`);

        // Track the write so teardown can wait for it: if a cancellation removes the temp files
        // while this write is still in flight, removing them before the write settles would let the
        // write recreate the prompt file with nothing left to clean it up (see _doSettle).
        this._writePromise = this._contexts.fs.writeFile(this._promptPath, this._args.prompt);
        try {
            await this._writePromise;
        } catch {
            // A cancellation may have fired while the write was pending and the write then rejected.
            // A cancelled invocation must end without producing a result (neither success nor a
            // non-retryable error) per src/ai/.spec/contracts/ai-runner.md, so suppress the
            // write-failure error in that case; the abort listener has already marked the call done.
            if (!this._aborted) {
                this._queue.push({ type: "error", retryable: false, message: "failed to write antigravity prompt file" });
                this._done = true;
                this._wake();
            }
            return;
        }

        if (this._aborted) {
            return;
        }

        const argv = this._buildArgv(this._promptPath, this._outputPath);
        const spawnOptions:SpawnOptions = { stdio: "pipe" };
        const proc = this._contexts.script.spawn("agy", argv, spawnOptions);
        this._proc = proc;

        let exitResolve:(() => void)|null = null;
        this._exitPromise = new Promise<void>(resolve => { exitResolve = resolve; });

        proc.stderr?.on("data", (chunk:Buffer|string) => {
            this._stderrBuf += String(chunk);
        });

        proc.on("error", (e:unknown) => {
            // Ignore a stray error once the call is over (aborted) or once exit has already been
            // observed — the terminal event for this invocation is decided exactly once.
            if (this._done || this._exited) {
                exitResolve?.();
                return;
            }
            const err = e instanceof Error ? e : new Error(String(e));
            const message = (err as {code?:string}).code === "ENOENT" ? "agy binary not found" : err.message;
            this._queue.push({ type: "error", retryable: false, message });
            this._done = true;
            this._wake();
            exitResolve?.();
        });

        proc.on("exit", (code:number|null, signal:string|null) => {
            if (this._done) {
                exitResolve?.();
                return;
            }
            this._exited = true;
            void this._finalize(code, signal).finally(() => exitResolve?.());
        });
    }

    private _buildArgv(promptPath:string, outputPath:string):string[] {
        const argv:string[] = [];

        argv.push("--print", buildPromptDirective(promptPath, outputPath));
        argv.push("--dangerously-skip-permissions");

        if (this._args.model) {
            argv.push("--model", this._args.model);
        }

        if (this._args.resumeSessionId) {
            argv.push("--conversation", this._args.resumeSessionId);
        }

        return argv;
    }

    private async _finalize(code:number|null, signal:string|null):Promise<void> {
        if (signal === null && code === 0) {
            let response = "";
            try {
                response = await this._contexts.fs.readFile(this._outputPath!);
            } catch {
                response = "";
            }
            if (this._aborted) {
                return;
            }
            if (response.length > 0) {
                this._queue.push({ type: "output", title: "Assistant", subtitle: "", details: response });
                this._queue.push({ type: "done" });
            } else {
                this._queue.push({ type: "error", retryable: true, message: "antigravity produced no response" });
            }
        } else {
            this._classifyExit(code, signal);
        }
        this._done = true;
        this._wake();
    }

    private _classifyExit(code:number|null, signal:string|null):void {
        const stderr = this._stderrBuf.trim();
        if (isRateLimitMessage(stderr)) {
            this._queue.push(synthesizeRateLimitEvent(this._contexts.time, this._contexts.random));
        } else if (isRetryableHttpStatus(stderr) || isRetryableTransport(stderr)) {
            this._queue.push({ type: "error", retryable: true, message: stderr });
        } else if (signal !== null) {
            this._queue.push({ type: "error", retryable: true, message: `antigravity terminated by signal ${signal}` });
        } else {
            const message = stderr.length > 0 ? stderr : `antigravity exited with code ${code}`;
            this._queue.push({ type: "error", retryable: false, message });
        }
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
                await this._settle();
                return { value: undefined as unknown as ToolEvent, done: true };
            }
            await this._wait();
        }
    }

    async return():Promise<IteratorResult<ToolEvent>> {
        this._aborted = true;
        this._done = true;
        if (this._proc) {
            this._proc.kill("SIGINT");
        }
        await this._settle();
        return { value: undefined as unknown as ToolEvent, done: true };
    }

    private _settle():Promise<void> {
        if (!this._settlePromise) {
            this._settlePromise = this._doSettle();
        }
        return this._settlePromise;
    }

    private async _doSettle():Promise<void> {
        if (this._abortListener) {
            this._args.abortSignal.removeEventListener("abort", this._abortListener);
            this._abortListener = null;
        }
        // Wait for the in-flight prompt-file write to settle before removing the temp files, so a
        // write that completes after cancellation cannot recreate a file we already removed. The
        // write may legitimately reject (e.g. a write failure already surfaced as a terminal error);
        // either way nothing remains to clean up beyond the rm calls below.
        if (this._writePromise) {
            try {
                await this._writePromise;
            } catch {
                // The write failed; no prompt file was created, so the rm below is a harmless no-op.
            }
        }
        if (this._exitPromise) {
            await this._exitPromise;
        }
        if (this._promptPath) {
            await this._contexts.fs.rm(this._promptPath, { force: true });
            this._promptPath = null;
        }
        if (this._outputPath) {
            await this._contexts.fs.rm(this._outputPath, { force: true });
            this._outputPath = null;
        }
    }
}
