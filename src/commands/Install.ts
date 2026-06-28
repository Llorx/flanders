import type { AskContext, ChoiceOption, FsContext, OutputContext, ScriptContext } from "../contexts";
import type { FlandersConfig, FlandersRole, FlandersReviewer } from "../workspace/FlandersConfig";
import { write as writeConfig, readScope } from "../workspace/FlandersConfig";
import { askChoice, askMultiChoice, askText } from "../ui/PromptHelper";
import type { AskChoiceArgs, AskMultiChoiceArgs, AskTextArgs } from "../ui/PromptHelper";
import { writeSkillArtifacts } from "./skillArtifacts";
import type { PlatformContext } from "../workspace/Workspace";
import { probeModelList } from "./InstallModelProbe";
import type { ModelProbeResult } from "./InstallModelProbe";
import type { ToolName } from "../ai/ToolAdapter";
import { TOOL_NAMES } from "../toolNames";
import { modelSupportsFastMode } from "../fastMode";

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

async function promptMultiChoice(ask:AskContext, args:AskMultiChoiceArgs):Promise<readonly ChoiceOption[]|null> {
    try {
        return await askMultiChoice(ask, args);
    } catch (e) {
        if (e instanceof Error && e.name === "AbortError") {
            return null;
        }
        throw e;
    }
}

type ReviewerFlagAnswers = Readonly<{
    tool?:ToolName;
    model?:string;
    effort?:string;
}>;

