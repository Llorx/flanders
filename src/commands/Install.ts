import type { AskContext, ChoiceOption, FsContext, OutputContext, ScriptContext } from "../contexts";
import type { FlandersConfig, FlandersRole } from "../workspace/FlandersConfig";
import { write as writeConfig } from "../workspace/FlandersConfig";
import { askChoice, askText } from "../ui/PromptHelper";
import type { AskChoiceArgs, AskTextArgs } from "../ui/PromptHelper";
import { joinPath } from "../system/fsUtils";
import { planSkillBody, specSkillBody } from "../prompts/skills";
import type { PlatformContext } from "../workspace/Workspace";
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
    body:string;
}>;

const SKILLS:readonly SkillDef[] = [
    { name: "flanders-spec", body: specSkillBody },
    { name: "flanders-plan", body: planSkillBody }
];

export function stripYamlFrontmatter(body:string):string {
    if (!body.startsWith("---\n") && !body.startsWith("---\r\n")) {
        return body;
    }
    const newlineAfterOpener = body.indexOf("\n") + 1;
    const closerIndex = body.indexOf("\n---\n", newlineAfterOpener);
    if (closerIndex === -1) {
        const closerCrlf = body.indexOf("\n---\r\n", newlineAfterOpener);
        if (closerCrlf === -1) {
            return body;
        }
        return body.slice(closerCrlf + "\n---\r\n".length);
    }
    return body.slice(closerIndex + "\n---\n".length);
}

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

type ReviewerFlagAnswers = Readonly<{
    tool?:"claude"|"codex";
    model?:string;
    effort?:string;
}>;

export type ResolvedAnswers = Readonly<{
    scope?:"project"|"global";
    skillsTool?:"claude"|"codex"|"both";
    workerTool?:"claude"|"codex";
    workerModel?:string;
    workerEffort?:string;
    reviewers?:readonly ReviewerFlagAnswers[];
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

const CODEX_EFFORT_LEVELS:readonly string[] = ["minimal", "low", "medium", "high", "xhigh"];

const CLAUDE_EFFORT_LEVELS:readonly string[] = ["low", "medium", "high", "xhigh", "max"];

const CLAUDE_MODEL_ALIASES:readonly string[] = ["best", "fable", "opus", "opus[1m]", "sonnet", "sonnet[1m]", "haiku", "opusplan"];

const REVIEWER_INDEXED_RE = /^--reviewer-(\d+)-(tool|model|effort)=/;

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
        reviewers?:readonly ReviewerFlagAnswers[];
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
        if (workerEffort !== "" && answers.workerTool === "codex") {
            const error = validateClosedSet(workerEffort, CODEX_EFFORT_LEVELS, "--worker-effort");
            if (error) return { ok: false, diagnostic: error };
        }
        answers.workerEffort = workerEffort;
    }
    const reviewerIndices = new Map<number, { tool?:"claude"|"codex"; model?:string; effort?:string }>();
    const reviewer1Tool = extractFlagValue(rawArgs, "--reviewer-tool");
    const reviewer1Model = extractFlagValue(rawArgs, "--reviewer-model");
    const reviewer1Effort = extractFlagValue(rawArgs, "--reviewer-effort");
    if (reviewer1Tool !== undefined) {
        const error = validateClosedSet(reviewer1Tool, ["claude", "codex"], "--reviewer-tool");
        if (error) return { ok: false, diagnostic: error };
        if (!reviewerIndices.has(1)) reviewerIndices.set(1, {});
        reviewerIndices.get(1)!.tool = reviewer1Tool as "claude"|"codex";
    }
    if (reviewer1Model !== undefined) {
        if (!reviewerIndices.has(1)) reviewerIndices.set(1, {});
        reviewerIndices.get(1)!.model = reviewer1Model;
    }
    if (reviewer1Effort !== undefined) {
        const tool1 = reviewerIndices.get(1)?.tool;
        if (reviewer1Effort !== "" && tool1 === "codex") {
            const error = validateClosedSet(reviewer1Effort, CODEX_EFFORT_LEVELS, "--reviewer-effort");
            if (error) return { ok: false, diagnostic: error };
        }
        if (!reviewerIndices.has(1)) reviewerIndices.set(1, {});
        reviewerIndices.get(1)!.effort = reviewer1Effort;
    }
    // First pass: collect every indexed reviewer flag without effort-against-tool validation,
    // since the tool flag may appear after the effort flag in argv (`rules/install/effort-set-discovery.md`
    // requires the codex closed set to be enforced regardless of argv order).
    for (const arg of rawArgs) {
        const match = arg.match(REVIEWER_INDEXED_RE);
        if (!match) continue;
        const idx = Number(match[1]);
        if (idx < 2) {
            return { ok: false, diagnostic: `Invalid reviewer flag: "${arg}". Reviewer 1 uses --reviewer-tool/-model/-effort; --reviewer-N-* requires N >= 2.\n` };
        }
        const field = match[2]!;
        const value = arg.slice(arg.indexOf("=") + 1);
        if (!reviewerIndices.has(idx)) reviewerIndices.set(idx, {});
        const entry = reviewerIndices.get(idx)!;
        if (field === "tool") {
            const error = validateClosedSet(value, ["claude", "codex"], `--reviewer-${idx}-tool`);
            if (error) return { ok: false, diagnostic: error };
            entry.tool = value as "claude"|"codex";
        } else if (field === "model") {
            entry.model = value;
        } else {
            entry.effort = value;
        }
    }
    // Second pass: validate every collected effort against its now-known tool.
    for (const [idx, entry] of reviewerIndices) {
        if (entry.effort !== undefined && entry.effort !== "" && entry.tool === "codex") {
            const error = validateClosedSet(entry.effort, CODEX_EFFORT_LEVELS, `--reviewer-${idx}-effort`);
            if (error) return { ok: false, diagnostic: error };
        }
    }
    if (reviewerIndices.size > 0) {
        const sortedIndices = [...reviewerIndices.keys()].sort((a, b) => a - b);
        const maxIdx = sortedIndices[sortedIndices.length - 1]!;
        for (let i = 1; i <= maxIdx; i++) {
            if (!reviewerIndices.has(i)) {
                return { ok: false, diagnostic: `Reviewer flag indices are not contiguous: missing reviewer ${i}. Indexed reviewer flags must form a contiguous run starting at reviewer 1.\n` };
            }
        }
        const list:ReviewerFlagAnswers[] = [];
        for (let i = 1; i <= maxIdx; i++) {
            list.push(reviewerIndices.get(i)!);
        }
        answers.reviewers = list;
    }
    return { ok: true, answers };
}

