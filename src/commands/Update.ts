import type { FsContext, OutputContext } from "../contexts";
import type { PlatformContext } from "../workspace/Workspace";
import { skillArtifactPaths, writeSkillArtifacts } from "./skillArtifacts";

export type UpdateContexts = Readonly<{
    fs:FsContext;
    output:OutputContext;
    platform:PlatformContext;
}>;

export type UpdateOptions = Readonly<{
    projectRoot:string;
}>;

type Destination = Readonly<{ scopeRoot:string; tool:"claude"|"codex" }>;

// `update` refreshes the Flanders skills already delivered to the user's AI-tool environments. It is
// non-interactive: it never reads or writes `.flanders/config.json`, asks the user nothing, and uses
// no prompt helper. It scans the four destinations (the project and home scope roots crossed with the
// claude and codex tools), rewrites the full skill set at every destination that already holds at
// least one Flanders skill artifact through the shared `writeSkillArtifacts` emission path, and leaves
// untouched destinations the user never installed to. With no installation anywhere it points the user
// at `npx flanders install` and exits non-zero. It is a disposable owner: its only async resource is
// the in-flight run, which `dispose()` awaits and whose mid-run disposal stops further writes.
export class Update {
    private _disposed = false;
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
    private async _isInstalled(fs:FsContext, scopeRoot:string, tool:"claude"|"codex"):Promise<boolean> {
        for (const path of skillArtifactPaths(scopeRoot, tool)) {
            if (await fs.exists(path)) {
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
                if (this._disposed) {
                    return 1;
                }
                if (!(await this._isInstalled(contexts.fs, dest.scopeRoot, dest.tool))) {
                    continue;
                }
                found = true;
                const result = await writeSkillArtifacts(contexts.fs, dest.scopeRoot, dest.tool, () => this._disposed);
                if (!result.ok) {
                    if (result.diagnostic !== null) {
                        contexts.output.writeError(result.diagnostic);
                    }
                    return 1;
                }
                writtenPaths.push(...result.writtenPaths);
            }
            // A disposal observed during the write phase exits non-zero with no success output, even
            // when it lands while the final artifact write is in flight (after `writeSkillArtifacts`
            // has already returned `ok`). The per-artifact `isDisposed()` check inside the shared
            // writer cannot catch that last-write race, so this guard does (`disposables.md`).
            if (this._disposed) {
                return 1;
            }
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
    async dispose():Promise<void> {
        if (this._disposed) {
            try {
                await this._runPromise;
            /* coverage ignore next 2 */ // — Defensive: _run always resolves with a number, so this catch is unreachable.
            } catch {
            }
            return;
        }
        this._disposed = true;
        try {
            await this._runPromise;
        /* coverage ignore next 2 */ // — Defensive: _run always resolves with a number, so this catch is unreachable.
        } catch {
        }
    }
}
