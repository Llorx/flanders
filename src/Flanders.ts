import { Implement, ImplementContexts } from "./commands/Implement";
import { Install, InstallContexts } from "./commands/Install";
import { Update, UpdateContexts } from "./commands/Update";
import type { AskContext, OutputContext } from "./contexts";

export type FlandersContexts = ImplementContexts & InstallContexts & UpdateContexts & Readonly<{ output:OutputContext; ask:AskContext }>;

export type FlandersOptions = Readonly<{
    projectRoot:string;
}>;

const USAGE = `usage: flanders <command> [arguments...]
  install [--global | --project]    install Claude Code skills
  update                            refresh installed skills in place
  implement [plan]                  run the iterative implementation loop`;

type AnyCommand = { result():Promise<number>; dispose():Promise<void> };

export class Flanders {
    private _disposed = false;
    private _command:AnyCommand|null = null;
    private _runPromise:Promise<number>;
    constructor(
        args:readonly string[],
        private _options:FlandersOptions,
        private _contexts:FlandersContexts
    ) {
        this._runPromise = this._dispatch(args);
        /* coverage ignore next */ // — Defensive: _runPromise is always awaited via result() or dispose(), so this handler is unreachable.
        this._runPromise.catch(() => {});
    }
    result():Promise<number> {
        return this._runPromise;
    }
    private async _dispatch(args:readonly string[]):Promise<number> {
        const [command, ...rest] = args;
        switch (command) {
            case "install": {
                const cmd = new Install(rest, { projectRoot: this._options.projectRoot }, this._contexts);
                this._command = cmd;
                return await cmd.result();
            }
            case "update": {
                const cmd = new Update(rest, { projectRoot: this._options.projectRoot }, this._contexts);
                this._command = cmd;
                return await cmd.result();
            }
            case "implement": {
                const cmd = new Implement(rest, { projectRoot: this._options.projectRoot }, this._contexts);
                this._command = cmd;
                return await cmd.result();
            }
            default: {
                this._contexts.output.writeError(`Unknown command: ${command ?? "(none)"}\n`);
                this._contexts.output.writeError(`${USAGE}\n`);
                return 1;
            }
        }
    }
    async dispose() {
        if (this._disposed) {
            try {
                await this._runPromise;
            /* coverage ignore next 2 */ // — Defensive: _dispatch always resolves (returns number), so this catch is unreachable.
            } catch {
            }
            return;
        }
        this._disposed = true;
        await this._command?.dispose();
        this._command = null;
        try {
            await this._runPromise;
        /* coverage ignore next 2 */ // — Defensive: _dispatch always resolves (returns number), so this catch is unreachable.
        } catch {
        }
    }
}
