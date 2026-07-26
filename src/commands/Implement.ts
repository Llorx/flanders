import { isFatalLoginError } from "../ai/AiRunner";
import { AiSession } from "../ai/AiSession";
import { ClaudeAdapter } from "../ai/ClaudeAdapter";
import { CodexAdapter } from "../ai/CodexAdapter";
import type { AskContext, ChoiceOption, FsContext, OutputContext, RandomContext, ScriptContext, TimeContext } from "../contexts";
import { disposeOnce } from "../disposeOnce";
import type { ToolAdapter, ToolName, ToolTokenUsage } from "../ai/ToolAdapter";
import type { FlandersConfig, FlandersRole } from "../workspace/FlandersConfig";
import { read as readConfig } from "../workspace/FlandersConfig";
import { isNonEmptyFile, joinPath, listFilesRecursive } from "../system/fsUtils";
import { isGitAvailable, isInsideWorkTree, countUnstagedChangesExcept, addAll, commit } from "../system/Git";
import { discoverSpecs } from "../workspace/SpecDiscovery";
import { PlanFile, PlanTask, buildSpecFileContent } from "../plan/PlanFile";
import { Placeholders, linkedReferenceDirective, prompts } from "../prompts/prompts";
import { ScriptRunner } from "../system/ScriptRunner";
import { BottomBlock } from "../ui/BottomBlock";
import type { Activity, ReviewerEntry, ReviewerState, TerminalLabel } from "../ui/BottomBlock";
import { formatDateTime, formatSnapshotBlock } from "../ui/formatters";
import { tryAskChoice } from "../ui/PromptHelper";
import { allTasksCompletedPool, pickVariant, tasksCompletedPool } from "../voiceVariants";
import { PlatformContext, Workspace, WorkspacePaths } from "../workspace/Workspace";

export type { Activity };

const MAX_ITER = 5;

// The marker the implement command prepends to a plan file's name once the plan is fully
// complete. It sits at the very start of the name, ahead of every other part of it; a name that
// already begins with it is returned unchanged, so the completed name carries the marker once.
const COMPLETED_PLAN_MARKER = "V-";

// Computes the marked name a completed plan file takes: the plan's name with the completion
// marker prepended to its basename, directory and the rest of the name preserved. A name whose
// basename already begins with the marker is returned unchanged.
export function completedPlanPath(planPath:string):string {
    const slash = Math.max(planPath.lastIndexOf("/"), planPath.lastIndexOf("\\"));
    const dir = planPath.slice(0, slash + 1);
    const base = planPath.slice(slash + 1);
    if (base.startsWith(COMPLETED_PLAN_MARKER)) {
        return planPath;
    }
    return `${dir}${COMPLETED_PLAN_MARKER}${base}`;
}

// The diagnostic a fatal authentication/login failure hard-stops with. It identifies no task because
// the failure belongs to the configured tool rather than to any task, and can arrive from the detect
// agent before the first task is even picked.
function loginFailureDiagnostic(workspaceRoot:string):string {
    return `Hard stop: the configured AI tool is not logged in. Log in and re-run. Inspect logs at ${workspaceRoot}.\n`;
}

class LineBufferedBlock {
    private _stdoutBuf = "";
    private _stderrBuf = "";
    constructor(private _block:BottomBlock) {}
    write(text:string):void {
        this._stdoutBuf = this._emit(this._stdoutBuf + text);
    }
    writeError(text:string):void {
        this._stderrBuf = this._emit(this._stderrBuf + text);
    }
    flush():void {
        /* coverage ignore next 8 */ // — AiSession always appends trailing newlines; buffers are empty when flush() runs.
        if (this._stdoutBuf) {
            this._block.writeAbove(this._stdoutBuf);
            this._stdoutBuf = "";
        }
        if (this._stderrBuf) {
            this._block.writeAbove(this._stderrBuf);
            this._stderrBuf = "";
        }
    }
    // Answers with the text still to hold back. A partial line waits for its newline only while the
    // block is mounted: held back before that, it would hide a prompt waiting for input on that line.
    private _emit(pending:string):string {
        if (pending.length === 0) {
            return "";
        }
        if (!this._block.isMounted()) {
            this._block.writeAbove(pending);
            return "";
        }
        const idx = pending.lastIndexOf("\n");
        if (idx === -1) {
            return pending;
        }
        this._block.writeAbove(pending.slice(0, idx + 1));
        return pending.slice(idx + 1);
    }
}

export type ImplementContexts = Readonly<{
    claude:ScriptContext;
    script:ScriptContext;
    fs:FsContext;
    time:TimeContext;
    random:RandomContext;
    platform:PlatformContext;
    ask:AskContext;
    output:OutputContext;
    /**
     * Supplies the tool adapter for a configured tool instead of the built-in one. Production omits
     * it. Present for testing: how the orchestrator responds to a runner outcome is otherwise
     * observable only by making a real adapter classify a native tool event into that outcome, which
     * couples the orchestrator's own behavior to whichever adapter the scenario happens to spawn.
     */
    adapter?:(tool:ToolName) => ToolAdapter;
}>;

export type ImplementOptions = Readonly<{
    projectRoot:string;
}>;

type RunningSession = { session:AiSession };
type RunningScript = { script:ScriptRunner };
// A per-stage failure retained across a task's iterations and written into the main temporary
// folder on a hard stop: the destination path the failing stage materializes to, and the captured
// content to write there. One authoritative shape for every materialized stage — build, test,
// commit, and each reviewer — so the hard-stop write is a single uniform loop with no per-stage
// branching.
type RetainedErrorLog = { path:string; content:string };

// The orchestrator's per-reviewer logical status for the round-completion decision. It is distinct
// from the UI reviewer state (`running`/`waiting`/`pass`/`fail`): a `done` reviewer renders as `pass` or
// `fail`, and a reviewer in a short transient-error backoff stays `running`, never `waiting`.
type ReviewerLogicalStatus = "running" | "waiting" | "done";

type RunAiCallbacks = {
    onLongWaitStart:(kind:"rate-limit", endTimeMs:number) => void;
    onLongWaitEnd:() => void;
    register:(session:AiSession) => void;
    unregister:(session:AiSession) => void;
};

