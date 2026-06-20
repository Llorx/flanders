import type { AskContext, ChoiceOption, FsContext, OutputContext, ScriptContext } from "../contexts";
import type { FlandersConfig, FlandersRole, FlandersReviewer } from "../workspace/FlandersConfig";
import { write as writeConfig } from "../workspace/FlandersConfig";
import { askChoice, askText } from "../ui/PromptHelper";
import type { AskChoiceArgs, AskTextArgs } from "../ui/PromptHelper";
import { joinPath } from "../system/fsUtils";
import { planSkillBody, specSkillBody, workSkillBody } from "../prompts/skills";
import type { PlatformContext } from "../workspace/Workspace";
import { probeModelList } from "./InstallModelProbe";
import type { ModelProbeResult } from "./InstallModelProbe";

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
    { name: "flanders-plan", body: planSkillBody },
    { name: "flanders-work", body: workSkillBody }
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
    optionalReviewerIndices?:readonly number[];
    reviewerMinimum?:number;
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

type ClaudeModelEntry = Readonly<{ label:string; value:string }>;

type ClaudeModelFamily = Readonly<{ family:string; entries:readonly ClaudeModelEntry[] }>;

// The `claude` model catalog, organized one group per model family in family order Opus, Sonnet,
// Haiku, Fable. Each family's `entries` list its auto-updating "Latest" alias(es) first — which
// persist the alias string — then its pinned-version identifiers, each pinning a specific release
// and persisting the full model identifier. A `[1m context]` entry is offered only for a model that
// supports a 1M-context window. Display labels are distinct from the persisted values. Pinned by
// `src/commands/.spec/rules/install/model-list-discovery.md`.
const CLAUDE_MODEL_FAMILIES:readonly ClaudeModelFamily[] = [
    {
        family: "Opus",
        entries: [
            { label: "Latest Opus", value: "opus" },
            { label: "Latest Opus [1m context]", value: "opus[1m]" },
            { label: "Opus 4.8", value: "claude-opus-4-8" },
            { label: "Opus 4.8 [1m context]", value: "claude-opus-4-8[1m]" },
            { label: "Opus 4.7", value: "claude-opus-4-7" },
            { label: "Opus 4.7 [1m context]", value: "claude-opus-4-7[1m]" },
            { label: "Opus 4.6", value: "claude-opus-4-6" },
            { label: "Opus 4.6 [1m context]", value: "claude-opus-4-6[1m]" }
        ]
    },
    {
        family: "Sonnet",
        entries: [
            { label: "Latest Sonnet", value: "sonnet" },
            { label: "Latest Sonnet [1m context]", value: "sonnet[1m]" },
            { label: "Sonnet 4.6", value: "claude-sonnet-4-6" },
            { label: "Sonnet 4.6 [1m context]", value: "claude-sonnet-4-6[1m]" },
            { label: "Sonnet 4.5", value: "claude-sonnet-4-5" },
            { label: "Sonnet 4.5 [1m context]", value: "claude-sonnet-4-5[1m]" }
        ]
    },
    {
        family: "Haiku",
        entries: [
            { label: "Latest Haiku", value: "haiku" },
            { label: "Haiku 4.5", value: "claude-haiku-4-5-20251001" }
        ]
    },
    {
        family: "Fable",
        entries: [
            { label: "Latest Fable", value: "fable" },
            { label: "Fable 5", value: "claude-fable-5" }
        ]
    }
];

// Cross-family aliases that do not belong to a single model family; each persists the alias string.
// Rendered as top-level direct selections after the family entries. Pinned by
// `src/commands/.spec/rules/install/model-list-discovery.md`.
const CLAUDE_CROSS_FAMILY_ALIASES:readonly ClaudeModelEntry[] = [
    { label: "Best (auto-pick)", value: "best" }
];

const CLAUDE_BACK_LABEL = "← back";

const REVIEWER_INDEXED_RE = /^--reviewer-(\d+)-(tool|model|effort)=/;

const REVIEWER_OPTIONAL_INDEXED_RE = /^--reviewer-(\d+)-optional$/;

