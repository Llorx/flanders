import { Implement, ImplementContexts } from "./commands/Implement";
import { Install, InstallContexts } from "./commands/Install";
import { Update, UpdateContexts } from "./commands/Update";
import type { AskContext, OutputContext } from "./contexts";
import { disposeOnce } from "./disposeOnce";

export type FlandersContexts = ImplementContexts & InstallContexts & UpdateContexts & Readonly<{ output:OutputContext; ask:AskContext }>;

export type FlandersOptions = Readonly<{
    projectRoot:string;
}>;

const USAGE = `usage: flanders <command> [arguments...]
  install [--global | --project]    install Claude Code skills
  update                            refresh installed skills in place
  implement [plan]                  run the iterative implementation loop`;

type AnyCommand = { result():Promise<number>; dispose():Promise<void>; output?():OutputContext };

export class Flanders {
    private _command:AnyCommand|null = null;
    // The same command as `_command`, kept for reporting alone: teardown drops `_command` before
    // disposing it so nothing can reach a command being torn down, yet a diagnostic escaping that
    // disposal still has to reach the output channel that command owns.
    private _outputOwner:AnyCommand|null = null;
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
    output():OutputContext {
        return this._outputOwner?.output?.() ?? this._contexts.output;
    }
    private async _runCommand(cmd:AnyCommand):Promise<number> {
        this._command = cmd;
        this._outputOwner = cmd;
        return await cmd.result();
    }
    private async _dispatch(args:readonly string[]):Promise<number> {
        const [command, ...rest] = args;
        const options = { projectRoot: this._options.projectRoot };
        switch (command) {
            case "install": {
                return await this._runCommand(new Install(rest, options, this._contexts));
            }
            case "update": {
                return await this._runCommand(new Update(rest, options, this._contexts));
            }
            case "implement": {
                return await this._runCommand(new Implement(rest, options, this._contexts));
            }
            default: {
                this._contexts.output.writeError(`Unknown command: ${command ?? "(none)"}\n`);
                this._contexts.output.writeError(`${USAGE}\n`);
                return 1;
            }
        }
    }
    dispose():Promise<void> {
        return this._dispose();
    }
    private _dispose = disposeOnce(async () => {
        const command = this._command;
        this._command = null;
        await command?.dispose();
        this._outputOwner = null;
        try {
            await this._runPromise;
        /* coverage ignore next 2 */ // — Defensive: _dispatch always resolves (returns number), so this catch is unreachable.
        } catch {
        }
    });
}
