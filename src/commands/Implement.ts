import { ClaudeSession } from "../ClaudeSession";
import type { AskContext, ClaudeContext, FsContext, OutputContext, ScriptContext, TimeContext } from "../contexts";
import { isNonEmptyFile, joinPath, listFilesRecursive } from "../fsUtils";
import { isGitAvailable, isInsideWorkTree, countPendingChangesExcept, addAll, commit } from "../Git";
import { PlanFile, PlanTask } from "../PlanFile";
import { Placeholders, prompts } from "../prompts";
import { ScriptRunner } from "../ScriptRunner";
import { BottomBlock } from "../ui/BottomBlock";
import type { Activity, TerminalLabel } from "../ui/BottomBlock";
import { formatSnapshotBlock } from "../ui/formatters";
import { PlatformContext, Workspace, WorkspacePaths } from "../Workspace";

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
        /* coverage ignore next 8 */ // — ClaudeSession always appends trailing newlines; buffers are empty when flush() runs.
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
    claude:ClaudeContext;
    script:ScriptContext;
    fs:FsContext;
    time:TimeContext;
    platform:PlatformContext;
    ask:AskContext;
    output:OutputContext;
}>;

export type ImplementOptions = Readonly<{
    projectRoot:string;
}>;

type RunningSession = { session:ClaudeSession };
type RunningScript = { script:ScriptRunner };