export type ResolvedAnswers = Readonly<{
    scope?:"project"|"global";
    skillsTools?:readonly ToolName[];
    workerTool?:ToolName;
    workerModel?:string;
    workerEffort?:string;
    workerFast?:boolean;
    reviewers?:readonly ReviewerFlagAnswers[];
    optionalReviewerIndices?:readonly number[];
    fastReviewerIndices?:readonly number[];
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

// Validate an effort flag value against the tool it applies to, mirroring the per-tool effort rules.
// An empty value is always accepted (it resolves to "default configured effort"). For `codex` the
// value must be one of the closed documented levels. For `claude` (and when the tool is not yet known
// from a flag) effort is open and unvalidated. Returns the diagnostic to reject with, or null when the
// value is valid. Pinned by `.spec/contracts/cli-commands/install.md` and
// `src/commands/.spec/rules/install.md`.
function validateEffortForTool(value:string, tool:ToolName|undefined, flagName:string):string|null {
    if (value === "") {
        return null;
    }
    if (tool === "codex") {
        return validateClosedSet(value, CODEX_EFFORT_LEVELS, flagName);
    }
    return null;
}

// Parse a `--skills-tool` value: a comma-separated list of one or more distinct names drawn from the
// closed tool set. An empty list, an unknown name, or a repeated name is a usage error naming the
// offending value, per `.spec/contracts/cli-commands/install.md`.
function parseSkillsToolList(value:string):Readonly<{ ok:true; tools:readonly ToolName[] }>|Readonly<{ ok:false; diagnostic:string }> {
    const invalid:Readonly<{ ok:false; diagnostic:string }> = {
        ok: false,
        diagnostic: `Invalid value for --skills-tool: "${value}". Expected a comma-separated list of distinct names from: ${TOOL_NAMES.join(", ")}.\n`
    };
    const seen = new Set<string>();
    const tools:ToolName[] = [];
    for (const part of value.split(",")) {
        if (!(TOOL_NAMES as readonly string[]).includes(part) || seen.has(part)) {
            return invalid;
        }
        seen.add(part);
        tools.push(part as ToolName);
    }
    return { ok: true, tools };
}

// The worker-tool and reviewer-tool questions both offer the same closed set of tools with the same
// per-tool descriptions; defined once so the two questions cannot drift apart.
const TOOL_CHOICE_OPTIONS:readonly ChoiceOption[] = [
    { label: "claude", description: "Use Claude Code" },
    { label: "codex", description: "Use Codex CLI" }
];

// The skills-root destination path each tool contributes to the scope prompt's option labels, per the
// `Interactive prompts` section of `.spec/contracts/cli-commands/install.md`. These are user-facing
// display fragments (with the `~/` home prefix for global and a trailing slash), distinct from the
// `joinPath` subfolder fragments in `skillArtifacts.ts`.
const SKILLS_TOOL_DESTINATIONS:Readonly<Record<ToolName, Readonly<{ project:string; global:string }>>> = {
    claude: { project: ".claude/skills/", global: "~/.claude/skills/" },
    codex: { project: ".codex/prompts/", global: "~/.codex/prompts/" }
};

const CLAUDE_EFFORT_LEVELS:readonly string[] = ["low", "medium", "high", "xhigh", "max"];

type ModelEntry = Readonly<{ label:string; value:string }>;

// A group of model entries shown as one submenu under a top-level entry — a `claude` model family.
// `name` is both the top-level label and the submenu title.
type ModelGroup = Readonly<{ name:string; entries:readonly ModelEntry[] }>;

// The `claude` model catalog, organized one group per model family in family order Opus, Sonnet,
// Haiku, Fable. Each family's `entries` list its auto-updating "Latest" alias(es) first — which
// persist the alias string — then its pinned-version identifiers, each pinning a specific release
// and persisting the full model identifier. A `[1m context]` entry is offered only for a model that
// supports a 1M-context window. Display labels are distinct from the persisted values. Pinned by
// `src/commands/.spec/rules/install/model-list-discovery.md`.
const CLAUDE_MODEL_FAMILIES:readonly ModelGroup[] = [
    {
        name: "Opus",
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
        name: "Sonnet",
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
        name: "Haiku",
        entries: [
            { label: "Latest Haiku", value: "haiku" },
            { label: "Haiku 4.5", value: "claude-haiku-4-5-20251001" }
        ]
    },
    {
        name: "Fable",
        entries: [
            { label: "Latest Fable", value: "fable" },
            { label: "Fable 5", value: "claude-fable-5" }
        ]
    }
];

// Cross-family aliases that do not belong to a single model family; each persists the alias string.
// Rendered as top-level direct selections after the family entries. Pinned by
// `src/commands/.spec/rules/install/model-list-discovery.md`.
const CLAUDE_CROSS_FAMILY_ALIASES:readonly ModelEntry[] = [
    { label: "Best (auto-pick)", value: "best" }
];

const MODEL_BACK_LABEL = "← back";

const REVIEWER_INDEXED_RE = /^--reviewer-(\d+)-(tool|model|effort)=/;

const REVIEWER_OPTIONAL_INDEXED_RE = /^--reviewer-(\d+)-optional$/;

const REVIEWER_FAST_INDEXED_RE = /^--reviewer-(\d+)-fast$/;

// Validate the `--reviewer-N-fast` flags against the now-known reviewer-list length. A fast flag
// annotates a reviewer within the list the tool/model/effort flags establish; it never extends that
// list, so a fast index beyond the list is a usage error naming the offending index. Shared by the
// parse-time contextual check (when a `--reviewer[-N]-tool/-model/-effort` flag fixed the length) and
// by the interactive assembly in `_run` (when the length is only known after the `Configure another
// reviewer?` loop). Returns the diagnostic to reject with, or null when every fast index is within the
// list. Pinned by `.spec/contracts/cli-commands/install.md`.
function validateFastFlagsForReviewerCount(fastReviewerIndices:readonly number[]|undefined, reviewerCount:number):string|null {
    if (fastReviewerIndices !== undefined) {
        for (const idx of fastReviewerIndices) {
            if (idx > reviewerCount) {
                return `Invalid reviewer flag: --reviewer-${idx}-fast references reviewer ${idx}, beyond the configured reviewer list of ${reviewerCount}.\n`;
            }
        }
    }
    return null;
}

// The usage-error diagnostic for a fast flag on an ineligible role — its tool is not `claude`, or its
// `claude` model does not support fast mode. `flagName` is the offending flag (`--worker-fast`,
// `--reviewer-fast`, or `--reviewer-N-fast`). Shared by the parse-time early rejection and the
// resolution-time check in `_resolveRoleFast`, so the identical diagnostic is produced wherever the
// ineligibility is first detected. Callers invoke it only for a role already known ineligible; `model`
// is read only for a `claude` role. Pinned by `.spec/contracts/cli-commands/install.md`.
function fastFlagEligibilityError(tool:ToolName, model:string, flagName:string):string {
    const reason = tool === "claude"
        ? `the model "${model}" does not support Claude Code fast mode`
        : `the ${tool} tool has no fast mode`;
    return `Invalid flag ${flagName}: ${reason}.\n`;
}

// Decide whether a fast flag is already known invalid from the role's flag-supplied tool and model, for
// the parse-time early validation the install contract's order-of-validation requires (a flag known
// invalid is rejected before any interactive prompt). Returns the usage-error diagnostic when the role
// is definitively ineligible from what the flags already fix — a known non-`claude` tool, or a `claude`
// tool with a known non-fast-capable model — and null when the tool, or a `claude` role's model, is not
// yet known (it comes from an interactive or stored answer), in which case eligibility is re-checked at
// resolution time in `_resolveRoleFast`. Pinned by `.spec/contracts/cli-commands/install.md`.
function knownFastFlagError(tool:ToolName|undefined, model:string|undefined, flagName:string):string|null {
    if (tool === undefined) {
        return null;
    }
    if (tool !== "claude") {
        return fastFlagEligibilityError(tool, "", flagName);
    }
    if (model === undefined) {
        return null;
    }
    return modelSupportsFastMode(model) ? null : fastFlagEligibilityError(tool, model, flagName);
}

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
        skillsTools?:readonly ToolName[];
        workerTool?:ToolName;
        workerModel?:string;
        workerEffort?:string;
        workerFast?:boolean;
        reviewers?:readonly ReviewerFlagAnswers[];
        optionalReviewerIndices?:readonly number[];
        fastReviewerIndices?:readonly number[];
        reviewerMinimum?:number;
    } = {};
    if (hasProject) answers.scope = "project";
    if (hasGlobal) answers.scope = "global";
    const skillsTool = extractFlagValue(rawArgs, "--skills-tool");
    if (skillsTool !== undefined) {
        const result = parseSkillsToolList(skillsTool);
        if (!result.ok) return { ok: false, diagnostic: result.diagnostic };
        answers.skillsTools = result.tools;
    }
    const workerTool = extractFlagValue(rawArgs, "--worker-tool");
    if (workerTool !== undefined) {
        const error = validateClosedSet(workerTool, TOOL_NAMES, "--worker-tool");
        if (error) return { ok: false, diagnostic: error };
        answers.workerTool = workerTool as ToolName;
    }
    const workerModel = extractFlagValue(rawArgs, "--worker-model");
    if (workerModel !== undefined) {
        answers.workerModel = workerModel;
    }
    const workerEffort = extractFlagValue(rawArgs, "--worker-effort");
    if (workerEffort !== undefined) {
        const error = validateEffortForTool(workerEffort, answers.workerTool, "--worker-effort");
        if (error) return { ok: false, diagnostic: error };
        answers.workerEffort = workerEffort;
    }
    const reviewerIndices = new Map<number, { tool?:ToolName; model?:string; effort?:string }>();
    const reviewer1Tool = extractFlagValue(rawArgs, "--reviewer-tool");
    const reviewer1Model = extractFlagValue(rawArgs, "--reviewer-model");
    const reviewer1Effort = extractFlagValue(rawArgs, "--reviewer-effort");
    if (reviewer1Tool !== undefined) {
        const error = validateClosedSet(reviewer1Tool, TOOL_NAMES, "--reviewer-tool");
        if (error) return { ok: false, diagnostic: error };
        if (!reviewerIndices.has(1)) reviewerIndices.set(1, {});
        reviewerIndices.get(1)!.tool = reviewer1Tool as ToolName;
    }
    if (reviewer1Model !== undefined) {
        if (!reviewerIndices.has(1)) reviewerIndices.set(1, {});
        reviewerIndices.get(1)!.model = reviewer1Model;
    }
    if (reviewer1Effort !== undefined) {
        const tool1 = reviewerIndices.get(1)?.tool;
        const error = validateEffortForTool(reviewer1Effort, tool1, "--reviewer-effort");
        if (error) return { ok: false, diagnostic: error };
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
            const error = validateClosedSet(value, TOOL_NAMES, `--reviewer-${idx}-tool`);
            if (error) return { ok: false, diagnostic: error };
            entry.tool = value as ToolName;
        } else if (field === "model") {
            entry.model = value;
        } else {
            entry.effort = value;
        }
    }
    // Second pass: validate every collected effort against its now-known tool.
    for (const [idx, entry] of reviewerIndices) {
        if (entry.effort !== undefined) {
            const error = validateEffortForTool(entry.effort, entry.tool, `--reviewer-${idx}-effort`);
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
        if (idx < 2) {
            return { ok: false, diagnostic: `Invalid reviewer flag: "${arg}". Reviewer 1 uses --reviewer-optional; --reviewer-N-optional requires N >= 2.\n` };
        }
        optionalIndices.add(idx);
    }
    if (optionalIndices.size > 0) {
        answers.optionalReviewerIndices = [...optionalIndices].sort((a, b) => a - b);
    }
    // Fast flags. `--worker-fast` is a presence flag enabling fast mode for the worker;
    // `--reviewer[-N]-fast` are presence flags marking a 1-based reviewer index fast, mirroring the
    // `--reviewer[-N]-optional` flags. They annotate the list the tool/model/effort flags establish and
    // never extend it (`rules/install/flag-driven-skip.md`). The fast-index-beyond-list check is
    // contextual on the reviewer-list length T and runs below only when the tool/model/effort flags
    // fixed T at parse time; otherwise it is deferred to the interactive assembly. Fast eligibility is
    // checked here for every role whose tool — and, for a claude role, model — the flags already fix
    // (`knownFastFlagError`), so a known-invalid fast flag is rejected before any interactive prompt per
    // the install contract's order-of-validation; a role whose tool or claude-model is still interactive
    // or stored is re-validated against its resolved values in `_resolveRoleFast`.
    if (rawArgs.includes("--worker-fast")) {
        answers.workerFast = true;
        const workerFastError = knownFastFlagError(answers.workerTool, answers.workerModel, "--worker-fast");
        if (workerFastError !== null) {
            return { ok: false, diagnostic: workerFastError };
        }
    }
    const fastIndices = new Set<number>();
    for (const arg of rawArgs) {
        if (arg === "--reviewer-fast") {
            fastIndices.add(1);
            continue;
        }
        const match = arg.match(REVIEWER_FAST_INDEXED_RE);
        if (match === null) {
            continue;
        }
        const idx = Number(match[1]);
        if (idx < 2) {
            return { ok: false, diagnostic: `Invalid reviewer flag: "${arg}". Reviewer 1 uses --reviewer-fast; --reviewer-N-fast requires N >= 2.\n` };
        }
        fastIndices.add(idx);
    }
    if (fastIndices.size > 0) {
        answers.fastReviewerIndices = [...fastIndices].sort((a, b) => a - b);
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
        const fastDiagnostic = validateFastFlagsForReviewerCount(answers.fastReviewerIndices, answers.reviewers.length);
        if (fastDiagnostic !== null) {
            return { ok: false, diagnostic: fastDiagnostic };
        }
        // Fast eligibility of each in-list reviewer whose tool — and, for a claude reviewer, model — the
        // flags already fix: a known-invalid reviewer fast flag is rejected here, before any prompt. A
        // reviewer whose tool or claude-model is still interactive/stored defers to `_resolveRoleFast`.
        if (answers.fastReviewerIndices !== undefined) {
            for (const idx of answers.fastReviewerIndices) {
                const supplied = answers.reviewers[idx - 1]!;
                const flagName = idx === 1 ? "--reviewer-fast" : `--reviewer-${idx}-fast`;
                const reviewerFastError = knownFastFlagError(supplied.tool, supplied.model, flagName);
                if (reviewerFastError !== null) {
                    return { ok: false, diagnostic: reviewerFastError };
                }
            }
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
    private async _resolveCuratedChoice(headerLabel:string, question:string, curatedValues:readonly string[], defaultLabel:string, customLabel:string, customPlaceholder:string, contexts:InstallContexts, preselect?:string):Promise<string|null> {
        const options:ChoiceOption[] = curatedValues.map(v => ({ label: v }));
        options.push({ label: defaultLabel });
        options.push({ label: customLabel });
        // Pre-select the entry reproducing the stored value: the synthetic default entry for the
        // empty string, the matching curated entry when the value is one of the suggestions, and
        // otherwise the custom entry with its free-text input defaulted to the stored value. An
        // undefined preselect (no stored configuration) leaves the list at its fresh default.
        let preselectLabel:string|undefined;
        let customDefault:string|undefined;
        if (preselect !== undefined) {
            if (preselect === "") {
                preselectLabel = defaultLabel;
            } else if (curatedValues.includes(preselect)) {
                preselectLabel = preselect;
            } else {
                preselectLabel = customLabel;
                customDefault = preselect;
            }
        }
        const option = await promptChoice(contexts.ask, {
            header: headerLabel,
            question,
            options,
            defaultLabel: preselectLabel
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
                placeholder: customPlaceholder,
                default: customDefault
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
    // Two-tier grouped model menu used by the `claude` model question (groups are model families,
    // with the cross-family aliases). The top level lists one entry per group, then each cross-group
    // alias as a direct selection, then the synthetic `default configured model` entry, then the custom
    // entry; selecting a group opens a submenu of that group's entries plus a back affordance. Pre-selects
    // along the path to the stored model: the synthetic default entry for the empty string, a
    // cross-group alias entry when it matches, the group entry (and, inside its submenu, the matching
    // model entry) when the stored model is one of that group's catalogued values, and otherwise the
    // custom entry with its free-text input defaulted to the stored model. An undefined preselect (no
    // stored configuration) leaves every level at its fresh default. Pinned by
    // `src/commands/.spec/rules/install.md`.
    private async _resolveGroupedModel(roleLabel:string, headerLabel:string, groups:readonly ModelGroup[], crossAliases:readonly ModelEntry[], contexts:InstallContexts, preselect?:string):Promise<string|null> {
        const question = `Which model should ${roleLabel} use?`;
        let topDefault:string|undefined;
        let customDefault:string|undefined;
        let preselectedGroup:ModelGroup|undefined;
        let preselectedEntryLabel:string|undefined;
        if (preselect !== undefined) {
            if (preselect === "") {
                topDefault = "default configured model";
            } else {
                const alias = crossAliases.find(a => a.value === preselect);
                if (alias) {
                    topDefault = alias.label;
                } else {
                    const group = groups.find(g => g.entries.some(e => e.value === preselect));
                    if (group) {
                        topDefault = group.name;
                        preselectedGroup = group;
                        preselectedEntryLabel = group.entries.find(e => e.value === preselect)!.label;
                    } else {
                        topDefault = "enter a custom value…";
                        customDefault = preselect;
                    }
                }
            }
        }
        topLevel: for (;;) {
            const topOptions:ChoiceOption[] = [
                ...groups.map(group => ({ label: group.name })),
                ...crossAliases.map(alias => ({ label: alias.label })),
                { label: "default configured model" },
                { label: "enter a custom value…" }
            ];
            const top = await promptChoice(contexts.ask, {
                header: headerLabel,
                question,
                options: topOptions,
                defaultLabel: topDefault
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
                    placeholder: "leave empty for the default configured model",
                    default: customDefault
                });
                if (text === null) {
                    return null;
                }
                if (this._disposed) {
                    return null;
                }
                return text;
            }
            const crossAlias = crossAliases.find(alias => alias.label === top.label);
            if (crossAlias) {
                return crossAlias.value;
            }
            const group = groups.find(g => g.name === top.label)!;
            for (;;) {
                const groupOptions:ChoiceOption[] = group.entries.map(entry => ({ label: entry.label }));
                groupOptions.push({ label: MODEL_BACK_LABEL });
                const choice = await promptChoice(contexts.ask, {
                    header: headerLabel,
                    question: `Which ${group.name} model should ${roleLabel} use?`,
                    options: groupOptions,
                    defaultLabel: group === preselectedGroup ? preselectedEntryLabel : undefined
                });
                if (!choice) {
                    return null;
                }
                if (this._disposed) {
                    return null;
                }
                if (choice.label === MODEL_BACK_LABEL) {
                    continue topLevel;
                }
                const entry = group.entries.find(e => e.label === choice.label)!;
                return entry.value;
            }
        }
    }
    // Free-text model entry used by the `codex` free-text fallback (empty or failed probe). The
    // question text, placeholder, and empty→"" resolution match the custom entry of the grouped menus;
    // the stored model seeds the default so accepting the empty input reproduces it.
    private async _resolveFreeTextModel(roleLabel:string, contexts:InstallContexts, preselect?:string):Promise<string|null> {
        const text = await promptText(contexts.ask, {
            question: `Which model should ${roleLabel} use?`,
            placeholder: "leave empty for the default configured model",
            default: preselect
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
    private async _resolveRoleModel(roleLabel:string, headerLabel:string, tool:ToolName, suppliedModel:string|undefined, contexts:InstallContexts, preselect?:string):Promise<string|null> {
        if (suppliedModel !== undefined) {
            return suppliedModel;
        }
        /* coverage ignore next 3 */ // — Defensive: callers already checked _disposed; no await between previous guard and this entry.
        if (this._disposed) {
            return null;
        }
        if (tool === "claude") {
            return await this._resolveGroupedModel(roleLabel, headerLabel, CLAUDE_MODEL_FAMILIES, CLAUDE_CROSS_FAMILY_ALIASES, contexts, preselect);
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
            // Pre-select the probe entry reproducing the stored model, or the synthetic default
            // entry for the empty string. A stored model the probe no longer returns is left
            // without a forced default, so that question is answered actively.
            let modelDefaultLabel:string|undefined;
            if (preselect !== undefined) {
                if (preselect === "") {
                    modelDefaultLabel = "default configured model";
                } else if (probeResult.models.includes(preselect)) {
                    modelDefaultLabel = preselect;
                }
            }
            const option = await promptChoice(contexts.ask, {
                header: headerLabel,
                question: `Which model should ${roleLabel} use?`,
                options,
                defaultLabel: modelDefaultLabel
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
        // Free-text fallback (empty or failed probe): default to the stored model so accepting the
        // empty input reproduces it.
        return await this._resolveFreeTextModel(roleLabel, contexts, preselect);
    }
    private async _resolveRoleEffort(roleLabel:string, headerLabel:string, tool:ToolName, suppliedEffort:string|undefined, contexts:InstallContexts, preselect?:string):Promise<string|null> {
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
            // Pre-select the documented level reproducing the stored effort, or the synthetic
            // default entry for the empty string. The codex effort set is closed, so a stored
            // effort is always one of these entries.
            let effortDefaultLabel:string|undefined;
            if (preselect !== undefined) {
                effortDefaultLabel = preselect === "" ? "default configured effort" : preselect;
            }
            const option = await promptChoice(contexts.ask, {
                header: headerLabel,
                question: `What effort level should ${roleLabel} use?`,
                options,
                defaultLabel: effortDefaultLabel
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
            contexts,
            preselect
        );
    }
    // Resolve a role's fast setting, asked after that role's effort question. The fast question is
    // asked only for a `claude` role whose resolved model supports fast mode (`modelSupportsFastMode`);
    // every other role — any `codex`/`antigravity` role, or a `claude` role on a model that does not
    // support fast mode — persists `false` without asking. When the role's fast flag is present, the
    // question is skipped and `fast` is `true`, but only after confirming the role is eligible: a fast
    // flag on a non-`claude` tool or an ineligible model is a usage error naming the offending flag.
    // The interactive question is a yes/no single-select through the shared prompt helper whose default
    // is `no` (fast off, because fast mode bills at a higher rate), seeded from the stored role's `fast`
    // when a configuration was read. Returns the resolved `fast`, or null on abort/disposal/usage error.
    // Pinned by `src/commands/.spec/rules/install.md#fast-mode-is-offered-only-for-a-claude-role-whose-model-supports-it`.
    private async _resolveRoleFast(roleLabel:string, headerLabel:string, tool:ToolName, model:string, fastFlag:boolean, flagName:string, contexts:InstallContexts, storedFast:boolean|undefined):Promise<boolean|null> {
        const eligible = tool === "claude" && modelSupportsFastMode(model);
        if (fastFlag) {
            if (!eligible) {
                // Reached only when this role's tool or claude-model was interactive or stored, so the
                // parse-time `knownFastFlagError` could not decide; the diagnostic is identical.
                contexts.output.writeError(fastFlagEligibilityError(tool, model, flagName));
                return null;
            }
            return true;
        }
        if (!eligible) {
            return false;
        }
        const option = await promptChoice(contexts.ask, {
            header: headerLabel,
            question: `Should ${roleLabel} run with Claude Code's fast mode enabled, neighbor?`,
            options: [
                { label: "no", description: "Standard mode — fast mode off" },
                { label: "yes", description: "Fast mode — Claude Code's higher-speed, higher-cost configuration" }
            ],
            // The default is "no" on a fresh run; a read configuration seeds it from the stored fast.
            defaultLabel: storedFast === true ? "yes" : "no"
        });
        if (!option) {
            return null;
        }
        if (this._disposed) {
            return null;
        }
        return option.label === "yes";
    }
    private async _resolveReviewer(idx:number, supplied:ReviewerFlagAnswers|undefined, fastFlag:boolean, contexts:InstallContexts, storedReviewer?:FlandersReviewer):Promise<FlandersRole|null> {
        const ordinal = idx === 1 ? "" : ` ${idx}`;
        const roleLabel = `reviewer${ordinal}`;
        let tool:ToolName;
        if (supplied?.tool !== undefined) {
            tool = supplied.tool;
        } else {
            /* coverage ignore next 3 */ // — Defensive: callers already checked _disposed; no await between previous guard and this entry.
            if (this._disposed) {
                return null;
            }
            // Pre-select this reviewer's stored tool when a configuration was read for this position;
            // a fresh position (no stored reviewer) leaves the tool question at its fresh default.
            const option = await promptChoice(contexts.ask, {
                header: `Reviewer${ordinal} tool`,
                question: `Which AI tool should ${roleLabel} use?`,
                options: TOOL_CHOICE_OPTIONS,
                defaultLabel: storedReviewer?.tool
            });
            if (!option) {
                return null;
            }
            if (this._disposed) {
                return null;
            }
            tool = option.label as ToolName;
        }
        // Re-validate the supplied effort flag against the now-resolved reviewer tool. As with the
        // worker, parse-time validation only covers a tool fixed by a flag; an effort the resolved tool
        // forbids (a non-documented level for codex) is rejected here with a diagnostic naming the
        // offending flag and value, before any further prompt.
        if (supplied?.effort !== undefined) {
            const effortError = validateEffortForTool(supplied.effort, tool, idx === 1 ? "--reviewer-effort" : `--reviewer-${idx}-effort`);
            if (effortError !== null) {
                contexts.output.writeError(effortError);
                return null;
            }
        }
        // The stored reviewer's model and effort seed their questions through the same resolvers as
        // the worker; a fresh position passes undefined and keeps the fresh default.
        const model = await this._resolveRoleModel(roleLabel, `Reviewer${ordinal} model`, tool, supplied?.model, contexts, storedReviewer?.model);
        if (model === null) {
            return null;
        }
        const effort = await this._resolveRoleEffort(roleLabel, `Reviewer${ordinal} effort`, tool, supplied?.effort, contexts, storedReviewer?.effort);
        if (effort === null) {
            return null;
        }
        // After the effort question, resolve the reviewer's fast setting. The fast flag for this 1-based
        // index (when present) is re-validated against the now-resolved tool and model, and the question
        // is asked only when the reviewer is an eligible `claude` role; the stored reviewer's fast seeds
        // its default.
        const fast = await this._resolveRoleFast(roleLabel, `Reviewer${ordinal} fast`, tool, model, fastFlag, idx === 1 ? "--reviewer-fast" : `--reviewer-${idx}-fast`, contexts, storedReviewer?.fast);
        if (fast === null) {
            return null;
        }
        return { tool, model, effort, fast };
    }
    private async _run(rawArgs:readonly string[], options:InstallOptions, contexts:InstallContexts):Promise<number> {
        try {
            const parsed = parseInstallFlags(rawArgs);
            if (!parsed.ok) {
                contexts.output.writeError(parsed.diagnostic);
                return 1;
            }
            const answers = parsed.answers;
            let skillsTools:readonly ToolName[];
            if (answers.skillsTools !== undefined) {
                skillsTools = answers.skillsTools;
            } else {
                /* coverage ignore next 3 */ // — Defensive: _disposed is false when _run begins synchronously from the constructor.
                if (this._disposed) {
                    return 1;
                }
                const picked = await promptMultiChoice(contexts.ask, {
                    header: "Skills tool",
                    question: "Which AI tool(s) should the skills be installed for, neighbor?",
                    options: [
                        { label: "claude", description: "Install skills for Claude Code" },
                        { label: "codex", description: "Install skills for Codex CLI" }
                    ]
                });
                if (!picked) {
                    return 1;
                }
                if (this._disposed) {
                    return 1;
                }
                skillsTools = picked.map(o => o.label as ToolName);
            }
            let mode:"global"|"project";
            if (answers.scope) {
                mode = answers.scope;
            } else {
                /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
                if (this._disposed) {
                    return 1;
                }
                // Each scope option is labelled with the destination path of every tool the
                // skills-tool selection names, in selection order, joined with " and ".
                const projectDescription = `Install in ${skillsTools.map(t => SKILLS_TOOL_DESTINATIONS[t].project).join(" and ")} relative to CWD`;
                const globalDescription = `Install in ${skillsTools.map(t => SKILLS_TOOL_DESTINATIONS[t].global).join(" and ")}`;
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
            // Read the chosen scope's configuration once to pre-select the interactive defaults of
            // the questions asked afterward. This pre-selection read is lenient (readScope returns
            // null on an absent, unreadable, or malformed file), so a missing or corrupt
            // configuration simply leaves every prompt at its fresh-install default rather than
            // aborting. The single result is reused for the worker (here) and reviewer questions;
            // the consume-to-run reader `implement` uses is unaffected and still hard-errors.
            const storedConfig = await readScope(contexts.fs, {
                scope: mode,
                projectRoot: options.projectRoot,
                homeDir: contexts.platform.homedir()
            });
            // A disposal during the pre-selection read stops the run here, before any path — including
            // a fully flag-supplied one that skips every prompt — can continue into skill emission.
            if (this._disposed) {
                return 1;
            }
            let workerTool:ToolName;
            if (answers.workerTool !== undefined) {
                workerTool = answers.workerTool;
            } else {
                /* coverage ignore next 3 */ // — Defensive: the unconditional post-read guard already returned on disposal; no await between it and here.
                if (this._disposed) {
                    return 1;
                }
                const option = await promptChoice(contexts.ask, {
                    header: "Worker tool, neighborino",
                    question: "Which AI tool should the worker use?",
                    options: TOOL_CHOICE_OPTIONS,
                    defaultLabel: storedConfig?.worker.tool
                });
                if (!option) {
                    return 1;
                }
                if (this._disposed) {
                    return 1;
                }
                workerTool = option.label as ToolName;
            }
            // Re-validate the supplied --worker-effort against the now-resolved worker tool. Parse-time
            // validation can only run when --worker-tool fixes the tool; when the tool is resolved
            // interactively or from a stored default, an effort the resolved tool forbids (a
            // non-documented level for codex) is caught here with a diagnostic naming the offending flag
            // and value, before any further prompt.
            if (answers.workerEffort !== undefined) {
                const effortError = validateEffortForTool(answers.workerEffort, workerTool, "--worker-effort");
                if (effortError !== null) {
                    contexts.output.writeError(effortError);
                    return 1;
                }
            }
            const workerModel = await this._resolveRoleModel("the worker", "Worker model", workerTool, answers.workerModel, contexts, storedConfig?.worker.model);
            if (workerModel === null) {
                return 1;
            }
            const workerEffort = await this._resolveRoleEffort("the worker", "Worker effort", workerTool, answers.workerEffort, contexts, storedConfig?.worker.effort);
            if (workerEffort === null) {
                return 1;
            }
            // After the worker effort question, resolve the worker's fast setting. A present --worker-fast
            // flag is re-validated against the resolved worker tool and model (a usage error when the tool
            // is not claude or the model does not support fast mode); otherwise the yes/no fast question is
            // asked only for an eligible claude role, seeded from the stored worker's fast.
            const workerFast = await this._resolveRoleFast("the worker", "Worker fast", workerTool, workerModel, answers.workerFast === true, "--worker-fast", contexts, storedConfig?.worker.fast);
            if (workerFast === null) {
                return 1;
            }
            const suppliedReviewers = answers.reviewers;
            // The 1-based reviewer indices a --reviewer[-N]-fast flag marks fast; consulted as each
            // reviewer is resolved so the flag skips that reviewer's interactive fast question.
            const fastReviewerSet = new Set(answers.fastReviewerIndices ?? []);
            // The stored reviewer at each 1-based position seeds that position's prompts; a position
            // beyond the stored list (or with no configuration read) gets undefined and keeps its
            // fresh defaults.
            const storedReviewers = storedConfig?.reviewers;
            const reviewers:FlandersRole[] = [];
            if (suppliedReviewers && suppliedReviewers.length > 0) {
                for (let i = 0; i < suppliedReviewers.length; i++) {
                    const reviewer = await this._resolveReviewer(i + 1, suppliedReviewers[i]!, fastReviewerSet.has(i + 1), contexts, storedReviewers?.[i]);
                    if (reviewer === null) {
                        return 1;
                    }
                    reviewers.push(reviewer);
                }
            } else {
                let idx = 1;
                for (;;) {
                    const reviewer = await this._resolveReviewer(idx, undefined, fastReviewerSet.has(idx), contexts, storedReviewers?.[idx - 1]);
                    if (reviewer === null) {
                        return 1;
                    }
                    reviewers.push(reviewer);
                    /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard inside _resolveReviewer and this point.
                    if (this._disposed) {
                        return 1;
                    }
                    // Seed the loop so accepting every default rebuilds a list of the stored length T:
                    // default to yes after each of the first T − 1 reviewers and to no at reviewer T.
                    // With no configuration read the question keeps its fresh default (none).
                    const moreDefault = storedReviewers !== undefined
                        ? (idx < storedReviewers.length ? "yes" : "no")
                        : undefined;
                    const more = await promptChoice(contexts.ask, {
                        header: "Configure another reviewer?",
                        question: "Okely-dokely — care to configure another reviewer?",
                        options: [
                            { label: "no", description: "Stop adding reviewers" },
                            { label: "yes", description: "Configure another reviewer in the ordered list" }
                        ],
                        defaultLabel: moreDefault
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
                const fastDiagnostic = validateFastFlagsForReviewerCount(answers.fastReviewerIndices, reviewers.length);
                if (fastDiagnostic !== null) {
                    contexts.output.writeError(fastDiagnostic);
                    return 1;
                }
            }
            // A single reviewer has no weighted-review question: it is required and the minimum is 1.
            // Two or more reviewers are collected directly, with no gate question — the minimum first
            // (a free-text numeric entry whose empty-input default is the stored minimumReviews,
            // clamped to the current reviewer count, or the reviewer count T when no configuration was
            // read; an entry outside [1, T] is re-prompted), then, only when the chosen minimum is
            // below T, each reviewer's optional flag (defaulting to the stored reviewer's optional, or
            // required when none was read). A minimum equal to T forces every reviewer to run to a
            // verdict, so no optional question is asked and every reviewer is required. Each value is
            // taken from its flag when present, otherwise asked through the shared prompt helper.
            let minimumReviews:number;
            const reviewerConfigs:FlandersReviewer[] = [];
            if (reviewers.length === 1) {
                minimumReviews = 1;
                reviewerConfigs.push({ ...reviewers[0]!, optional: false });
            } else {
                const reviewerCount = reviewers.length;
                // The minimum's empty-input default is the stored minimumReviews clamped to the current
                // reviewer count; with no configuration read it falls back to the reviewer count.
                const minimumDefault = storedConfig !== null
                    ? Math.min(storedConfig.minimumReviews, reviewerCount)
                    : reviewerCount;
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
                            placeholder: `1-${reviewerCount}, empty for ${minimumDefault}`,
                            default: String(minimumDefault)
                        });
                        if (entry === null) {
                            return 1;
                        }
                        if (this._disposed) {
                            return 1;
                        }
                        const trimmed = entry.trim();
                        const parsed = Number(trimmed);
                        if (/^\d+$/.test(trimmed) && parsed >= 1 && parsed <= reviewerCount) {
                            chosen = parsed;
                        } else {
                            contexts.output.write(`Whoopsie — enter an integer between 1 and ${reviewerCount}, or leave empty for ${minimumDefault}.\n`);
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
                            // Default to the stored reviewer's optional flag at this position; a fresh
                            // position (no stored reviewer) defaults to "no" (required).
                            const optionalDefault = storedReviewers?.[i]?.optional === true ? "yes" : "no";
                            const optionalOption = await promptChoice(contexts.ask, {
                                header: `Reviewer ${i + 1} optional`,
                                question: `Is reviewer ${i + 1} (${reviewer.tool} · ${modelLabel} · ${effortLabel}) optional?`,
                                options: [
                                    { label: "no", description: "Required — always waits out its rate-limit waits; the round never completes without its verdict" },
                                    { label: "yes", description: "Optional — reviews exactly like a required reviewer; the only difference is the round abandons it while it is in a rate-limit wait, once every required reviewer is in and the minimum is met" }
                                ],
                                defaultLabel: optionalDefault
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
            const writtenPaths:string[] = [];
            // Emit each selected tool's skill trio into its own destination, in selection order.
            for (const tool of skillsTools) {
                const result = await writeSkillArtifacts(contexts.fs, scopeRoot, tool, () => this._disposed);
                if (!result.ok) {
                    if (result.diagnostic !== null) {
                        contexts.output.writeError(result.diagnostic);
                    }
                    return 1;
                }
                writtenPaths.push(...result.writtenPaths);
            }
            /* coverage ignore next 3 */ // — Defensive: no await between the previous disposed guard and this point.
            if (this._disposed) {
                return 1;
            }
            const config:FlandersConfig = {
                worker: { tool: workerTool, model: workerModel, effort: workerEffort, fast: workerFast },
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
