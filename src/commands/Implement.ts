import { AiSession } from "../ai/AiSession";
import { ClaudeAdapter } from "../ai/ClaudeAdapter";
import { CodexAdapter } from "../ai/CodexAdapter";
import type { FsContext, OutputContext, RandomContext, ScriptContext, TimeContext } from "../contexts";
import type { ToolAdapter, ToolName } from "../ai/ToolAdapter";
import type { FlandersConfig, FlandersRole } from "../workspace/FlandersConfig";
import { read as readConfig } from "../workspace/FlandersConfig";
import { isNonEmptyFile, joinPath, listFilesRecursive } from "../system/fsUtils";
import { isGitAvailable, isInsideWorkTree, countPendingChangesExcept, addAll, commit } from "../system/Git";
import { discoverSpecs } from "../workspace/SpecDiscovery";
import { PlanFile, PlanTask } from "../plan/PlanFile";
import { Placeholders, prompts } from "../prompts/prompts";
import { ScriptRunner } from "../system/ScriptRunner";
import { BottomBlock } from "../ui/BottomBlock";
import type { Activity, ReviewerEntry, ReviewerState, TerminalLabel } from "../ui/BottomBlock";
import { formatSnapshotBlock } from "../ui/formatters";
import { PlatformContext, Workspace, WorkspacePaths } from "../workspace/Workspace";

export type { Activity };

const MAX_ITER = 5;