export class Install {
    private _disposed = false;
    private _modelProbeCache = new Map<"codex", readonly string[]|null>();
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
    private async _resolveCuratedChoice(headerLabel:string, question:string, curatedValues:readonly string[], defaultLabel:string, customLabel:string, customPlaceholder:string, contexts:InstallContexts):Promise<string|null> {
        const options:ChoiceOption[] = curatedValues.map(v => ({ label: v }));
        options.push({ label: defaultLabel });
        options.push({ label: customLabel });
        const option = await promptChoice(contexts.ask, {
            header: headerLabel,
            question,
            options
        });
        if (!option) {
            return null;
        }
        if (this._disposed) {
            return null;
        }
        if (option.label === defaultLabel) {
            return "";
        }
        if (option.label === customLabel) {
            const text = await promptText(contexts.ask, {
                question,
                placeholder: customPlaceholder
            });
            if (text === null) {
                return null;
            }
            if (this._disposed) {
                return null;
            }
            return text;
        }
        return option.label;
    }
    private async _resolveRoleModel(roleLabel:string, headerLabel:string, tool:"claude"|"codex", suppliedModel:string|undefined, contexts:InstallContexts):Promise<string|null> {
        if (suppliedModel !== undefined) {
            return suppliedModel;
        }
        /* coverage ignore next 3 */ // — Defensive: callers already checked _disposed; no await between previous guard and this entry.
        if (this._disposed) {
            return null;
        }
        if (tool === "claude") {
            return await this._resolveCuratedChoice(
                headerLabel,
                `Which model should ${roleLabel} use?`,
                CLAUDE_MODEL_ALIASES,
                "default configured model",
                "enter a custom value…",
                "leave empty for the default configured model",
                contexts
            );
        }
        if (!this._modelProbeCache.has(tool)) {
            const models = await probeModelList(contexts.script);
            if (this._disposed) {
                return null;
            }
            this._modelProbeCache.set(tool, models);
        }
        const probeResult = this._modelProbeCache.get(tool)!;
        if (probeResult && probeResult.length > 0) {
            const options:ChoiceOption[] = probeResult.map(m => ({ label: m }));
            options.push({ label: "default configured model" });
            const option = await promptChoice(contexts.ask, {
                header: headerLabel,
                question: `Which model should ${roleLabel} use?`,
                options
            });
            if (!option) {
                return null;
            }
            /* coverage ignore next 3 */ // — Defensive: _disposed cannot flip between the synchronous promptChoice return and this check.
            if (this._disposed) {
                return null;
            }
            return option.label === "default configured model" ? "" : option.label;
        }
        const text = await promptText(contexts.ask, {
            question: `Which model should ${roleLabel} use?`,
            placeholder: "leave empty for the default configured model"
        });
        if (text === null) {
            return null;
        }
        /* coverage ignore next 3 */ // — Defensive: _disposed cannot flip between the synchronous promptText return and this check.
        if (this._disposed) {
            return null;
        }
        return text;
    }
    private async _resolveRoleEffort(roleLabel:string, headerLabel:string, tool:"claude"|"codex", suppliedEffort:string|undefined, contexts:InstallContexts):Promise<string|null> {
        if (suppliedEffort !== undefined) {
            return suppliedEffort;
        }
        /* coverage ignore next 3 */ // — Defensive: callers already checked _disposed; no await between previous guard and this entry.
        if (this._disposed) {
            return null;
        }
        if (tool === "codex") {
            const options:ChoiceOption[] = CODEX_EFFORT_LEVELS.map(e => ({ label: e }));
            options.push({ label: "default configured effort" });
            const option = await promptChoice(contexts.ask, {
                header: headerLabel,
                question: `What effort level should ${roleLabel} use?`,
                options
            });
            if (!option) {
                return null;
            }
            /* coverage ignore next 3 */ // — Defensive: _disposed cannot flip between the synchronous promptChoice return and this check.
            if (this._disposed) {
                return null;
            }
            return option.label === "default configured effort" ? "" : option.label;
        }
        return await this._resolveCuratedChoice(
            headerLabel,
            `What effort level should ${roleLabel} use?`,
            CLAUDE_EFFORT_LEVELS,
            "default configured effort",
            "enter a custom value…",
            "leave empty for the default configured effort",
            contexts
        );
    }
    private async _resolveReviewer(idx:number, supplied:ReviewerFlagAnswers|undefined, contexts:InstallContexts):Promise<FlandersRole|null> {
        const ordinal = idx === 1 ? "" : ` ${idx}`;
        const roleLabel = `reviewer${ordinal}`;
        let tool:"claude"|"codex";
        if (supplied?.tool !== undefined) {
            tool = supplied.tool;
        } else {
            /* coverage ignore next 3 */ // — Defensive: callers already checked _disposed; no await between previous guard and this entry.
            if (this._disposed) {
                return null;
            }
            const option = await promptChoice(contexts.ask, {
                header: `Reviewer${ordinal} tool`,
                question: `Which AI tool should ${roleLabel} use?`,
                options: [
                    { label: "claude", description: "Use Claude Code" },
                    { label: "codex", description: "Use Codex CLI" }
                ]
            });
            if (!option) {
                return null;
            }
            if (this._disposed) {
                return null;
            }
            tool = option.label as "claude"|"codex";
        }
        const model = await this._resolveRoleModel(roleLabel, `Reviewer${ordinal} model`, tool, supplied?.model, contexts);
        if (model === null) {
            return null;
        }
        const effort = await this._resolveRoleEffort(roleLabel, `Reviewer${ordinal} effort`, tool, supplied?.effort, contexts);
        if (effort === null) {
            return null;
        }
        return { tool, model, effort };
    }
    private async _run(rawArgs:readonly string[], options:InstallOptions, contexts:InstallContexts):Promise<number> {
        try {
            const parsed = parseInstallFlags(rawArgs);
            if (!parsed.ok) {
                contexts.output.writeError(parsed.diagnostic);
                return 1;
            }
            const answers = parsed.answers;
            let skillsTool:"claude"|"codex"|"both";
            if (answers.skillsTool !== undefined) {
                skillsTool = answers.skillsTool;
            } else {
                /* coverage ignore next 3 */ // — Defensive: _disposed is false when _run begins synchronously from the constructor.
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
            let mode:"global"|"project";
            if (answers.scope) {
                mode = answers.scope;
            } else {
                /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
                if (this._disposed) {
                    return 1;
                }
                let projectDescription:string;
                let globalDescription:string;
                if (skillsTool === "claude") {
                    projectDescription = "Install in .claude/skills/ relative to CWD";
                    globalDescription = "Install in ~/.claude/skills/";
                } else if (skillsTool === "codex") {
                    projectDescription = "Install in .codex/prompts/ relative to CWD";
                    globalDescription = "Install in ~/.codex/prompts/";
                } else {
                    projectDescription = "Install in .claude/skills/ and .codex/prompts/ relative to CWD";
                    globalDescription = "Install in ~/.claude/skills/ and ~/.codex/prompts/";
                }
                const option = await promptChoice(contexts.ask, {
                    header: "Install destination",
                    question: "Where should Flanders skills be installed?",
                    options: [
                        { label: "project", description: projectDescription },
                        { label: "global", description: globalDescription }
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
            const workerModel = await this._resolveRoleModel("the worker", "Worker model", workerTool, answers.workerModel, contexts);
            if (workerModel === null) {
                return 1;
            }
            const workerEffort = await this._resolveRoleEffort("the worker", "Worker effort", workerTool, answers.workerEffort, contexts);
            if (workerEffort === null) {
                return 1;
            }
            const suppliedReviewers = answers.reviewers;
            const reviewers:FlandersRole[] = [];
            if (suppliedReviewers && suppliedReviewers.length > 0) {
                for (let i = 0; i < suppliedReviewers.length; i++) {
                    const reviewer = await this._resolveReviewer(i + 1, suppliedReviewers[i]!, contexts);
                    if (reviewer === null) {
                        return 1;
                    }
                    reviewers.push(reviewer);
                }
            } else {
                let idx = 1;
                for (;;) {
                    const reviewer = await this._resolveReviewer(idx, undefined, contexts);
                    if (reviewer === null) {
                        return 1;
                    }
                    reviewers.push(reviewer);
                    /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard inside _resolveReviewer and this point.
                    if (this._disposed) {
                        return 1;
                    }
                    const more = await promptChoice(contexts.ask, {
                        header: "Configure another reviewer?",
                        question: "Configure another reviewer?",
                        options: [
                            { label: "no", description: "Stop adding reviewers" },
                            { label: "yes", description: "Configure another reviewer in the ordered list" }
                        ]
                    });
                    if (!more) {
                        return 1;
                    }
                    if (this._disposed) {
                        return 1;
                    }
                    if (more.label === "no") {
                        break;
                    }
                    idx++;
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
            for (const r of reviewers) {
                selectedTools.add(r.tool);
            }
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
            const scopeRoot = mode === "global"
                ? contexts.platform.homedir()
                : options.projectRoot;
            for (const skill of SKILLS) {
                /* coverage ignore next 4 */ // — Defensive: skill bodies are compile-time constants that are always non-empty.
                if (!skill.body) {
                    contexts.output.writeError(`Skill "${skill.name}" has no content.\n`);
                    return 1;
                }
            }
            const writeClaude = skillsTool === "claude" || skillsTool === "both";
            const writeCodex = skillsTool === "codex" || skillsTool === "both";
            const writtenPaths:string[] = [];
            if (writeClaude) {
                const claudeSkillsRoot = joinPath(scopeRoot, ".claude/skills");
                for (const skill of SKILLS) {
                    if (this._disposed) {
                        return 1;
                    }
                    const skillFolder = joinPath(claudeSkillsRoot, skill.name);
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
            }
            if (writeCodex) {
                const codexPromptsRoot = joinPath(scopeRoot, ".codex/prompts");
                try {
                    await contexts.fs.mkdir(codexPromptsRoot, { recursive: true });
                } catch {
                    contexts.output.writeError(`Cannot create destination: ${codexPromptsRoot}\n`);
                    return 1;
                }
                for (const skill of SKILLS) {
                    if (this._disposed) {
                        return 1;
                    }
                    const filePath = joinPath(codexPromptsRoot, `${skill.name}.md`);
                    try {
                        await contexts.fs.writeFile(filePath, stripYamlFrontmatter(skill.body));
                        writtenPaths.push(filePath);
                    } catch {
                        contexts.output.writeError(`Cannot write file: ${filePath}\n`);
                        return 1;
                    }
                }
            }
            /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
            if (this._disposed) {
                return 1;
            }
            const config:FlandersConfig = {
                worker: { tool: workerTool, model: workerModel, effort: workerEffort },
                reviewers
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
