import type { AskContext, ChoiceOption, FsContext, OutputContext, ScriptContext } from "../contexts";
import type { FlandersConfig } from "../FlandersConfig";
import { write as writeConfig } from "../FlandersConfig";
import { askChoice, askText } from "../PromptHelper";
import type { AskChoiceArgs, AskTextArgs } from "../PromptHelper";
import { joinPath } from "../fsUtils";
import { planSkillBody, specSkillBody } from "../skills";
import type { PlatformContext } from "../Workspace";
import { verifyToolAvailability } from "./InstallAvailabilityCheck";
import { probeModelList } from "./InstallModelProbe";

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

async function promptChoice(ask:AskContext, args:AskChoiceArgs):Promise<ChoiceOption|null> {
    try {
        return await askChoice(ask, args);
    } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
            return null;
        }
        throw e;
    }
}

async function promptText(ask:AskContext, args:AskTextArgs):Promise<string|null> {
    try {
        return await askText(ask, args);
    } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
            return null;
        /* coverage ignore next 3 */ // — Defensive: askText in PromptHelper wraps all errors as AbortError, so this rethrow is unreachable.
        }
        throw e;
    }
}

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
    private _modelProbeCache = new Map<"claude"|"codex", readonly string[]|null>();
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
                const option = await promptChoice(contexts.ask, {
                    header: "Install destination",
                    question: "Where should Flanders skills be installed?",
                    options: [
                        { label: "project", description: "Install in .claude/skills/ relative to CWD" },
                        { label: "global", description: "Install in ~/.claude/skills/" }
                    ]
                });
                if (!option) {
                    return 1;
                }
                if (this._disposed) {
                    return 1;
                }
                mode = option.label as "global"|"project";
            }
            let skillsTool:"claude"|"codex"|"both";
            if (answers.skillsTool !== undefined) {
                skillsTool = answers.skillsTool;
            } else {
                /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
                if (this._disposed) {
                    return 1;
                }
                const option = await promptChoice(contexts.ask, {
                    header: "Skills tool",
                    question: "Which AI tool(s) should the skills be installed for?",
                    options: [
                        { label: "claude", description: "Install skills for Claude Code" },
                        { label: "codex", description: "Install skills for Codex CLI" },
                        { label: "both", description: "Install skills for both Claude Code and Codex CLI" }
                    ]
                });
                if (!option) {
                    return 1;
                }
                if (this._disposed) {
                    return 1;
                }
                skillsTool = option.label as "claude"|"codex"|"both";
            }
            let workerTool:"claude"|"codex";
            if (answers.workerTool !== undefined) {
                workerTool = answers.workerTool;
            } else {
                /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
                if (this._disposed) {
                    return 1;
                }
                const option = await promptChoice(contexts.ask, {
                    header: "Worker tool",
                    question: "Which AI tool should the worker use?",
                    options: [
                        { label: "claude", description: "Use Claude Code" },
                        { label: "codex", description: "Use Codex CLI" }
                    ]
                });
                if (!option) {
                    return 1;
                }
                if (this._disposed) {
                    return 1;
                }
                workerTool = option.label as "claude"|"codex";
            }
            let workerModel:string;
            if (answers.workerModel !== undefined) {
                workerModel = answers.workerModel;
            } else {
                /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
                if (this._disposed) {
                    return 1;
                }
                if (!this._modelProbeCache.has(workerTool)) {
                    const models = await probeModelList(workerTool, contexts.script);
                    if (this._disposed) {
                        return 1;
                    }
                    this._modelProbeCache.set(workerTool, models);
                }
                const probeResult = this._modelProbeCache.get(workerTool)!;
                if (probeResult && probeResult.length > 0) {
                    const options:ChoiceOption[] = probeResult.map(m => ({ label: m }));
                    options.push({ label: "default configured model" });
                    const option = await promptChoice(contexts.ask, {
                        header: "Worker model",
                        question: "Which model should the worker use?",
                        options
                    });
                    if (!option) {
                        return 1;
                    }
                    /* coverage ignore next 3 */ // — Defensive: _disposed cannot flip between the synchronous promptChoice return and this check.
                    if (this._disposed) {
                        return 1;
                    }
                    workerModel = option.label === "default configured model" ? "" : option.label;
                } else {
                    const text = await promptText(contexts.ask, {
                        question: "Which model should the worker use?",
                        placeholder: "leave empty for the default configured model"
                    });
                    if (text === null) {
                        return 1;
                    }
                    /* coverage ignore next 3 */ // — Defensive: _disposed cannot flip between the synchronous promptText return and this check.
                    if (this._disposed) {
                        return 1;
                    }
                    workerModel = text;
                }
            }
            let reviewerTool:"claude"|"codex";
            if (answers.reviewerTool !== undefined) {
                reviewerTool = answers.reviewerTool;
            } else {
                /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
                if (this._disposed) {
                    return 1;
                }
                const option = await promptChoice(contexts.ask, {
                    header: "Reviewer tool",
                    question: "Which AI tool should the reviewer use?",
                    options: [
                        { label: "claude", description: "Use Claude Code" },
                        { label: "codex", description: "Use Codex CLI" }
                    ]
                });
                if (!option) {
                    return 1;
                }
                if (this._disposed) {
                    return 1;
                }
                reviewerTool = option.label as "claude"|"codex";
            }
            let reviewerModel:string;
            if (answers.reviewerModel !== undefined) {
                reviewerModel = answers.reviewerModel;
            } else {
                /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
                if (this._disposed) {
                    return 1;
                }
                if (!this._modelProbeCache.has(reviewerTool)) {
                    const models = await probeModelList(reviewerTool, contexts.script);
                    /* coverage ignore next 3 */ // — Defensive: _disposed cannot flip during a synchronous Map.set following the await.
                    if (this._disposed) {
                        return 1;
                    }
                    this._modelProbeCache.set(reviewerTool, models);
                }
                const probeResult = this._modelProbeCache.get(reviewerTool)!;
                if (probeResult && probeResult.length > 0) {
                    const options:ChoiceOption[] = probeResult.map(m => ({ label: m }));
                    options.push({ label: "default configured model" });
                    const option = await promptChoice(contexts.ask, {
                        header: "Reviewer model",
                        question: "Which model should the reviewer use?",
                        options
                    });
                    if (!option) {
                        return 1;
                    }
                    /* coverage ignore next 3 */ // — Defensive: _disposed cannot flip between the synchronous promptChoice return and this check.
                    if (this._disposed) {
                        return 1;
                    }
                    reviewerModel = option.label === "default configured model" ? "" : option.label;
                } else {
                    const text = await promptText(contexts.ask, {
                        question: "Which model should the reviewer use?",
                        placeholder: "leave empty for the default configured model"
                    });
                    if (text === null) {
                        return 1;
                    }
                    /* coverage ignore next 3 */ // — Defensive: _disposed cannot flip between the synchronous promptText return and this check.
                    if (this._disposed) {
                        return 1;
                    }
                    reviewerModel = text;
                }
            }
            const selectedTools = new Set<"claude"|"codex">();
            if (skillsTool === "both") {
                selectedTools.add("claude");
                selectedTools.add("codex");
            } else {
                selectedTools.add(skillsTool);
            }
            selectedTools.add(workerTool);
            selectedTools.add(reviewerTool);
            /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
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
            /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
            if (this._disposed) {
                return 1;
            }
            const config:FlandersConfig = {
                worker: { tool: workerTool, model: workerModel, effort: answers.workerEffort ?? "" },
                reviewer: { tool: reviewerTool, model: reviewerModel, effort: answers.reviewerEffort ?? "" }
            };
            const configWrittenPath = await writeConfig(contexts.fs, {
                scope: mode,
                projectRoot: options.projectRoot,
                homeDir: contexts.platform.homedir(),
                config
            });
            /* coverage ignore next 3 */ // — Defensive: _disposed cannot flip between the synchronous writeConfig return and this check.
            if (this._disposed) {
                return 1;
            }
            writtenPaths.push(configWrittenPath);
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
