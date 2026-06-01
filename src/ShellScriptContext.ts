import type { ScriptContext, SpawnedProcess } from "./contexts";
import type { PlatformContext } from "./Workspace";

type SpawnOpts = Parameters<ScriptContext["spawn"]>[2];

export interface RawSpawnedReadable {
    on(event:"data", listener:(chunk:Buffer|string) => void):void;
}

export interface RawSpawnedStdin {
    write(chunk:string):unknown;
    end():void;
}

export interface RawSpawnedChild {
    pid:number;
    stdout?:RawSpawnedReadable|null;
    stderr?:RawSpawnedReadable|null;
    stdin?:RawSpawnedStdin|null;
    on(event:"exit", listener:(code:number|null, signal:string|null) => void):void;
    on(event:"error", listener:(e:unknown) => void):void;
    kill(signal:"SIGINT"|"SIGTERM"):void;
}

export interface RawSpawner {
    (command:string, args:readonly string[], options:SpawnOpts):RawSpawnedChild;
}

export interface KillPrimitive {
    (pid:number, signal:"SIGINT"|"SIGTERM"):void;
}

export class ShellScriptContext implements ScriptContext {
    constructor(
        private _rawSpawn:RawSpawner,
        private _kill:KillPrimitive,
        private _platform:PlatformContext
    ) {}

    spawn(command:string, args:readonly string[], options:SpawnOpts):SpawnedProcess {
        const isWindows = this._platform.isWindows();
        const child = this._shellLaunch(command, args, options, isWindows);
        const pid = child.pid;
        const proc:SpawnedProcess = {
            on(event, listener) {
                if (event === "exit") {
                    child.on(event, listener as (code:number|null, signal:string|null) => void);
                } else {
                    child.on(event, listener as (e:unknown) => void);
                }
            },
            kill: (signal) => {
                if (isWindows) {
                    this._shellLaunch("taskkill", ["/pid", String(pid), "/t", "/f"], {}, true);
                } else {
                    this._kill(-pid, signal);
                }
            },
            stdout: child.stdout ? {
                on(event, listener) {
                    child.stdout!.on(event, listener);
                }
            } : undefined,
            stderr: child.stderr ? {
                on(event, listener) {
                    child.stderr!.on(event, listener);
                }
            } : undefined,
            stdin: child.stdin ? {
                write(chunk) {
                    child.stdin!.write(chunk);
                },
                end() {
                    child.stdin!.end();
                }
            } : undefined
        };
        return proc;
    }

    private _shellLaunch(command:string, args:readonly string[], options:SpawnOpts, isWindows:boolean):RawSpawnedChild {
        const escapedArgs = args.map(a => isWindows ? this._escapeWindowsArg(a) : this._escapePosixArg(a));
        const spawnOptions:SpawnOpts = isWindows
            ? { ...options, shell: true }
            : { ...options, shell: true, detached: true };
        return this._rawSpawn(command, escapedArgs, spawnOptions);
    }

    private _escapePosixArg(arg:string):string {
        return `'${arg.replace(/'/g, "'\\''")}'`;
    }

    private _escapeWindowsArg(arg:string):string {
        let escaped = arg.replace(/(\\*)"/g, '$1$1\\"');
        escaped = escaped.replace(/(\\*)$/, '$1$1');
        escaped = `"${escaped}"`;
        return escaped.replace(/[()%!^"<>&|]/g, c => `^${c}`);
    }
}