class LineBufferedBlock {
    private _stdoutBuf = "";
    private _stderrBuf = "";
    constructor(private _block:BottomBlock) {}
    write(text:string):void {
        this._stdoutBuf += text;
        const idx = this._stdoutBuf.lastIndexOf("\n");
        if (idx !== -1) {
            this._block.writeAbove(this._stdoutBuf.slice(0, idx + 1));
            this._stdoutBuf = this._stdoutBuf.slice(idx + 1);
        }
    }
    writeError(text:string):void {
        this._stderrBuf += text;
        const idx = this._stderrBuf.lastIndexOf("\n");
        if (idx !== -1) {
            this._block.writeAbove(this._stderrBuf.slice(0, idx + 1));
            this._stderrBuf = this._stderrBuf.slice(idx + 1);
        }
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
}

export type ImplementContexts = Readonly<{
    claude:ScriptContext;
    script:ScriptContext;
    fs:FsContext;
    time:TimeContext;
    random:RandomContext;
    platform:PlatformContext;
    output:OutputContext;
}>;

export type ImplementOptions = Readonly<{
    projectRoot:string;
}>;

type RunningSession = { session:AiSession };
type RunningScript = { script:ScriptRunner };

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
    private _buffered!:LineBufferedBlock;
    private _currentWorkerSessionId:string|null = null;
    private _currentPrepSessionId:string|null = null;
    private _activeSession:RunningSession|null = null;
    private _activeScript:RunningScript|null = null;
    private _activeReviewerSessions:Set<AiSession> = new Set();
    private _reviewerStates:ReviewerEntry[]|null = null;
    private _currentIndexLabel = "";
    private _currentIteration = 0;
    private _currentTask:PlanTask|null = null;
    private _taskStartedAt:number = 0;
    private _taskRateLimitMs:number = 0;
    private _taskRateLimitStartedAt:number|null = null;
    private _taskTokens = {it:0, ot:0};
    private _restingFooterKind:"working"|"preparing" = "working";
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
    private async _run(rawArgs:readonly string[]):Promise<number> {
        const block = new BottomBlock({
            write: text => this._contexts.output.write(text),
            columns: () => this._contexts.output.columns(),
            onResize: listener => this._contexts.output.onResize(listener)
        }, this._contexts.time);
        this._block = block;
        block.mount();
        this._buffered = new LineBufferedBlock(block);
        try {
            const positional:string[] = [];
            for (const arg of rawArgs) {
                if (arg.startsWith("-")) {
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
                this._buffered.writeError("Missing Flanders configuration. Run 'npx flanders install'.\n");
                this._finalizeBlock("Failed");
                return 1;
            }
            this._config = config;
            const planPath = await this._selectPlan(positional);
            /* coverage ignore next 4 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                this._finalizeBlock("Interrupted");
                return 1;
            }
            if (!planPath) {
                this._finalizeBlock("Failed");
                return 1;
            }
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
                this._block!.setMetrics({ plan: { tokens: planTotals.it + planTotals.ot, seconds: planTotals.t } });
                this._buffered.write("tasks completed\n");
                this._finalizeBlock("Done");
                return 0;
            }
            this._block!.setHeader({ indexLabel: `0/${totalTasks}` });
            this._block!.setMetrics({ plan: { tokens: planTotals.it + planTotals.ot, seconds: planTotals.t } });
            const gitAvailable = await isGitAvailable(this._contexts.script, this._contexts.time);
            const insideWorkTree = gitAvailable && await isInsideWorkTree(this._contexts.script, this._contexts.time, this._options.projectRoot);
            if (!insideWorkTree) {
                this._buffered.writeError("The project must be a git repository. Flanders implement requires git on PATH and the project root inside a git work tree.\n");
                this._finalizeBlock("Failed");
                return 1;
            }
            const pending = await countPendingChangesExcept(this._contexts.script, this._contexts.time, this._options.projectRoot, planPath);
            if (pending > 0) {
                this._buffered.writeError("Working tree has uncommitted changes. Please commit or stash them before re-running.\n");
                this._finalizeBlock("Failed");
                return 1;
            }
            const specs = await discoverSpecs(this._contexts.script, this._contexts.time, this._options.projectRoot);
            this._contractList = specs.contracts;
            this._ruleList = specs.rules;
            this._behaviorRuleList = specs.flanders;
            this._workspace = new Workspace(this._contexts.fs, this._contexts.platform);
            const wsPaths = await this._workspace.setup(this._config.reviewers.length);
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
                const taskOk = await this._runTask(plan, open, wsPaths, indexLabel, completedSoFar);
                if (this._disposed) {
                    this._finalizeBlock("Interrupted");
                    return 1;
                }
                if (!taskOk) {
                    this._finalizeBlock("Hard stop");
                    return 1;
                }
            }
            this._buffered.write("all tasks completed\n");
            this._finalizeBlock("Done");
            return 0;
        } catch (e) {
            if (!this._disposed) {
                /* coverage ignore next */ // — Defensive: all rejections inside _run() produce Error instances.
                this._buffered.writeError(`${e instanceof Error ? e.message : String(e)}\n`);
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
            this._buffered.writeError(`Plan file not found: ${arg}\n`);
            return null;
        }
        const files = await listFilesRecursive(this._contexts.fs, plansFolder);
        if (files.length === 0) {
            this._buffered.writeError(`No plan files found in ${plansFolder}.\n`);
            return null;
        }
        if (files.length === 1) {
            return joinPath(plansFolder, files[0]!);
        }
        this._buffered.writeError(`Multiple plan files found in ${plansFolder}:\n`);
        for (const f of files) {
            this._buffered.writeError(`  ${f}\n`);
        }
        this._buffered.writeError("Re-run with the chosen plan as the [plan] argument.\n");
        return null;
    }
    private async _detectBuildAndTest(ws:WorkspacePaths):Promise<void> {
        const prompt = prompts.detectBuildAndTest
            .split(Placeholders.BUILD_SCRIPT_PATH).join(ws.buildScript)
            .split(Placeholders.TEST_SCRIPT_PATH).join(ws.testScript)
            .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList));
        await this._runAi(this._config!.worker.tool, this._config!.worker.model, this._config!.worker.effort, prompt);
    }
    private _setActivity(activity:Activity, iteration?:number|null):void {
        /* coverage ignore next */ // — Defensive: _setActivity is only called within _runTask which always sets _currentTask.
        if (!this._currentTask) return;
        this._block!.setHeader({
            indexLabel: this._currentIndexLabel,
            iteration: iteration === undefined ? this._currentIteration : iteration,
            activity,
            taskNumber: this._currentTask.taskNumber || undefined,
            title: this._currentTask.title
        });
    }
    private _activeSeconds():number {
        return Math.max(0, Math.floor((this._contexts.time.now() - this._taskStartedAt - this._taskRateLimitMs) / 1000));
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
        this._block!.setMetrics({
            task: { tokens: this._taskTokens.it + this._taskTokens.ot, seconds: this._activeSeconds() },
            plan: { tokens: planTotals.it + planTotals.ot, seconds: planTotals.t }
        });
    }
    private _reviewerMatchesWorker(reviewer:FlandersRole):boolean {
        const w = this._config!.worker;
        return reviewer.tool === w.tool && reviewer.model === w.model && reviewer.effort === w.effort;
    }
    private _prepActive():boolean {
        return this._config!.reviewers.some(r => this._reviewerMatchesWorker(r));
    }
    private async _runTask(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, indexLabel:string, taskIndex:number):Promise<boolean> {
        this._currentTask = task;
        this._currentIndexLabel = indexLabel;
        this._currentWorkerSessionId = null;
        this._currentPrepSessionId = null;
        this._taskStartedAt = this._contexts.time.now();
        this._taskRateLimitMs = 0;
        this._taskRateLimitStartedAt = null;
        this._taskTokens = {it:0, ot:0};
        this._updateMetrics(plan);
        const prepActive = this._prepActive();
        if (prepActive) {
            this._setActivity("preparing", null);
            this._restingFooterKind = "preparing";
            this._block!.setFooter({ kind: "preparing" });
            const prepOk = await this._prepStage(plan, task, ws, taskIndex);
            if (this._disposed) {
                return false;
            }
            if (!prepOk) {
                return false;
            }
            this._restingFooterKind = "working";
            this._block!.setFooter({ kind: "working" });
        }
        let iteration = 0;
        for (;;) {
            iteration++;
            this._currentIteration = iteration;
            if (iteration > MAX_ITER) {
                this._workspace!.preserveOnDispose();
                this._buffered.writeError(`Hard stop: task at line ${task.line} ("${task.title}") exceeded ${MAX_ITER} iterations. Inspect logs at ${ws.root}.\n`);
                return false;
            }
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return false;
            }
            this._setActivity("implementing");
            const workerOk = await this._workerStage(plan, task, ws, iteration, prepActive);
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return false;
            }
            if (!workerOk) {
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
            const reviewOk = await this._reviewerStage(plan, task, ws, iteration, prepActive);
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return false;
            }
            this._block!.setFooter({ kind: "working" });
            if (!reviewOk) {
                continue;
            }
            await plan.markDone(task.line, {it:this._taskTokens.it, ot:this._taskTokens.ot, t:this._activeSeconds()});
            const commitMessage = task.taskNumber ? `${task.taskNumber} ${task.title}` : task.title;
            const gitOutput:OutputContext = {
                write: text => this._buffered.write(text),
                writeError: text => this._buffered.writeError(text),
                /* coverage ignore next 2 */ // — Pass-through required by OutputContext; Git never calls columns or rows.
                columns: () => this._contexts.output.columns(),
                rows: () => this._contexts.output.rows(),
                /* coverage ignore next */ // — Pass-through required by OutputContext; Git never calls onResize.
                onResize: listener => this._contexts.output.onResize(listener)
            };
            const addResult = await addAll(this._contexts.script, this._contexts.time, gitOutput, this._options.projectRoot);
            if (addResult.code !== 0) {
                await this._writeErrorLog(ws, `git add -A failed (exit ${addResult.code})\n--- stdout ---\n${addResult.stdout}\n--- stderr ---\n${addResult.stderr}`);
                await plan.markOpen(task.line, {it:this._taskTokens.it, ot:this._taskTokens.ot, t:this._activeSeconds()});
                continue;
            }
            const commitResult = await commit(this._contexts.script, this._contexts.time, gitOutput, this._options.projectRoot, commitMessage);
            if (commitResult.code !== 0) {
                await this._writeErrorLog(ws, `git commit failed (exit ${commitResult.code})\n--- stdout ---\n${commitResult.stdout}\n--- stderr ---\n${commitResult.stderr}`);
                await plan.markOpen(task.line, {it:this._taskTokens.it, ot:this._taskTokens.ot, t:this._activeSeconds()});
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
    private async _prepStage(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, taskIndex:number):Promise<boolean> {
        const prompt = prompts.prep
            .split(Placeholders.PLAN_PATH).join(plan.path)
            .split(Placeholders.TASK_LINE).join(String(task.line))
            .split(Placeholders.TASK_TITLE).join(task.title)
            .split(Placeholders.CONTRACT_LIST).join(this._formatPathList(this._contractList))
            .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList))
            .split(Placeholders.BEHAVIOR_RULE_LIST).join(this._formatPathList(this._behaviorRuleList));
        try {
            const { result, capturedOutput } = await this._runAi(this._config!.worker.tool, this._config!.worker.model, this._config!.worker.effort, prompt);
            this._taskTokens.it += result.inputTokens;
            this._taskTokens.ot += result.outputTokens;
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            await this._writeLog(ws.prepLog(taskIndex), capturedOutput);
            if (result.sessionId === null) {
                this._workspace!.preserveOnDispose();
                await this._writeErrorLog(ws, `prep returned no session id for task at line ${task.line} ("${task.title}")`);
                this._buffered.writeError(`Hard stop: prep for task at line ${task.line} ("${task.title}") returned no session id. Inspect logs at ${ws.root}.\n`);
                return false;
            }
            this._currentPrepSessionId = result.sessionId;
            return true;
        } catch (e) {
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            this._workspace!.preserveOnDispose();
            await this._writeErrorLog(ws, `prep stage failed: ${this._stringifyError(e)}`);
            this._buffered.writeError(`Hard stop: prep for task at line ${task.line} ("${task.title}") failed. Inspect logs at ${ws.root}.\n`);
            return false;
        }
    }
    private async _workerStage(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, iteration:number, prepActive:boolean):Promise<boolean> {
        let prompt = prompts.worker
            .split(Placeholders.PLAN_PATH).join(plan.path)
            .split(Placeholders.TASK_LINE).join(String(task.line))
            .split(Placeholders.TASK_TITLE).join(task.title)
            .split(Placeholders.BUILD_SCRIPT_PATH).join(ws.buildScript)
            .split(Placeholders.TEST_SCRIPT_PATH).join(ws.testScript)
            .split(Placeholders.CONTRACT_LIST).join(this._formatPathList(this._contractList))
            .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList))
            .split(Placeholders.BEHAVIOR_RULE_LIST).join(this._formatPathList(this._behaviorRuleList));
        if (iteration === 1 && !prepActive) {
            prompt = await this._appendLinkedContent(plan, task, prompt);
        }
        if (iteration > 1) {
            const briefing = prompts.previousIterationBriefing
                .split(Placeholders.ITERATION).join(String(iteration))
                .split(Placeholders.ERROR_LOG_PATH).join(ws.errorLog);
            prompt = `${prompt}\n\n${briefing}`;
        }
        try {
            const { result, capturedOutput } = iteration === 1
                ? prepActive
                    ? await this._runAi(this._config!.worker.tool, this._config!.worker.model, this._config!.worker.effort, prompt, null, this._currentPrepSessionId)
                    : await this._runAi(this._config!.worker.tool, this._config!.worker.model, this._config!.worker.effort, prompt)
                : await this._runAi(this._config!.worker.tool, this._config!.worker.model, this._config!.worker.effort, prompt, this._currentWorkerSessionId);
            if (result.sessionId !== null) {
                this._currentWorkerSessionId = result.sessionId;
            }
            this._taskTokens.it += result.inputTokens;
            this._taskTokens.ot += result.outputTokens;
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            await this._writeLog(ws.workerLog(iteration), capturedOutput);
            return true;
        } catch (e) {
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            await this._writeErrorLog(ws, `worker stage failed: ${this._stringifyError(e)}`);
            return false;
        }
    }
    private async _appendLinkedContent(plan:PlanFile, task:PlanTask, prompt:string):Promise<string> {
        const linked = plan.linkedPaths(task);
        const allPaths = [...linked.contracts, ...linked.rules];
        if (allPaths.length === 0) {
            return prompt;
        }
        const sections:string[] = [];
        for (const relPath of allPaths) {
            const absPath = joinPath(this._options.projectRoot, relPath);
            try {
                const content = await this._contexts.fs.readFile(absPath);
                sections.push(`## ${relPath}\n\n${content}`);
            } catch {
                sections.push(`## ${relPath}\n\n(file not found)`);
            }
        }
        return `${prompt}\n\n## Linked reference content\n\n${sections.join("\n\n")}`;
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
            await this._writeErrorLog(ws, `build stage failed (exit ${result.code})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
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
            await this._writeErrorLog(ws, `test stage failed (exit ${result.code})\n--- stdout ---\n${result.stdout}\n--- stderr ---\n${result.stderr}`);
            return false;
        }
        return true;
    }
    private _setReviewerState(reviewerIdx:number, state:ReviewerState):void {
        /* coverage ignore next */ // — Defensive: _reviewerStates is initialized at the start of _reviewerStage before any reviewer launches.
        if (!this._reviewerStates) return;
        const entry = this._reviewerStates[reviewerIdx];
        /* coverage ignore next */ // — Defensive: callers always pass a valid in-range reviewerIdx.
        if (!entry) return;
        this._reviewerStates[reviewerIdx] = { tool: entry.tool, model: entry.model, effort: entry.effort, state };
        this._renderReviewingFooter();
    }
    private _renderReviewingFooter():void {
        /* coverage ignore next */ // — Defensive: callers always check that _reviewerStates is populated; _block/finalized guards cover disposal races.
        if (!this._block || this._block.isFinalized() || !this._reviewerStates) return;
        this._block.setFooter({ kind: "reviewing", reviewers: this._reviewerStates.slice() });
    }
    private async _reviewerStage(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, iteration:number, prepActive:boolean):Promise<boolean> {
        const reviewers = this._config!.reviewers;
        this._reviewerStates = reviewers.map<ReviewerEntry>(r => ({ tool: r.tool, model: r.model, effort: r.effort, state: "running" }));
        this._renderReviewingFooter();
        for (let i = 0; i < reviewers.length; i++) {
            await this._workspace!.clearReviewerErrorLog(i + 1);
        }
        await this._workspace!.clearErrorLog();
        let failureCaught:unknown = null;
        const launches = reviewers.map((reviewer, idx) => this._runOneReviewerToVerdict(plan, task, ws, iteration, prepActive, reviewer, idx).catch(e => {
            if (failureCaught === null) {
                failureCaught = e;
            }
        }));
        await Promise.all(launches);
        /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
        if (this._disposed) {
            return false;
        }
        if (failureCaught !== null) {
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            await this._writeErrorLog(ws, `reviewer stage failed: ${this._stringifyError(failureCaught)}`);
            return false;
        }
        const perFile:string[] = [];
        for (let i = 0; i < reviewers.length; i++) {
            perFile.push(await this._workspace!.readReviewerErrorLog(i + 1));
        }
        const aggregate = perFile.join("\n").replace(/^\s+|\s+$/g, "");
        if (aggregate.length === 0) {
            return true;
        }
        await this._workspace!.writeErrorLog(aggregate);
        return false;
    }
    private async _runOneReviewerToVerdict(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, iteration:number, prepActive:boolean, reviewer:FlandersRole, idx:number):Promise<void> {
        const reviewerNum = idx + 1;
        const matchesWorker = this._reviewerMatchesWorker(reviewer);
        const useBranchA = prepActive && matchesWorker;
        let prompt = prompts.reviewer
            .split(Placeholders.PLAN_PATH).join(plan.path)
            .split(Placeholders.TASK_LINE).join(String(task.line))
            .split(Placeholders.TASK_TITLE).join(task.title)
            .split(Placeholders.CONTRACT_LIST).join(this._formatPathList(this._contractList))
            .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList))
            .split(Placeholders.BEHAVIOR_RULE_LIST).join(this._formatPathList(this._behaviorRuleList))
            .split(Placeholders.ERROR_LOG_PATH).join(ws.reviewerErrorLog(reviewerNum));
        if (!useBranchA) {
            prompt = await this._appendLinkedContent(plan, task, prompt);
        }
        const aggregateOutput:string[] = [];
        for (;;) {
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return;
            }
            this._setReviewerState(idx, "running");
            const callbacks:RunAiCallbacks = {
                onLongWaitStart: () => {
                    /* coverage ignore next */ // — Defensive: disposed guard during long-wait callback.
                    if (this._disposed) return;
                    this._setReviewerState(idx, "waiting");
                },
                onLongWaitEnd: () => {
                    /* coverage ignore next */ // — Defensive: disposed guard during long-wait callback.
                    if (this._disposed) return;
                    this._setReviewerState(idx, "running");
                },
                register: (session) => {
                    this._activeReviewerSessions.add(session);
                },
                unregister: (session) => {
                    this._activeReviewerSessions.delete(session);
                }
            };
            const { result, capturedOutput } = useBranchA
                ? await this._runAiWith(reviewer.tool, reviewer.model, reviewer.effort, prompt, null, this._currentPrepSessionId, callbacks)
                : await this._runAiWith(reviewer.tool, reviewer.model, reviewer.effort, prompt, null, null, callbacks);
            this._taskTokens.it += result.inputTokens;
            this._taskTokens.ot += result.outputTokens;
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            aggregateOutput.push(capturedOutput);
            if (!await this._workspace!.reviewerErrorLogExists(reviewerNum)) {
                await this._writeLog(ws.reviewerOutputLog(iteration, reviewerNum), aggregateOutput.join("\n---\n"));
                continue;
            }
            const trimmed = (await this._workspace!.readReviewerErrorLog(reviewerNum)).trim();
            // Flip per-reviewer footer state to ok/fail the instant this reviewer's own verdict
            // file is present — before writing the per-reviewer log — so the UI advances per
            // reviewer rather than waiting for the slowest reviewer in the round.
            this._setReviewerState(idx, trimmed.length === 0 ? "ok" : "fail");
            const verdictLine = trimmed.length === 0
                ? "Verdict: PASS"
                : `Verdict: FAIL ${trimmed}`;
            await this._writeLog(ws.reviewerOutputLog(iteration, reviewerNum), `${aggregateOutput.join("\n---\n")}\n\n${verdictLine}`);
            return;
        }
    }
    private _formatPathList(items:readonly string[]):string {
        if (items.length === 0) {
            return "(none)";
        }
        return items.join("\n");
    }
    private _getAdapter(tool:ToolName):ToolAdapter {
        if (tool === "codex") {
            return new CodexAdapter({
                script: this._contexts.script,
                time: this._contexts.time,
                random: this._contexts.random
            });
        }
        return new ClaudeAdapter({
            claude: this._contexts.claude,
            time: this._contexts.time
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
                    this._taskRateLimitMs += this._contexts.time.now() - this._taskRateLimitStartedAt;
                    this._taskRateLimitStartedAt = null;
                }
                if (this._disposed) return;
                this._block!.setFooter({ kind: this._restingFooterKind });
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
    private _runAi(tool:ToolName, model:string, effort:string, prompt:string, initialSessionId?:string|null, forkFromSessionId?:string|null) {
        return this._runAiWith(tool, model, effort, prompt, initialSessionId ?? null, forkFromSessionId ?? null, this._defaultRunAiCallbacks());
    }
    private async _runAiWith(tool:ToolName, model:string, effort:string, prompt:string, initialSessionId:string|null, forkFromSessionId:string|null, callbacks:RunAiCallbacks) {
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
            ...(initialSessionId != null ? { resumeSessionId: initialSessionId } : null),
            ...(forkFromSessionId != null ? { forkParentSessionId: forkFromSessionId } : null),
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
    private _stringifyError(e:unknown):string {
        if (e instanceof Error) {
            /* coverage ignore next */ // — Defensive: V8 always populates Error.stack; the ?? guards the optional type.
            return e.stack ?? e.message;
        /* coverage ignore next 3 */ // — Defensive: all callers receive Error instances from spawn/promise rejections.
        }
        return String(e);
    }
    private _finalizeBlock(label:TerminalLabel):void {
        if (!this._block || this._block.isFinalized()) return;
        this._buffered.flush();
        this._block.finalize(label);
    }
    async dispose() {
        /* coverage ignore next 8 */ // — Defensive: _runPromise always resolves (returns number); second-dispose path is idempotent.
        if (this._disposed) {
            try {
                await this._runPromise;
            } catch {

            }
            return;
        }
        this._disposed = true;
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
        if (this._block) {
            this._finalizeBlock("Interrupted");
            const block = this._block;
            this._block = null;
            block.dispose();
        }
        if (this._workspace) {
            const ws = this._workspace;
            this._workspace = null;
            await ws.dispose();
        }
    }
}