// Validate the weighted-review flags against the now-known reviewer-list length. Shared by the
// parse-time contextual check (when a `--reviewer[-N]-tool/-model/-effort` flag fixed the length)
// and by the interactive assembly in `_run` (when the length is only known after the
// `Configure another reviewer?` loop). Returns the diagnostic to reject with, or null when the
// flags are consistent with the reviewer count. Pinned by
// `src/commands/.spec/rules/install/weighted-reviews-configuration.md`.
function validateWeightedFlagsForReviewerCount(reviewerMinimum:number|undefined, optionalReviewerIndices:readonly number[]|undefined, reviewerCount:number):string|null {
    if (reviewerCount === 1) {
        if (reviewerMinimum !== undefined) {
            return "Invalid flag for a single-reviewer configuration: --reviewer-minimum. Weighted-review flags require two or more reviewers.\n";
        }
        if (optionalReviewerIndices !== undefined) {
            const idx = optionalReviewerIndices[0]!;
            const flag = idx === 1 ? "--reviewer-optional" : `--reviewer-${idx}-optional`;
            return `Invalid flag for a single-reviewer configuration: ${flag}. Weighted-review flags require two or more reviewers.\n`;
        }
        return null;
    }
    if (reviewerMinimum !== undefined && (reviewerMinimum < 1 || reviewerMinimum > reviewerCount)) {
        return `Invalid value for --reviewer-minimum: "${reviewerMinimum}". Must be an integer between 1 and ${reviewerCount}.\n`;
    }
    if (optionalReviewerIndices !== undefined) {
        for (const idx of optionalReviewerIndices) {
            if (idx > reviewerCount) {
                return `Invalid reviewer flag: --reviewer-${idx}-optional references reviewer ${idx}, beyond the configured reviewer list of ${reviewerCount}.\n`;
            }
        }
    }
    if (reviewerMinimum === reviewerCount && optionalReviewerIndices !== undefined) {
        return `Invalid flag combination: --reviewer-minimum equal to the reviewer count (${reviewerCount}) leaves no reviewer that can be optional, so it cannot be combined with --reviewer[-N]-optional.\n`;
    }
    return null;
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
        reviewers?:readonly ReviewerFlagAnswers[];
        optionalReviewerIndices?:readonly number[];
        reviewerMinimum?:number;
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
    // Weighted-review flags. `--reviewer[-N]-optional` are presence flags that mark a 1-based reviewer
    // index optional; `--reviewer-minimum` carries the minimum-reviews count. They annotate the list the
    // tool/model/effort flags establish and never extend it (`rules/install/flag-driven-skip.md`). Only
    // value-format validation happens unconditionally here; the single-reviewer and `[1, T]` range checks
    // are contextual on the reviewer-list length T and run below only when the tool/model/effort flags
    // fixed T at parse time, otherwise they are deferred (`rules/install/weighted-reviews-configuration.md`).
    const optionalIndices = new Set<number>();
    for (const arg of rawArgs) {
        if (arg === "--reviewer-optional") {
            optionalIndices.add(1);
            continue;
        }
        const match = arg.match(REVIEWER_OPTIONAL_INDEXED_RE);
        if (match === null) {
            continue;
        }
        const idx = Number(match[1]);
        if (idx < 1) {
            return { ok: false, diagnostic: `Invalid reviewer flag: "${arg}". --reviewer-N-optional requires N >= 1.\n` };
        }
        optionalIndices.add(idx);
    }
    if (optionalIndices.size > 0) {
        answers.optionalReviewerIndices = [...optionalIndices].sort((a, b) => a - b);
    }
    const minimumRaw = extractFlagValue(rawArgs, "--reviewer-minimum");
    if (minimumRaw !== undefined) {
        if (!/^\d+$/.test(minimumRaw)) {
            return { ok: false, diagnostic: `Invalid value for --reviewer-minimum: "${minimumRaw}". Expected a non-negative integer.\n` };
        }
        answers.reviewerMinimum = Number(minimumRaw);
    }
    // Contextual checks against the reviewer-list length T, performed only when at least one
    // `--reviewer[-N]-tool/-model/-effort` flag fixed T (answers.reviewers is then set to the full list).
    // When no such flag is present T is unknown here, so the values are returned unvalidated against T and
    // these checks are deferred to the interactive assembly (task 2.2).
    if (answers.reviewers !== undefined) {
        const diagnostic = validateWeightedFlagsForReviewerCount(answers.reviewerMinimum, answers.optionalReviewerIndices, answers.reviewers.length);
        if (diagnostic !== null) {
            return { ok: false, diagnostic };
        }
    }
    return { ok: true, answers };
}