export class Implement {
    private _disposed = false;
    private _config:FlandersConfig|null = null;
    private _contractList:readonly string[] = [];
    private _ruleList:readonly string[] = [];
    private _behaviorRuleList:readonly string[] = [];
    private _workspace:Workspace|null = null;
    private _block:BottomBlock|null = null;
    // The channel every write of this command flows through, held apart from `_block` because
    // teardown drops the block before disposing it, yet a diagnostic escaping that disposal still
    // has to reach it.
    private _ownerChannel:OutputContext|null = null;
    private _buffered!:LineBufferedBlock;
    private _currentWorkerSessionId:string|null = null;
    // Running token total already attributed to the current worker session, fed back as the
    // resume baseline (priorSessionUsage) so a tool that reports session-cumulative usage surfaces
    // only the new iteration's own consumption. Reset per task; restarted whenever a new worker
    // session id is established (see _workerStage).
    private _workerSessionTokens:ToolTokenUsage = { inputTokens: 0, outputTokens: 0 };
    private _activeSession:RunningSession|null = null;
    private _activeScript:RunningScript|null = null;
    private _activeReviewerSessions:Set<AiSession> = new Set();
    private _reviewerStates:ReviewerEntry[]|null = null;
    private _reviewerLogicalStatuses:ReviewerLogicalStatus[] = [];
    private _reviewerAbortControllers:Map<number, AbortController> = new Map();
    private _cancelledReviewers:Set<number> = new Set();
    private _promptControllers:Set<AbortController> = new Set();
    private _promptOperations:Set<Promise<unknown>> = new Set();
    private _currentIndexLabel = "";
    private _currentIteration = 0;
    // Per-task retention of each failing iteration's captured stage output as ready-to-write
    // error-log files (the main-folder path the failure materializes to, plus the captured
    // content). On a hard stop these are written into the main temporary folder before the briefing
    // error.log is removed. Reset at the start of every task so 1-based iteration numbers never
    // collide across tasks. The worker stage and the pre-build staging of the worker's output are
    // not among the four stages, so neither is retained here; empty-verdict reviewers and reviewers
    // cancelled at round completion contribute nothing.
    private _retainedMaterializations:RetainedErrorLog[] = [];
    private _currentTask:PlanTask|null = null;
    private _taskStartedAt:number = 0;
    // Total milliseconds excluded from the current task's active working time:
    // completed worker-stage rate-limit waits plus completed review-stage pauses
    // (spans during which no reviewer was running). Both _activeSeconds() and the
    // anchor _updateMetrics pushes subtract it, so the persisted `t` and the live
    // counter exclude the same spans.
    private _taskExcludedMs:number = 0;
    private _taskRateLimitStartedAt:number|null = null;
    // The clock value at which the current review-stage pause began — set while no
    // reviewer is running (every reviewer waiting or at its verdict), null while at
    // least one runs. Folded into _taskExcludedMs when a reviewer returns to
    // running or the review stage ends.
    private _reviewPauseStartedAt:number|null = null;
    private _taskTokens = {it:0, ot:0};
    // Accumulated active seconds of every task in the plan OTHER than the in-progress
    // one, snapshotted at task start (the other tasks' persisted `t` does not change
    // while the current task runs). The plan time the block renders is the in-progress
    // task's live active time plus this constant, so it ticks in lockstep with the task
    // time instead of lagging behind the persisted `plan.planTotals().t`.
    private _otherTasksSeconds = 0;
    private _runPromise:Promise<number>;
    /** Public for testing: the stashed config is otherwise observable only as downstream AI invocation arguments (tool/model/effort). */
    get config():FlandersConfig|null { return this._config; }
    constructor(
        rawArgs:readonly string[],
        private _options:ImplementOptions,
        private _contexts:ImplementContexts
    ) {
        this._runPromise = this._run(rawArgs);
        /* coverage ignore next */ // — Defensive: _runPromise is always awaited via result() or dispose().
        this._runPromise.catch(() => {});
    }
    result():Promise<number> {
        return this._runPromise;
    }
    output():OutputContext {
        return this._ownerChannel ?? this._contexts.output;
    }
    private async _run(rawArgs:readonly string[]):Promise<number> {
        const block = new BottomBlock({
            write: text => this._contexts.output.write(text),
            columns: () => this._contexts.output.columns(),
            onResize: listener => this._contexts.output.onResize(listener)
        }, this._contexts.time, this._contexts.random);
        this._block = block;
        this._buffered = new LineBufferedBlock(block);
        this._ownerChannel = this._bufferedOutputContext();
        try {
            const positional:string[] = [];
            for (const arg of rawArgs) {
                if (arg.startsWith("-")) {
                    this._ensureBlockMounted();
                    this._buffered.writeError(`Unknown flag: ${arg}\n`);
                    this._finalizeBlock("Failed");
                    return 1;
                } else {
                    positional.push(arg);
                }
            }
            const config = await readConfig(this._contexts.fs, {
                projectRoot: this._options.projectRoot,
                homeDir: this._contexts.platform.homedir()
            });
            if (config === null) {
                this._ensureBlockMounted();
                this._buffered.writeError("Missing Flanders configuration. Run 'npx flanders install'.\n");
                this._finalizeBlock("Failed");
                return 1;
            }
            this._config = config;
            const planPath = await this._selectPlan(positional);
            if (this._disposed) {
                this._finalizeBlock("Interrupted");
                return 1;
            }
            if (!planPath) {
                this._finalizeBlock("Failed");
                return 1;
            }
            this._ensureBlockMounted();
            const plan = await PlanFile.load(planPath, this._contexts.fs);
            const initialParse = plan.parse();
            if (initialParse.malformed.length > 0) {
                this._buffered.writeError(`Plan ${planPath} contains malformed checkbox lines:\n`);
                for (const m of initialParse.malformed) {
                    this._buffered.writeError(`  line ${m.line}: ${m.raw}\n`);
                }
                this._finalizeBlock("Failed");
                return 1;
            }
            if (initialParse.tasks.length === 0) {
                this._buffered.writeError(`Plan ${planPath} has no task lines.\n`);
                this._finalizeBlock("Failed");
                return 1;
            }
            const totalTasks = initialParse.tasks.length;
            const planTotals = plan.planTotals();
            if (initialParse.tasks.every(t => t.done)) {
                this._block!.setHeader({ indexLabel: `${totalTasks}/${totalTasks}` });
                this._block!.setMetrics({ plan: { tokens: planTotals.it + planTotals.ot, baseSeconds: planTotals.t } });
                this._buffered.write(`${pickVariant(tasksCompletedPool, this._contexts.random)}\n`);
                this._finalizeBlock("Done");
                return 0;
            }
            // Seed the header index from the moment the plan is parsed: the numerator is the number
            // of tasks already complete at startup (the all-complete N/N case returns above), so a
            // partially-complete plan shows e.g. 3/12 and an untouched one 0/12. The same seeded
            // label is reused for the detection-phase header below.
            const completedAtStartup = initialParse.tasks.filter(t => t.done).length;
            const startupIndexLabel = `${completedAtStartup}/${totalTasks}`;
            this._block!.setHeader({ indexLabel: startupIndexLabel });
            this._block!.setMetrics({ plan: { tokens: planTotals.it + planTotals.ot, baseSeconds: planTotals.t } });
            const gitAvailable = await isGitAvailable(this._contexts.script, this._contexts.time);
            const insideWorkTree = gitAvailable && await isInsideWorkTree(this._contexts.script, this._contexts.time, this._options.projectRoot);
            if (!insideWorkTree) {
                this._buffered.writeError("The project must be a git repository. Flanders implement requires git on PATH and the project root inside a git work tree.\n");
                this._finalizeBlock("Failed");
                return 1;
            }
            const pending = await countUnstagedChangesExcept(this._contexts.script, this._contexts.time, this._options.projectRoot, planPath);
            if (pending > 0) {
                this._buffered.writeError("Working tree has unstaged changes. Please stage, commit, or stash them before re-running.\n");
                this._finalizeBlock("Failed");
                return 1;
            }
            const specs = await discoverSpecs(this._contexts.script, this._contexts.time, this._options.projectRoot);
            this._contractList = specs.contracts;
            this._ruleList = specs.rules;
            this._behaviorRuleList = specs.flanders;
            this._workspace = new Workspace(this._contexts.fs, this._contexts.platform);
            const wsPaths = await this._workspace.setup(this._config.reviewers.length);
            // During the build-and-test detection phase — after the git preflight has passed and
            // before the iteration loop — the header shows the seeded index followed by the phase
            // message, with the iteration, activity, task-number and title fields blank (no task is
            // selected yet). The fields are passed structured, never as a precomputed string, so the
            // live header recomputes its colour and width-fit on each redraw per
            // src/ui/.spec/rules/ui-behavior.md#live-terminal-regions-redraw-from-structured-state.
            // The message clears on its own when the first task's worker stage calls _setActivity,
            // which replaces the whole header with that task's per-task fields.
            this._block!.setHeader({ indexLabel: startupIndexLabel, phaseMessage: "preparing build and test scripts" });
            await this._detectBuildAndTest(wsPaths);
            /* coverage ignore next 4 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                this._finalizeBlock("Interrupted");
                return 1;
            }
            for (;;) {
                /* coverage ignore next 4 */ // — Defensive: disposed guard between async operations.
                if (this._disposed) {
                    this._finalizeBlock("Interrupted");
                    return 1;
                }
                const open = plan.nextOpenTask();
                if (!open) {
                    break;
                }
                const refreshed = plan.parse();
                const completedSoFar = refreshed.tasks.filter(t => t.done).length;
                const indexLabel = `${completedSoFar + 1}/${totalTasks}`;
                const taskOk = await this._runTask(plan, open, wsPaths, indexLabel);
                if (this._disposed) {
                    this._finalizeBlock("Interrupted");
                    return 1;
                }
                if (!taskOk) {
                    this._finalizeBlock("Hard stop");
                    return 1;
                }
            }
            this._buffered.write(`${pickVariant(allTasksCompletedPool, this._contexts.random)}\n`);
            this._finalizeBlock("Done");
            return 0;
        } catch (e) {
            if (isFatalLoginError(e)) {
                await this._hardStop(loginFailureDiagnostic(this._workspace!.paths().root));
                this._finalizeBlock("Hard stop");
                return 1;
            }
            if (!this._disposed) {
                this._ensureBlockMounted();
                this._buffered.writeError(`${this._errorMessage(e)}\n`);
            }
            /* coverage ignore next */ // — Defensive: _disposed is only true when dispose() races with _run(); tested via dispose-during-execution.
            this._finalizeBlock(this._disposed ? "Interrupted" : "Failed");
            return 1;
        }
    }
    private async _selectPlan(rawArgs:readonly string[]):Promise<string|null> {
        const plansFolder = joinPath(this._options.projectRoot, "plans");
        if (rawArgs.length > 0) {
            const arg = rawArgs.length === 1 ? rawArgs[0]! : rawArgs.join(" ");
            const direct = arg;
            if (await this._contexts.fs.exists(direct)) {
                return direct;
            }
            const inFolder = joinPath(plansFolder, arg);
            if (await this._contexts.fs.exists(inFolder)) {
                return inFolder;
            }
            this._ensureBlockMounted();
            this._buffered.writeError(`Plan file not found: ${arg}\n`);
            return null;
        }
        const files = await listFilesRecursive(this._contexts.fs, plansFolder);
        if (files.length === 0) {
            this._ensureBlockMounted();
            this._buffered.writeError(`No plan files found in ${plansFolder}.\n`);
            return null;
        }
        if (files.length === 1) {
            return joinPath(plansFolder, files[0]!);
        }
        return await this._pickPlan(plansFolder, files);
    }
    private async _pickPlan(plansFolder:string, files:readonly string[]):Promise<string|null> {
        const entries:Array<{ name:string; mtimeMs:number; listingIndex:number; label:string }> = [];
        for (const name of files) {
            const { mtimeMs } = await this._contexts.fs.stat(joinPath(plansFolder, name));
            if (this._disposed) {
                return null;
            }
            entries.push({
                name,
                mtimeMs,
                listingIndex: entries.length,
                label: `${name} — ${formatDateTime(new Date(mtimeMs))}`
            });
        }
        entries.sort((a, b) => a.mtimeMs - b.mtimeMs || a.listingIndex - b.listingIndex);
        const options = entries.map(e => ({ label: e.label }));
        const controller = new AbortController();
        this._promptControllers.add(controller);
        const prompt = tryAskChoice(this._contexts.ask, {
            header: "Plan pickin' time",
            question: "Which plan should I work on, neighborino?",
            options,
            defaultLabel: entries[entries.length - 1]!.label
        }, this._ownerChannel!, controller.signal);
        this._promptOperations.add(prompt);
        let chosen:ChoiceOption|null;
        try {
            chosen = await prompt;
        } finally {
            this._promptControllers.delete(controller);
            this._promptOperations.delete(prompt);
        }
        // The answer only counts if teardown did not begin while this continuation was queued: the
        // controller is gone by now, so nothing else can stop the run from mounting the block.
        if (!chosen || this._disposed) {
            return null;
        }
        return joinPath(plansFolder, entries.find(e => e.label === chosen.label)!.name);
    }
    private _ensureBlockMounted():void {
        this._block!.mount();
    }
    private async _detectBuildAndTest(ws:WorkspacePaths):Promise<void> {
        const prompt = prompts.detectBuildAndTest
            .split(Placeholders.BUILD_SCRIPT_PATH).join(ws.buildScript)
            .split(Placeholders.TEST_SCRIPT_PATH).join(ws.testScript)
            .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList));
        await this._runAi(this._config!.worker.tool, this._config!.worker.model, this._config!.worker.effort, this._config!.worker.fast, prompt);
    }
    private _setActivity(activity:Activity):void {
        /* coverage ignore next */ // — Defensive: _setActivity is only called within _runTask which always sets _currentTask.
        if (!this._currentTask) return;
        this._block!.setHeader({
            indexLabel: this._currentIndexLabel,
            iteration: this._currentIteration,
            activity,
            taskNumber: this._currentTask.taskNumber || undefined,
            title: this._currentTask.title
        });
    }
    private _activeSeconds():number {
        return Math.max(0, Math.floor((this._contexts.time.now() - this._taskStartedAt - this._taskExcludedMs) / 1000));
    }
    private async _persistMetrics(plan:PlanFile, line:number):Promise<void> {
        try {
            await plan.updateMetrics(line, {it:this._taskTokens.it, ot:this._taskTokens.ot, t:this._activeSeconds()});
        } catch (e) {
            this._buffered.writeError(`metrics persist failed: ${this._stringifyError(e)}\n`);
        }
    }
    private _updateMetrics(plan:PlanFile):void {
        /* coverage ignore next */ // — Defensive: _updateMetrics is only called when _currentTask is set and outside rate-limit windows.
        if (!this._currentTask || this._taskRateLimitStartedAt !== null) return;
        const planTotals = plan.planTotals();
        // The active-time anchor the block measures the live seconds from: the
        // in-progress task's start shifted forward by every completed excluded span
        // (rate-limit waits and review-stage pauses), so floor((now - anchorMs)/1000)
        // equals _activeSeconds(). Both pairs share the anchor; the plan pair adds
        // the other tasks' accumulated active seconds as its static base, so the two
        // times tick together.
        const anchorMs = this._taskStartedAt + this._taskExcludedMs;
        this._block!.setMetrics({
            task: { tokens: this._taskTokens.it + this._taskTokens.ot, anchorMs, baseSeconds: 0 },
            plan: { tokens: planTotals.it + planTotals.ot, anchorMs, baseSeconds: this._otherTasksSeconds }
        });
    }
    private _bufferedOutputContext():OutputContext {
        return {
            write: text => this._buffered.write(text),
            writeError: text => this._buffered.writeError(text),
            columns: () => this._contexts.output.columns(),
            rows: () => this._contexts.output.rows(),
            onResize: listener => this._contexts.output.onResize(listener)
        };
    }
    private async _runTask(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, indexLabel:string):Promise<boolean> {
        this._currentTask = task;
        this._currentIndexLabel = indexLabel;
        this._currentWorkerSessionId = null;
        this._workerSessionTokens = { inputTokens: 0, outputTokens: 0 };
        this._taskStartedAt = this._contexts.time.now();
        this._taskExcludedMs = 0;
        this._taskRateLimitStartedAt = null;
        this._reviewPauseStartedAt = null;
        this._taskTokens = {it:0, ot:0};
        // The retained per-iteration failure history is per task: reset it so a hard stop
        // materializes only this task's iterations and their 1-based counters never collide with a
        // previously-completed task's.
        this._retainedMaterializations = [];
        // The other tasks' accumulated active time is the plan total minus this
        // task's own persisted `t`; it stays constant while this task runs because
        // only this task's line is rewritten, so it is snapshotted once here.
        this._otherTasksSeconds = plan.planTotals().t - task.metrics.t;
        this._updateMetrics(plan);
        let iteration = 0;
        for (;;) {
            iteration++;
            this._currentIteration = iteration;
            if (iteration > MAX_ITER) {
                // Exceeding the iteration cap is one of the two hard-stop triggers: finalize with the
                // task-identifying, workspace-pointing cap diagnostic (see the Hard stop section of
                // the iteration-loop contract).
                await this._hardStop(`Hard stop: task at line ${task.line} ("${task.title}") exceeded ${MAX_ITER} iterations. Inspect logs at ${ws.root}.\n`);
                return false;
            }
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return false;
            }
            this._setActivity("implementing");
            const workerOk = await this._workerStage(plan, task, ws, iteration);
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return false;
            }
            if (!workerOk) {
                continue;
            }
            // The other hard-stop trigger: the worker declared the task structurally impossible by
            // leaving a `hard-stop.log` in the main folder. Both the presence check and the content
            // read go through the injected filesystem context. When present, the run stops directly —
            // the same finalization the iteration cap runs — so this iteration's staging, build, test
            // and review never run and the declared `hard-stop.log` survives in the preserved folder.
            // The diagnostic identifies the task by line and title, reproduces the declared content,
            // and points at the preserved folder (see iteration-loop.md#hard-stop).
            if (await this._contexts.fs.exists(ws.hardStopLog)) {
                const declared = await this._contexts.fs.readFile(ws.hardStopLog);
                await this._hardStop(`Hard stop: task at line ${task.line} ("${task.title}") declared structurally impossible.\n--- hard-stop.log ---\n${declared}\n--- end hard-stop.log ---\nInspect logs at ${ws.root}.\n`);
                return false;
            }
            const workerAddResult = await addAll(this._contexts.script, this._contexts.time, this._ownerChannel!, this._options.projectRoot);
            if (workerAddResult.code !== 0) {
                await this._writeErrorLog(ws, `git add -A failed (exit ${workerAddResult.code})\n--- stdout ---\n${workerAddResult.stdout}\n--- stderr ---\n${workerAddResult.stderr}`);
                continue;
            }
            this._setActivity("building");
            const buildOk = await this._buildStage(plan, task.line, ws, iteration);
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return false;
            }
            if (!buildOk) {
                continue;
            }
            this._setActivity("testing");
            const testOk = await this._testStage(plan, task.line, ws, iteration);
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return false;
            }
            if (!testOk) {
                continue;
            }
            this._setActivity("reviewing");
            const reviewOk = await this._reviewerStage(plan, task, ws, iteration);
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return false;
            }
            this._block!.setFooter({ kind: "working" });
            if (!reviewOk) {
                continue;
            }
            await plan.markDone(task.line, {it:this._taskTokens.it, ot:this._taskTokens.ot, t:this._activeSeconds()});
            // When this task was the last open one, the plan is now complete: rename the plan file
            // to mark it before staging, so the same `git add -A`/commit that finalizes the task
            // captures the rename and the working tree is left clean. If the staging or commit then
            // fails, the rename is reverted alongside the checkbox so the loop restarts from the
            // original on-disk state.
            const originalPlanPath = plan.path;
            let completionRenamed = false;
            if (plan.nextOpenTask() === null) {
                const completedPath = completedPlanPath(originalPlanPath);
                if (completedPath !== originalPlanPath) {
                    await plan.rename(completedPath);
                    completionRenamed = true;
                }
            }
            const revertCompletion = async () => {
                if (completionRenamed) {
                    await plan.rename(originalPlanPath);
                }
                await plan.markOpen(task.line, {it:this._taskTokens.it, ot:this._taskTokens.ot, t:this._activeSeconds()});
            };
            const commitMessage = task.taskNumber ? `${task.taskNumber} ${task.title}` : task.title;
            const addResult = await addAll(this._contexts.script, this._contexts.time, this._ownerChannel!, this._options.projectRoot);
            if (addResult.code !== 0) {
                const briefing = `git add -A failed (exit ${addResult.code})\n--- stdout ---\n${addResult.stdout}\n--- stderr ---\n${addResult.stderr}`;
                this._retainedMaterializations.push({ path: ws.commitErrorLog(iteration), content: briefing });
                await this._writeErrorLog(ws, briefing);
                await revertCompletion();
                continue;
            }
            const commitResult = await commit(this._contexts.script, this._contexts.time, this._ownerChannel!, this._options.projectRoot, commitMessage);
            if (commitResult.code !== 0) {
                const briefing = `git commit failed (exit ${commitResult.code})\n--- stdout ---\n${commitResult.stdout}\n--- stderr ---\n${commitResult.stderr}`;
                this._retainedMaterializations.push({ path: ws.commitErrorLog(iteration), content: briefing });
                await this._writeErrorLog(ws, briefing);
                await revertCompletion();
                continue;
            }
            const planTotals = plan.planTotals();
            const snapshot = formatSnapshotBlock(
                indexLabel,
                iteration,
                task.taskNumber || undefined,
                task.title,
                this._taskTokens.it + this._taskTokens.ot,
                this._activeSeconds(),
                planTotals.it + planTotals.ot,
                planTotals.t,
                this._contexts.output.columns()
            );
            this._block!.writeAbove(snapshot);
            this._updateMetrics(plan);
            return true;
        }
    }
    private async _workerStage(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, iteration:number):Promise<boolean> {
        // Iteration 1 is a fresh invocation: the orchestrator injects the full task text and (via
        // _buildSpecContent) consolidates the full content of every referenced contract and rule
        // into the worker's `spec.md`, then directs the worker to read it. Iterations n>1 do NOT
        // re-inject the task text or the referenced content (per
        // src/commands/.spec/rules/ai/task-context.md):
        //   - when the worker's session was captured, it resumes and a continuity note stands in;
        //   - when no session is available, the iteration is a fresh fallback, so the worker is told
        //     which task to implement and directed to reread the consolidated `spec.md` iteration 1
        //     left in the temporary folder rather than reopening each referenced file.
        let taskText:string;
        if (iteration === 1) {
            taskText = plan.fullTaskText(task);
        } else if (this._currentWorkerSessionId !== null) {
            taskText = "(The full task text and the contracts and rules it references were provided when this session began and remain available to you through session continuity; they are not repeated here.)";
        } else {
            taskText = `(Your previous session for this task could not be resumed, so this is a fresh invocation. You are continuing work on the task at line ${task.line} of the plan file, titled "${task.title}". The task text and its referenced content are not re-injected here: re-read that task from the plan file, and for the contracts and rules it references reread the consolidated spec.md the orchestrator left in the temporary folder at ${ws.specFile} — read that single file rather than reopening each referenced file — then address the previous-iteration briefing below.)`;
        }
        let prompt = prompts.worker
            .split(Placeholders.PLAN_PATH).join(plan.path)
            .split(Placeholders.TASK_TEXT).join(taskText)
            .split(Placeholders.BUILD_SCRIPT_PATH).join(ws.buildScript)
            .split(Placeholders.TEST_SCRIPT_PATH).join(ws.testScript)
            .split(Placeholders.HARD_STOP_LOG_PATH).join(ws.hardStopLog)
            .split(Placeholders.CONTRACT_LIST).join(this._formatPathList(this._contractList))
            .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList))
            .split(Placeholders.BEHAVIOR_RULE_LIST).join(this._formatPathList(this._behaviorRuleList));
        if (iteration > 1) {
            const briefing = prompts.previousIterationBriefing
                .split(Placeholders.ITERATION).join(String(iteration))
                .split(Placeholders.ERROR_LOG_PATH).join(ws.errorLog);
            prompt = `${prompt}\n\n${briefing}`;
        }
        try {
            // Iteration 1 consolidates the referenced content into the worker's `spec.md` here,
            // inside the try, so a failure to read a referenced file surfaces as a worker-stage
            // failure (briefing written to error.log, the inner loop restarted) rather than escaping
            // the stage. The only hard-stop exit remains exceeding the per-task iteration cap (see
            // iteration-loop.md). The task text stays in the prompt; the referenced content goes to
            // `spec.md`, which the appended directive points the worker at. Iterations n>1 do not
            // regenerate `spec.md` — the one written here is left in the temporary folder.
            if (iteration === 1) {
                await this._contexts.fs.writeFile(ws.specFile, await this._buildSpecContent(plan, task));
                prompt = `${prompt}\n\n${linkedReferenceDirective(ws.specFile)}`;
            }
            const { result, capturedOutput } = iteration === 1
                ? await this._runAi(this._config!.worker.tool, this._config!.worker.model, this._config!.worker.effort, this._config!.worker.fast, prompt, null, this._workerSessionTokens)
                : await this._runAi(this._config!.worker.tool, this._config!.worker.model, this._config!.worker.effort, this._config!.worker.fast, prompt, this._currentWorkerSessionId, this._workerSessionTokens);
            if (result.sessionId !== null && result.sessionId !== this._currentWorkerSessionId) {
                // A new worker session was established (iteration 1, or a fresh fallback/renegotiation
                // that abandoned the previous session). The resume baseline restarts from this run's
                // own reported consumption, since the new session's cumulative usage starts here.
                this._currentWorkerSessionId = result.sessionId;
                this._workerSessionTokens = { inputTokens: result.inputTokens, outputTokens: result.outputTokens };
            } else {
                // Same session resumed: add this iteration's own consumption onto the session baseline,
                // so the next resume subtracts the full running total of prior iterations.
                this._workerSessionTokens = {
                    inputTokens: this._workerSessionTokens.inputTokens + result.inputTokens,
                    outputTokens: this._workerSessionTokens.outputTokens + result.outputTokens
                };
            }
            this._taskTokens.it += result.inputTokens;
            this._taskTokens.ot += result.outputTokens;
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            await this._writeLog(ws.workerLog(iteration), capturedOutput);
            return true;
        } catch (e) {
            if (isFatalLoginError(e)) {
                throw e;
            }
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            await this._writeErrorLog(ws, `worker stage failed: ${this._stringifyError(e)}`);
            return false;
        }
    }
    // Builds the consolidated `spec.md` content for a task: it resolves the task's references,
    // reads each distinct referenced file once, and delegates to buildSpecFileContent, which
    // narrows a heading-anchored reference to its section and keeps an unanchored or line-anchored
    // reference whole. This single source feeds both the worker's `spec.md` (iteration 1) and every
    // reviewer's own `spec.md`. The contract requires consolidating the FULL referenced content
    // (see .spec/contracts/cli-commands/implement/iteration-loop.md); a read failure is not papered
    // over with a placeholder — the readFile rejection propagates to the caller, which treats it as
    // a stage failure rather than launching the agent without the obligation it is bound to.
    private async _buildSpecContent(plan:PlanFile, task:PlanTask):Promise<string> {
        const references = plan.linkedReferences(task);
        const fileContents = new Map<string, string>();
        for (const { path } of references) {
            if (!fileContents.has(path)) {
                fileContents.set(path, await this._contexts.fs.readFile(joinPath(this._options.projectRoot, path)));
            }
        }
        return buildSpecFileContent(references, fileContents);
    }
    private async _buildStage(plan:PlanFile, taskLine:number, ws:WorkspacePaths, iteration:number):Promise<boolean> {
        if (!(await isNonEmptyFile(this._contexts.fs, ws.buildScript))) {
            return true;
        }
        const result = await this._runScript(ws.buildScript);
        /* coverage ignore next 3 */ // — Defensive: _runScript returns null only when disposed during spawn.
        if (result === null) {
            return false;
        }
        await this._persistMetrics(plan, taskLine);
        this._updateMetrics(plan);
        await this._writeLog(ws.buildLog(iteration), `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
        if (result.code !== 0) {
            const briefing = `build stage failed (exit ${result.code})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
            this._retainedMaterializations.push({ path: ws.buildErrorLog(iteration), content: briefing });
            await this._writeErrorLog(ws, briefing);
            return false;
        }
        return true;
    }
    private async _testStage(plan:PlanFile, taskLine:number, ws:WorkspacePaths, iteration:number):Promise<boolean> {
        if (!(await isNonEmptyFile(this._contexts.fs, ws.testScript))) {
            return true;
        }
        const result = await this._runScript(ws.testScript);
        /* coverage ignore next 3 */ // — Defensive: _runScript returns null only when disposed during spawn.
        if (result === null) {
            return false;
        }
        await this._persistMetrics(plan, taskLine);
        this._updateMetrics(plan);
        await this._writeLog(ws.testLog(iteration), `--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
        if (result.code !== 0) {
            const briefing = `test stage failed (exit ${result.code})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`;
            this._retainedMaterializations.push({ path: ws.testErrorLog(iteration), content: briefing });
            await this._writeErrorLog(ws, briefing);
            return false;
        }
        return true;
    }
    private _setReviewerState(reviewerIdx:number, state:ReviewerState):void {
        this._writeReviewerEntry(reviewerIdx, state, undefined);
    }
    // The waiting variant carries the reviewer's own rate-limit end time so the
    // reviewing footer renders that reviewer's compact countdown (recomputed from
    // the live clock on every redraw, never cached). Non-waiting states go through
    // _setReviewerState and carry no endTime; re-rendering with the non-waiting
    // variant therefore clears any previously-shown countdown.
    private _setReviewerWaiting(reviewerIdx:number, endTimeMs:number):void {
        this._writeReviewerEntry(reviewerIdx, "waiting", endTimeMs);
    }
    private _writeReviewerEntry(reviewerIdx:number, state:ReviewerState, endTime:number|undefined):void {
        /* coverage ignore next */ // — Defensive: _reviewerStates is initialized at the start of _reviewerStage before any reviewer launches.
        if (!this._reviewerStates) return;
        const entry = this._reviewerStates[reviewerIdx];
        /* coverage ignore next */ // — Defensive: callers always pass a valid in-range reviewerIdx.
        if (!entry) return;
        const next:ReviewerEntry = { tool: entry.tool, model: entry.model, effort: entry.effort, state };
        if (endTime !== undefined) {
            next.endTime = endTime;
        }
        this._reviewerStates[reviewerIdx] = next;
        this._syncReviewPause();
        this._renderReviewingFooter();
    }
    // The review stage advances the task's active time only while at least one
    // reviewer is running: a span with every reviewer waiting or at its verdict is
    // excluded, mirroring the worker rate-limit accounting so _activeSeconds() and
    // the anchor _updateMetrics pushes both leave it out. Re-synced on every
    // reviewer state transition; an already-open pause keeps its original start.
    private _syncReviewPause():void {
        if (this._reviewerStates!.some(r => r.state === "running")) {
            this._endReviewPause();
        } else {
            // A reviewer only leaves `running` from a transition in which it was
            // running, so the pause is necessarily closed when the last running
            // reviewer leaves; capturing unconditionally cannot overwrite an open one.
            this._reviewPauseStartedAt = this._contexts.time.now();
        }
    }
    private _endReviewPause():void {
        if (this._reviewPauseStartedAt !== null) {
            this._taskExcludedMs += this._contexts.time.now() - this._reviewPauseStartedAt;
            this._reviewPauseStartedAt = null;
        }
    }
    private _renderReviewingFooter():void {
        /* coverage ignore next */ // — Defensive: callers always check that _reviewerStates is populated; _block/finalized guards cover disposal races.
        if (!this._block || this._block.isFinalized() || !this._reviewerStates) return;
        this._block.setFooter({ kind: "reviewing", reviewers: this._reviewerStates.slice() });
    }
    private _setReviewerLogicalStatus(idx:number, status:ReviewerLogicalStatus):void {
        this._reviewerLogicalStatuses[idx] = status;
        // The round-completion condition can only be newly satisfied when a reviewer enters a
        // usage-limit wait (`waiting`) or finishes with a verdict (`done`); a transition back to
        // `running` never completes a round, so it does not re-evaluate.
        if (status !== "running") {
            this._evaluateReviewRoundCompletion();
        }
    }
    private _evaluateReviewRoundCompletion():void {
        const statuses = this._reviewerLogicalStatuses;
        const reviewers = this._config!.reviewers;
        // (1) No reviewer is still running (each is either in a usage-limit wait or has a verdict).
        if (statuses.some(s => s === "running")) {
            return;
        }
        // (2) Every required (non-optional) reviewer has produced a verdict.
        for (let i = 0; i < reviewers.length; i++) {
            if (!reviewers[i]!.optional && statuses[i] !== "done") {
                return;
            }
        }
        // (3) At least `minimumReviews` reviewers have produced a verdict.
        const doneCount = statuses.filter(s => s === "done").length;
        if (doneCount < this._config!.minimumReviews) {
            return;
        }
        // All three hold: cancel every reviewer still in a usage-limit wait. Because (2) requires
        // every required reviewer to already have a verdict, any still-waiting reviewer is optional.
        for (let i = 0; i < statuses.length; i++) {
            if (statuses[i] === "waiting") {
                this._cancelReviewer(i, this._reviewerAbortControllers.get(i)!);
            }
        }
    }
    // The one transition by which the orchestrator cancels a reviewer of the round, shared by every
    // caller that cancels one. The mark is what tells the reviewer apart from one that failed on its
    // own: it both stops the reviewer before it starts another invocation and identifies the
    // resulting rejection as this deliberate cancellation.
    private _cancelReviewer(idx:number, controller:AbortController):void {
        this._cancelledReviewers.add(idx);
        controller.abort();
    }
    // Cancels every reviewer of the round that has not yet returned — preparing, invoking, or
    // sitting out a usage-limit wait that would otherwise hold the round open for hours. Each such
    // reviewer holds its handle in the map from the moment it starts until its finally removes it,
    // so a reviewer whose own invocation raised the failure is already out and only its siblings
    // remain.
    private _cancelInFlightReviewers():void {
        for (const [idx, controller] of this._reviewerAbortControllers) {
            this._cancelReviewer(idx, controller);
        }
    }
    private async _reviewerStage(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, iteration:number):Promise<boolean> {
        const reviewers = this._config!.reviewers;
        this._reviewerStates = reviewers.map<ReviewerEntry>(r => ({ tool: r.tool, model: r.model, effort: r.effort, state: "running" }));
        this._reviewerLogicalStatuses = reviewers.map<ReviewerLogicalStatus>(() => "running");
        this._cancelledReviewers = new Set();
        this._renderReviewingFooter();
        for (let i = 0; i < reviewers.length; i++) {
            await this._workspace!.clearReviewerErrorLog(i + 1);
        }
        await this._workspace!.clearErrorLog();
        let failureCaught:unknown = null;
        // Kept apart from the ordinary first-error above, which it outranks: a fatal
        // authentication/login failure ends the whole run whenever in the round it surfaces, even
        // after a sibling has already failed ordinarily.
        let fatalLoginCaught:unknown = null;
        const outcomes:Array<"verdict"|"cancelled"> = reviewers.map(() => "cancelled");
        const launches = reviewers.map((reviewer, idx) => this._runOneReviewerToVerdict(plan, task, ws, iteration, reviewer, idx)
            .then(outcome => { outcomes[idx] = outcome; })
            .catch(e => {
                if (isFatalLoginError(e)) {
                    fatalLoginCaught = e;
                    this._cancelInFlightReviewers();
                } else if (failureCaught === null) {
                    failureCaught = e;
                }
            }));
        await Promise.all(launches);
        // The stage's reviewer work is over: fold any still-open pause (the span
        // since the last reviewer left running) so it does not leak into the time
        // markDone or the next stage measures.
        this._endReviewPause();
        /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
        if (this._disposed) {
            return false;
        }
        // Read every reviewer that ran to a verdict, in reviewer order, and retain each non-empty
        // verdict's own untrimmed text (tagged with its 1-based position) for the hard-stop
        // materialization. This runs before the failureCaught branch so a completed reviewer's
        // recorded violations are retained even when a sibling reviewer errored; a reviewer
        // cancelled at round completion (outcomes[i] === "cancelled") is skipped, so it contributes
        // nothing, as does an empty-verdict reviewer. Retaining here is additive: perFile still
        // holds every verdict file in reviewer order and drives the unchanged read-all / concatenate
        // / trim / test-once aggregate verdict below. Non-empty content only occurs when the stage
        // fails, so a clean pass retains nothing.
        const perFile:string[] = [];
        for (let i = 0; i < reviewers.length; i++) {
            if (outcomes[i] === "verdict") {
                const content = await this._workspace!.readReviewerErrorLog(i + 1);
                perFile.push(content);
                if (content.trim().length > 0) {
                    this._retainedMaterializations.push({ path: ws.reviewerErrorLogFor(iteration, i + 1), content });
                }
            }
        }
        if (fatalLoginCaught !== null) {
            throw fatalLoginCaught;
        }
        if (failureCaught !== null) {
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            await this._writeErrorLog(ws, `reviewer stage failed: ${this._stringifyError(failureCaught)}`);
            return false;
        }
        const aggregate = perFile.join("\n").replace(/^\s+|\s+$/g, "");
        if (aggregate.length === 0) {
            return true;
        }
        await this._workspace!.writeErrorLog(aggregate);
        return false;
    }
    private async _runOneReviewerToVerdict(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, iteration:number, reviewer:FlandersRole, idx:number):Promise<"verdict"|"cancelled"> {
        const reviewerNum = idx + 1;
        // Per-reviewer cancellation handle owned by the orchestrator: aborting it disposes whichever
        // invocation is in flight (wired below), which aborts a usage-limit wait per the
        // AiSession/AiRunner cancellation behavior. Registered ahead of the asynchronous preparation
        // below so a reviewer cancelled before its first invocation is reachable too; removed in the
        // finally so cancelled, settled, and thrown paths all clean up.
        const controller = new AbortController();
        this._reviewerAbortControllers.set(idx, controller);
        try {
            // Every reviewer invocation is fresh and receives the same deterministic injection the
            // worker's iteration 1 receives: the full task text in the prompt, and the full content of
            // every referenced contract and rule consolidated into this reviewer's own `spec.md` (its
            // SPEC_PATH placeholder resolves to that file in this reviewer's temporary folder). A read
            // failure from _buildSpecContent propagates so the reviewer stage treats it as a failure.
            const prompt = prompts.reviewer
                .split(Placeholders.PLAN_PATH).join(plan.path)
                .split(Placeholders.TASK_TEXT).join(plan.fullTaskText(task))
                .split(Placeholders.CONTRACT_LIST).join(this._formatPathList(this._contractList))
                .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList))
                .split(Placeholders.BEHAVIOR_RULE_LIST).join(this._formatPathList(this._behaviorRuleList))
                .split(Placeholders.ERROR_LOG_PATH).join(ws.reviewerErrorLog(reviewerNum))
                .split(Placeholders.SPEC_PATH).join(ws.reviewerSpecFile(reviewerNum));
            await this._contexts.fs.writeFile(ws.reviewerSpecFile(reviewerNum), await this._buildSpecContent(plan, task));
            const aggregateOutput:string[] = [];
            for (;;) {
                /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
                if (this._disposed) {
                    return "cancelled";
                }
                // A reviewer cancelled while it was preparing, or between a missing-verdict relaunch,
                // has no in-flight invocation for the abort to reach, so the mark is what stops it:
                // it never starts another invocation.
                if (this._cancelledReviewers.has(idx)) {
                    return "cancelled";
                }
                this._setReviewerState(idx, "running");
                this._setReviewerLogicalStatus(idx, "running");
                let currentSession:AiSession|null = null;
                const onAbort = () => {
                    /* coverage ignore next */ // — Defensive: the listener is removed in unregister, so a session is always registered when abort fires.
                    if (!currentSession) return;
                    void currentSession.dispose();
                };
                const callbacks:RunAiCallbacks = {
                    onLongWaitStart: (_kind, endTimeMs) => {
                        /* coverage ignore next */ // — Defensive: disposed guard during long-wait callback.
                        if (this._disposed) return;
                        this._setReviewerWaiting(idx, endTimeMs);
                        this._setReviewerLogicalStatus(idx, "waiting");
                    },
                    onLongWaitEnd: () => {
                        /* coverage ignore next */ // — Defensive: disposed guard during long-wait callback.
                        if (this._disposed) return;
                        this._setReviewerState(idx, "running");
                        this._setReviewerLogicalStatus(idx, "running");
                    },
                    register: (session) => {
                        currentSession = session;
                        this._activeReviewerSessions.add(session);
                        controller.signal.addEventListener("abort", onAbort);
                    },
                    unregister: (session) => {
                        this._activeReviewerSessions.delete(session);
                        controller.signal.removeEventListener("abort", onAbort);
                        currentSession = null;
                    }
                };
                let runResult;
                try {
                    runResult = await this._runAiWith(reviewer.tool, reviewer.model, reviewer.effort, reviewer.fast, prompt, null, callbacks);
                } catch (e) {
                    // A fatal authentication/login failure ends the whole run, so it is surfaced even
                    // when this reviewer had already been marked cancelled; absorbing it as the
                    // cancellation would let the round carry on without it.
                    if (isFatalLoginError(e)) {
                        throw e;
                    }
                    // A reviewer the orchestrator intentionally cancelled is marked here: its
                    // in-flight session was disposed, surfacing as the runner's AbortError. The mark
                    // distinguishes that deliberate cancellation from a genuine reviewer error, which
                    // is never marked and propagates to the stage's failure path so the worker is
                    // briefed — regardless of whether the reviewer is optional.
                    if (this._cancelledReviewers.has(idx)) {
                        return "cancelled";
                    }
                    throw e;
                }
                if (this._cancelledReviewers.has(idx)) {
                    return "cancelled";
                }
                // Consumption already incurred is accounted for unconditionally from here, in the same
                // synchronous step as the boundary above: a reviewer cancelled after this point has
                // still spent these tokens, and the plan file reports what the task consumed. Only the
                // verdict is withheld from a cancelled reviewer, so each await on the way to it is
                // followed by a fresh recheck — the orchestrator can mark this reviewer during any of
                // those microtask windows.
                const { result, capturedOutput } = runResult;
                this._taskTokens.it += result.inputTokens;
                this._taskTokens.ot += result.outputTokens;
                await this._persistMetrics(plan, task.line);
                this._updateMetrics(plan);
                aggregateOutput.push(capturedOutput);
                const verdictFilePresent = await this._workspace!.reviewerErrorLogExists(reviewerNum);
                if (this._cancelledReviewers.has(idx)) {
                    return "cancelled";
                }
                if (!verdictFilePresent) {
                    await this._writeLog(ws.reviewerOutputLog(iteration, reviewerNum), aggregateOutput.join("\n---\n"));
                    continue;
                }
                const trimmed = (await this._workspace!.readReviewerErrorLog(reviewerNum)).trim();
                if (this._cancelledReviewers.has(idx)) {
                    return "cancelled";
                }
                // Flip per-reviewer footer state to pass/fail the instant this reviewer's own verdict
                // file is present — before writing the per-reviewer log — so the UI advances per
                // reviewer rather than waiting for the slowest reviewer in the round.
                this._setReviewerState(idx, trimmed.length === 0 ? "pass" : "fail");
                this._setReviewerLogicalStatus(idx, "done");
                const verdictLine = trimmed.length === 0
                    ? "Verdict: PASS"
                    : `Verdict: FAIL ${trimmed}`;
                await this._writeLog(ws.reviewerOutputLog(iteration, reviewerNum), `${aggregateOutput.join("\n---\n")}\n\n${verdictLine}`);
                if (this._cancelledReviewers.has(idx)) {
                    return "cancelled";
                }
                return "verdict";
            }
        } finally {
            this._reviewerAbortControllers.delete(idx);
        }
    }
    private _formatPathList(items:readonly string[]):string {
        if (items.length === 0) {
            return "(none)";
        }
        return items.join("\n");
    }
    private _getAdapter(tool:ToolName):ToolAdapter {
        if (this._contexts.adapter) {
            return this._contexts.adapter(tool);
        }
        if (tool === "codex") {
            return new CodexAdapter({
                script: this._contexts.script,
                time: this._contexts.time,
                random: this._contexts.random
            });
        }
        return new ClaudeAdapter({
            claude: this._contexts.claude,
            time: this._contexts.time,
            random: this._contexts.random
        });
    }
    private _defaultRunAiCallbacks():RunAiCallbacks {
        return {
            onLongWaitStart: (kind, endTimeMs) => {
                /* coverage ignore next */ // — Defensive: rate-limit callback after dispose is a no-op.
                if (this._disposed) return;
                if (this._currentTask !== null) {
                    this._taskRateLimitStartedAt = this._contexts.time.now();
                }
                this._block!.setFooter({ kind: "waiting", waitKind: kind, endTime: endTimeMs });
            },
            onLongWaitEnd: () => {
                if (this._taskRateLimitStartedAt !== null) {
                    this._taskExcludedMs += this._contexts.time.now() - this._taskRateLimitStartedAt;
                    this._taskRateLimitStartedAt = null;
                }
                if (this._disposed) return;
                this._block!.setFooter({ kind: "working" });
            },
            register: (session) => {
                this._activeSession = { session };
            },
            unregister: (session) => {
                if (this._activeSession?.session === session) {
                    this._activeSession = null;
                }
            }
        };
    }
    private _runAi(tool:ToolName, model:string, effort:string, fast:boolean, prompt:string, initialSessionId?:string|null, priorSessionUsage?:ToolTokenUsage) {
        return this._runAiWith(tool, model, effort, fast, prompt, initialSessionId ?? null, this._defaultRunAiCallbacks(), priorSessionUsage);
    }
    private async _runAiWith(tool:ToolName, model:string, effort:string, fast:boolean, prompt:string, initialSessionId:string|null, callbacks:RunAiCallbacks, priorSessionUsage?:ToolTokenUsage) {
        /* coverage ignore next 3 */ // — Defensive: disposed guard; _runAiWith is only called from methods that already checked _disposed.
        if (this._disposed) {
            throw new Error("Implement disposed");
        }
        let capturedOutput = "";
        const capturingOutput:OutputContext = {
            write: (text:string) => {
                capturedOutput += text;
                this._buffered.write(text);
            },
            writeError: (text:string) => {
                capturedOutput += text;
                this._buffered.writeError(text);
            },
            /* coverage ignore next 2 */ // — Pass-through required by OutputContext; AiSession never calls columns or rows.
            columns: () => this._contexts.output.columns(),
            rows: () => this._contexts.output.rows(),
            /* coverage ignore next */ // — Pass-through required by OutputContext; AiSession never calls onResize.
            onResize: listener => this._contexts.output.onResize(listener)
        };
        const adapter = this._getAdapter(tool);
        const session = new AiSession({
            adapter,
            prompt,
            model,
            effort,
            fast,
            ...(initialSessionId != null ? { resumeSessionId: initialSessionId } : null),
            ...(priorSessionUsage != null ? { priorSessionUsage } : null),
            onLongWaitStart: callbacks.onLongWaitStart,
            onLongWaitEnd: callbacks.onLongWaitEnd
        }, {
            time: this._contexts.time,
            output: capturingOutput
        });
        callbacks.register(session);
        try {
            const result = await session.run();
            return { result, capturedOutput };
        } finally {
            callbacks.unregister(session);
            await session.dispose();
        }
    }
    private async _runScript(scriptPath:string) {
        /* coverage ignore next 3 */ // — Defensive: disposed guard; callers are inside the task loop which already checks _disposed.
        if (this._disposed) {
            return null;
        }
        const isBat = scriptPath.toLowerCase().endsWith(".bat");
        const command = isBat ? "cmd.exe" : "sh";
        const args = isBat ? ["/c", scriptPath] : [scriptPath];
        const script = new ScriptRunner({
            command,
            args,
            cwd: this._options.projectRoot,
            onStdout: chunk => this._buffered.write(chunk),
            onStderr: chunk => this._buffered.writeError(chunk)
        }, this._contexts.script, this._contexts.time);
        const running = { script };
        this._activeScript = running;
        try {
            return await script.result();
        } catch (e) {
            this._buffered.writeError(`${this._stringifyError(e)}\n`);
            return { code: -1, stdout: "", stderr: this._stringifyError(e) };
        /* coverage ignore next 4 */ // — V8 maps the finally keyword to an uncovered range; the guard is false only when dispose() races and nulls _activeScript.
        } finally {
            if (this._activeScript === running) {
                this._activeScript = null;
            }
            await script.dispose();
        }
    }
    private async _writeLog(path:string, content:string):Promise<void> {
        try {
            await this._contexts.fs.writeFile(path, content);
        /* coverage ignore next 3 */ // — Defensive: writeFile rejection is silently swallowed; logs are best-effort.
        } catch {

        }
    }
    private async _writeErrorLog(ws:WorkspacePaths, content:string):Promise<void> {
        await this._writeLog(ws.errorLog, content);
    }
    // The shared finalization both hard-stop triggers run — exceeding the iteration cap and a
    // worker-declared `hard-stop.log`. It materializes the retained per-iteration, per-stage error
    // history into the main folder and drops the single briefing error.log first, then preserves the
    // workspace, per the workspace contract. The briefing removal inside the materializer runs only
    // after every retained file is on disk, so a write failure leaves it in place. A materialization
    // I/O failure must not bypass the hard-stop outcome: preservation is guaranteed in the finally,
    // and a rejected write is caught so the caller's task-identifying, workspace-pointing diagnostic
    // and its non-zero return still stand. The trigger-specific diagnostic is passed in.
    private async _hardStop(diagnostic:string):Promise<void> {
        try {
            await this._materializeHardStopErrorLogs();
        } catch (e) {
            this._buffered.writeError(`Hard stop: could not materialize per-iteration error logs: ${this._stringifyError(e)}\n`);
        } finally {
            this._workspace!.preserveOnDispose();
        }
        this._buffered.writeError(diagnostic);
    }
    // Materializes the retained per-iteration, per-stage failure history into the main temporary
    // folder as one `.error.log` file per failing stage per iteration, then removes the single
    // briefing error.log. Called once on a hard stop, after preservation is armed. Each write goes
    // through the filesystem context directly so a failure propagates (unlike the best-effort
    // _writeLog used for streamed logs); the briefing removal — routed through the Workspace, itself
    // backed by the FsContext — runs only after every retained file is on disk, so a write failure
    // leaves the briefing in place rather than dropping it with the history unwritten.
    private async _materializeHardStopErrorLogs():Promise<void> {
        for (const { path, content } of this._retainedMaterializations) {
            await this._contexts.fs.writeFile(path, content);
        }
        await this._workspace!.clearErrorLog();
    }
    private _errorText(e:unknown, withStack:boolean):string {
        if (!(e instanceof Error)) {
            return String(e);
        }
        if (withStack) {
            /* coverage ignore next */ // — Defensive: V8 always populates Error.stack; the ?? guards the optional type.
            return e.stack ?? e.message;
        }
        return e.message;
    }
    private _errorMessage(e:unknown):string {
        return this._errorText(e, false);
    }
    private _stringifyError(e:unknown):string {
        return this._errorText(e, true);
    }
    private _finalizeBlock(label:TerminalLabel):void {
        if (!this._block || this._block.isFinalized()) return;
        this._buffered.flush();
        this._block.finalize(label);
    }
    dispose():Promise<void> {
        return this._dispose();
    }
    private _dispose = disposeOnce(async () => {
        this._disposed = true;
        const promptControllers = [...this._promptControllers];
        const promptOperations = [...this._promptOperations];
        this._promptControllers.clear();
        this._promptOperations.clear();
        for (const controller of promptControllers) {
            controller.abort();
        }
        await Promise.allSettled(promptOperations);
        // Abort every per-reviewer cancellation handle before teardown: each abort disposes the
        // reviewer's in-flight session (wired in _runOneReviewerToVerdict), so no reviewer outlives
        // the dispose. These are not round-completion cancellations, so they are not marked.
        for (const controller of this._reviewerAbortControllers.values()) {
            controller.abort();
        }
        this._reviewerAbortControllers.clear();
        const activeSession = this._activeSession?.session;
        /* coverage ignore next */ // — Defensive: _activeScript is always null when dispose runs after result(); non-null path requires mid-execution dispose.
        const activeScript = this._activeScript?.script;
        const reviewerSessions = [...this._activeReviewerSessions];
        this._activeSession = null;
        this._activeScript = null;
        this._activeReviewerSessions.clear();
        const closers:Promise<unknown>[] = [];
        if (activeSession) {
            closers.push(activeSession.dispose());
        }
        /* coverage ignore next 3 */ // — Defensive: activeScript is null in all covered dispose paths.
        if (activeScript) {
            closers.push(activeScript.dispose());
        }
        for (const session of reviewerSessions) {
            closers.push(session.dispose());
        }
        await Promise.allSettled(closers);
        try {
            await this._runPromise;
        /* coverage ignore next 3 */ // — Defensive: _runPromise always resolves (returns number).
        } catch {

        }
        if (this._workspace) {
            const ws = this._workspace;
            this._workspace = null;
            await ws.dispose();
        }
        if (this._block) {
            this._finalizeBlock("Interrupted");
            const block = this._block;
            this._block = null;
            block.dispose();
        }
        this._ownerChannel = null;
    });
}