export class Implement {
    private _disposed = false;
    private _contractList:readonly string[] = [];
    private _ruleList:readonly string[] = [];
    private _workspace:Workspace|null = null;
    private _block:BottomBlock|null = null;
    private _buffered!:LineBufferedBlock;
    private _currentWorkerSessionId:string|null = null;
    private _currentPrepSessionId:string|null = null;
    private _activeSession:RunningSession|null = null;
    private _activeScript:RunningScript|null = null;
    private _currentIndexLabel = "";
    private _currentIteration = 0;
    private _currentTask:PlanTask|null = null;
    private _taskStartedAt:number = 0;
    private _taskRateLimitMs:number = 0;
    private _taskRateLimitStartedAt:number|null = null;
    private _taskTokens = {it:0, ot:0};
    private _runPromise:Promise<number>;
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
            let noGitFlag = false;
            for (const arg of rawArgs) {
                if (arg === "--no-git") {
                    noGitFlag = true;
                } else if (arg.startsWith("-")) {
                    this._buffered.writeError(`Unknown flag: ${arg}\n`);
                    this._finalizeBlock("Failed");
                    return 1;
                } else {
                    positional.push(arg);
                }
            }
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
            let gitActive = false;
            if (!noGitFlag) {
                if (await isGitAvailable(this._contexts.script, this._contexts.time)) {
                    gitActive = await isInsideWorkTree(this._contexts.script, this._contexts.time, this._options.projectRoot);
                }
            }
            if (gitActive) {
                const pending = await countPendingChangesExcept(this._contexts.script, this._contexts.time, this._options.projectRoot, planPath);
                if (pending > 0) {
                    this._buffered.writeError("Working tree has uncommitted changes. Please commit or stash them before re-running.\n");
                    this._finalizeBlock("Failed");
                    return 1;
                }
            }
            const contractFiles = await listFilesRecursive(this._contexts.fs, joinPath(this._options.projectRoot, "contracts"));
            this._contractList = contractFiles.map(f => `contracts/${f}`);
            const ruleFiles = await listFilesRecursive(this._contexts.fs, joinPath(this._options.projectRoot, "rules"));
            this._ruleList = ruleFiles.map(f => `rules/${f}`);
            this._workspace = new Workspace(this._contexts.fs, this._contexts.platform);
            const wsPaths = await this._workspace.setup();
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
                const taskOk = await this._runTask(plan, open, wsPaths, indexLabel, completedSoFar, gitActive);
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
                this._buffered.writeError(`${e instanceof Error ? e.message : String(e)}\n`);
            }
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
        return await this._promptPlanChoice(plansFolder, files);
    }
    private _askOutput():OutputContext {
        return {
            write: text => this._buffered.write(text),
            writeError: text => this._buffered.writeError(text),
            columns: () => this._contexts.output.columns(),
            rows: () => this._contexts.output.rows(),
            /* coverage ignore next */ // — Pass-through required by OutputContext; consumers never call onResize.
            onResize: listener => this._contexts.output.onResize(listener)
        };
    }
    private async _promptPlanChoice(plansFolder:string, files:readonly string[]):Promise<string|null> {
        const askOutput = this._askOutput();
        for (;;) {
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return null;
            }
            const [answer] = await this._contexts.ask.askChoices([{
                header: "Plan file",
                question: `Multiple plans found in ${plansFolder}. Which one do you want to implement?`,
                options: files.map(f => ({ label: f })),
                multiSelect: false
            }], askOutput);
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return null;
            }
            if (answer && answer.picked.length > 0) {
                return joinPath(plansFolder, answer.picked[0]!.label);
            }
            this._buffered.writeError("Please pick one of the listed plans by its number.\n");
        }
    }
    private async _detectBuildAndTest(ws:WorkspacePaths):Promise<void> {
        const prompt = prompts.detectBuildAndTest
            .split(Placeholders.BUILD_SCRIPT_PATH).join(ws.buildScript)
            .split(Placeholders.TEST_SCRIPT_PATH).join(ws.testScript)
            .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList));
        await this._runClaude(prompt);
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
    private async _runTask(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, indexLabel:string, taskIndex:number, gitActive:boolean):Promise<boolean> {
        this._currentTask = task;
        this._currentIndexLabel = indexLabel;
        this._currentWorkerSessionId = null;
        this._currentPrepSessionId = null;
        this._taskStartedAt = this._contexts.time.now();
        this._taskRateLimitMs = 0;
        this._taskRateLimitStartedAt = null;
        this._taskTokens = {it:0, ot:0};
        this._updateMetrics(plan);
        const prepOk = await this._prepStage(plan, task, ws, taskIndex);
        if (this._disposed) {
            return false;
        }
        if (!prepOk) {
            return false;
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
            const workerOk = await this._workerStage(plan, task, ws, iteration);
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
            const reviewOk = await this._reviewerStage(plan, task, ws, iteration);
            /* coverage ignore next 3 */ // — Defensive: disposed guard between async operations.
            if (this._disposed) {
                return false;
            }
            if (!reviewOk) {
                continue;
            }
            await plan.markDone(task.line, {it:this._taskTokens.it, ot:this._taskTokens.ot, t:this._activeSeconds()});
            if (gitActive) {
                const commitMessage = task.taskNumber ? `${task.taskNumber} ${task.title}` : task.title;
                const gitOutput:OutputContext = {
                    write: text => this._buffered.write(text),
                    writeError: text => this._buffered.writeError(text),
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
            .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList));
        try {
            const { result, capturedOutput } = await this._runClaude(prompt);
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
    private async _workerStage(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, iteration:number):Promise<boolean> {
        let prompt = prompts.worker
            .split(Placeholders.PLAN_PATH).join(plan.path)
            .split(Placeholders.TASK_LINE).join(String(task.line))
            .split(Placeholders.TASK_TITLE).join(task.title)
            .split(Placeholders.BUILD_SCRIPT_PATH).join(ws.buildScript)
            .split(Placeholders.TEST_SCRIPT_PATH).join(ws.testScript)
            .split(Placeholders.CONTRACT_LIST).join(this._formatPathList(this._contractList))
            .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList));
        if (iteration > 1) {
            const briefing = prompts.previousIterationBriefing
                .split(Placeholders.ITERATION).join(String(iteration))
                .split(Placeholders.ERROR_LOG_PATH).join(ws.errorLog);
            prompt = `${prompt}\n\n${briefing}`;
        }
        if (iteration === 1 && this._currentPrepSessionId === null) {
            throw new Error(`Worker iteration 1 for task at line ${task.line} ("${task.title}") requires a prep session id but none was captured`);
        }
        try {
            const { result, capturedOutput } = iteration === 1
                ? await this._runClaude(prompt, null, this._currentPrepSessionId)
                : await this._runClaude(prompt, this._currentWorkerSessionId);
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
    private async _reviewerStage(plan:PlanFile, task:PlanTask, ws:WorkspacePaths, iteration:number):Promise<boolean> {
        if (this._currentPrepSessionId === null) {
            throw new Error(`Reviewer for task at line ${task.line} ("${task.title}") requires a prep session id but none was captured`);
        }
        const prompt = prompts.reviewer
            .split(Placeholders.PLAN_PATH).join(plan.path)
            .split(Placeholders.TASK_LINE).join(String(task.line))
            .split(Placeholders.TASK_TITLE).join(task.title)
            .split(Placeholders.CONTRACT_LIST).join(this._formatPathList(this._contractList))
            .split(Placeholders.RULE_LIST).join(this._formatPathList(this._ruleList));
        try {
            const { result, capturedOutput } = await this._runClaude(prompt, null, this._currentPrepSessionId);
            this._taskTokens.it += result.inputTokens;
            this._taskTokens.ot += result.outputTokens;
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            const verdict = this._parseReviewVerdict(result.text);
            await this._writeLog(ws.reviewerLog(iteration), verdict.pass
                ? `${capturedOutput}\n\nVerdict: PASS`
                : `${capturedOutput}\n\nVerdict: FAIL ${verdict.reason}`);
            if (verdict.pass) {
                return true;
            }
            await this._writeErrorLog(ws, `reviewer rejected: ${verdict.reason}`);
            return false;
        } catch (e) {
            await this._persistMetrics(plan, task.line);
            this._updateMetrics(plan);
            await this._writeErrorLog(ws, `reviewer stage failed: ${this._stringifyError(e)}`);
            return false;
        }
    }
    private _parseReviewVerdict(text:string):{ pass:boolean; reason:string } {
        const trimmed = text.trim();
        const lines = trimmed.split(/\r?\n/);
        for (let i = lines.length - 1; i >= 0; i--) {
            const line = lines[i]!.trim();
            if (!line) {
                continue;
            }
            if (/^pass$/i.test(line)) {
                return { pass: true, reason: "" };
            }
            const failMatch = /^fail\b\s*(.*)$/i.exec(line);
            if (failMatch) {
                return { pass: false, reason: failMatch[1]!.trim() };
            }
            break;
        }
        return { pass: false, reason: `unrecognized reviewer verdict: ${trimmed}` };
    }
    private _formatPathList(items:readonly string[]):string {
        if (items.length === 0) {
            return "(none)";
        }
        return items.join("\n");
    }
    private async _runClaude(prompt:string, initialSessionId?:string|null, forkFromSessionId?:string|null) {
        /* coverage ignore next 3 */ // — Defensive: disposed guard; _runClaude is only called from methods that already checked _disposed.
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
            columns: () => this._contexts.output.columns(),
            rows: () => this._contexts.output.rows(),
            /* coverage ignore next */ // — Pass-through required by OutputContext; ClaudeSession never calls onResize.
            onResize: listener => this._contexts.output.onResize(listener)
        };
        const session = new ClaudeSession({
            prompt,
            cwd: this._options.projectRoot,
            ...(initialSessionId != null ? { initialSessionId } : null),
            ...(forkFromSessionId != null ? { forkFromSessionId } : null),
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
                this._block!.setFooter({ kind: "working" });
            }
        }, {
            claude: this._contexts.claude,
            time: this._contexts.time,
            output: capturingOutput,
            ask: this._contexts.ask
        });
        const running = { session };
        this._activeSession = running;
        try {
            const result = await session.run();
            return { result, capturedOutput };
        } finally {
            if (this._activeSession === running) {
                this._activeSession = null;
            }
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
        /* coverage ignore next */ // — V8 maps the finally keyword to an uncovered range even though it always executes.
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
        const activeScript = this._activeScript?.script;
        this._activeSession = null;
        this._activeScript = null;
        const closers:Promise<unknown>[] = [];
        if (activeSession) {
            closers.push(activeSession.dispose());
        }
        /* coverage ignore next 3 */ // — Defensive: activeScript is null in all covered dispose paths.
        if (activeScript) {
            closers.push(activeScript.dispose());
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

