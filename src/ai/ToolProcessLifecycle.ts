import type { SpawnOptions } from "child_process";

import type { ScriptContext, SpawnedProcess, TimeContext, TimeoutHandle } from "../contexts";

const TOOL_PROCESS_EXIT_GRACE_MS = 10_000;

export type ToolProcessLifecycleHandlers = Readonly<{
    onExit(code:number|null, signal:string|null):void;
    onError(error:unknown):void;
}>;

export class ToolProcessLifecycle {
    readonly process:SpawnedProcess;

    private _disposed = false;
    private _errorListener:(error:unknown) => void;
    private _exited = false;
    private _exitListener:(code:number|null, signal:string|null) => void;
    private _exitPromise:Promise<void>;
    private _resolveExit:() => void = () => {};
    private _graceTimer:TimeoutHandle|null = null;
    private _terminalReady:(() => void)|null = null;
    private _terminationRequested = false;

    constructor(
        script:ScriptContext,
        command:string,
        args:readonly string[],
        options:SpawnOptions,
        private _time:TimeContext,
        handlers:ToolProcessLifecycleHandlers
    ) {
        this._exitPromise = new Promise<void>(resolve => {
            this._resolveExit = resolve;
        });
        this.process = script.spawn(command, args, options);
        this._exitListener = (code, signal) => {
            this._handleExit(code, signal, handlers.onExit);
        };
        this._errorListener = error => {
            this._handleError(error, handlers.onError);
        };
        this.process.on("exit", this._exitListener);
        this.process.on("error", this._errorListener);
    }

    finishAfterExit(terminalReady:() => void):void {
        if (this._disposed) {
            return;
        }
        if (this._exited) {
            terminalReady();
            return;
        }
        this._terminalReady = terminalReady;
        this._graceTimer = this._time.setTimeout(() => {
            this._graceTimer = null;
            this._requestTermination();
        }, TOOL_PROCESS_EXIT_GRACE_MS);
    }

    dispose():Promise<void> {
        if (this._disposed) {
            return this._exitPromise;
        }
        this._disposed = true;
        this._terminalReady = null;
        this._cancelGraceTimer();
        this._requestTermination();
        return this._exitPromise;
    }

    private _handleExit(
        code:number|null,
        signal:string|null,
        onExit:ToolProcessLifecycleHandlers["onExit"]
    ):void {
        if (this._exited) {
            return;
        }
        this._markExited();
        if (this._disposed) {
            return;
        }
        const terminalReady = this._terminalReady;
        this._terminalReady = null;
        onExit(code, signal);
        terminalReady?.();
    }

    private _handleError(error:unknown, onError:ToolProcessLifecycleHandlers["onError"]):void {
        if (this._exited) {
            return;
        }
        if (this.process.pid === undefined) {
            this._markExited();
            if (this._disposed) {
                return;
            }
            const terminalReady = this._terminalReady;
            this._terminalReady = null;
            onError(error);
            terminalReady?.();
            return;
        }
        if (!this._disposed) {
            onError(error);
        }
    }

    private _markExited():void {
        this._exited = true;
        this._cancelGraceTimer();
        this.process.off("error", this._errorListener);
        this.process.off("exit", this._exitListener);
        this._resolveExit();
    }

    private _cancelGraceTimer():void {
        if (this._graceTimer === null) {
            return;
        }
        this._graceTimer.cancel();
        this._graceTimer = null;
    }

    private _requestTermination():void {
        if (!this._exited && !this._terminationRequested) {
            this._terminationRequested = true;
            this.process.kill("SIGINT");
        }
    }
}
