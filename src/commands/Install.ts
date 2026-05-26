import type { AskContext, FsContext, OutputContext } from "../contexts";
import { joinPath } from "../fsUtils";
import { planSkillBody, specSkillBody } from "../skills";
import type { PlatformContext } from "../Workspace";

export type InstallContexts = Readonly<{
    fs:FsContext;
    ask:AskContext;
    output:OutputContext;
    platform:PlatformContext;
}>;

export type InstallOptions = Readonly<{
    projectRoot:string;
}>;

type SkillDef = Readonly<{
    name:string;
    folder:string;
    body:string;
}>;

const SKILLS:readonly SkillDef[] = [
    { name: "flanders-spec", folder: "flanders-spec", body: specSkillBody },
    { name: "flanders-plan", folder: "flanders-plan", body: planSkillBody }
];

export class Install {
    private _disposed = false;
    private _runPromise:Promise<number>;
    constructor(
        rawArgs:readonly string[],
        _options:InstallOptions,
        _contexts:InstallContexts
    ) {
        this._runPromise = this._run(rawArgs, _options, _contexts);
        /* coverage ignore next */ // — Defensive: _runPromise is always awaited via result() or dispose(), so this handler is unreachable.
        this._runPromise.catch(() => {});
    }
    result():Promise<number> {
        return this._runPromise;
    }
    private async _run(rawArgs:readonly string[], options:InstallOptions, contexts:InstallContexts):Promise<number> {
        try {
            const hasGlobal = rawArgs.includes("--global");
            const hasProject = rawArgs.includes("--project");
            if (hasGlobal && hasProject) {
                contexts.output.writeError("Conflicting flags: --global and --project cannot be used together.\n");
                return 1;
            }
            let mode:"global"|"project";
            if (hasGlobal) {
                mode = "global";
            } else if (hasProject) {
                mode = "project";
            } else {
                /* coverage ignore next 3 */ // — Defensive: _disposed is false when _run begins synchronously from the constructor.
                if (this._disposed) {
                    return 1;
                }
                const picked = await this._promptDestination(contexts);
                if (this._disposed) {
                    return 1;
                }
                if (!picked) {
                    return 1;
                }
                mode = picked;
            }
            const skillsRoot = mode === "global"
                ? joinPath(contexts.platform.homedir(), ".claude/skills")
                : joinPath(options.projectRoot, ".claude/skills");
            for (const skill of SKILLS) {
                /* coverage ignore next 4 */ // — Defensive: skill bodies are compile-time constants that are always non-empty.
                if (!skill.body) {
                    contexts.output.writeError(`Skill "${skill.name}" has no content.\n`);
                    return 1;
                }
            }
            const writtenPaths:string[] = [];
            for (const skill of SKILLS) {
                if (this._disposed) {
                    return 1;
                }
                const skillFolder = joinPath(skillsRoot, skill.folder);
                try {
                    await contexts.fs.mkdir(skillFolder, { recursive: true });
                } catch {
                    contexts.output.writeError(`Cannot create destination: ${skillFolder}\n`);
                    return 1;
                }
                const filePath = joinPath(skillFolder, "SKILL.md");
                try {
                    await contexts.fs.writeFile(filePath, skill.body);
                    writtenPaths.push(filePath);
                } catch {
                    contexts.output.writeError(`Cannot write file: ${filePath}\n`);
                    return 1;
                }
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
    private async _promptDestination(contexts:InstallContexts):Promise<"global"|"project"|null> {
        const [answer] = await contexts.ask.askChoices([{
            header: "Install destination",
            question: "Where should Flanders skills be installed?",
            options: [
                { label: "project", description: "Install in .claude/skills/ relative to CWD" },
                { label: "global", description: "Install in ~/.claude/skills/" }
            ],
            multiSelect: false
        }]);
        if (!answer || answer.picked.length === 0) {
            return null;
        }
        return answer.picked[0]!.label as "global"|"project";
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