export class Install {
    private _disposed = false;
    private _modelProbeCache = new Map<"codex", ModelProbeResult>();
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
    private async _resolveClaudeModel(roleLabel:string, headerLabel:string, contexts:InstallContexts):Promise<string|null> {
        const question = `Which model should ${roleLabel} use?`;
        topLevel: for (;;) {
            const topOptions:ChoiceOption[] = [
                ...CLAUDE_MODEL_FAMILIES.map(family => ({ label: family.family })),
                ...CLAUDE_CROSS_FAMILY_ALIASES.map(alias => ({ label: alias.label })),
                { label: "default configured model" },
                { label: "enter a custom value…" }
            ];
            const top = await promptChoice(contexts.ask, {
                header: headerLabel,
                question,
                options: topOptions
            });
            if (!top) {
                return null;
            }
            if (this._disposed) {
                return null;
            }
            if (top.label === "default configured model") {
                return "";
            }
            if (top.label === "enter a custom value…") {
                const text = await promptText(contexts.ask, {
                    question,
                    placeholder: "leave empty for the default configured model"
                });
                if (text === null) {
                    return null;
                }
                if (this._disposed) {
                    return null;
                }
                return text;
            }
            const crossFamily = CLAUDE_CROSS_FAMILY_ALIASES.find(alias => alias.label === top.label);
            if (crossFamily) {
                return crossFamily.value;
            }
            const family = CLAUDE_MODEL_FAMILIES.find(f => f.family === top.label)!;
            for (;;) {
                const familyOptions:ChoiceOption[] = family.entries.map(entry => ({ label: entry.label }));
                familyOptions.push({ label: CLAUDE_BACK_LABEL });
                const choice = await promptChoice(contexts.ask, {
                    header: headerLabel,
                    question: `Which ${family.family} model should ${roleLabel} use?`,
                    options: familyOptions
                });
                if (!choice) {
                    return null;
                }
                if (this._disposed) {
                    return null;
                }
                if (choice.label === CLAUDE_BACK_LABEL) {
                    continue topLevel;
                }
                const entry = family.entries.find(e => e.label === choice.label)!;
                return entry.value;
            }
        }
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
            return await this._resolveClaudeModel(roleLabel, headerLabel, contexts);
        }
        if (!this._modelProbeCache.has(tool)) {
            const result = await probeModelList(contexts.script);
            if (this._disposed) {
                return null;
            }
            this._modelProbeCache.set(tool, result);
            // Surface why `codex` could not be contacted, but only on the probe execution itself:
            // the cached result drives the second `codex` question without re-emitting the reason.
            if (result.kind === "not-started") {
                contexts.output.writeError(`Could not start codex to list models: ${result.reason}\n`);
            }
        }
        const probeResult = this._modelProbeCache.get(tool)!;
        if (probeResult.kind === "list") {
            const options:ChoiceOption[] = probeResult.models.map(m => ({ label: m }));
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
                    question: "Which AI tool(s) should the skills be installed for, neighbor?",
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
                    header: "Worker tool, neighborino",
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
                        question: "Okely-dokely — care to configure another reviewer?",
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
            // Weighted-review configuration. When the reviewer list was built interactively, the
            // T-dependent flag validation parseInstallFlags deferred runs now — before any
            // weighted-review prompt and before any file is written.
            if (suppliedReviewers === undefined) {
                const diagnostic = validateWeightedFlagsForReviewerCount(answers.reviewerMinimum, answers.optionalReviewerIndices, reviewers.length);
                if (diagnostic !== null) {
                    contexts.output.writeError(diagnostic);
                    return 1;
                }
            }
            // A single reviewer has no weighted-review question: it is required and the minimum is 1.
            // Two or more reviewers are collected directly, with no gate question — the minimum first
            // (a free-text numeric entry defaulting to the reviewer count T on an empty entry; an entry
            // outside [1, T] is re-prompted), then, only when the chosen minimum is below T, each
            // reviewer's optional flag (no/required as the default). A minimum equal to T forces every
            // reviewer to run to a verdict, so no optional question is asked and every reviewer is
            // required. Each value is taken from its flag when present, otherwise asked through the
            // shared prompt helper.
            let minimumReviews:number;
            const reviewerConfigs:FlandersReviewer[] = [];
            if (reviewers.length === 1) {
                minimumReviews = 1;
                reviewerConfigs.push({ ...reviewers[0]!, optional: false });
            } else {
                const reviewerCount = reviewers.length;
                if (answers.reviewerMinimum !== undefined) {
                    minimumReviews = answers.reviewerMinimum;
                } else {
                    /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
                    if (this._disposed) {
                        return 1;
                    }
                    let chosen:number|null = null;
                    while (chosen === null) {
                        const entry = await promptText(contexts.ask, {
                            question: "Minimum reviewers that must run to a verdict in each review round",
                            placeholder: `1-${reviewerCount}, empty for ${reviewerCount}`
                        });
                        if (entry === null) {
                            return 1;
                        }
                        if (this._disposed) {
                            return 1;
                        }
                        const trimmed = entry.trim();
                        if (trimmed === "") {
                            chosen = reviewerCount;
                        } else {
                            const parsed = Number(trimmed);
                            if (/^\d+$/.test(trimmed) && parsed >= 1 && parsed <= reviewerCount) {
                                chosen = parsed;
                            } else {
                                contexts.output.write(`Whoopsie — enter an integer between 1 and ${reviewerCount}, or leave empty for ${reviewerCount}.\n`);
                            }
                        }
                    }
                    minimumReviews = chosen;
                }
                if (minimumReviews < reviewerCount) {
                    if (answers.optionalReviewerIndices !== undefined) {
                        const optionalSet = new Set(answers.optionalReviewerIndices);
                        for (let i = 0; i < reviewerCount; i++) {
                            reviewerConfigs.push({ ...reviewers[i]!, optional: optionalSet.has(i + 1) });
                        }
                    } else {
                        for (let i = 0; i < reviewerCount; i++) {
                            /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
                            if (this._disposed) {
                                return 1;
                            }
                            // Identify the reviewer by its 1-based position together with its tool,
                            // model, and effort, so the user knows which reviewer the question concerns.
                            // An empty model or effort resolves to the tool's default, shown as
                            // "default configured model"/"default configured effort". The option
                            // descriptions explain that the only effect of optionality is that the round
                            // abandons the reviewer while it is in a rate-limit wait once it can otherwise
                            // complete; in every other respect an optional reviewer reviews like a required one.
                            const reviewer = reviewers[i]!;
                            const modelLabel = reviewer.model === "" ? "default configured model" : reviewer.model;
                            const effortLabel = reviewer.effort === "" ? "default configured effort" : reviewer.effort;
                            const optionalOption = await promptChoice(contexts.ask, {
                                header: `Reviewer ${i + 1} optional`,
                                question: `Is reviewer ${i + 1} (${reviewer.tool} · ${modelLabel} · ${effortLabel}) optional?`,
                                options: [
                                    { label: "no", description: "Required — always waits out its rate-limit waits; the round never completes without its verdict" },
                                    { label: "yes", description: "Optional — reviews exactly like a required reviewer; the only difference is the round abandons it while it is in a rate-limit wait, once every required reviewer is in and the minimum is met" }
                                ]
                            });
                            if (!optionalOption) {
                                return 1;
                            }
                            if (this._disposed) {
                                return 1;
                            }
                            reviewerConfigs.push({ ...reviewer, optional: optionalOption.label === "yes" });
                        }
                    }
                } else {
                    // minimumReviews === reviewerCount: every reviewer must run to a verdict, so none can
                    // be optional — no optional question is asked and every reviewer is required.
                    for (let i = 0; i < reviewerCount; i++) {
                        reviewerConfigs.push({ ...reviewers[i]!, optional: false });
                    }
                }
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
                reviewers: reviewerConfigs,
                minimumReviews
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
