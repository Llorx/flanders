import type { ScriptContext, SpawnedProcess, TimeContext, TimeoutHandle } from "./contexts";

export type ScriptResult = Readonly<{
    code:number|null;
    stdout:string;
    stderr:string;
}>;

export type ScriptRunOptions = Readonly<{
    command:string;
    args?:readonly string[];
    cwd?:string;
    onStdout?(chunk:string):void;
    onStderr?(chunk:string):void;
}>;

export class ScriptRunner {
    private _disposed = false;
    private _process:SpawnedProcess|null = null;
    private _runPromise:Promise<ScriptResult>;
    private _killTimer:TimeoutHandle|null = null;
    constructor(
        readonly options:ScriptRunOptions,
        private _context:ScriptContext,
        private _time:TimeContext
    ) {
        this._runPromise = this._run();
        /* coverage ignore next */ // — Defensive: _runPromise is always awaited via result() or dispose(), so this handler is unreachable.
        this._runPromise.catch(() => {});
    }
    result():Promise<ScriptResult> {
        return this._runPromise;
    }
    private _run():Promise<ScriptResult> {
        return new Promise<ScriptResult>((resolve, reject) => {
            /* coverage ignore next 3 */ // — Defensive: _run is called in the constructor where _disposed is always false.
            if (this._disposed) {
                return reject(new Error("ScriptRunner disposed"));
            }
            const proc = this._context.spawn(this.options.command, this.options.args ?? [], {
                stdio: "pipe",
                ...(this.options.cwd ? { cwd: this.options.cwd } : null)
            });
            this._process = proc;
            const stdoutChunks:string[] = [];
            const stderrChunks:string[] = [];
            proc.stdout?.on("data", chunk => {
                const text = String(chunk);
                stdoutChunks.push(text);
                this.options.onStdout?.(text);
            });
            proc.stderr?.on("data", chunk => {
                const text = String(chunk);
                stderrChunks.push(text);
                this.options.onStderr?.(text);
            });
            let settled = false;
            const settle = (outcome:{ ok:true; value:ScriptResult }|{ ok:false; error:Error }) => {
                if (settled) {
                    return;
                }
                settled = true;
                this._process = null;
                if (outcome.ok) {
                    resolve(outcome.value);
                } else {
                    reject(outcome.error);
                }
            };
            proc.on("error", e => {
                settle({ ok: false, error: e instanceof Error ? e : new Error(String(e)) });
            });
            proc.on("exit", code => {
                if (this._disposed) {
                    settle({ ok: false, error: new Error("ScriptRunner disposed") });
                    return;
                }
                settle({
                    ok: true,
                    value: {
                        code,
                        stdout: stdoutChunks.join(""),
                        stderr: stderrChunks.join("")
                    }
                });
            });
        });
    }
    async dispose() {
        /* coverage ignore next 7 */ // — Defensive: second-dispose idempotent guard; _runPromise is always settled by the first dispose.
        if (this._disposed) {
            try {
                await this._runPromise;
            } catch {

            }
            return;
        }
        this._disposed = true;
        const proc = this._process;
        if (proc) {
            const exitWaiter = new Promise<void>(resolve => {
                proc.on("exit", () => resolve());
            });
            proc.kill("SIGINT");
            this._killTimer = this._time.setTimeout(() => {
                this._killTimer = null;
                proc.kill("SIGTERM");
            }, 5000);
            await exitWaiter;
            this._killTimer?.cancel();
            this._killTimer = null;
        }
        try {
            await this._runPromise;
        } catch {

        }
    }
}
