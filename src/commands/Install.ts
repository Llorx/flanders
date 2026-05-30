import type { AskContext, FsContext, OutputContext, ScriptContext } from "../contexts";
import { askChoice } from "../PromptHelper";
import { joinPath } from "../fsUtils";
import { planSkillBody, specSkillBody } from "../skills";
import type { PlatformContext } from "../Workspace";
import { verifyToolAvailability } from "./InstallAvailabilityCheck";

export type InstallContexts = Readonly<{
    fs:FsContext;
    ask:AskContext;
    output:OutputContext;
    platform:PlatformContext;
    script:ScriptContext;
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

export type ResolvedAnswers = Readonly<{
    scope?:"project"|"global";
    skillsTool?:"claude"|"codex"|"both";
    workerTool?:"claude"|"codex";
    workerModel?:string;
    workerEffort?:string;
    reviewerTool?:"claude"|"codex";
    reviewerModel?:string;
    reviewerEffort?:string;
}>;

function extractFlagValue(rawArgs:readonly string[], flag:string):string|undefined {
    const prefix = flag + "=";
    for (const arg of rawArgs) {
        if (arg.startsWith(prefix)) {
            return arg.slice(prefix.length);
        }
    }
    return undefined;
}

function validateClosedSet(value:string, allowed:readonly string[], flagName:string):string|null {
    if (allowed.includes(value)) {
        return null;
    }
    return `Invalid value for ${flagName}: "${value}". Allowed values: ${allowed.join(", ")}.\n`;
}

export function parseInstallFlags(rawArgs:readonly string[]):Readonly<{ok:true; answers:ResolvedAnswers}>|Readonly<{ok:false; diagnostic:string}> {
    const hasGlobal = rawArgs.includes("--global");
    const hasProject = rawArgs.includes("--project");
    if (hasGlobal && hasProject) {
        return { ok: false, diagnostic: "Conflicting flags: --global and --project cannot be used together.\n" };
    }
    const answers:{
        scope?:"project"|"global";
        skillsTool?:"claude"|"codex"|"both";
        workerTool?:"claude"|"codex";
        workerModel?:string;
        workerEffort?:string;
        reviewerTool?:"claude"|"codex";
        reviewerModel?:string;
        reviewerEffort?:string;
    } = {};
    if (hasProject) answers.scope = "project";
    if (hasGlobal) answers.scope = "global";
    const skillsTool = extractFlagValue(rawArgs, "--skills-tool");
    if (skillsTool !== undefined) {
        const error = validateClosedSet(skillsTool, ["claude", "codex", "both"], "--skills-tool");
        if (error) return { ok: false, diagnostic: error };
        answers.skillsTool = skillsTool as "claude"|"codex"|"both";
    }
    const workerTool = extractFlagValue(rawArgs, "--worker-tool");
    if (workerTool !== undefined) {
        const error = validateClosedSet(workerTool, ["claude", "codex"], "--worker-tool");
        if (error) return { ok: false, diagnostic: error };
        answers.workerTool = workerTool as "claude"|"codex";
    }
    const workerModel = extractFlagValue(rawArgs, "--worker-model");
    if (workerModel !== undefined) {
        answers.workerModel = workerModel;
    }
    const workerEffort = extractFlagValue(rawArgs, "--worker-effort");
    if (workerEffort !== undefined) {
        answers.workerEffort = workerEffort;
    }
    const reviewerTool = extractFlagValue(rawArgs, "--reviewer-tool");
    if (reviewerTool !== undefined) {
        const error = validateClosedSet(reviewerTool, ["claude", "codex"], "--reviewer-tool");
        if (error) return { ok: false, diagnostic: error };
        answers.reviewerTool = reviewerTool as "claude"|"codex";
    }
    const reviewerModel = extractFlagValue(rawArgs, "--reviewer-model");
    if (reviewerModel !== undefined) {
        answers.reviewerModel = reviewerModel;
    }
    const reviewerEffort = extractFlagValue(rawArgs, "--reviewer-effort");
    if (reviewerEffort !== undefined) {
        answers.reviewerEffort = reviewerEffort;
    }
    return { ok: true, answers };
}

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
            const parsed = parseInstallFlags(rawArgs);
            if (!parsed.ok) {
                contexts.output.writeError(parsed.diagnostic);
                return 1;
            }
            const answers = parsed.answers;
            let mode:"global"|"project";
            if (answers.scope) {
                mode = answers.scope;
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
            const selectedTools = new Set<"claude"|"codex">();
            if (answers.skillsTool === "both") {
                selectedTools.add("claude");
                selectedTools.add("codex");
            } else if (answers.skillsTool) {
                selectedTools.add(answers.skillsTool);
            }
            if (answers.workerTool) {
                selectedTools.add(answers.workerTool);
            }
            if (answers.reviewerTool) {
                selectedTools.add(answers.reviewerTool);
            }
            if (selectedTools.size > 0) {
                /* coverage ignore next 3 */ // — Defensive: with flag-supplied scope, code is synchronous here so dispose can't be set; with prompted scope, the earlier guard at _promptDestination catches it.
                if (this._disposed) {
                    return 1;
                }
                const report = await verifyToolAvailability(selectedTools, contexts.script);
                if (this._disposed) {
                    return 1;
                }
                const missing = report.filter(e => !e.available);
                if (missing.length > 0) {
                    for (const entry of missing) {
                        contexts.output.writeError(`${entry.reason}\n`);
                    }
                    return 1;
                }
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
        try {
            const option = await askChoice(contexts.ask, {
                header: "Install destination",
                question: "Where should Flanders skills be installed?",
                options: [
                    { label: "project", description: "Install in .claude/skills/ relative to CWD" },
                    { label: "global", description: "Install in ~/.claude/skills/" }
                ]
            });
            return option.label as "global"|"project";
        } catch (e) {
            if (e instanceof Error && e.name === "AbortError") {
                return null;
            }
            throw e;
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
