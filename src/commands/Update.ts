import type { FsContext, OutputContext } from "../contexts";
import type { ToolName } from "../ai/ToolAdapter";
import { disposeOnce } from "../disposeOnce";
import type { PlatformContext } from "../workspace/Workspace";
import { skillArtifactPaths, writeSkillArtifacts } from "./skillArtifacts";
import { abortError } from "../abortError";

export type UpdateContexts = Readonly<{
    fs:FsContext;
    output:OutputContext;
    platform:PlatformContext;
}>;

export type UpdateOptions = Readonly<{
    projectRoot:string;
}>;

type Destination = Readonly<{ scopeRoot:string; tool:ToolName }>;

export class Update {
    private _disposed = false;
    private _skillArtifactControllers = new Set<AbortController>();
    private _runPromise:Promise<number>;
    constructor(
        rawArgs:readonly string[],
        options:UpdateOptions,
        contexts:UpdateContexts
    ) {
        this._runPromise = this._run(rawArgs, options, contexts);
        /* coverage ignore next */ // — Defensive: _runPromise is always awaited via result() or dispose(), so this handler is unreachable.
        this._runPromise.catch(() => {});
    }
    result():Promise<number> {
        return this._runPromise;
    }
    private _throwIfDisposed():void {
        if (this._disposed) {
            throw abortError();
        }
    }
    private async _isInstalled(fs:FsContext, scopeRoot:string, tool:ToolName):Promise<boolean> {
        for (const path of skillArtifactPaths(scopeRoot, tool)) {
            const exists = await fs.exists(path);
            this._throwIfDisposed();
            if (exists) {
                return true;
            }
        }
        return false;
    }
    private async _run(rawArgs:readonly string[], options:UpdateOptions, contexts:UpdateContexts):Promise<number> {
        try {
            // `update` takes no flags or arguments (`.spec/contracts/cli-commands/update.md`); the
            // command owns its own argument validation (`.spec/contracts/overview.md`), rejecting any
            // extra argument with a non-zero exit instead of silently ignoring it.
            if (rawArgs.length > 0) {
                contexts.output.writeError("The update command takes no arguments.\n");
                return 1;
            }
            const homeDir = contexts.platform.homedir();
            const destinations:readonly Destination[] = [
                { scopeRoot: options.projectRoot, tool: "claude" },
                { scopeRoot: options.projectRoot, tool: "codex" },
                { scopeRoot: homeDir, tool: "claude" },
                { scopeRoot: homeDir, tool: "codex" }
            ];
            const writtenPaths:string[] = [];
            let found = false;
            for (const dest of destinations) {
                this._throwIfDisposed();
                const installed = await this._isInstalled(contexts.fs, dest.scopeRoot, dest.tool);
                this._throwIfDisposed();
                if (!installed) {
                    continue;
                }
                found = true;
                const controller = new AbortController();
                this._skillArtifactControllers.add(controller);
                let result;
                try {
                    result = await writeSkillArtifacts(contexts.fs, dest.scopeRoot, dest.tool, controller.signal);
                    this._throwIfDisposed();
                } finally {
                    this._skillArtifactControllers.delete(controller);
                }
                if (!result.ok) {
                    contexts.output.writeError(result.diagnostic);
                    return 1;
                }
                writtenPaths.push(...result.writtenPaths);
            }
            this._throwIfDisposed();
            if (!found) {
                contexts.output.writeError("Well, hi-diddly-ho! There are no Flanders skills installed anywhere to refresh. Run npx flanders install to set them up first.\n");
                return 1;
            }
            for (const p of writtenPaths) {
                contexts.output.write(`${p}\n`);
            }
            return 0;
        } catch (e) {
            if (!this._disposed) {
                contexts.output.writeError(`${e instanceof Error ? e.message : String(e)}\n`);
            }
            return 1;
        }
    }
    dispose():Promise<void> {
        return this._dispose();
    }
    private _dispose = disposeOnce(async () => {
        this._disposed = true;
        for (const controller of this._skillArtifactControllers) {
            controller.abort();
        }
        this._skillArtifactControllers.clear();
        try {
            await this._runPromise;
        /* coverage ignore next 2 */ // — Defensive: _run always resolves with a number, so this catch is unreachable.
        } catch {
        }
    });
}
