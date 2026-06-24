import * as Assert from "assert";

import test from "arrange-act-assert";

import { Implement, completedPlanPath } from "./Implement";
import type { ImplementContexts } from "./Implement";
import type { FlandersConfig } from "../workspace/FlandersConfig";
import type { SpawnedProcess, TimeContext, TimeoutHandle } from "../contexts";
import { BottomBlock } from "../ui/BottomBlock";
import type { HeaderFields, MetricsFields, TerminalLabel, ReviewerEntry } from "../ui/BottomBlock";
import { CYAN, YELLOW, MAGENTA, GREEN, BLUE, DIM, SEPARATOR_GLYPH, formatDateTime, stripAnsi } from "../ui/formatters";
import { workingPool, successPool, hardStopPool, interruptionPool, failurePool, tasksCompletedPool, allTasksCompletedPool } from "../voiceVariants";

// The stub random context returns 0, so the rotating working footer label is
// always workingPool[0] — the deterministic label the live footer renders here.
const WORKING_LABEL = workingPool[0]!;

// The stub random context returns 0, so each outcome's terminal label at exit is
// always its pool[0] entry — the deterministic terminal labels these tests observe.
const DONE_LABEL = successPool[0]!;
const HARD_STOP_LABEL = hardStopPool[0]!;
const INTERRUPTED_LABEL = interruptionPool[0]!;
const FAILED_LABEL = failurePool[0]!;

type FakeProcess = SpawnedProcess & {
    $emitStdout(chunk:string):void;
    $emitStderr(chunk:string):void;
    $emit(event:"exit", code:number|null, signal?:string|null):void;
    $emit(event:"error", e:unknown):void;
};

function fakeProcess():FakeProcess {
    const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stdoutListeners:Array<(chunk:Buffer|string) => void> = [];
    const stderrListeners:Array<(chunk:Buffer|string) => void> = [];
    return {
        kill() {},
        on(event:"exit"|"error", listener:((code:number|null, signal:string|null) => void)|((e:unknown) => void)) {
            if (event === "exit") exitListeners.push(listener as (code:number|null, signal:string|null) => void);
            else if (event === "error") errorListeners.push(listener as (e:unknown) => void);
        },
        stdout: { on(_event:"data", listener:(chunk:Buffer|string) => void) { stdoutListeners.push(listener); } },
        stderr: { on(_event:"data", listener:(chunk:Buffer|string) => void) { stderrListeners.push(listener); } },
        stdin: {
            write() {},
            end() {}
        },
        $emitStdout(chunk:string) { for (const l of stdoutListeners) l(chunk); },
        $emitStderr(chunk:string) { for (const l of stderrListeners) l(chunk); },
        $emit(event:string, codeOrError:unknown, signal?:unknown) {
            if (event === "exit") for (const l of exitListeners) l(codeOrError as number|null, (signal ?? null) as string|null);
            else if (event === "error") for (const l of errorListeners) l(codeOrError);
        }
    };
}

function claudeResultEvents(text:string, inputTokens = 0, outputTokens = 0, sessionId?:string):string {
    let out = "";
    if (sessionId) {
        out += JSON.stringify({ session_id: sessionId }) + "\n";
    }
    out += JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text }] } }) + "\n"
        + JSON.stringify({ type: "result", result: text, usage: { input_tokens: inputTokens, output_tokens: outputTokens } }) + "\n";
    return out;
}

function rateLimitEvent(nowMs:number, retryAfterSeconds:number):string {
    return JSON.stringify({
        type: "result",
        is_error: true,
        api_error_status: 429,
        error: { message: "rate limited" },
        rate_limit_info: {
            status: "rejected",
            resetsAt: Math.ceil((nowMs + retryAfterSeconds * 1000) / 1000),
            rateLimitType: "five_hour",
            isUsingOverage: false,
            overageStatus: "rejected"
        }
    });
}

type ClaudeResponse = { text:string; inputTokens?:number; outputTokens?:number; sessionId?:string; error?:true; stderr?:string; errorLog?:string };
type CodexResponse = { text:string; sessionId?:string; inputTokens?:number; outputTokens?:number; error?:true; errorLog?:string };
type ScriptResponse = { code:number; stdout:string; stderr:string };

function codexResultEvents(text:string, sessionId?:string, inputTokens?:number, outputTokens?:number):string {
    let out = "";
    if (sessionId) {
        out += JSON.stringify({ type: "thread.started", thread_id: sessionId }) + "\n";
    }
    out += JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }) + "\n";
    const turnCompleted:Record<string, unknown> = { type: "turn.completed" };
    if (inputTokens !== undefined || outputTokens !== undefined) {
        turnCompleted.usage = { input_tokens: inputTokens ?? 0, output_tokens: outputTokens ?? 0 };
    }
    out += JSON.stringify(turnCompleted) + "\n";
    return out;
}

function stubContexts() {
    const files = new Map<string, string>();
    files.set("/project/.flanders/config.json", JSON.stringify(DEFAULT_CONFIG));
    const rmCalls:string[] = [];
    const written:string[] = [];
    const errors:string[] = [];
    const mkdtempState = { count: 0 };
    const mkdtempCalls:string[] = [];

    const claudeQueue:ClaudeResponse[] = [];
    const codexQueue:CodexResponse[] = [];
    const promptQueue:string[] = [];
    const scriptQueue:ScriptResponse[] = [];
    const gitQueue:ScriptResponse[] = [];
    const gitSpawns:Array<{command:string; args:readonly string[]}> = [];
    const claudeSpawnedArgs:string[][] = [];
    const codexSpawnedArgs:string[][] = [];

    const contexts:ImplementContexts = {
        claude: {
            spawn(_command:string, args:readonly string[]) {
                claudeSpawnedArgs.push([...args]);
                const proc = fakeProcess();
                const origStdin = proc.stdin!;
                let capturedPrompt = "";
                (proc as any).stdin = {
                    write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; promptQueue.push(p.message.content); } } catch {} },
                    end() { origStdin.end(); }
                };
                const response = claudeQueue.shift();
                if (!response) {
                    setImmediate(() => proc.$emit("error", new Error("claude queue exhausted")));
                    return proc;
                }
                setImmediate(() => {
                    if (response.error) {
                        proc.$emit("error", new Error("spawn error"));
                    } else {
                        if (response.errorLog !== undefined) {
                            const target = targetErrorLogFromPrompt(capturedPrompt);
                            files.set(target, response.errorLog);
                        }
                        if (response.stderr) {
                            proc.$emitStderr(response.stderr);
                        }
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    }
                });
                return proc;
            }
        },
        script: {
            spawn(command:string, args:readonly string[]) {
                const proc = fakeProcess();
                if (command === "codex") {
                    codexSpawnedArgs.push([...args]);
                    const origStdin = proc.stdin!;
                    let capturedPrompt = "";
                    (proc as any).stdin = {
                        write(chunk:string) { origStdin.write(chunk); capturedPrompt += chunk; promptQueue.push(chunk); },
                        end() { origStdin.end(); }
                    };
                    const response = codexQueue.shift();
                    if (!response) {
                        setImmediate(() => proc.$emit("error", new Error("codex queue exhausted")));
                        return proc;
                    }
                    setImmediate(() => {
                        if (response.error) {
                            proc.$emit("error", new Error("spawn error"));
                        } else {
                            if (response.errorLog !== undefined) {
                                const target = targetErrorLogFromPrompt(capturedPrompt);
                                files.set(target, response.errorLog);
                            }
                            proc.$emitStdout(codexResultEvents(response.text, response.sessionId, response.inputTokens, response.outputTokens));
                            proc.$emit("exit", 0);
                        }
                    });
                    return proc;
                }
                const isGit = command === "git";
                if (isGit) {
                    gitSpawns.push({ command, args: [...args] });
                }
                const response = (isGit ? gitQueue : scriptQueue).shift();
                if (!response) {
                    setImmediate(() => proc.$emit("error", new Error("no response in queue")));
                    return proc;
                }
                setImmediate(() => {
                    if (response.stdout) proc.$emitStdout(response.stdout);
                    if (response.stderr) proc.$emitStderr(response.stderr);
                    proc.$emit("exit", response.code);
                });
                return proc;
            }
        },
        fs: {
            readFile(p) { return files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error("not found: " + p)); },
            writeFile(p, content) { files.set(p, content); return Promise.resolve(); },
            rename(oldP, newP) { const c = files.get(oldP); if (c !== undefined) { files.delete(oldP); files.set(newP, c); } return Promise.resolve(); },
            readdir() { return Promise.resolve([]); },
            stat(p) {
                if (files.has(p)) return Promise.resolve({ size: files.get(p)!.length, isFile: true, isDirectory: false });
                return Promise.reject(new Error("not found: " + p));
            },
            exists(p) { return Promise.resolve(files.has(p)); },
            mkdir() { return Promise.resolve(); },
            mkdtemp(prefix) {
                mkdtempCalls.push(prefix);
                mkdtempState.count++;
                if (mkdtempState.count === 1) return Promise.resolve(prefix + "ws123");
                return Promise.resolve(prefix + `rev${mkdtempState.count - 1}`);
            },
            rm(p:string) { rmCalls.push(p); files.delete(p); return Promise.resolve(); }
        },
        time: {
            now() { return 0; },
            setTimeout(handler, ms):TimeoutHandle {
                const id = globalThis.setTimeout(handler, ms);
                return { cancel() { globalThis.clearTimeout(id); } };
            }
        },
        random: { random() { return 0; } },
        platform: {
            isWindows() { return false; },
            tmpdir() { return "/tmp"; },
            homedir() { return "/home/test"; }
        },
        output: {
            write(text) { written.push(text); },
            writeError(text) { errors.push(text); },
            columns() { return 80; },
            rows() { return 24; },
            onResize() { return () => {}; }
        }
    };
    return { contexts, files, rmCalls, written, errors, claudeQueue, codexQueue, promptQueue, scriptQueue, gitQueue, gitSpawns, claudeSpawnedArgs, codexSpawnedArgs, mkdtempCalls };
}

const PLAN_PATH = "/project/plans/test.md";
// Where a plan at PLAN_PATH ends up once the implement command accepts its last open task: the
// command prepends the `V-` completion marker to the plan's basename. A fully-completed run reads
// its plan content here, not at PLAN_PATH.
const COMPLETED_PLAN_PATH = "/project/plans/V-test.md";
const PLAN_ONE_TASK = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Implement feature A\n';
const WS_ROOT = "/tmp/flanders-ws123";
function reviewerRoot(n:number):string { return `/tmp/flanders-rev${n}`; }
function reviewerErrorLogPath(n:number):string { return `${reviewerRoot(n)}/error.log`; }
function targetErrorLogFromPrompt(capturedPrompt:string):string {
    const m = capturedPrompt.match(/(\/tmp\/flanders-rev\d+)\/error\.log/);
    return m ? `${m[1]}/error.log` : `${WS_ROOT}/error.log`;
}
const DEFAULT_CONFIG:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "", optional: false }], minimumReviews: 1 };
const CONFIG_PATH = "/project/.flanders/config.json";

test.describe("Implement per-iteration logs", test => {
    test("writes all four log files after one successful iteration", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "No build or test scripts needed." });
            s.claudeQueue.push({ text: "Worker output for feature A" });
            s.claudeQueue.push({ text: "Looks good.\n\nPASS", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files }) {
            Assert.strictEqual(code, 0);
            Assert.ok(files.has(WS_ROOT + "/worker.1.log"), "worker.1.log should exist");
            Assert.ok(files.get(WS_ROOT + "/worker.1.log")!.includes("Worker output for feature A"), "worker.1.log should contain worker output");
            Assert.ok(files.has(WS_ROOT + "/reviewer.1.1.log"), "reviewer.1.1.log should exist");
            Assert.ok(files.get(WS_ROOT + "/reviewer.1.1.log")!.includes("Looks good."));
            Assert.ok(files.get(WS_ROOT + "/reviewer.1.1.log")!.includes("Verdict: PASS"));
        }
    });

    test("writes build and test logs when scripts exist", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // detect build/test — simulate scripts being written
            s.claudeQueue.push({ text: "Scripts written." });
            s.files.set(WS_ROOT + "/build.sh", "npm run build");
            s.files.set(WS_ROOT + "/test.sh", "npm test");
            // worker
            s.claudeQueue.push({ text: "implemented" });
            // build script
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            // test script
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "warn\n" });
            // reviewer
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files }) {
            Assert.strictEqual(code, 0);
            Assert.ok(files.has(WS_ROOT + "/build.1.log"), "build.1.log should exist");
            Assert.ok(files.get(WS_ROOT + "/build.1.log")!.includes("build ok"));
            Assert.ok(files.has(WS_ROOT + "/test.1.log"), "test.1.log should exist");
            Assert.ok(files.get(WS_ROOT + "/test.1.log")!.includes("tests pass"));
            Assert.ok(files.get(WS_ROOT + "/test.1.log")!.includes("warn"));
        }
    });

    test("previous iteration logs are preserved when build fails and retries", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (build fails) still runs a post-worker add
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // detect build/test
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "make");
            // iter 1: worker
            s.claudeQueue.push({ text: "iter 1 worker" });
            // iter 1: build fails
            s.scriptQueue.push({ code: 1, stdout: "compile error\n", stderr: "fatal\n" });
            // iter 2: worker
            s.claudeQueue.push({ text: "iter 2 worker" });
            // iter 2: build succeeds
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            // iter 2: test (skipped — no test script)
            // iter 2: reviewer
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files }) {
            Assert.strictEqual(code, 0);
            Assert.ok(files.has(WS_ROOT + "/worker.1.log"), "worker.1.log preserved");
            Assert.ok(files.get(WS_ROOT + "/worker.1.log")!.includes("iter 1 worker"), "worker.1.log should contain iter 1 output");
            Assert.ok(files.has(WS_ROOT + "/build.1.log"), "build.1.log preserved");
            Assert.ok(files.get(WS_ROOT + "/build.1.log")!.includes("compile error"));
            Assert.ok(files.has(WS_ROOT + "/worker.2.log"), "worker.2.log exists");
            Assert.ok(files.get(WS_ROOT + "/worker.2.log")!.includes("iter 2 worker"), "worker.2.log should contain iter 2 output");
            Assert.ok(files.has(WS_ROOT + "/build.2.log"), "build.2.log exists");
            Assert.ok(files.get(WS_ROOT + "/build.2.log")!.includes("build ok"));
        }
    });

    test("error.log is overwritten on each failure (not per-iteration)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 2); // iters 1 and 2 (build fails) each run a post-worker add
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "make");
            // iter 1: worker ok, build fails
            s.claudeQueue.push({ text: "w1" });
            s.scriptQueue.push({ code: 1, stdout: "err1\n", stderr: "" });
            // iter 2: worker ok, build fails again
            s.claudeQueue.push({ text: "w2" });
            s.scriptQueue.push({ code: 1, stdout: "err2\n", stderr: "" });
            // iter 3: worker ok, build passes, reviewer passes
            s.claudeQueue.push({ text: "w3" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 0);
        }
    });

    test("reviewer FAIL writes reviewer log with verdict and preserves across iterations", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker ok, build/test skipped, reviewer fails
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "Missing edge case.", errorLog: "needs error handling" });
            // iter 2: worker ok, reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "All good.", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files }) {
            Assert.strictEqual(code, 0);
            const rev1 = files.get(WS_ROOT + "/reviewer.1.1.log")!;
            Assert.ok(rev1.includes("Missing edge case."));
            Assert.ok(rev1.includes("Verdict: FAIL needs error handling"));
            const rev2 = files.get(WS_ROOT + "/reviewer.2.1.log")!;
            Assert.ok(rev2.includes("Verdict: PASS"));
        }
    });

    test("hard stop message points to workspace with per-iteration logs", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 2); // 5 worker-success iterations need 5 post-worker adds; gitRunQueue's 3 {code:0} replies cover the rest
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // 5 iterations of worker success + reviewer failure => hard stop at iter 6
            for (let i = 0; i < 5; i++) {
                s.claudeQueue.push({ text: `worker iter ${i + 1}` });
                s.claudeQueue.push({ text: "found issues", errorLog: "not good enough" });
            }
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "hard stop message points to workspace"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(WS_ROOT), "hard stop should point to workspace");
            },
            "iteration 5 worker log is preserved"(_code, { files }) {
                Assert.ok(files.has(WS_ROOT + "/worker.5.log"), "iteration 5 worker log preserved");
            },
            "iteration 5 reviewer log is preserved"(_code, { files }) {
                Assert.ok(files.has(WS_ROOT + "/reviewer.5.1.log"), "iteration 5 reviewer log preserved");
            },
            "workspace folder is not removed on dispose"(_code, { rmCalls }) {
                Assert.ok(!rmCalls.includes(WS_ROOT), "fs.rm should not be called with workspace root");
            }
        }
    });

    test("non-hard-stop run still removes the workspace on dispose", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "workspace folder is removed on dispose"(_code, { rmCalls }) {
                Assert.ok(rmCalls.includes(WS_ROOT), "fs.rm should be called with workspace root on success");
            }
        }
    });
});

const CLEAR_SEQ = "\x1b[3A\r\x1b[J";
const SEP = "─";

test.describe("Implement output routing through BottomBlock", test => {
    test("claude session output appears via writeAbove (preceded by block clear)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker output line\n" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            Assert.ok(allOutput.includes(SEP.repeat(80)), "should draw block separator");
            Assert.ok(allOutput.includes(CLEAR_SEQ), "should contain block clear sequences");
            Assert.ok(allOutput.includes("worker output line"), "claude output should appear in output");
        }
    });

    test("script stdout and stderr routed through writeAbove", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.claudeQueue.push({ text: "implemented" });
            s.scriptQueue.push({ code: 0, stdout: "build stdout line\n", stderr: "build stderr line\n" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            Assert.ok(allOutput.includes("build stdout line"), "script stdout should appear in output");
            Assert.ok(allOutput.includes("build stderr line"), "script stderr should appear in output");
        }
    });

    test("line buffering: partial lines are held until newline arrives", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "echo");
            const proc = fakeProcess();
            let scriptSpawnCount = 0;
            const origScriptSpawn = s.contexts.script.spawn;
            (s.contexts.script as { spawn:typeof s.contexts.script.spawn }).spawn = (command, args, options) => {
                if (command === "git") {
                    return origScriptSpawn(command, args, options);
                }
                scriptSpawnCount++;
                if (scriptSpawnCount === 1) {
                    setImmediate(() => {
                        proc.$emitStdout("partial");
                        proc.$emitStdout(" line\ncomplete\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
                throw new Error("unexpected spawn");
            };
            s.claudeQueue.push({ text: "implemented" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            Assert.ok(allOutput.includes("partial line\n"), "partial chunks should be joined into complete line");
            Assert.ok(allOutput.includes("complete\n"), "second complete line should appear");
        }
    });

    test("ANSI escape sequences pass through unchanged", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "echo");
            s.scriptQueue.push({ code: 0, stdout: "\x1b[31mred text\x1b[0m\n", stderr: "" });
            s.claudeQueue.push({ text: "implemented" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            Assert.ok(allOutput.includes("\x1b[31mred text\x1b[0m"), "ANSI sequences should pass through unchanged");
        }
    });

    test("block remains visible after run completes and no additional writes happen", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, written }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            const countAfterDispose = written.length;
            await new Promise(resolve => globalThis.setTimeout(resolve, 300));
            return { countAfterDispose, countAfterWait: written.length, hasSep: written.join("").includes(SEP.repeat(80)) };
        },
        ASSERTS: {
            "block separator is visible in output"(result) {
                Assert.ok(result.hasSep, "block should remain visible after run");
            },
            "no additional writes after dispose"(result) {
                Assert.strictEqual(result.countAfterDispose, result.countAfterWait);
            }
        }
    });

    test("plan errors appear above the block (block always present)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, '# Plan\n\n- [done]{"it":0,"ot":0,"t":0} bad checkbox\n');
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "block separator is present"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(SEP.repeat(80)), "block should be mounted from the start");
            },
            "exact diagnostic header appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                const header = `Plan ${PLAN_PATH} contains malformed checkbox lines:\n`;
                Assert.ok(allOutput.includes(header), "exact diagnostic header should appear in output above block");
                const clearBefore = allOutput.lastIndexOf(CLEAR_SEQ, allOutput.indexOf(header));
                Assert.ok(clearBefore !== -1, "diagnostic header should be preceded by block clear");
            },
            "exact offending raw line appears in output"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(
                    allOutput.includes('  line 3: - [done]{"it":0,"ot":0,"t":0} bad checkbox\n'),
                    "exact offending raw line should appear in output above block"
                );
            }
        }
    });
});

test.describe("Implement block present on early routes", test => {
    test("unknown flag keeps block present and emits error above the block", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--bad-flag"], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "block separator is present"(_code, { written }) {
                Assert.ok(written.join("").includes(SEP.repeat(80)), "block should be present");
            },
            "error text appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("--bad-flag"), "error text should appear in output");
                const clearIdx = allOutput.lastIndexOf(CLEAR_SEQ, allOutput.indexOf("--bad-flag"));
                Assert.ok(clearIdx !== -1, "error should be preceded by block clear");
            }
        }
    });

    test("plan not found keeps block present and emits error above the block", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["/nonexistent/plan.md"], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "block separator is present"(_code, { written }) {
                Assert.ok(written.join("").includes(SEP.repeat(80)));
            },
            "error text appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("Plan file not found"), "error text should appear in output");
                const clearIdx = allOutput.lastIndexOf(CLEAR_SEQ, allOutput.indexOf("Plan file not found"));
                Assert.ok(clearIdx !== -1, "error should be preceded by block clear");
            }
        }
    });

    test("plan malformed emits each malformed line above the block", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, '# Plan\n\n- [done]{"it":0,"ot":0,"t":0} bad1\n- [nope]{"it":0,"ot":0,"t":0} bad2\n');
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "block separator is present"(_code, { written }) {
                Assert.ok(written.join("").includes(SEP.repeat(80)));
            },
            "exact diagnostic header appears in output"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(
                    allOutput.includes(`Plan ${PLAN_PATH} contains malformed checkbox lines:\n`),
                    "exact diagnostic header should appear in output"
                );
            },
            "first exact offending raw line appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                const lineText = '  line 3: - [done]{"it":0,"ot":0,"t":0} bad1\n';
                Assert.ok(allOutput.includes(lineText), "first exact offending raw line should appear");
                const clearBefore = allOutput.lastIndexOf(CLEAR_SEQ, allOutput.indexOf(lineText));
                Assert.ok(clearBefore !== -1, "first offending raw line should be preceded by block clear");
            },
            "second exact offending raw line appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                const lineText = '  line 4: - [nope]{"it":0,"ot":0,"t":0} bad2\n';
                Assert.ok(allOutput.includes(lineText), "second exact offending raw line should appear");
                const clearBefore = allOutput.lastIndexOf(CLEAR_SEQ, allOutput.indexOf(lineText));
                Assert.ok(clearBefore !== -1, "second offending raw line should be preceded by block clear");
            }
        }
    });

    test("plan empty (no tasks) keeps block present and emits error above the block", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, "# Plan\n\nNo checkbox lines here.\n");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "block separator is present"(_code, { written }) {
                Assert.ok(written.join("").includes(SEP.repeat(80)));
            },
            "error text appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("no task lines"), "error text should appear in output");
                const clearIdx = allOutput.lastIndexOf(CLEAR_SEQ, allOutput.indexOf("no task lines"));
                Assert.ok(clearIdx !== -1, "error should be preceded by block clear");
            }
        }
    });

    test("preflight failed keeps block present and emits error above the block", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: " M src/dirty.ts\n", stderr: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "block separator is present"(_code, { written }) {
                Assert.ok(written.join("").includes(SEP.repeat(80)));
            },
            "error text appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const msg = "Working tree has unstaged changes. Please stage, commit, or stash them before re-running.\n";
                const allOutput = written.join("");
                Assert.ok(written.includes(msg), "exact unstaged diagnostic should appear in output");
                const clearIdx = allOutput.lastIndexOf(CLEAR_SEQ, allOutput.indexOf(msg));
                Assert.ok(clearIdx !== -1, "error should be preceded by block clear");
            }
        }
    });
});

test.describe("Implement config loading", test => {
    test("missing config at both scopes exits 1 with exact diagnostic and Failed footer", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.delete(CONFIG_PATH);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "error output equals the exact literal string"(_code, { written }) {
                const strippedEntries = written.map(entry => stripAnsi(entry));
                const diagnosticEntry = strippedEntries.find(entry => entry.includes("Missing Flanders"));
                Assert.ok(diagnosticEntry !== undefined, "a written entry must contain the diagnostic");
                Assert.strictEqual(diagnosticEntry, "Missing Flanders configuration. Run 'npx flanders install'.\n");
            },
            "footer shows Failed"(_code, { written }) {
                const stripped = stripAnsi(written.join(""));
                Assert.ok(stripped.includes(FAILED_LABEL));
            }
        }
    });

    test("valid project-scope config proceeds and is stashed on instance", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const projectConfig:FlandersConfig = { worker: { tool: "codex", model: "test-model", effort: "high" }, reviewers: [{ tool: "claude", model: "rev-model", effort: "low", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(projectConfig));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.codexQueue.push({ text: "detect" });
            s.codexQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "review", errorLog: "" });
            return { ...s, projectConfig };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            const config = cmd.config;
            await cmd.dispose();
            return { code, config };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "stashed config equals the parsed file"({ config }, { projectConfig }) {
                Assert.deepStrictEqual(config, projectConfig);
            }
        }
    });

    test("project config shadows global config", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const projectConfig:FlandersConfig = { worker: { tool: "claude", model: "project-sentinel", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "", optional: false }], minimumReviews: 1 };
            const globalConfig:FlandersConfig = { worker: { tool: "codex", model: "global-sentinel", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(projectConfig));
            s.files.set("/home/test/.flanders/config.json", JSON.stringify(globalConfig));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "review", errorLog: "" });
            return { ...s, projectConfig };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            const config = cmd.config;
            await cmd.dispose();
            return { code, config };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "stashed config uses the project-scope sentinel"({ config }) {
                Assert.strictEqual(config!.worker.model, "project-sentinel");
            },
            "stashed config does not use the global-scope sentinel"({ config }) {
                Assert.notStrictEqual(config!.worker.model, "global-sentinel");
            }
        }
    });

    test("malformed config exits non-zero with diagnostic containing file path and field name", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(CONFIG_PATH, JSON.stringify({ worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "" }] }));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic contains the file path"(_code, { written }) {
                const allOutput = stripAnsi(written.join(""));
                Assert.ok(allOutput.includes("/project/.flanders/config.json"), "should contain the config file path");
            },
            "diagnostic contains the offending field name"(_code, { written }) {
                const allOutput = stripAnsi(written.join(""));
                Assert.ok(allOutput.includes("reviewers[0].effort"), "should contain the offending field name");
            }
        }
    });

    test("malformed config footer shows Failed", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(CONFIG_PATH, "not valid json{{{");
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "footer shows Failed"(_code, { written }) {
                const stripped = stripAnsi(written.join(""));
                Assert.ok(stripped.includes(FAILED_LABEL));
            }
        }
    });

    test("config JSON with an unexpected top-level key is rejected as malformed", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(CONFIG_PATH, JSON.stringify({
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [{ tool: "claude", model: "", effort: "", optional: false }],
                minimumReviews: 1,
                detect: { tool: "claude", model: "detect-model", effort: "detect-effort" }
            }));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the unexpected top-level key and the config path"(_code, { written }) {
                const allOutput = stripAnsi(written.join(""));
                Assert.ok(allOutput.includes(`Malformed config at /project/.flanders/config.json: unexpected top-level key "detect"`), "should name the unexpected key and the config path");
            }
        }
    });
});

test.describe("Implement ambiguous plan selection", test => {
    const PLAN_A = '# Plan A\n\n- [ ]{"it":0,"ot":0,"t":0} Task A\n';
    const PLAN_B = '# Plan B\n\n- [ ]{"it":0,"ot":0,"t":0} Task B\n';

    test("multiple plans + no [plan] arg emits diagnostic listing each plan and instructions, exits non-zero, never prompts", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set("/project/plans/plan-a.md", PLAN_A);
            s.files.set("/project/plans/plan-b.md", PLAN_B);
            const origExists = s.contexts.fs.exists.bind(s.contexts.fs);
            (s.contexts.fs as any).exists = (p:string) => {
                if (p === "/project/plans") return Promise.resolve(true);
                return origExists(p);
            };
            (s.contexts.fs as any).readdir = (p:string) => {
                if (p === "/project/plans") {
                    return Promise.resolve([
                        { name: "plan-a.md", isFile: true, isDirectory: false },
                        { name: "plan-b.md", isFile: true, isDirectory: false }
                    ]);
                }
                return Promise.resolve([]);
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "block separator is present"(_code, { written }) {
                Assert.ok(written.join("").includes(SEP.repeat(80)), "block should be present");
            },
            "header entry equals exact literal naming plansFolder"(_code, { written }) {
                const stripped = written.map(stripAnsi);
                const entry = stripped.find(e => e.includes("Multiple plan files found"));
                Assert.ok(entry !== undefined, "a written entry must contain the header");
                Assert.strictEqual(entry, "Multiple plan files found in /project/plans:\n");
            },
            "plan-a.md is listed as an exact line entry"(_code, { written }) {
                const stripped = written.map(stripAnsi);
                const entry = stripped.find(e => e.includes("plan-a.md"));
                Assert.ok(entry !== undefined, "a written entry must contain plan-a.md");
                Assert.strictEqual(entry, "  plan-a.md\n");
            },
            "plan-b.md is listed as an exact line entry"(_code, { written }) {
                const stripped = written.map(stripAnsi);
                const entry = stripped.find(e => e.includes("plan-b.md"));
                Assert.ok(entry !== undefined, "a written entry must contain plan-b.md");
                Assert.strictEqual(entry, "  plan-b.md\n");
            },
            "instruction entry equals exact literal naming the [plan] argument"(_code, { written }) {
                const stripped = written.map(stripAnsi);
                const entry = stripped.find(e => e.includes("Re-run"));
                Assert.ok(entry !== undefined, "a written entry must contain the instruction");
                Assert.strictEqual(entry, "Re-run with the chosen plan as the [plan] argument.\n");
            },
            "footer shows Failed"(_code, { written }) {
                Assert.ok(stripAnsi(written.join("")).includes(FAILED_LABEL));
            }
        }
    });
});

test.describe("Implement intermediate header and metrics states", test => {
    test("noop tasks completed shows header N/N and plan metrics", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const allDonePlan = '# Plan\n\n- [x]{"it":100,"ot":50,"t":5} Already done task\n';
            s.files.set(PLAN_PATH, allDonePlan);
            const headerCalls:HeaderFields[] = [];
            const metricsCalls:MetricsFields[] = [];
            const origSetHeader = BottomBlock.prototype.setHeader;
            BottomBlock.prototype.setHeader = function(fields:HeaderFields) {
                headerCalls.push(fields);
                origSetHeader.call(this, fields);
            };
            const origSetMetrics = BottomBlock.prototype.setMetrics;
            BottomBlock.prototype.setMetrics = function(fields:MetricsFields) {
                metricsCalls.push(fields);
                origSetMetrics.call(this, fields);
            };
            return { s, headerCalls, metricsCalls, origSetHeader, origSetMetrics };
        },
        async ACT({ s, headerCalls, metricsCalls, origSetHeader, origSetMetrics }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                const code = await cmd.result();
                await cmd.dispose();
                return { code, headerCalls: [...headerCalls], metricsCalls: [...metricsCalls] };
            } finally {
                BottomBlock.prototype.setHeader = origSetHeader;
                BottomBlock.prototype.setMetrics = origSetMetrics;
            }
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "header shows N/N"({ headerCalls }) {
                Assert.ok(headerCalls.length >= 1, "need at least 1 header call");
                Assert.strictEqual(headerCalls[0]!.indexLabel, "1/1");
            },
            "noop metrics has no task pair"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 1, "need at least 1 metrics call");
                Assert.strictEqual(metricsCalls[0]!.task, undefined);
            },
            "noop metrics plan pair is a static accumulated total (no anchor, base seconds)"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 1, "need at least 1 metrics call");
                Assert.deepStrictEqual(metricsCalls[0]!.plan, { tokens: 150, baseSeconds: 5 });
            }
        }
    });

    test("after parsing plan, block shows header 0/N, metrics with plan pair only, footer Working", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            const headerCalls:HeaderFields[] = [];
            const metricsCalls:MetricsFields[] = [];
            const origSetHeader = BottomBlock.prototype.setHeader;
            BottomBlock.prototype.setHeader = function(fields:HeaderFields) {
                headerCalls.push(fields);
                origSetHeader.call(this, fields);
            };
            const origSetMetrics = BottomBlock.prototype.setMetrics;
            BottomBlock.prototype.setMetrics = function(fields:MetricsFields) {
                metricsCalls.push(fields);
                origSetMetrics.call(this, fields);
            };
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { s, headerCalls, metricsCalls, origSetHeader, origSetMetrics };
        },
        async ACT({ s, headerCalls, metricsCalls, origSetHeader, origSetMetrics }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                const code = await cmd.result();
                await cmd.dispose();
                return { code, headerCalls: [...headerCalls], metricsCalls: [...metricsCalls] };
            } finally {
                BottomBlock.prototype.setHeader = origSetHeader;
                BottomBlock.prototype.setMetrics = origSetMetrics;
            }
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "first header call shows 0/N"({ headerCalls }) {
                Assert.ok(headerCalls.length >= 1, "need at least 1 header call");
                Assert.strictEqual(headerCalls[0]!.indexLabel, "0/1");
            },
            "first metrics call has no task pair"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 1, "need at least 1 metrics call");
                Assert.strictEqual(metricsCalls[0]!.task, undefined);
            },
            "first metrics call has a static zero plan pair (no anchor)"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 1, "need at least 1 metrics call");
                Assert.deepStrictEqual(metricsCalls[0]!.plan, { tokens: 0, baseSeconds: 0 });
            },
            "footer shows the working label in output"(_result, { s }) {
                const allOutput = s.written.join("");
                Assert.ok(allOutput.includes(WORKING_LABEL), "footer should show the working-pool label");
            }
        }
    });
});

test.describe("Implement completion-message variants", test => {
    test("noop tasks-completed path prints the tasks-completed pool entry the random context selects", {
        ARRANGE() {
            const s = stubContexts();
            const allDonePlan = '# Plan\n\n- [x]{"it":100,"ot":50,"t":5} Already done\n';
            s.files.set(PLAN_PATH, allDonePlan);
            // random() = 0.45 → pickVariant index Math.floor(0.45 * 10) = 4: a non-zero
            // entry, so a regression hardcoding a fixed index (e.g. pool[0]) is caught and
            // the selection is shown to route through the injected RandomContext.
            const contexts:ImplementContexts = { ...s.contexts, random: { random: () => 0.45 } };
            return { contexts, written: s.written };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "prints exactly the random-selected tasks-completed pool entry followed by a newline"(_code, { written }) {
                const plain = stripAnsi(written.join(""));
                Assert.ok(plain.includes(tasksCompletedPool[4]! + "\n"), "should print tasksCompletedPool[4] followed by a newline");
            }
        }
    });

    test("end-of-run path prints the all-tasks-completed pool entry the random context selects", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });                        // detect build/test
            s.claudeQueue.push({ text: "worker" });                    // worker stage
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" }); // reviewer stage
            // random() = 0.45 → pickVariant index Math.floor(0.45 * 10) = 4: a non-zero
            // entry, so a regression hardcoding a fixed index (e.g. pool[0]) is caught and
            // the selection is shown to route through the injected RandomContext.
            const contexts:ImplementContexts = { ...s.contexts, random: { random: () => 0.45 } };
            return { contexts, written: s.written };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "prints exactly the random-selected all-tasks-completed pool entry followed by a newline"(_code, { written }) {
                const plain = stripAnsi(written.join(""));
                Assert.ok(plain.includes(allTasksCompletedPool[4]! + "\n"), "should print allTasksCompletedPool[4] followed by a newline");
            }
        }
    });
});

test.describe("Implement header line", test => {
    test("header shows index, iteration, activity and title", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            Assert.ok(stripAnsi(allOutput).includes("1/1 iter 1 implementing Implement feature A"), "header should show all fields");
        }
    });

    test("no [index] iter N task output lines are emitted — info comes from header only", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            Assert.ok(!/\[\d+\/\d+\] iter \d+/.test(allOutput), "should not contain [N/N] iter N style output");
        }
    });

    test("header updates activity through all four stages", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.files.set(WS_ROOT + "/test.sh", "test");
            s.claudeQueue.push({ text: "worker" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = stripAnsi(written.join(""));
            Assert.ok(allOutput.includes("1/1 iter 1 implementing"), "should show implementing");
            Assert.ok(allOutput.includes("1/1 iter 1 building"), "should show building");
            Assert.ok(allOutput.includes("1/1 iter 1 testing"), "should show testing");
            Assert.ok(allOutput.includes("1/1 iter 1 reviewing"), "should show reviewing");
        }
    });

    test("header includes taskNumber when plan has numbered headings", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const numberedPlan = '# Plan\n\n## 3. Section\n\n### 3.2 Subsection\n\n- [ ]{"it":0,"ot":0,"t":0} Do the thing\n';
            s.files.set(PLAN_PATH, numberedPlan);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = stripAnsi(written.join(""));
            Assert.ok(allOutput.includes("implementing 3.2 Do the thing"), "header should include taskNumber before title");
        }
    });

    test("header truncates with ellipsis when wider than terminal", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            (s.contexts.output as any).columns = () => 20;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = stripAnsi(written.join(""));
            Assert.ok(allOutput.includes("1/1 iter 1 implemen…"), "header should be truncated with ellipsis");
            Assert.ok(!allOutput.includes("1/1 iter 1 implementing Implement feature A"), "full header should not appear");
        }
    });

    test("header iteration updates across retries", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "found issues", errorLog: "not ready" });
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = stripAnsi(written.join(""));
            Assert.ok(allOutput.includes("1/1 iter 1 implementing"), "should show iter 1");
            Assert.ok(allOutput.includes("1/1 iter 2 implementing"), "should show iter 2 after retry");
        }
    });

    test("header contains ANSI color escapes for each field", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const numberedPlan = '# Plan\n\n## 3. Section\n\n- [ ]{"it":0,"ot":0,"t":0} Do the thing\n';
            s.files.set(PLAN_PATH, numberedPlan);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            Assert.ok(allOutput.includes(CYAN + "1/1"), "index label should be cyan");
            Assert.ok(allOutput.includes(YELLOW + "iter 1"), "iteration should be yellow");
            Assert.ok(allOutput.includes(MAGENTA + "implementing"), "activity should be magenta");
            Assert.ok(allOutput.includes(GREEN + "3"), "task number should be green");
        }
    });
});

const ORANGE = "\x1b[38;5;208m";
const ANSI_RESET = "\x1b[0m";

test.describe("Implement footer animation", test => {
    test("footer shows Working label in orange during execution", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            Assert.ok(allOutput.includes(ORANGE), "footer should contain orange escape");
            Assert.ok(allOutput.includes(WORKING_LABEL), "footer should contain the working-pool label");
            Assert.ok(allOutput.includes(ANSI_RESET), "footer should contain reset escape");
        }
    });

    test("animation is stopped when block is unmounted (no lingering timers)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, written }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            const countAfterDispose = written.length;
            await new Promise(resolve => globalThis.setTimeout(resolve, 300));
            return { countAfterDispose, countAfterWait: written.length };
        },
        ASSERT({ countAfterDispose, countAfterWait }) {
            Assert.strictEqual(countAfterDispose, countAfterWait, "no additional writes after dispose — animation timer cancelled");
        }
    });
});

function controllableTime() {
    let now = 0;
    const timers:Array<{ at:number; cb:() => void; cancelled:boolean }> = [];
    return {
        advance(ms:number) {
            now += ms;
            for (const t of timers.slice()) {
                if (!t.cancelled && t.at <= now) {
                    t.cancelled = true;
                    t.cb();
                }
            }
        },
        ctx: {
            now() { return now; },
            setTimeout(handler:() => void, ms:number):TimeoutHandle {
                const t = { at: now + ms, cb: handler, cancelled: false };
                timers.push(t);
                return { cancel() { t.cancelled = true; } };
            }
        } satisfies TimeContext
    };
}

// Claude stub where spawn number `rateLimitOnSpawn` emits a rate_limit event (driving the runner
// into a rate-limit wait) and every other spawn replies from `s.claudeQueue`. Spawns named via
// `hold(...)` have their emission deferred until `release(n)` — so a test can observe the footer at
// rest after the wait resolves but before the next AI call produces any output (the hold mechanism
// mirrors gatedClaudeStub; sharing it here avoids a near-duplicate stub per docs/rules/code-deduplication.md).
// With no spawn held the dispatch is `setImmediate(emit)` for every spawn, identical to the original.
function rateLimitStub(rateLimitOnSpawn:number, retryAfterSeconds:number) {
    const s = stubContexts();
    gitRunQueue(s.gitQueue);
    const time = controllableTime();
    (s.contexts as any).time = time.ctx;
    s.files.set(PLAN_PATH, PLAN_ONE_TASK);
    let spawnCount = 0;
    const holdSet = new Set<number>();
    const releasers = new Map<number, () => void>();
    (s.contexts.claude as any).spawn = (_command:string, args:readonly string[]) => {
        s.claudeSpawnedArgs.push([...args]);
        spawnCount++;
        const mySpawn = spawnCount;
        const proc = fakeProcess();
        const origStdin = proc.stdin!;
        let capturedPrompt = "";
        (proc as any).stdin = {
            write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; s.promptQueue.push(p.message.content); } } catch {} },
            end() { origStdin.end(); }
        };
        let emit:() => void;
        if (mySpawn === rateLimitOnSpawn) {
            emit = () => {
                proc.$emitStdout(rateLimitEvent(time.ctx.now(), retryAfterSeconds) + "\n");
                proc.$emit("exit", 0);
            };
        } else {
            const response = s.claudeQueue.shift();
            emit = () => {
                if (!response) {
                    proc.$emit("error", new Error("claude queue exhausted"));
                    return;
                }
                if (response.errorLog !== undefined) {
                    s.files.set(targetErrorLogFromPrompt(capturedPrompt), response.errorLog);
                }
                if (response.stderr) {
                    proc.$emitStderr(response.stderr);
                }
                proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                proc.$emit("exit", 0);
            };
        }
        if (holdSet.has(mySpawn)) {
            releasers.set(mySpawn, () => setImmediate(emit));
        } else {
            setImmediate(emit);
        }
        return proc;
    };
    return {
        s,
        time,
        hold(...spawns:number[]) { for (const n of spawns) holdSet.add(n); },
        release(spawn:number) { const r = releasers.get(spawn); if (r) { releasers.delete(spawn); r(); } }
    };
}

async function flush(rounds = 20) {
    for (let i = 0; i < rounds; i++) {
        await new Promise(r => setImmediate(r));
    }
}

// Records the FooterState kind of every BottomBlock.setFooter call (the public footer surface) so a
// test can observe footer transitions without piercing private state. Call restore() in a finally.
function recordFooterKinds() {
    const footerKinds:string[] = [];
    const origSetFooter = BottomBlock.prototype.setFooter;
    BottomBlock.prototype.setFooter = function(state) {
        footerKinds.push(state.kind);
        origSetFooter.call(this, state);
    };
    return {
        footerKinds,
        restore() { BottomBlock.prototype.setFooter = origSetFooter; }
    };
}

// A claude spawn whose designated spawns (hold(...)) are held open — their result is not emitted until
// release(n) — so a test can observe live header/footer state while a specific AI call is in flight.
function gatedClaudeStub(planContent:string) {
    const s = stubContexts();
    gitRunQueue(s.gitQueue);
    s.files.set(PLAN_PATH, planContent);
    let spawnCount = 0;
    const holdSet = new Set<number>();
    const releasers = new Map<number, () => void>();
    (s.contexts.claude as any).spawn = (_command:string, args:readonly string[]) => {
        s.claudeSpawnedArgs.push([...args]);
        spawnCount++;
        const mySpawn = spawnCount;
        const proc = fakeProcess();
        const origStdin = proc.stdin!;
        let capturedPrompt = "";
        (proc as any).stdin = {
            write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; s.promptQueue.push(p.message.content); } } catch {} },
            end() { origStdin.end(); }
        };
        const response = s.claudeQueue.shift();
        const emit = () => {
            if (!response) {
                proc.$emit("error", new Error("claude queue exhausted"));
                return;
            }
            if (response.errorLog !== undefined) {
                s.files.set(targetErrorLogFromPrompt(capturedPrompt), response.errorLog);
            }
            if (response.stderr) {
                proc.$emitStderr(response.stderr);
            }
            proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
            proc.$emit("exit", 0);
        };
        if (holdSet.has(mySpawn)) {
            releasers.set(mySpawn, () => setImmediate(emit));
        } else {
            setImmediate(emit);
        }
        return proc;
    };
    return {
        s,
        hold(...spawns:number[]) { for (const n of spawns) holdSet.add(n); },
        release(spawn:number) { const r = releasers.get(spawn); if (r) { releasers.delete(spawn); r(); } }
    };
}

test.describe("Implement rate-limit footer", test => {
    test("footer switches to rate-limit state during AI wait", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 300);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            const outputDuringRateLimit = s.written.join("");
            time.advance(300000);
            await flush();
            const code = await cmd.result();
            await cmd.dispose();
            return { outputDuringRateLimit, code };
        },
        ASSERTS: {
            "exits successfully"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "footer heading is exactly Waiting rate limit"({ outputDuringRateLimit }) {
                const footer = stripAnsi(outputDuringRateLimit.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[0], "Waiting rate limit");
            },
            "footer shows countdown"({ outputDuringRateLimit }) {
                Assert.ok(outputDuringRateLimit.includes("5 minutes"));
            }
        }
    });

    test("countdown ticks down each second", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 180);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            const initialOutput = s.written.join("");
            time.advance(60000);
            await flush();
            const afterOneMinute = s.written.join("");
            time.advance(120000);
            await flush();
            await cmd.result();
            await cmd.dispose();
            return { initialOutput, afterOneMinute };
        },
        ASSERTS: {
            "shows 3 minutes initially"({ initialOutput }) {
                Assert.ok(initialOutput.includes("3 minutes"));
            },
            "shows 2 minutes after 1 minute elapsed"({ afterOneMinute }) {
                Assert.ok(afterOneMinute.includes("2 minutes"));
            }
        }
    });

    test("animation resumes after rate-limit ends", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 5);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            const duringRateLimit = s.written.join("");
            time.advance(5000);
            await flush();
            const afterRateLimit = s.written.join("");
            await cmd.result();
            await cmd.dispose();
            return { duringRateLimit, afterRateLimit };
        },
        ASSERTS: {
            "footer heading during wait is exactly Waiting rate limit"({ duringRateLimit }) {
                const footer = stripAnsi(duringRateLimit.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[0], "Waiting rate limit");
            },
            "animation resumes after wait ends"({ duringRateLimit, afterRateLimit }) {
                const afterPortion = afterRateLimit.slice(duringRateLimit.length);
                Assert.ok(afterPortion.includes(WORKING_LABEL));
            }
        }
    });

    test("Working animation does not fire during rate-limit wait", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 10);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            const beforeTick = s.written.length;
            time.advance(200);
            await flush();
            time.advance(200);
            await flush();
            const afterAnimationTicks = s.written.length;
            time.advance(9600);
            await flush();
            await cmd.result();
            await cmd.dispose();
            return { beforeTick, afterAnimationTicks };
        },
        ASSERT({ beforeTick, afterAnimationTicks }) {
            Assert.strictEqual(beforeTick, afterAnimationTicks, "no animation writes during rate-limit wait (only countdown ticks)");
        }
    });

    test("rate-limit footer shows absolute end date and time", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 300);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            const output = s.written.join("");
            time.advance(300000);
            await flush();
            await cmd.result();
            await cmd.dispose();
            return output;
        },
        ASSERT(output) {
            Assert.ok(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(output), "footer should contain formatted date+time");
        }
    });

    test("countdown formats hours and minutes for long waits", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 5400);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            const output = s.written.join("");
            time.advance(5400000);
            await flush();
            await cmd.result();
            await cmd.dispose();
            return output;
        },
        ASSERT(output) {
            Assert.ok(output.includes("1 hours 30 minutes"), "should format as hours and minutes for >= 1h wait");
        }
    });

    test("a rate-limit wait during the build/test detection stage shows the Waiting rate limit footer and returns to Working", {
        ARRANGE() {
            // Spawn 1 is the build/test command detection ("validator") agent, which runs through
            // _detectBuildAndTest -> _runAi -> _defaultRunAiCallbacks before the iteration loop
            // starts, while _currentTask is still null. Rate-limiting spawn 1 (with a 300s = 5
            // minute wait) exercises the single-agent waiting footer for the detection stage. The
            // detect retry (spawn 2) is held so that, once the wait resolves, the run pauses at the
            // retry and the footer is observably at rest on Working — isolating the wait-resolution
            // render from the later post-review `setFooter({kind:"working"})`. Releasing spawn 2 lets
            // the worker (spawn 3) and reviewer (spawn 4) finish the single accepted iteration (exit 0).
            const r = rateLimitStub(1, 300);
            r.hold(2);
            r.s.claudeQueue.push({ text: "ok" });                        // detect retry (spawn 2, held)
            r.s.claudeQueue.push({ text: "worker" });                    // worker (spawn 3)
            r.s.claudeQueue.push({ text: "reviewer ok", errorLog: "" }); // reviewer (spawn 4)
            return r;
        },
        async ACT({ s, time, release }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            const outputDuringRateLimit = s.written.join("");
            time.advance(300000);
            await flush();
            // The detect retry (spawn 2) is held, so the last render is the post-wait footer.
            const footerAfterWait = stripAnsi(s.written.join("").split("\n").pop() ?? "");
            release(2);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, outputDuringRateLimit, footerAfterWait };
        },
        ASSERTS: {
            "exits successfully"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the rate-limit fires before the worker stage — no implementing activity has been shown yet"({ outputDuringRateLimit }) {
                Assert.ok(
                    !stripAnsi(outputDuringRateLimit).includes("implementing"),
                    `the detection-stage wait must precede the worker stage, got: ${JSON.stringify(stripAnsi(outputDuringRateLimit))}`
                );
            },
            "the footer heading during the detection wait is exactly Waiting rate limit"({ outputDuringRateLimit }) {
                const footer = stripAnsi(outputDuringRateLimit.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[0], "Waiting rate limit");
            },
            "the footer shows the expected end date and time"({ outputDuringRateLimit }) {
                const footer = stripAnsi(outputDuringRateLimit.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[1], formatDateTime(new Date(300000)));
            },
            "the footer shows the live countdown"({ outputDuringRateLimit }) {
                const footer = stripAnsi(outputDuringRateLimit.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[2], "5 minutes");
            },
            "the rendered footer returns to Working when the detection-stage wait resolves"({ footerAfterWait }) {
                Assert.strictEqual(footerAfterWait, `⣋ ${WORKING_LABEL}`);
            }
        }
    });
});

test.describe("Implement no preparing stage", test => {
    test("a run under DEFAULT_CONFIG never emits a preparing footer or activity; the worker stage opens at implementing/iter 1 with the Working footer", {
        ARRANGE() {
            // DEFAULT_CONFIG has the worker and the single reviewer share {claude,"",""}; this used to
            // trigger a prep stage. With prep removed, the first task stage is the worker itself.
            // A numbered plan so the worker header exercises index, plan number and title together.
            // The worker (spawn 2; spawn 1 is detect) is held so the live state is observed mid-call.
            const numberedPlan = '# Plan\n\n## 3. Section\n\n### 3.2 Subsection\n\n- [ ]{"it":0,"ot":0,"t":0} Do the thing\n';
            const gated = gatedClaudeStub(numberedPlan);
            gated.hold(2);
            gated.s.claudeQueue.push({ text: "ok" });        // detect (spawn 1)
            gated.s.claudeQueue.push({ text: "worker" });     // worker (spawn 2, held)
            gated.s.claudeQueue.push({ text: "reviewer ok", errorLog: "" }); // reviewer (spawn 3)
            const { footerKinds, restore } = recordFooterKinds();
            return { gated, footerKinds, restore };
        },
        async ACT({ gated, footerKinds, restore }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, gated.s.contexts);
                await flush();
                const outputDuringWorker = gated.s.written.join("");
                const footerKindsAtWorker = [...footerKinds];
                gated.release(2);
                const code = await cmd.result();
                await cmd.dispose();
                return { code, fullOutput: gated.s.written.join(""), outputDuringWorker, footerKindsAtWorker, footerKinds: [...footerKinds] };
            } finally {
                restore();
            }
        },
        ASSERTS: {
            "exits successfully"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the Preparing footer label never appears in the output"({ fullOutput }) {
                Assert.ok(!fullOutput.includes("Preparing"), "no Preparing footer should ever be rendered");
            },
            "the preparing activity never appears in the header"({ fullOutput }) {
                Assert.ok(!stripAnsi(fullOutput).includes("preparing"), "no preparing activity should ever be shown");
            },
            "the footer never enters the preparing state"({ footerKinds }) {
                Assert.ok(!footerKinds.includes("preparing"), `footer kinds should never include preparing, got: ${footerKinds.join(", ")}`);
            },
            "while the worker call is in flight the header shows 'iter 1 implementing' for the task"({ outputDuringWorker }) {
                Assert.ok(
                    stripAnsi(outputDuringWorker).includes("1/1 iter 1 implementing 3.2 Do the thing"),
                    "first activity should be implementing with iter 1"
                );
            },
            "no footer state is set before the worker stage — the footer stays the initial Working render"({ footerKindsAtWorker }) {
                Assert.deepStrictEqual(footerKindsAtWorker, []);
            },
            "while the worker call is in flight the live footer line shows the working label"({ outputDuringWorker }) {
                const footerLine = stripAnsi(outputDuringWorker.split("\n").pop() ?? "");
                Assert.ok(footerLine.endsWith(WORKING_LABEL), `live footer at worker start should end with the working label, got: ${JSON.stringify(footerLine)}`);
            }
        }
    });

    test("a rate-limit wait that ends during the worker stage returns the footer to Working", {
        ARRANGE() {
            // Rate-limit fires on spawn 2 = the worker call (spawn 1 is detect). No prep stage precedes it.
            const { s, time } = rateLimitStub(2, 300);
            s.claudeQueue.push({ text: "ok" });            // detect (spawn 1)
            s.claudeQueue.push({ text: "worker" });        // worker retry (spawn 3)
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" }); // reviewer (spawn 4)
            const { footerKinds, restore } = recordFooterKinds();
            return { s, time, footerKinds, restore };
        },
        async ACT({ s, time, footerKinds, restore }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                await flush();
                time.advance(300000);
                await flush();
                const code = await cmd.result();
                await cmd.dispose();
                return { code, footerKinds: [...footerKinds] };
            } finally {
                restore();
            }
        },
        ASSERTS: {
            "exits successfully"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the footer set when the worker-stage wait ends is working"({ footerKinds }) {
                const waitingIdx = footerKinds.indexOf("waiting");
                Assert.ok(waitingIdx >= 0, "precondition: a waiting footer was set during the worker rate-limit");
                Assert.strictEqual(footerKinds[waitingIdx + 1], "working");
            }
        }
    });
});

test.describe("Implement cleanup on exit", test => {
    test("dispose during active AI session stops timers but block stays visible", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            let spawnCount = 0;
            const originalSpawn = s.contexts.claude.spawn.bind(s.contexts.claude);
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = (...args) => {
                spawnCount++;
                if (spawnCount <= 1) {
                    return originalSpawn(...args);
                }
                const proc = fakeProcess();
                const realKill = proc.kill;
                proc.kill = (signal:"SIGINT"|"SIGTERM") => {
                    realKill.call(proc, signal);
                    setImmediate(() => proc.$emit("exit", null));
                };
                return proc;
            };
            return s;
        },
        async ACT({ contexts, written }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await flush();
            const hasSepBeforeDispose = written.join("").includes(SEP.repeat(80));
            const countBefore = written.length;
            await cmd.dispose();
            const countAfterDispose = written.length;
            await new Promise(resolve => globalThis.setTimeout(resolve, 300));
            return { hasSepBeforeDispose, countBefore, countAfterDispose, countAfterWait: written.length };
        },
        ASSERTS: {
            "block was mounted before dispose"(result) {
                Assert.ok(result.hasSepBeforeDispose);
            },
            "no additional writes after dispose"(result) {
                Assert.strictEqual(result.countAfterDispose, result.countAfterWait);
            }
        }
    });

    test("block stays visible after hard stop (MAX_ITER exceeded)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 2); // 5 worker-success iterations each run a post-worker add; gitRunQueue's 3 {code:0} replies cover the rest
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            for (let i = 0; i < 5; i++) {
                s.claudeQueue.push({ text: `worker iter ${i + 1}` });
                s.claudeQueue.push({ text: "found issues", errorLog: "not good enough" });
            }
            return s;
        },
        async ACT({ contexts, written }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, hasSep: written.join("").includes(SEP.repeat(80)) };
        },
        ASSERTS: {
            "exits with code 1"(result) {
                Assert.strictEqual(result.code, 1);
            },
            "block separator remains visible"(result) {
                Assert.ok(result.hasSep, "block should stay visible after hard stop");
            }
        }
    });

    test("separator remains visible after successful exit", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, written }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return written.join("");
        },
        ASSERT(finalOutput) {
            Assert.ok(finalOutput.includes(SEP.repeat(80)), "block separator should remain visible after successful exit");
        }
    });

    test("dispose during rate-limit wait cancels countdown timer but block stays visible", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 300);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { s, time };
        },
        async ACT({ s }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            const headingBeforeDispose = stripAnsi(s.written.join("").split("\n").pop() ?? "").split(" — ")[0] ?? "";
            await cmd.dispose();
            const countAfterDispose = s.written.length;
            await new Promise(resolve => globalThis.setTimeout(resolve, 300));
            return { headingBeforeDispose, hasSep: s.written.join("").includes(SEP.repeat(80)), countAfterDispose, countAfterWait: s.written.length };
        },
        ASSERTS: {
            "heading before dispose is exactly Waiting rate limit"(result) {
                Assert.strictEqual(result.headingBeforeDispose, "Waiting rate limit");
            },
            "block separator remains visible"(result) {
                Assert.ok(result.hasSep);
            },
            "no additional writes after dispose"(result) {
                Assert.strictEqual(result.countAfterDispose, result.countAfterWait);
            }
        }
    });
});

test.describe("Implement per-task token and time metrics", test => {
    test("single task records accumulated token metrics in the plan file", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files }) {
            Assert.strictEqual(code, 0);
            const plan = files.get(COMPLETED_PLAN_PATH)!;
            Assert.ok(plan.includes('[x]{"it":180,"ot":80,"t":0}'), `plan should have accumulated metrics, got: ${plan}`);
        }
    });

    test("tokens accumulate across iterations when first reviewer returns FAIL", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "found issues", inputTokens: 80, outputTokens: 30, errorLog: "not ready" });
            s.claudeQueue.push({ text: "w2", inputTokens: 120, outputTokens: 60 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 90, outputTokens: 40, errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files }) {
            Assert.strictEqual(code, 0);
            const plan = files.get(COMPLETED_PLAN_PATH)!;
            Assert.ok(plan.includes('[x]{"it":390,"ot":180,"t":0}'), `plan should accumulate across iterations, got: ${plan}`);
        }
    });

    test("a resumed codex worker counts each token once: task metrics reflect per-iteration consumption, not the re-counted session-cumulative total", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            const config:FlandersConfig = { worker: { tool: "codex", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // detect agent (runs through the worker tool = codex), no usage
            s.codexQueue.push({ text: "detect" });
            // worker iteration 1: fresh session, codex reports cumulative usage 100/50
            s.codexQueue.push({ text: "w1", sessionId: "cdx-1", inputTokens: 100, outputTokens: 50 });
            // reviewer iteration 1 FAILs (claude), contributes no tokens
            s.claudeQueue.push({ text: "found issues", errorLog: "not ready" });
            // worker iteration 2 resumes cdx-1: codex reports the SESSION-CUMULATIVE total 250/120
            s.codexQueue.push({ text: "w2", sessionId: "cdx-1", inputTokens: 250, outputTokens: 120 });
            // reviewer iteration 2 passes (claude), contributes no tokens
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "run succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "iteration 2 resumes the captured codex session via codex exec resume"(_code, { codexSpawnedArgs }) {
                // codex spawns: [0]=detect, [1]=worker iter 1 (fresh exec), [2]=worker iter 2 (resume)
                Assert.deepStrictEqual(codexSpawnedArgs[2]!.slice(0, 3), ["exec", "resume", "cdx-1"]);
            },
            "task metrics count each token once (250/120), not the re-counted cumulative (350/170)"(_code, { files }) {
                const plan = files.get(COMPLETED_PLAN_PATH)!;
                Assert.ok(plan.includes('[x]{"it":250,"ot":120,"t":0}'), `expected delta-summed metrics, got: ${plan}`);
            }
        }
    });

    test("build and test scripts do not add tokens to the task metrics", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.files.set(WS_ROOT + "/test.sh", "test");
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files }) {
            Assert.strictEqual(code, 0);
            const plan = files.get(COMPLETED_PLAN_PATH)!;
            Assert.ok(plan.includes('[x]{"it":180,"ot":80,"t":0}'), `tokens should only come from AI calls, got: ${plan}`);
        }
    });

    test("active seconds reflect elapsed time with scripts", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const time = controllableTime();
            (s.contexts as any).time = time.ctx;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            let claudeSpawnCount = 0;
            const origClaudeSpawn = s.contexts.claude.spawn;
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = (...args) => {
                claudeSpawnCount++;
                if (claudeSpawnCount === 1) {
                    time.advance(5000);
                } else if (claudeSpawnCount === 2) {
                    time.advance(3000);
                } else if (claudeSpawnCount === 3) {
                    time.advance(2000);
                }
                return origClaudeSpawn.apply(null, args);
            };
            let scriptSpawnCount = 0;
            const origScriptSpawn = s.contexts.script.spawn;
            (s.contexts.script as { spawn:typeof s.contexts.script.spawn }).spawn = (...args) => {
                scriptSpawnCount++;
                time.advance(4000);
                return origScriptSpawn.apply(null, args);
            };
            s.claudeQueue.push({ text: "ok", inputTokens: 10, outputTokens: 5 });
            s.claudeQueue.push({ text: "worker", inputTokens: 10, outputTokens: 5 });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 10, outputTokens: 5, errorLog: "" });
            return { s };
        },
        async ACT({ s }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { s }) {
            Assert.strictEqual(code, 0);
            const plan = s.files.get(COMPLETED_PLAN_PATH)!;
            // _taskStartedAt is captured at the start of _runTask (after the detect spawn), so only
            // spawns within the task count. Each script spawn advances 4000; the post-worker git add -A
            // is one such spawn. Within the task: worker (claude spawn 2, +3000),
            // post-worker git add -A (+4000), build (+4000), reviewer (claude spawn 3, +2000).
            // active = (3000 + 4000 + 4000 + 2000) / 1000 = 13.
            Assert.ok(plan.includes('"t":13}'), `plan should reflect elapsed time including scripts, got: ${plan}`);
        }
    });

    test("persisted t excludes rate-limit window", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const time = controllableTime();
            (s.contexts as any).time = time.ctx;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            let spawnCount = 0;
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = () => {
                spawnCount++;
                const proc = fakeProcess();
                const origStdin = proc.stdin!;
                let capturedPrompt = "";
                (proc as any).stdin = {
                    write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; } } catch {} },
                    end() { origStdin.end(); }
                };
                if (spawnCount === 2) {
                    time.advance(1000);
                    setImmediate(() => {
                        proc.$emitStdout(rateLimitEvent(time.ctx.now(), 10) + "\n");
                        proc.$emit("exit", 1);
                    });
                } else {
                    const advance = spawnCount === 1 ? 2000 : 1000;
                    time.advance(advance);
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
                        if (response.errorLog !== undefined) {
                            const target = targetErrorLogFromPrompt(capturedPrompt);
                            s.files.set(target, response.errorLog);
                        }
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    });
                }
                return proc;
            };
            s.claudeQueue.push({ text: "ok", inputTokens: 5, outputTokens: 5 });
            s.claudeQueue.push({ text: "worker", inputTokens: 50, outputTokens: 25 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 50, outputTokens: 25, errorLog: "" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            time.advance(10000);
            await flush();
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { s }) {
            Assert.strictEqual(code, 0);
            const plan = s.files.get(COMPLETED_PLAN_PATH)!;
            // detect spawn(1): time→2000. Task starts: _taskStartedAt=2000
            // worker spawn(2) (rate-limited): time→3000. _enterRateLimit: _taskRateLimitStartedAt=3000
            // time.advance(10000): time→13000. Rate-limit timer fires, _exitRateLimit: _taskRateLimitMs=10000
            // worker retry spawn(3): time→14000
            // reviewer spawn(4): time→15000
            // active = (15000 - 2000 - 10000) / 1000 = 3
            Assert.ok(plan.includes('"t":3}'), `t should exclude rate-limit window, got: ${plan}`);
        }
    });

    test("detect-build-and-test tokens do not appear in any task metrics", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok", inputTokens: 500, outputTokens: 200 });
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files }) {
            Assert.strictEqual(code, 0);
            const plan = files.get(COMPLETED_PLAN_PATH)!;
            Assert.ok(plan.includes('[x]{"it":180,"ot":80,"t":0}'), `detect tokens should not appear in task metrics, got: ${plan}`);
        }
    });

    test("persist failure is logged but does not abort the iteration loop", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            const origWriteFile = s.contexts.fs.writeFile;
            let planWriteCount = 0;
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p, content) => {
                if (p === PLAN_PATH) {
                    planWriteCount++;
                    if (planWriteCount === 1) {
                        return Promise.reject(new Error("disk full"));
                    }
                }
                return origWriteFile(p, content);
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written, files }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            Assert.ok(allOutput.includes("metrics persist failed"), "should log persist failure");
            const plan = files.get(COMPLETED_PLAN_PATH)!;
            Assert.ok(plan.includes("[x]"), "task should still be marked done despite earlier persist failure");
        }
    });

    test("repeated rate-limit windows each subtract their own duration from t", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const time = controllableTime();
            (s.contexts as any).time = time.ctx;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            let spawnCount = 0;
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = () => {
                spawnCount++;
                const proc = fakeProcess();
                const origStdin = proc.stdin!;
                let capturedPrompt = "";
                (proc as any).stdin = {
                    write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; } } catch {} },
                    end() { origStdin.end(); }
                };
                if (spawnCount === 2 || spawnCount === 4) {
                    const seconds = spawnCount === 2 ? 5 : 3;
                    time.advance(1000);
                    setImmediate(() => {
                        proc.$emitStdout(rateLimitEvent(time.ctx.now(), seconds) + "\n");
                        proc.$emit("exit", 1);
                    });
                } else {
                    time.advance(1000);
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
                        if (response.errorLog !== undefined) {
                            const target = targetErrorLogFromPrompt(capturedPrompt);
                            s.files.set(target, response.errorLog);
                        }
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    });
                }
                return proc;
            };
            s.claudeQueue.push({ text: "ok", inputTokens: 5, outputTokens: 5 });
            s.claudeQueue.push({ text: "worker", inputTokens: 50, outputTokens: 25 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 50, outputTokens: 25, errorLog: "" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            time.advance(5000);
            await flush();
            time.advance(3000);
            await flush();
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { s }) {
            Assert.strictEqual(code, 0);
            const plan = s.files.get(COMPLETED_PLAN_PATH)!;
            // detect (1s) → task starts at 1000
            // worker rate-limited (1s spawn + 5s wait) → 7000
            // worker retry (1s) → 8000
            // reviewer rate-limited (1s spawn + 3s wait) → 12000  (reviewer wait does NOT freeze metrics time)
            // reviewer retry (1s) → 13000
            // active = (13000 - 1000 - 5000) / 1000 = 7 — only the worker rate-limit is subtracted
            Assert.ok(plan.includes('"t":7}'), `t should exclude only worker rate-limit (reviewer waits do not freeze metrics), got: ${plan}`);
        }
    });

    test("rate-limit before any task is picked does not affect task accumulator", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const time = controllableTime();
            (s.contexts as any).time = time.ctx;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            let spawnCount = 0;
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = () => {
                spawnCount++;
                const proc = fakeProcess();
                const origStdin = proc.stdin!;
                let capturedPrompt = "";
                (proc as any).stdin = {
                    write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; } } catch {} },
                    end() { origStdin.end(); }
                };
                if (spawnCount === 1) {
                    time.advance(1000);
                    setImmediate(() => {
                        proc.$emitStdout(rateLimitEvent(time.ctx.now(), 10) + "\n");
                        proc.$emit("exit", 1);
                    });
                } else {
                    time.advance(1000);
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
                        if (response.errorLog !== undefined) {
                            const target = targetErrorLogFromPrompt(capturedPrompt);
                            s.files.set(target, response.errorLog);
                        }
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    });
                }
                return proc;
            };
            s.claudeQueue.push({ text: "ok", inputTokens: 5, outputTokens: 5 });
            s.claudeQueue.push({ text: "worker", inputTokens: 50, outputTokens: 25 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 50, outputTokens: 25, errorLog: "" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            time.advance(10000);
            await flush();
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { s }) {
            Assert.strictEqual(code, 0);
            const plan = s.files.get(COMPLETED_PLAN_PATH)!;
            // detect rate-limited (1s spawn + 10s wait) → 11000
            // detect retry (1s) → 12000
            // task starts at 12000, _taskRateLimitMs = 0
            // worker (1s) → 13000
            // reviewer (1s) → 14000
            // active = (14000 - 12000 - 0) / 1000 = 2
            Assert.ok(plan.includes('"t":2}'), `pre-task rate-limit should not affect task t, got: ${plan}`);
        }
    });

    test("setMetrics is not called on BottomBlock during rate-limit wait", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 10);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            const callTracker = { count: 0 };
            const origSetMetrics = BottomBlock.prototype.setMetrics;
            BottomBlock.prototype.setMetrics = function(fields:MetricsFields) {
                callTracker.count++;
                origSetMetrics.call(this, fields);
            };
            return { s, time, callTracker, origSetMetrics };
        },
        async ACT({ s, time, callTracker, origSetMetrics }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                await flush();
                const countAtEnter = callTracker.count;
                time.advance(10000);
                const countAtTimerFire = callTracker.count;
                await flush();
                const code = await cmd.result();
                await cmd.dispose();
                return { code, callsDuringRateLimit: countAtTimerFire - countAtEnter };
            } finally {
                BottomBlock.prototype.setMetrics = origSetMetrics;
            }
        },
        ASSERTS: {
            "exits successfully"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "setMetrics not called during rate-limit wait"({ callsDuringRateLimit }) {
                Assert.strictEqual(callsDuringRateLimit, 0);
            }
        }
    });

    test("metrics are persisted after every action boundary, not only at the end", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            const planSnapshots:string[] = [];
            const origWriteFile = s.contexts.fs.writeFile;
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p, content) => {
                if (p === PLAN_PATH) {
                    planSnapshots.push(content);
                }
                return origWriteFile(p, content);
            };
            return { ...s, planSnapshots };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { planSnapshots }) {
            Assert.strictEqual(code, 0);
            // Expect 4 plan writes: after worker, after build, after reviewer, markDone
            Assert.ok(planSnapshots.length >= 4, `should have at least 4 plan writes, got ${planSnapshots.length}`);
            Assert.ok(planSnapshots[0]!.includes('"it":100'), "first persist (after worker) should have worker tokens");
            Assert.ok(planSnapshots[0]!.includes('[ ]'), "first persist should still be open");
            Assert.ok(planSnapshots[1]!.includes('"it":100'), "second persist (after build) should still carry only worker tokens");
            Assert.ok(planSnapshots[1]!.includes('[ ]'), "second persist should still be open");
            const last = planSnapshots[planSnapshots.length - 1]!;
            Assert.ok(last.includes('[x]'), "final persist should mark done");
            Assert.ok(last.includes('"it":180'), "final persist should have all tokens");
        }
    });

    test("setMetrics is called after each AI call with expected structured data", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 1000, outputTokens: 500 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 800, outputTokens: 300, errorLog: "" });
            const metricsCalls:MetricsFields[] = [];
            const origSetMetrics = BottomBlock.prototype.setMetrics;
            BottomBlock.prototype.setMetrics = function(fields:MetricsFields) {
                metricsCalls.push(fields);
                origSetMetrics.call(this, fields);
            };
            return { s, metricsCalls, origSetMetrics };
        },
        async ACT({ s, metricsCalls, origSetMetrics }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                const code = await cmd.result();
                await cmd.dispose();
                return { code, metricsCalls: [...metricsCalls] };
            } finally {
                BottomBlock.prototype.setMetrics = origSetMetrics;
            }
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "setMetrics is called 5 times"({ metricsCalls }) {
                Assert.strictEqual(metricsCalls.length, 5);
            },
            "plan-level metrics has no task pair"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 1, "need at least 1 call");
                Assert.strictEqual(metricsCalls[0]!.task, undefined);
            },
            "plan-level metrics has a static zero plan pair (no anchor)"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 1, "need at least 1 call");
                Assert.deepStrictEqual(metricsCalls[0]!.plan, { tokens: 0, baseSeconds: 0 });
            },
            "initial task call has a live zero-anchored task pair"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 2, "need at least 2 calls");
                Assert.deepStrictEqual(metricsCalls[1]!.task, { tokens: 0, anchorMs: 0, baseSeconds: 0 });
            },
            "initial task call has a live zero-anchored plan pair"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 2, "need at least 2 calls");
                Assert.deepStrictEqual(metricsCalls[1]!.plan, { tokens: 0, anchorMs: 0, baseSeconds: 0 });
            },
            "after-worker call task metrics accumulate worker tokens on a live anchor"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 3, "need at least 3 calls");
                Assert.deepStrictEqual(metricsCalls[2]!.task, { tokens: 1500, anchorMs: 0, baseSeconds: 0 });
            },
            "after-worker call plan metrics accumulate worker tokens on a live anchor"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 3, "need at least 3 calls");
                Assert.deepStrictEqual(metricsCalls[2]!.plan, { tokens: 1500, anchorMs: 0, baseSeconds: 0 });
            },
            "after-reviewer call task metrics accumulate reviewer tokens on a live anchor"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 4, "need at least 4 calls");
                Assert.deepStrictEqual(metricsCalls[3]!.task, { tokens: 2600, anchorMs: 0, baseSeconds: 0 });
            },
            "after-reviewer call plan metrics accumulate reviewer tokens on a live anchor"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 4, "need at least 4 calls");
                Assert.deepStrictEqual(metricsCalls[3]!.plan, { tokens: 2600, anchorMs: 0, baseSeconds: 0 });
            },
            "after-markDone call task metrics preserve final tokens on a live anchor"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 5, "need at least 5 calls");
                Assert.deepStrictEqual(metricsCalls[4]!.task, { tokens: 2600, anchorMs: 0, baseSeconds: 0 });
            },
            "after-markDone call plan metrics preserve final tokens on a live anchor"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 5, "need at least 5 calls");
                Assert.deepStrictEqual(metricsCalls[4]!.plan, { tokens: 2600, anchorMs: 0, baseSeconds: 0 });
            }
        }
    });

    test("the live plan pair's base seconds are the accumulated active time of every other task", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            // Task 1 is already done carrying t=7; task 2 is open. When task 2 starts,
            // the plan pair's base seconds must equal the other (done) task's 7 active
            // seconds, while the task pair's base is 0 — so the rendered plan time is the
            // open task's live seconds plus 7.
            const plan = '# Plan\n\n- [x]{"it":100,"ot":50,"t":7} Done task\n- [ ]{"it":0,"ot":0,"t":0} Open task\n';
            s.files.set(PLAN_PATH, plan);
            const metricsCalls:MetricsFields[] = [];
            const origSetMetrics = BottomBlock.prototype.setMetrics;
            BottomBlock.prototype.setMetrics = function(fields:MetricsFields) {
                metricsCalls.push(fields);
                origSetMetrics.call(this, fields);
            };
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 10, outputTokens: 5 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 8, outputTokens: 3, errorLog: "" });
            return { s, metricsCalls, origSetMetrics };
        },
        async ACT({ s, metricsCalls, origSetMetrics }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                const code = await cmd.result();
                await cmd.dispose();
                return { code, metricsCalls: [...metricsCalls] };
            } finally {
                BottomBlock.prototype.setMetrics = origSetMetrics;
            }
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "a live anchored task-start push is emitted for the open task"({ metricsCalls }) {
                Assert.ok(metricsCalls.some(c => c.task?.anchorMs !== undefined), "expected a live task-start metrics push");
            },
            "the task pair carries a zero base on a live anchor"({ metricsCalls }) {
                const firstLive = metricsCalls.find(c => c.task?.anchorMs !== undefined)!;
                Assert.deepStrictEqual(firstLive.task, { tokens: 0, anchorMs: 0, baseSeconds: 0 });
            },
            "the plan pair's base equals the done task's 7 accumulated seconds"({ metricsCalls }) {
                const firstLive = metricsCalls.find(c => c.task?.anchorMs !== undefined)!;
                Assert.deepStrictEqual(firstLive.plan, { tokens: 150, anchorMs: 0, baseSeconds: 7 });
            }
        }
    });

    test("resize from wide to narrow triggers compact-form metrics in block redraw", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            let cols = 80;
            const resizeListeners:Array<() => void> = [];
            (s.contexts.output as any).columns = () => cols;
            (s.contexts.output as any).onResize = (listener:() => void) => {
                resizeListeners.push(listener);
                return () => { const idx = resizeListeners.indexOf(listener); if (idx >= 0) resizeListeners.splice(idx, 1); };
            };
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            let releaseReviewer:() => void;
            let spawnCount = 0;
            (s.contexts.claude as any).spawn = () => {
                spawnCount++;
                const proc = fakeProcess();
                const origStdin = proc.stdin!;
                let capturedPrompt = "";
                (proc as any).stdin = {
                    write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; } } catch {} },
                    end() { origStdin.end(); }
                };
                if (spawnCount === 3) {
                    new Promise<void>(r => { releaseReviewer = r; }).then(() => {
                        setImmediate(() => {
                            const target = targetErrorLogFromPrompt(capturedPrompt);
                            s.files.set(target, "");
                            proc.$emitStdout(claudeResultEvents("PASS", 800, 300));
                            proc.$emit("exit", 0);
                        });
                    });
                } else {
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
                        if (response.errorLog !== undefined) {
                            const target = targetErrorLogFromPrompt(capturedPrompt);
                            s.files.set(target, response.errorLog);
                        }
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    });
                }
                return proc;
            };
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 1000, outputTokens: 500 });
            return { s, resizeListeners, setCols: (n:number) => { cols = n; }, getReleaseReviewer: () => releaseReviewer! };
        },
        async ACT({ s, resizeListeners, setCols, getReleaseReviewer }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            const beforeResize = s.written.join("");
            s.written.length = 0;
            setCols(25);
            for (const l of [...resizeListeners]) l();
            const afterResize = s.written.join("");
            getReleaseReviewer()();
            await flush();
            const code = await cmd.result();
            await cmd.dispose();
            return { code, beforeResize, afterResize };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "before resize uses full form"({ beforeResize }) {
                Assert.ok(stripAnsi(beforeResize).includes("task "), "full form contains 'task'");
            },
            "after resize uses compact form"({ afterResize }) {
                Assert.ok(stripAnsi(afterResize).includes("t:"), "compact form contains 't:'");
            }
        }
    });

    test("metrics rendered in block output contain ANSI color escapes for each field", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 1000, outputTokens: 500 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 800, outputTokens: 300, errorLog: "" });
            return s;
        },
        async ACT({ contexts, written }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, output: written.join("") };
        },
        ASSERTS: {
            "exits successfully"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "output contains dim task label"({ output }) {
                Assert.ok(output.includes(DIM + "task"), "task label should be dim");
            },
            "output contains green tokens"({ output }) {
                Assert.ok(output.includes(GREEN + "2.6k"), "tokens should be green");
            },
            "output contains blue time"({ output }) {
                Assert.ok(output.includes(BLUE + "0s"), "time should be blue");
            },
            "output contains dim separator"({ output }) {
                Assert.ok(output.includes(DIM + "│"), "separator should be dim");
            },
            "output contains dim plan label"({ output }) {
                Assert.ok(output.includes(DIM + "plan"), "plan label should be dim");
            }
        }
    });
});

const PLAN_TWO_TASKS = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task Alpha\n- [ ]{"it":0,"ot":0,"t":0} Task Beta\n';

test.describe("Implement per-task completion snapshot", test => {
    test("emits exactly two separator-framed blocks with done headers for a 2-task plan", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue, 2);
            s.files.set(PLAN_PATH, PLAN_TWO_TASKS);
            s.claudeQueue.push({ text: "ok" });
            // Task 1: worker + reviewer
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            // Task 2: worker + reviewer
            s.claudeQueue.push({ text: "w2", inputTokens: 200, outputTokens: 100 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 120, outputTokens: 60, errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            const plain = stripAnsi(allOutput);
            const doneMatches = plain.match(/\bdone\b/g) || [];
            Assert.strictEqual(doneMatches.length, 2, `should have exactly 2 'done' occurrences in snapshots, got ${doneMatches.length}`);
            const sep = SEPARATOR_GLYPH.repeat(80);
            const sepCount = allOutput.split(sep).length - 1;
            Assert.ok(sepCount >= 4, `should have at least 4 snapshot separators (2 per task), got ${sepCount}`);
        }
    });

    test("snapshot appears in the output region via writeAbove, not inside the bottom-fixed block", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            const writeAboveCalls:string[] = [];
            const origWriteAbove = BottomBlock.prototype.writeAbove;
            BottomBlock.prototype.writeAbove = function(text:string) {
                writeAboveCalls.push(text);
                origWriteAbove.call(this, text);
            };
            return { s, writeAboveCalls, origWriteAbove };
        },
        async ACT({ s, writeAboveCalls, origWriteAbove }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                const code = await cmd.result();
                await cmd.dispose();
                return { code, writeAboveCalls: [...writeAboveCalls] };
            } finally {
                BottomBlock.prototype.writeAbove = origWriteAbove;
            }
        },
        ASSERT({ code, writeAboveCalls }) {
            Assert.strictEqual(code, 0);
            const snapshotCalls = writeAboveCalls.filter(t => stripAnsi(t).includes("done"));
            Assert.strictEqual(snapshotCalls.length, 1, "snapshot should be written exactly once via writeAbove");
            const snap = stripAnsi(snapshotCalls[0]!);
            Assert.ok(snap.includes("task"), "snapshot should contain metrics with task label");
            Assert.ok(snap.includes("plan"), "snapshot should contain metrics with plan label");
        }
    });

    test("snapshot contains separator, done header, full metrics, and second separator in order", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 1500, outputTokens: 500 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 1000, outputTokens: 300, errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            const sep = SEPARATOR_GLYPH.repeat(80);
            const doneMarker = GREEN + "done";
            const doneIdx = allOutput.indexOf(doneMarker);
            Assert.ok(doneIdx !== -1, "snapshot should contain green done header");
            const beforeDone = allOutput.lastIndexOf("\n", doneIdx);
            const snapshotStart = allOutput.lastIndexOf(sep + "\n", beforeDone);
            Assert.ok(snapshotStart !== -1, "separator should precede the done header");
            const snapshotRegion = allOutput.slice(snapshotStart);
            const lines = snapshotRegion.split("\n");
            Assert.strictEqual(lines[0], sep, "first line should be separator");
            Assert.ok(stripAnsi(lines[1]!).includes("done"), "second line should be header with done");
            Assert.ok(stripAnsi(lines[2]!).includes("task"), "third line should be full metrics with task label");
            Assert.ok(stripAnsi(lines[2]!).includes("plan"), "third line should be full metrics with plan label");
            Assert.ok(!stripAnsi(lines[2]!).includes("t:"), "metrics should not use compact form t:");
            Assert.strictEqual(lines[3], sep, "fourth line should be separator");
        }
    });

    test("snapshot uses full metrics form even when terminal is narrow", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            (s.contexts.output as any).columns = () => 10;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            const writeAboveCalls:string[] = [];
            const origWriteAbove = BottomBlock.prototype.writeAbove;
            BottomBlock.prototype.writeAbove = function(text:string) {
                writeAboveCalls.push(text);
                origWriteAbove.call(this, text);
            };
            return { s, writeAboveCalls, origWriteAbove };
        },
        async ACT({ s, writeAboveCalls, origWriteAbove }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                const code = await cmd.result();
                await cmd.dispose();
                return { code, writeAboveCalls: [...writeAboveCalls] };
            } finally {
                BottomBlock.prototype.writeAbove = origWriteAbove;
            }
        },
        ASSERT({ code, writeAboveCalls }) {
            Assert.strictEqual(code, 0);
            const snapshotCalls = writeAboveCalls.filter(t => stripAnsi(t).includes("done"));
            Assert.strictEqual(snapshotCalls.length, 1, "snapshot should be written exactly once via writeAbove");
            const snap = stripAnsi(snapshotCalls[0]!);
            Assert.ok(snap.includes("done"), "snapshot should contain done header");
            Assert.ok(!snap.includes("t:"), "snapshot should not contain compact t: label");
            Assert.ok(!snap.includes("p:"), "snapshot should not contain compact p: label");
            Assert.ok(snap.includes("task "), "snapshot should contain full 'task' label");
            Assert.ok(snap.includes("plan "), "snapshot should contain full 'plan' label");
            Assert.ok(!snap.includes("…"), "snapshot should not be truncated with ellipsis");
        }
    });

    test("all tasks completed appears after all snapshots", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue, 2);
            s.files.set(PLAN_PATH, PLAN_TWO_TASKS);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            s.claudeQueue.push({ text: "w2", inputTokens: 200, outputTokens: 100 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 120, outputTokens: 60, errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            const plain = stripAnsi(allOutput);
            const lastDone = plain.lastIndexOf("done");
            // The stub random returns 0, so pickVariant selects allTasksCompletedPool[0].
            const completedIdx = plain.indexOf(allTasksCompletedPool[0]!);
            Assert.ok(completedIdx !== -1, "should contain the all-tasks-completed pool entry");
            Assert.ok(completedIdx > lastDone, "the all-tasks-completed message should appear after the last snapshot");
        }
    });

    test("startup short-circuit does not emit a snapshot but block is present", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const allDonePlan = '# Plan\n\n- [x]{"it":100,"ot":50,"t":5} Already done task\n';
            s.files.set(PLAN_PATH, allDonePlan);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "prints the random-selected tasks-completed pool entry followed by a newline"(_code, { written }) {
                // The stub random returns 0, so pickVariant selects tasksCompletedPool[0].
                const plain = stripAnsi(written.join(""));
                Assert.ok(plain.includes(tasksCompletedPool[0]! + "\n"), "should print the tasks-completed pool entry followed by a newline");
            },
            "does not emit done snapshot"(_code, { written }) {
                const plain = stripAnsi(written.join(""));
                Assert.ok(!plain.includes("done"), "should not emit any snapshot with done header");
            },
            "block is present with separator"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(SEPARATOR_GLYPH.repeat(80)), "block should be mounted from the start");
            }
        }
    });

    test("bottom-fixed block stays consistent after snapshot emission", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue, 2);
            s.files.set(PLAN_PATH, PLAN_TWO_TASKS);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            s.claudeQueue.push({ text: "w2", inputTokens: 200, outputTokens: 100 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 120, outputTokens: 60, errorLog: "" });
            const headerCalls:HeaderFields[] = [];
            const origSetHeader = BottomBlock.prototype.setHeader;
            BottomBlock.prototype.setHeader = function(fields:HeaderFields) {
                headerCalls.push(fields);
                origSetHeader.call(this, fields);
            };
            return { s, headerCalls, origSetHeader };
        },
        async ACT({ s, headerCalls, origSetHeader }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                const code = await cmd.result();
                await cmd.dispose();
                return { code, headerCalls: [...headerCalls] };
            } finally {
                BottomBlock.prototype.setHeader = origSetHeader;
            }
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "has at least 2 header updates"({ headerCalls }) {
                Assert.ok(headerCalls.length >= 2);
            },
            "includes headers for first task"({ headerCalls }) {
                const firstTaskHeaders = headerCalls.filter(h => h.title === "Task Alpha");
                Assert.ok(firstTaskHeaders.length > 0);
            },
            "includes headers for second task after snapshot"({ headerCalls }) {
                const secondTaskHeaders = headerCalls.filter(h => h.title === "Task Beta");
                Assert.ok(secondTaskHeaders.length > 0);
            },
            "last second-task header shows 2/2 index"({ headerCalls }) {
                const secondTaskHeaders = headerCalls.filter(h => h.title === "Task Beta");
                Assert.ok(secondTaskHeaders.length > 0, "need second task headers to check index");
                Assert.strictEqual(secondTaskHeaders[secondTaskHeaders.length - 1]!.indexLabel, "2/2");
            }
        }
    });

    test("snapshot uses done activity color (green)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { written }) {
            Assert.strictEqual(code, 0);
            const allOutput = written.join("");
            Assert.ok(allOutput.includes(GREEN + "done"), "snapshot should use green for done activity");
        }
    });
});

test.describe("Implement flag parsing", test => {
    test("--no-git is rejected as an unknown flag with exit 1 and the exact diagnostic", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exactly 'Unknown flag: --no-git'"(_code, { written }) {
                Assert.ok(written.join("").includes("Unknown flag: --no-git\n"), "diagnostic should be exactly 'Unknown flag: --no-git'");
            },
            "no git spawns happen (rejected before the git preflight)"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.length, 0, "an unknown flag exits before any git spawn");
            }
        }
    });

    test("flag absent — normal invocation still works", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 0);
        }
    });

    test("unknown flag exits non-zero with diagnostic naming the flag", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--foo"], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the unknown flag"(_code, { written }) {
                Assert.ok(written.join("").includes("--foo"), "diagnostic should name the unknown flag");
            }
        }
    });

    test("unknown short flag exits non-zero with diagnostic", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["-x"], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the unknown short flag"(_code, { written }) {
                Assert.ok(written.join("").includes("-x"), "diagnostic should name the unknown short flag");
            }
        }
    });

    test("unknown flag is detected before loading the plan", {
        ARRANGE() {
            const s = stubContexts();
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--unknown", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "reports the unknown flag"(_code, { written }) {
                Assert.ok(written.join("").includes("--unknown"), "should report the unknown flag");
            },
            "does not reach plan malformed validation"(_code, { written }) {
                Assert.ok(!written.join("").includes("malformed"), "should not reach plan validation");
            },
            "does not reach plan task validation"(_code, { written }) {
                Assert.ok(!written.join("").includes("no task"), "should not reach plan validation");
            }
        }
    });
});

test.describe("Implement git requirement", test => {
    const GIT_DIAGNOSTIC = "The project must be a git repository. Flanders implement requires git on PATH and the project root inside a git work tree.\n";

    test("git unavailable (git --version exits non-zero) exits 1 with the exact diagnostic before workspace setup", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 1, stdout: "", stderr: "" }); // git --version fails
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "emits exactly the git-requirement diagnostic"(_code, { written }) {
                Assert.ok(written.join("").includes(GIT_DIAGNOSTIC), "should emit the exact git-requirement diagnostic");
            },
            "finalizes the footer with the Failed terminal label"(_code, { written }) {
                Assert.ok(written.join("").includes(ORANGE + FAILED_LABEL + ANSI_RESET), "footer should show the Failed terminal label");
            },
            "block is mounted before the diagnostic (separator scrolls above it)"(_code, { written }) {
                const all = written.join("");
                Assert.ok(all.includes(SEP.repeat(80)), "block separator should be present");
                Assert.ok(all.indexOf(SEP.repeat(80)) < all.indexOf(GIT_DIAGNOSTIC), "block should be mounted before the diagnostic is emitted");
            },
            "only git --version is spawned, no work-tree check"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.length, 1, "git --version is the only git spawn");
                Assert.deepStrictEqual(gitSpawns[0]!.args, ["--version"]);
            },
            "performs no workspace setup (no mkdtemp recorded)"(_code, { mkdtempCalls }) {
                Assert.strictEqual(mkdtempCalls.length, 0, "no temporary folder should be created");
            }
        }
    });

    test("git available but rev-parse answers false exits 1 with the exact diagnostic before workspace setup", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git --version ok
            s.gitQueue.push({ code: 0, stdout: "false\n", stderr: "" }); // rev-parse: not inside a work tree
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "emits exactly the git-requirement diagnostic"(_code, { written }) {
                Assert.ok(written.join("").includes(GIT_DIAGNOSTIC), "should emit the exact git-requirement diagnostic");
            },
            "finalizes the footer with the Failed terminal label"(_code, { written }) {
                Assert.ok(written.join("").includes(ORANGE + FAILED_LABEL + ANSI_RESET), "footer should show the Failed terminal label");
            },
            "both git --version and rev-parse are spawned"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.length, 2, "git --version and rev-parse are spawned");
                Assert.deepStrictEqual(gitSpawns[0]!.args, ["--version"]);
                Assert.deepStrictEqual(gitSpawns[1]!.args, ["rev-parse", "--is-inside-work-tree"]);
            },
            "performs no workspace setup (no mkdtemp recorded)"(_code, { mkdtempCalls }) {
                Assert.strictEqual(mkdtempCalls.length, 0, "no temporary folder should be created");
            }
        }
    });

    test("git available but rev-parse exits non-zero exits 1 with the exact diagnostic before workspace setup", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git --version ok
            s.gitQueue.push({ code: 1, stdout: "", stderr: "fatal: not a git repository\n" }); // rev-parse errors
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "emits exactly the git-requirement diagnostic"(_code, { written }) {
                Assert.ok(written.join("").includes(GIT_DIAGNOSTIC), "should emit the exact git-requirement diagnostic");
            },
            "performs no workspace setup (no mkdtemp recorded)"(_code, { mkdtempCalls }) {
                Assert.strictEqual(mkdtempCalls.length, 0, "no temporary folder should be created");
            }
        }
    });

    test("git available and inside a work tree — preflight passes and the run completes", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { gitSpawns }) {
            Assert.strictEqual(code, 0);
            Assert.deepStrictEqual(gitSpawns[0]!.args, ["--version"]);
            Assert.deepStrictEqual(gitSpawns[1]!.args, ["rev-parse", "--is-inside-work-tree"]);
        }
    });
});

test.describe("Implement git preflight", test => {
    test("working tree with changes only in planPath — preflight passes", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: ` M ${PLAN_PATH.replace("/project/", "")}\n`, stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // ls-files discovery (empty → empty lists)
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            // post-worker git add -A, then commit-stage git add + commit after task accepted
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { gitSpawns }) {
            Assert.strictEqual(code, 0, "preflight should pass when only planPath has changes");
            Assert.deepStrictEqual(gitSpawns[2]!.args, ["status", "--porcelain=v1", "--untracked-files=all"]);
        }
    });

    test("working tree with only staged changes — preflight passes and the run proceeds to workspace setup", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });               // git --version
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });          // rev-parse --is-inside-work-tree
            s.gitQueue.push({ code: 0, stdout: "M  src/foo.ts\n", stderr: "" }); // status: staged-only change (index col set, worktree col is a space)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });               // ls-files discovery (empty → empty lists)
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            // post-worker git add -A, then commit-stage git add + commit after task accepted
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0 (staged-only changes do not fail the preflight)"(code) {
                Assert.strictEqual(code, 0);
            },
            "the preflight ran git status"(_code, { gitSpawns }) {
                Assert.deepStrictEqual(gitSpawns[2]!.args, ["status", "--porcelain=v1", "--untracked-files=all"]);
            },
            "the run proceeds to workspace setup (mkdtemp recorded)"(_code, { mkdtempCalls }) {
                Assert.ok(mkdtempCalls.length > 0);
            }
        }
    });

    test("working tree with external changes — exit 1, generic message, block present, no workspace", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: " M src/foo.ts\n M src/bar.ts\n", stderr: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "emits the exact unstaged-changes diagnostic"(_code, { written }) {
                Assert.ok(written.includes("Working tree has unstaged changes. Please stage, commit, or stash them before re-running.\n"));
            },
            "does not list individual file src/foo.ts"(_code, { written }) {
                Assert.ok(!written.join("").includes("src/foo.ts"));
            },
            "does not list individual file src/bar.ts"(_code, { written }) {
                Assert.ok(!written.join("").includes("src/bar.ts"));
            },
            "block is mounted from the start"(_code, { written }) {
                Assert.ok(written.join("").includes("─".repeat(80)));
            },
            "finalizes the block as Failed"(_code, { written }) {
                Assert.ok(stripAnsi(written.join("")).includes(FAILED_LABEL));
            },
            "workspace is not set up"(_code, { files }) {
                Assert.ok(!files.has(WS_ROOT + "/build.sh"));
            },
            "never sets up a workspace (no temporary folder created)"(_code, { mkdtempCalls }) {
                Assert.strictEqual(mkdtempCalls.length, 0);
            }
        }
    });

});

test.describe("Implement commit per task", test => {
    test("both git commands succeed — add and commit appear in order with correct message", {
        ARRANGE() {
            const s = stubContexts();
            const numberedPlan = '# Plan\n\n## 3. Section\n\n- [ ]{"it":0,"ot":0,"t":0} 3.1 Validate input\n';
            s.files.set(PLAN_PATH, numberedPlan);
            // git activation: --version, rev-parse, status
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // ls-files discovery (empty → empty lists)
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            // post-worker git add -A, then commit-stage git add -A + git commit
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { gitSpawns, files, written }) {
            Assert.strictEqual(code, 0);
            const plan = files.get(COMPLETED_PLAN_PATH)!;
            Assert.ok(plan.includes("[x]"), "plan should be marked done");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes("done"), "snapshot should be emitted");
            // After preflight (3 git calls) + ls-files discovery (1 call), expect the
            // post-worker add, the commit-stage add, then commit — in that order.
            const postPreflight = gitSpawns.slice(4);
            Assert.strictEqual(postPreflight.length, 3, "should have exactly 3 git calls after preflight+discovery (post-worker add, commit-stage add, commit)");
            Assert.deepStrictEqual(postPreflight[0]!.args, ["add", "-A"]);
            Assert.deepStrictEqual(postPreflight[1]!.args, ["add", "-A"]);
            Assert.strictEqual(postPreflight[2]!.args[0], "commit");
            Assert.strictEqual(postPreflight[2]!.args[1], "--allow-empty");
            Assert.strictEqual(postPreflight[2]!.args[2], "-m");
            Assert.strictEqual(postPreflight[2]!.args[3], "3 3.1 Validate input");
        }
    });

    test("git add -A fails — error.log written, plan reverted to open, loop continues", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // git activation
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // ls-files discovery (empty → empty lists)
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker + reviewer pass, post-worker add ok, commit-stage add fails
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });                     // git add -A (post-worker staging, iter1)
            s.gitQueue.push({ code: 128, stdout: "", stderr: "add error output\n" }); // git add -A (commit stage, iter1) — fails
            // iter 2: worker + reviewer pass, post-worker add + commit-stage add + commit succeed
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging, iter2)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage, iter2)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit (iter2)
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files, written }) {
            Assert.strictEqual(code, 0);
            const plan = files.get(COMPLETED_PLAN_PATH)!;
            Assert.ok(plan.includes("[x]"), "plan should be marked done after retry");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes("done"), "snapshot should be emitted after successful retry");
        }
    });

    test("git commit fails — error.log written, plan reverted to open, loop continues", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // git activation
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // ls-files discovery (empty → empty lists)
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker + reviewer pass, post-worker add + commit-stage add succeed, commit fails
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging, iter1)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage, iter1)
            s.gitQueue.push({ code: 1, stdout: "hook output\n", stderr: "pre-commit hook failed\n" }); // git commit (iter1) — fails
            // iter 2: worker + reviewer pass, post-worker add + commit-stage add + commit succeed
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging, iter2)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage, iter2)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit (iter2)
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files, written }) {
            Assert.strictEqual(code, 0);
            const plan = files.get(COMPLETED_PLAN_PATH)!;
            Assert.ok(plan.includes("[x]"), "plan should be marked done after retry");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes("done"), "snapshot should be emitted after successful retry");
        }
    });

    test("commit failure increments iteration counter toward MAX_ITER", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // git activation
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // ls-files discovery (empty → empty lists)
            s.claudeQueue.push({ text: "ok" });
            // 5 iterations: worker + reviewer pass, post-worker add + commit-stage add succeed, commit fails each time
            for (let i = 0; i < 5; i++) {
                s.claudeQueue.push({ text: `w${i + 1}` });
                s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
                s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
                s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
                s.gitQueue.push({ code: 1, stdout: "", stderr: "hook failed\n" }); // git commit — fails
            }
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files, written }) {
            Assert.strictEqual(code, 1, "should exit non-zero after MAX_ITER");
            const plan = files.get(PLAN_PATH)!;
            Assert.ok(plan.includes("[ ]"), "plan should still be open after exhausting iterations");
            Assert.ok(!files.has(COMPLETED_PLAN_PATH), "the completion rename is reverted on each failed commit, so no V- plan file lingers");
            const allOutput = written.join("");
            Assert.ok(allOutput.includes("Hard stop"), "should show hard stop message");
            Assert.ok(allOutput.includes(WS_ROOT), "hard stop should point to workspace");
        }
    });

    test("commit message uses only title when taskNumber is empty", {
        ARRANGE() {
            const s = stubContexts();
            const noNumberPlan = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Simple task title\n';
            s.files.set(PLAN_PATH, noNumberPlan);
            // git activation
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // ls-files discovery (empty → empty lists)
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { gitSpawns }) {
            Assert.strictEqual(code, 0);
            const commitSpawn = gitSpawns.find(s => s.args[0] === "commit");
            Assert.ok(commitSpawn, "should have a commit spawn");
            Assert.strictEqual(commitSpawn!.args[3], "Simple task title", "commit message should be just the title without leading space");
        }
    });
});

test.describe("Implement post-worker staging", test => {
    test("post-worker git add -A fails every iteration — error.log holds the combined output, no commit, task stays open, hard stop", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // git activation: --version, rev-parse, status, ls-files discovery
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // ls-files discovery (empty → empty lists)
            s.claudeQueue.push({ text: "ok" });
            // MAX_ITER iterations: each worker succeeds, then the post-worker git add -A fails, so the
            // loop restarts before the build gate and never reaches the reviewer/commit. iteration 6
            // exceeds MAX_ITER and hard-stops.
            for (let i = 0; i < 5; i++) {
                s.claudeQueue.push({ text: `w${i + 1}` });
                s.gitQueue.push({ code: 137, stdout: "post-worker stdout marker\n", stderr: "post-worker stderr marker\n" }); // git add -A (post-worker staging) — fails
            }
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1 after exhausting iterations"(code) {
                Assert.strictEqual(code, 1);
            },
            "error.log holds the failed post-worker add's combined stdout/stderr"(_code, { files }) {
                Assert.strictEqual(
                    files.get(WS_ROOT + "/error.log"),
                    "git add -A failed (exit 137)\n--- stdout ---\npost-worker stdout marker\n\n--- stderr ---\npost-worker stderr marker\n"
                );
            },
            "the task is never marked done"(_code, { files }) {
                Assert.ok(files.get(PLAN_PATH)!.includes("[ ]"), "task should stay open when post-worker staging never succeeds");
            },
            "no commit is ever created"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.filter(g => g.args[0] === "commit").length, 0);
            },
            "the run hard-stops"(_code, { written }) {
                Assert.ok(written.join("").includes("Hard stop"), "should hard-stop after MAX_ITER post-worker staging failures");
            }
        }
    });

    test("post-worker git add -A fails once, then the retry succeeds and the task is accepted", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // git activation: --version, rev-parse, status, ls-files discovery
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // ls-files discovery (empty → empty lists)
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker succeeds, post-worker git add -A fails → error.log + restart (no reviewer, no commit)
            s.claudeQueue.push({ text: "w1" });
            s.gitQueue.push({ code: 137, stdout: "", stderr: "post-worker add boom\n" }); // git add -A (post-worker staging, iter1) — fails
            // iter 2: worker succeeds, post-worker add ok, reviewer passes, commit-stage add + commit ok
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging, iter2)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage, iter2)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit (iter2)
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0 (the task is accepted on the retry)"(code) {
                Assert.strictEqual(code, 0);
            },
            "the task is marked done after the retry"(_code, { files }) {
                const plan = files.get(COMPLETED_PLAN_PATH)!;
                Assert.ok(plan.includes("[x]") && !plan.includes("[ ]"), "task should be marked done after the retry");
            },
            "the failing post-worker add streams its output to the output region"(_code, { written }) {
                Assert.ok(stripAnsi(written.join("")).includes("post-worker add boom"), "the failing post-worker add's stderr is streamed to the output");
            },
            "iteration 2's worker prompt carries the previous-iteration briefing (the loop restarted)"(_code, { promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker iter1, [2]=worker iter2, [3]=reviewer iter2
                Assert.ok(promptQueue[2]!.includes(WS_ROOT + "/error.log"), "iter2 worker prompt should reference the briefing error.log");
            },
            "exactly one commit happens despite the two iterations (no commit on the failed iteration)"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.filter(g => g.args[0] === "commit").length, 1);
            },
            "a post-worker git add -A runs on every iteration before the build gate"(_code, { gitSpawns }) {
                // After preflight+discovery (4 git calls): iter1 post-worker add (failed), then iter2's
                // post-worker add, commit-stage add, and commit — three "add" then one "commit".
                Assert.deepStrictEqual(gitSpawns.slice(4).map(g => g.args[0]), ["add", "add", "add", "commit"]);
            }
        }
    });
});

const E2E_TWO_TASK_PLAN = [
    "# Plan",
    "",
    "## 1. Module A",
    "",
    '- [ ]{"it":0,"ot":0,"t":0} Build the parser',
    "",
    "## 2. Module B",
    "",
    '- [ ]{"it":0,"ot":0,"t":0} Add validation',
    ""
].join("\n");

// Arranges the git startup preflight (version / rev-parse / clean status) plus the
// `.spec` discovery's `git ls-files` spawn that runs immediately after the preflight.
// `lsFilesStdout` defaults to empty: an empty-stdout reply yields empty global lists
// and no follow-up `git check-ignore` spawn, which is the correct arrangement for the
// many tests that don't exercise the contract/rule lists. Tests that do exercise the
// lists pass a NUL-joined `.spec` namespace fixture and push their own check-ignore reply.
function gitActivationQueue(gitQueue:ScriptResponse[], lsFilesStdout = ""):void {
    gitQueue.push({ code: 0, stdout: "git version 2.40.0\n", stderr: "" }); // git --version
    gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });               // rev-parse --is-inside-work-tree
    gitQueue.push({ code: 0, stdout: "", stderr: "" });                     // status (clean)
    gitQueue.push({ code: 0, stdout: lsFilesStdout, stderr: "" });          // ls-files discovery
}

// Arranges a full git run: the version/rev-parse/status preflight triple plus, for each
// task the scenario accepts unconditionally in a single worker-success iteration, the
// three {code:0} git calls that iteration makes — the post-worker `git add -A`, the
// commit-stage `git add -A`, and the `git commit`.
function gitRunQueue(gitQueue:ScriptResponse[], taskCount = 1):void {
    gitActivationQueue(gitQueue);
    for (let i = 0; i < taskCount; i++) {
        gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
        gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
        gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit
    }
}

// Every worker-success iteration runs the post-worker `git add -A` before the build/test/review
// gates, even iterations that later fail a gate (build, test, or review) or that ultimately hit
// the hard stop. gitRunQueue only provisions the single accepted iteration's three git calls, so a
// scenario with `n` additional worker-success iterations (pre-acceptance gate failures, or the
// extra iterations of a hard-stop run) needs `n` extra {code:0} post-worker `git add -A` replies.
// They are fungible with gitRunQueue's other {code:0} replies, so appending them after gitRunQueue
// keeps the queue long enough without disturbing the relative order of any non-zero reply.
function extraWorkerAdds(gitQueue:ScriptResponse[], n:number):void {
    for (let i = 0; i < n; i++) {
        gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging, pre-acceptance iteration)
    }
}

test.describe("Implement end-to-end git flow", test => {
    test("Scenario A — happy path with git active and two open tasks", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, E2E_TWO_TASK_PLAN);
            gitActivationQueue(s.gitQueue);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "npm run build");
            s.files.set(WS_ROOT + "/test.sh", "npm test");
            // Task 1: worker → build → test → reviewer
            s.claudeQueue.push({ text: "parser implemented" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging, task 1)
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage, task 1)
            s.gitQueue.push({ code: 0, stdout: "[main abc1234] 1 Build the parser\n", stderr: "" }); // git commit (task 1)
            // Task 2: worker → build → test → reviewer
            s.claudeQueue.push({ text: "validation added" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging, task 2)
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage, task 2)
            s.gitQueue.push({ code: 0, stdout: "[main def5678] 2 Add validation\n", stderr: "" }); // git commit (task 2)
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { gitSpawns, files, written }) {
            Assert.strictEqual(code, 0);
            const plan = files.get(COMPLETED_PLAN_PATH)!;
            Assert.ok(plan.includes("[x]") && !plan.includes("[ ]"), "both tasks should be marked done");
            const postPreflight = gitSpawns.slice(4);
            Assert.strictEqual(postPreflight.length, 6, "should have exactly 6 git calls after preflight+discovery (post-worker add + commit-stage add + commit per task)");
            Assert.deepStrictEqual(postPreflight[0]!.args, ["add", "-A"]);
            Assert.deepStrictEqual(postPreflight[1]!.args, ["add", "-A"]);
            Assert.strictEqual(postPreflight[2]!.args[0], "commit");
            Assert.strictEqual(postPreflight[2]!.args[3], "1 Build the parser");
            Assert.deepStrictEqual(postPreflight[3]!.args, ["add", "-A"]);
            Assert.deepStrictEqual(postPreflight[4]!.args, ["add", "-A"]);
            Assert.strictEqual(postPreflight[5]!.args[0], "commit");
            Assert.strictEqual(postPreflight[5]!.args[3], "2 Add validation");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes(allTasksCompletedPool[0]! + "\n"), "should print the all-tasks-completed pool entry followed by a newline");
        }
    });

    test("Scenario B — --no-git is rejected as an unknown flag and exits 1", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exactly 'Unknown flag: --no-git'"(_code, { written }) {
                Assert.ok(written.join("").includes("Unknown flag: --no-git\n"), "diagnostic should be exactly 'Unknown flag: --no-git'");
            },
            "no git spawns happen (rejected before the git preflight)"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.length, 0, "an unknown flag exits before any git spawn");
            }
        }
    });

    test("Scenario C — git binary unavailable exits 1 with the git-requirement diagnostic", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 1, stdout: "", stderr: "git: command not found\n" }); // git --version fails
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "emits exactly the git-requirement diagnostic"(_code, { written }) {
                Assert.ok(written.join("").includes("The project must be a git repository. Flanders implement requires git on PATH and the project root inside a git work tree.\n"), "should emit the exact git-requirement diagnostic");
            },
            "only git --version is spawned"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.length, 1, "only git --version should be spawned");
                Assert.deepStrictEqual(gitSpawns[0]!.args, ["--version"]);
            },
            "performs no workspace setup (no mkdtemp recorded)"(_code, { mkdtempCalls }) {
                Assert.strictEqual(mkdtempCalls.length, 0, "no temporary folder should be created");
            }
        }
    });

    test("Scenario D — preflight fails, exits 1 with block present, no workspace", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            gitActivationQueue(s.gitQueue);
            // Override the status response to report external changes. Drop the ls-files
            // discovery reply (preflight fails first, so discovery never runs) and the clean
            // status reply, then push a dirty status.
            s.gitQueue.pop();
            s.gitQueue.pop();
            s.gitQueue.push({ code: 0, stdout: " M src/dirty.ts\n?? src/new.ts\n", stderr: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "emits the exact unstaged-changes diagnostic"(_code, { written }) {
                Assert.ok(written.includes("Working tree has unstaged changes. Please stage, commit, or stash them before re-running.\n"));
            },
            "does not list individual files"(_code, { written }) {
                Assert.ok(!written.join("").includes("src/dirty.ts"));
            },
            "block is mounted from the start"(_code, { written }) {
                Assert.ok(written.join("").includes(SEPARATOR_GLYPH.repeat(80)));
            },
            "workspace is not set up"(_code, { files }) {
                Assert.ok(!files.has(WS_ROOT + "/build.sh"));
            },
            "no non-git spawns"(_code, { gitSpawns }) {
                const claudeSpawns = gitSpawns.filter(s => s.command !== "git");
                Assert.strictEqual(claudeSpawns.length, 0);
            },
            "only preflight git calls"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.length, 3);
            }
        }
    });

    test("Scenario E — commit fails first iteration, passes on second with iter 2 in snapshot", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            gitActivationQueue(s.gitQueue);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "npm run build");
            s.files.set(WS_ROOT + "/test.sh", "npm test");
            // Iteration 1: worker → post-worker add → build → test → reviewer → commit-stage add (ok) → commit (fail)
            s.claudeQueue.push({ text: "iter 1 worker" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging, iter1)
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage, iter1)
            s.gitQueue.push({ code: 1, stdout: "hook output\n", stderr: "pre-commit hook rejected\n" }); // git commit (iter1) — fails
            // Iteration 2: worker → post-worker add → build → test → reviewer → commit-stage add → commit (ok)
            s.claudeQueue.push({ text: "iter 2 worker" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging, iter2)
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage, iter2)
            s.gitQueue.push({ code: 0, stdout: "[main abc1234] committed\n", stderr: "" }); // git commit (iter2)
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files, written }) {
            Assert.strictEqual(code, 0);
            const plan = files.get(COMPLETED_PLAN_PATH)!;
            Assert.ok(plan.includes("[x]"), "task should be marked done after second iteration");
            Assert.ok(!plan.includes("[ ]"), "no open tasks should remain");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes("iter 2"), "snapshot should show iter 2");
            Assert.ok(plain.includes("done"), "snapshot should contain done header");
            Assert.ok(plain.includes(allTasksCompletedPool[0]! + "\n"), "should print the all-tasks-completed pool entry followed by a newline");
        }
    });
});

test.describe("Implement completion rename", test => {
    test("accepting the last open task renames the plan file with the V- completion marker", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the plan content lives at the V- marked path, marked done"(_code, { files }) {
                const plan = files.get(COMPLETED_PLAN_PATH);
                Assert.ok(plan !== undefined, "completed plan should exist at the V- path");
                Assert.ok(plan!.includes("[x]"), "the renamed plan should be marked done");
            },
            "the original plan path is vacated by the rename"(_code, { files }) {
                Assert.ok(!files.has(PLAN_PATH), "the original plan path should no longer hold the file");
            },
            "the accepted task still produces its commit (capturing the rename)"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.filter(g => g.args[0] === "commit").length, 1);
            }
        }
    });

    test("the completion marker is prepended ahead of the rest of the name, including a timestamp prefix", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const timestampedPath = "/project/plans/2026-06-24_10.00-add-feature.md";
            s.files.set(timestampedPath, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { s, timestampedPath };
        },
        async ACT({ s, timestampedPath }) {
            const cmd = new Implement([timestampedPath], { projectRoot: "/project" }, s.contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { s }) {
            Assert.strictEqual(code, 0);
            Assert.ok(s.files.has("/project/plans/V-2026-06-24_10.00-add-feature.md"), "the V- marker sits at the very start, ahead of the timestamp prefix");
            Assert.ok(!s.files.has("/project/plans/2026-06-24_10.00-add-feature.md"), "the un-marked timestamped path is vacated");
        }
    });

    test("a plan already complete at startup keeps its name (no completion marker added)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, '# Plan\n\n- [x]{"it":1,"ot":1,"t":1} Already done\n');
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the plan keeps its original name"(_code, { files }) {
                Assert.ok(files.has(PLAN_PATH), "an already-complete plan is left at its original path");
            },
            "no V- marked file is created"(_code, { files }) {
                Assert.ok(!files.has(COMPLETED_PLAN_PATH), "the already-complete startup path adds no completion marker");
            }
        }
    });
});

test.describe("completedPlanPath", test => {
    test("prepends the V- marker to the basename, preserving the directory", {
        ARRANGE() { return "/project/plans/test.md"; },
        ACT(path) { return completedPlanPath(path); },
        ASSERT(result) { Assert.strictEqual(result, "/project/plans/V-test.md"); }
    });
    test("returns a name already carrying the marker unchanged", {
        ARRANGE() { return "/project/plans/V-test.md"; },
        ACT(path) { return completedPlanPath(path); },
        ASSERT(result) { Assert.strictEqual(result, "/project/plans/V-test.md"); }
    });
    test("places the marker ahead of a timestamp prefix in the basename", {
        ARRANGE() { return "/project/plans/2026-06-24_10.00-feature.md"; },
        ACT(path) { return completedPlanPath(path); },
        ASSERT(result) { Assert.strictEqual(result, "/project/plans/V-2026-06-24_10.00-feature.md"); }
    });
    test("prepends the marker when the path has no directory", {
        ARRANGE() { return "test.md"; },
        ACT(path) { return completedPlanPath(path); },
        ASSERT(result) { Assert.strictEqual(result, "V-test.md"); }
    });
    test("handles a backslash-separated path", {
        ARRANGE() { return "C:\\dev\\plans\\test.md"; },
        ACT(path) { return completedPlanPath(path); },
        ASSERT(result) { Assert.strictEqual(result, "C:\\dev\\plans\\V-test.md"); }
    });
});

// Extracts the namespace-list block that follows a "## Available contracts" or
// "## Available rules" heading in an agent prompt. The block layout is: heading line,
// blank line, single-line description, blank line, the substituted list, then either a
// blank line (mid-prompt) or end-of-prompt. Returns the list block, trimmed.
function extractPromptList(prompt:string, heading:string):string {
    const idx = prompt.indexOf(heading);
    if (idx === -1) return "";
    const afterHeading = prompt.indexOf("\n", idx) + 1;
    const descEnd = prompt.indexOf("\n\n", afterHeading);
    if (descEnd === -1) return prompt.slice(afterHeading).trim();
    const listStart = descEnd + 2;
    const listEnd = prompt.indexOf("\n\n", listStart);
    return prompt.slice(listStart, listEnd === -1 ? undefined : listEnd).trim();
}

test.describe("Implement detect prompt rule list", test => {
    test("detect prompt's rule list comes from .spec discovery and substitutes RULE_LIST", {
        ARRANGE() {
            const s = stubContexts();
            // discovery yields one nested .spec/rules namespace; nothing ignored.
            gitActivationQueue(s.gitQueue, ".spec/rules/testing/runner-flag.md\0");
            s.gitQueue.push({ code: 1, stdout: "", stderr: "" }); // check-ignore: none ignored
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "the command succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "the detect prompt's rule list is exactly the discovered namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[0]!, "## Available rules"), ".spec/rules/testing/runner-flag.md");
            },
            "the RULE_LIST placeholder is substituted"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[0]!.includes("<RULE_LIST>"), "RULE_LIST placeholder should be substituted");
            }
        }
    });

    test("detect prompt shows (none) when rules/ is empty", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "the command succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "the detect prompt shows (none) for absent rules"(_code, { promptQueue }) {
                Assert.ok(promptQueue[0]!.includes("(none)"), "detect prompt should show (none) for absent rules");
            },
            "the RULE_LIST placeholder is substituted"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[0]!.includes("<RULE_LIST>"), "RULE_LIST placeholder should be substituted");
            }
        }
    });
});

test.describe("Implement worker prompt contract and rule lists", test => {
    test("worker prompt's lists come from .spec discovery and exclude git-ignored namespaces", {
        ARRANGE() {
            const s = stubContexts();
            // discovery enumerates a root contract, a nested rule, a .spec/flanders behavior rule, and a
            // candidate git check-ignore reports as ignored — the ignored one must not reach the prompt.
            gitActivationQueue(s.gitQueue, ".spec/contracts/c1.md\0src/x/.spec/rules/r1.md\0.spec/flanders/naming.md\0node-ish/.spec/rules/ignored.md\0");
            s.gitQueue.push({ code: 0, stdout: "node-ish/.spec/rules/ignored.md\0", stderr: "" }); // check-ignore: this candidate is ignored
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            // promptQueue: [0]=detect, [1]=worker, [2]=reviewer
            "the command succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker contract list is exactly the surviving .spec contract namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[1]!, "## Available contracts"), ".spec/contracts/c1.md");
            },
            "the worker rule list is exactly the surviving nested .spec rule namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[1]!, "## Available rules"), "src/x/.spec/rules/r1.md");
            },
            "the worker behavior-rule list is exactly the surviving .spec/flanders namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[1]!, "## Available behavior rules"), ".spec/flanders/naming.md");
            },
            "neither list contains the git-ignored namespace"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[1]!.includes("node-ish/.spec/rules/ignored.md"), "the git-ignored namespace must not appear in the worker prompt");
            },
            "the CONTRACT_LIST placeholder is substituted"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[1]!.includes("<CONTRACT_LIST>"), "CONTRACT_LIST placeholder should be substituted");
            },
            "the RULE_LIST placeholder is substituted"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[1]!.includes("<RULE_LIST>"), "RULE_LIST placeholder should be substituted");
            },
            "the BEHAVIOR_RULE_LIST placeholder is substituted in the worker prompt"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[1]!.includes("<BEHAVIOR_RULE_LIST>"), "BEHAVIOR_RULE_LIST placeholder should be substituted");
            }
        }
    });

    test("behavior-rule list renders (none) when no .spec/flanders folder is discovered, and the detect prompt omits it", {
        ARRANGE() {
            const s = stubContexts();
            // gitRunQueue discovers no .spec files at all, so the flanders listing is empty.
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            // promptQueue: [0]=detect, [1]=worker, [2]=reviewer
            "the command succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker behavior-rule list renders (none)"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[1]!, "## Available behavior rules"), "(none)");
            },
            "the reviewer behavior-rule list renders (none)"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available behavior rules"), "(none)");
            },
            "the detect prompt has no behavior-rule section"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[0]!.includes("## Available behavior rules"), "detect prompt should not carry an Available behavior rules section");
            },
            "the detect prompt has no BEHAVIOR_RULE_LIST placeholder"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[0]!.includes("<BEHAVIOR_RULE_LIST>"), "detect prompt should not carry the BEHAVIOR_RULE_LIST placeholder");
            }
        }
    });

    test("worker prompt's rule list reflects a discovered .spec/rules namespace", {
        ARRANGE() {
            const s = stubContexts();
            gitActivationQueue(s.gitQueue, ".spec/rules/testing/coverage.md\0");
            s.gitQueue.push({ code: 1, stdout: "", stderr: "" }); // check-ignore: none ignored
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { promptQueue }) {
            Assert.strictEqual(code, 0);
            // promptQueue: [0]=detect, [1]=worker, [2]=reviewer
            Assert.strictEqual(extractPromptList(promptQueue[1]!, "## Available rules"), ".spec/rules/testing/coverage.md");
        }
    });

    test("discovery runs once at startup and the lists are reused for every task", {
        ARRANGE() {
            const s = stubContexts();
            // A single ls-files discovery at startup; nothing ignored. The queue holds only
            // one ls-files reply, so a regression that re-ran discovery per task would either
            // spawn ls-files twice (caught below) or exhaust the queue.
            gitActivationQueue(s.gitQueue, ".spec/contracts/initial.md\0");
            s.gitQueue.push({ code: 1, stdout: "", stderr: "" }); // check-ignore: none ignored
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task A post-worker add
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task A commit-stage add
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task A commit
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task B post-worker add
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task B commit-stage add
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task B commit
            const twoTaskPlan = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task A\n- [ ]{"it":0,"ot":0,"t":0} Task B\n';
            s.files.set(PLAN_PATH, twoTaskPlan);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            // promptQueue: [0]=detect, [1]=worker1, [2]=reviewer1, [3]=worker2, [4]=reviewer2
            "the run succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "git ls-files is spawned exactly once for the whole run"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.filter(g => g.args[0] === "ls-files").length, 1, "discovery should run exactly once at startup");
            },
            "the first worker prompt carries the discovered contract"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[1]!, "## Available contracts"), ".spec/contracts/initial.md");
            },
            "the second worker prompt carries the same discovered contract (lists reused)"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[3]!, "## Available contracts"), ".spec/contracts/initial.md");
            }
        }
    });

    test("lists are identical across tasks and iterations within a single run", {
        ARRANGE() {
            const s = stubContexts();
            // discovery yields one contract and one rule; nothing ignored.
            gitActivationQueue(s.gitQueue, ".spec/contracts/spec.md\0.spec/rules/style.md\0");
            s.gitQueue.push({ code: 1, stdout: "", stderr: "" }); // check-ignore: none ignored
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task A post-worker add (iter1 — review fails, no commit)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task A post-worker add (iter2)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task A commit-stage add (iter2)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task A commit (iter2)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task B post-worker add
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task B commit-stage add
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // task B commit
            const twoTaskPlan = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task A\n- [ ]{"it":0,"ot":0,"t":0} Task B\n';
            s.files.set(PLAN_PATH, twoTaskPlan);
            s.claudeQueue.push({ text: "ok" });
            // Task A: worker fails, retries, then passes
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "found issues", errorLog: "not ready" });
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            // Task B: worker + reviewer
            s.claudeQueue.push({ text: "w3" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { promptQueue }) {
            Assert.strictEqual(code, 0);
            // promptQueue: [0]=detect, [1]=worker A iter 1, [2]=reviewer A iter 1,
            // [3]=worker A iter 2, [4]=reviewer A iter 2,
            // [5]=worker B, [6]=reviewer B
            const w1Contracts = extractPromptList(promptQueue[1]!, "## Available contracts");
            const w2Contracts = extractPromptList(promptQueue[3]!, "## Available contracts");
            const w3Contracts = extractPromptList(promptQueue[5]!, "## Available contracts");
            Assert.strictEqual(w1Contracts, w2Contracts, "contract lists should be identical across iterations");
            Assert.strictEqual(w1Contracts, w3Contracts, "contract lists should be identical across tasks");
            const w1Rules = extractPromptList(promptQueue[1]!, "## Available rules");
            const w2Rules = extractPromptList(promptQueue[3]!, "## Available rules");
            const w3Rules = extractPromptList(promptQueue[5]!, "## Available rules");
            Assert.strictEqual(w1Rules, w2Rules, "rule lists should be identical across iterations");
            Assert.strictEqual(w1Rules, w3Rules, "rule lists should be identical across tasks");
        }
    });
});

test.describe("Implement reviewer prompt contract and rule lists", test => {
    test("reviewer prompt receives the same discovered lists as the worker for the same iteration", {
        ARRANGE() {
            const s = stubContexts();
            // discovery yields one contract, one nested rule, and one .spec/flanders behavior rule; nothing ignored.
            gitActivationQueue(s.gitQueue, ".spec/contracts/overview.md\0src/x/.spec/rules/r1.md\0.spec/flanders/naming.md\0");
            s.gitQueue.push({ code: 1, stdout: "", stderr: "" }); // check-ignore: none ignored
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            // promptQueue: [0]=detect, [1]=worker, [2]=reviewer
            "the command succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker contract list is the discovered namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[1]!, "## Available contracts"), ".spec/contracts/overview.md");
            },
            "the reviewer contract list matches the worker's"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available contracts"), extractPromptList(promptQueue[1]!, "## Available contracts"));
            },
            "the worker rule list is the discovered nested namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[1]!, "## Available rules"), "src/x/.spec/rules/r1.md");
            },
            "the reviewer rule list matches the worker's"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available rules"), extractPromptList(promptQueue[1]!, "## Available rules"));
            },
            "the reviewer behavior-rule list is the discovered .spec/flanders namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available behavior rules"), ".spec/flanders/naming.md");
            },
            "the reviewer behavior-rule list matches the worker's"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available behavior rules"), extractPromptList(promptQueue[1]!, "## Available behavior rules"));
            }
        }
    });

    test("reviewer prompt contains the four explicit FAIL conditions", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { promptQueue }) {
            Assert.strictEqual(code, 0);
            // promptQueue: [0]=detect, [1]=worker, [2]=reviewer
            const reviewerPrompt = promptQueue[2]!;
            Assert.ok(reviewerPrompt.includes("task spec"), "reviewer prompt should mention task spec condition");
            Assert.ok(reviewerPrompt.includes("contract referenced"), "reviewer prompt should mention contract referenced condition");
            Assert.ok(/rule referenced.*not applied/i.test(reviewerPrompt) || /referenced rule.*not applied/i.test(reviewerPrompt) || reviewerPrompt.includes("rule referenced by the task is not applied"), "reviewer prompt should mention rule not applied condition");
            Assert.ok(/global lists/i.test(reviewerPrompt) || reviewerPrompt.includes("should have been applied"), "reviewer prompt should mention global list FAIL condition");
        }
    });

    test("reviewer error.log verdict protocol works with updated prompt", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker ok, reviewer fails
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "Checking contracts and rules...", errorLog: "missing test for edge case" });
            // iter 2: worker ok, reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "All four conditions verified.", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { files }) {
            Assert.strictEqual(code, 0);
            const rev1 = files.get(WS_ROOT + "/reviewer.1.1.log")!;
            Assert.ok(rev1.includes("Verdict: FAIL missing test for edge case"), "reviewer.1.1.log should contain FAIL verdict");
            const rev2 = files.get(WS_ROOT + "/reviewer.2.1.log")!;
            Assert.ok(rev2.includes("Verdict: PASS"), "reviewer.2.1.log should contain PASS verdict");
        }
    });
});

function hasResume(args:readonly string[]):string|null {
    const idx = args.indexOf("--resume");
    return idx !== -1 && idx + 1 < args.length ? args[idx + 1]! : null;
}

test.describe("Implement worker session_id persistence", test => {
    test("worker session_id is reused across iterations of the same task", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns sessionId, build fails
            s.claudeQueue.push({ text: "w1", sessionId: "WS" });
            s.scriptQueue.push({ code: 1, stdout: "compile error\n", stderr: "" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (build fails) still runs a post-worker add
            // iter 2: worker again, build ok, reviewer ok
            s.claudeQueue.push({ text: "w2" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "first worker spawn (iteration 1) is fresh — no --resume"(_code, { claudeSpawnedArgs }) {
                // claudeSpawnedArgs: [0]=detect, [1]=worker iter 1, [2]=worker iter 2, [3]=reviewer iter 2
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--resume"));
            },
            "first worker spawn has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--fork-session"));
            },
            "second worker spawn has --resume WS"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(hasResume(claudeSpawnedArgs[2]!), "WS");
            },
            "second worker spawn has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[2]!.includes("--fork-session"));
            }
        }
    });

    test("reviewer never receives the worker session_id", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns sessionId, reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "WS" });
            s.claudeQueue.push({ text: "found issues", errorLog: "not ready" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker + reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits successfully"(code) {
                Assert.strictEqual(code, 0);
            },
            "reviewer iter 1 does not receive worker session_id"(_code, { claudeSpawnedArgs }) {
                // claudeSpawnedArgs: [0]=detect, [1]=worker1, [2]=reviewer1, [3]=worker2, [4]=reviewer2
                Assert.notStrictEqual(hasResume(claudeSpawnedArgs[2]!), "WS");
            },
            "reviewer iter 2 does not receive worker session_id"(_code, { claudeSpawnedArgs }) {
                Assert.notStrictEqual(hasResume(claudeSpawnedArgs[4]!), "WS");
            },
            "reviewer iter 1 is a fresh invocation — no --resume"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(hasResume(claudeSpawnedArgs[2]!), null);
            },
            "reviewer iter 2 is a fresh invocation — no --resume"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(hasResume(claudeSpawnedArgs[4]!), null);
            }
        }
    });

    test("worker session_id resets between tasks", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue, 2);
            const twoTaskPlan = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task Alpha\n- [ ]{"it":0,"ot":0,"t":0} Task Beta\n';
            s.files.set(PLAN_PATH, twoTaskPlan);
            s.claudeQueue.push({ text: "ok" });
            // Task 1: worker returns sessionId, reviewer PASS
            s.claudeQueue.push({ text: "w1", sessionId: "WS1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            // Task 2: worker + reviewer
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits successfully"(code) {
                Assert.strictEqual(code, 0);
            },
            "task 2 worker (iteration 1) is fresh — no --resume"(_code, { claudeSpawnedArgs }) {
                // claudeSpawnedArgs: [0]=detect, [1]=task1 worker, [2]=task1 reviewer, [3]=task2 worker, [4]=task2 reviewer
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--resume"));
            },
            "task 2 worker does not carry over WS1 from task 1"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("WS1"));
            },
            "task 2 worker has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--fork-session"));
            }
        }
    });

    test("null sessionId from worker does not overwrite a previously stored session_id", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns sessionId, build fails
            s.claudeQueue.push({ text: "w1", sessionId: "WS" });
            s.scriptQueue.push({ code: 1, stdout: "compile error\n", stderr: "" });
            // iter 2: worker returns no sessionId (result.sessionId === null), build fails
            s.claudeQueue.push({ text: "w2" });
            s.scriptQueue.push({ code: 1, stdout: "compile error\n", stderr: "" });
            extraWorkerAdds(s.gitQueue, 2); // iters 1 and 2 (build fails) each run a post-worker add
            // iter 3: worker, build ok, reviewer PASS
            s.claudeQueue.push({ text: "w3" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits successfully"(code) {
                Assert.strictEqual(code, 0);
            },
            "iter 1 worker (iteration 1) is fresh — no --resume"(_code, { claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker1, [2]=worker2, [3]=worker3, [4]=reviewer
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--resume"));
            },
            "iter 1 worker has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--fork-session"));
            },
            "iter 3 worker has --resume WS (the iter-1 session survived the null iter-2)"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(hasResume(claudeSpawnedArgs[3]!), "WS");
            },
            "iter 3 worker has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--fork-session"));
            }
        }
    });

    test("worker rejection does not clear a previously stored session_id", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns sessionId, reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "WS" });
            s.claudeQueue.push({ text: "found issues", errorLog: "not ready" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) runs a post-worker add; the iter 2 worker rejection does not reach staging
            // iter 2: worker errors (rejection)
            s.claudeQueue.push({ text: "", error: true });
            // iter 3: worker, reviewer PASS
            s.claudeQueue.push({ text: "w3" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits successfully"(code) {
                Assert.strictEqual(code, 0);
            },
            "iter 3 worker has --resume WS"(_code, { claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker1, [2]=reviewer1, [3]=worker2(error), [4]=worker3, [5]=reviewer3
                Assert.strictEqual(hasResume(claudeSpawnedArgs[4]!), "WS");
            },
            "iter 3 worker has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[4]!.includes("--fork-session"));
            }
        }
    });

    test("iteration 1 is fresh and iteration 2 resumes the captured worker session", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns sessionId, build fails
            s.claudeQueue.push({ text: "w1", sessionId: "WORKER-S" });
            s.scriptQueue.push({ code: 1, stdout: "compile error\n", stderr: "" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (build fails) still runs a post-worker add
            // iter 2: worker, build ok, reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "iter 1 worker is fresh — no --resume"(_code, { claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker iter 1, [2]=worker iter 2, [3]=reviewer iter 2
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--resume"));
            },
            "iter 1 worker has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--fork-session"));
            },
            "iter 2 worker args[0] is --resume"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[2]![0], "--resume");
            },
            "iter 2 worker args[1] is the worker session id"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[2]![1], "WORKER-S");
            },
            "iter 2 worker has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[2]!.includes("--fork-session"));
            },
            "exactly 4 claude spawns: detect, worker1, worker2, reviewer2"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 4);
            }
        }
    });

});

test.describe("Implement reviewer session is never stored or resumed", test => {
    test("reviewer session ids are never reused and reviewers are always fresh — observed via --resume args", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker emits its own session id; reviewer emits a DIFFERENT id AND FAILs (forces iter 2)
            s.claudeQueue.push({ text: "w1", sessionId: "WORKER-NOSAVE" });
            s.claudeQueue.push({ text: "found issues", sessionId: "REVIEWER-SESS-1", errorLog: "not ready" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker resumes; reviewer emits yet another id and PASSes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", sessionId: "REVIEWER-SESS-2", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            // claudeSpawnedArgs positions: [0]=detect, [1]=worker-iter1,
            // [2]=reviewer-iter1, [3]=worker-iter2, [4]=reviewer-iter2.
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "iter 2 worker resumes the iter-1 worker session id (never a reviewer's id)"({ claudeSpawnedArgs }) {
                const iter2WorkerArgs = claudeSpawnedArgs[3]!;
                Assert.strictEqual(iter2WorkerArgs[0], "--resume");
                Assert.strictEqual(iter2WorkerArgs[1], "WORKER-NOSAVE");
            },
            "iter 1 reviewer is a fresh invocation — no --resume"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[2]!.includes("--resume"));
            },
            "iter 2 reviewer is a fresh invocation — no --resume"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[4]!.includes("--resume"));
            },
            "no reviewer session id appears in any spawn's --resume position after the reviewer that emitted it"({ claudeSpawnedArgs }) {
                // For each spawn, --resume's argument must not be any reviewer's session id.
                const forbiddenIds = new Set(["REVIEWER-SESS-1", "REVIEWER-SESS-2"]);
                for (const args of claudeSpawnedArgs) {
                    const resumeIdx = args.indexOf("--resume");
                    if (resumeIdx === -1) continue;
                    const resumeArg = args[resumeIdx + 1];
                    Assert.ok(resumeArg !== undefined && !forbiddenIds.has(resumeArg), `--resume ${resumeArg} pointed at a reviewer's session id`);
                }
            }
        }
    });
});

test.describe("Implement terminal label on exit", test => {
    test("success path shows Done terminal label", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "footer shows Done label in orange"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(ORANGE + DONE_LABEL + ANSI_RESET), "footer should show Done terminal label");
            },
            "block remains visible after exit"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(SEP.repeat(80)), "block separator should remain visible");
            },
            "cursor is on line below block"(_code, { written }) {
                const allOutput = written.join("");
                const labelStr = ORANGE + DONE_LABEL + ANSI_RESET;
                const labelIdx = allOutput.lastIndexOf(labelStr);
                Assert.ok(labelIdx !== -1, "terminal label should be present");
                const afterLabel = allOutput.slice(labelIdx + labelStr.length);
                Assert.strictEqual(afterLabel, "\x1b[?7h\n");
            }
        }
    });

    test("noop tasks completed shows Done terminal label", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const allDonePlan = '# Plan\n\n- [x]{"it":100,"ot":50,"t":5} Already done\n';
            s.files.set(PLAN_PATH, allDonePlan);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "footer shows Done label in orange"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(ORANGE + DONE_LABEL + ANSI_RESET), "footer should show Done terminal label");
            }
        }
    });

    test("unknown flag shows Failed terminal label", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--bad-flag"], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "footer shows Failed label in orange"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(ORANGE + FAILED_LABEL + ANSI_RESET), "footer should show Failed terminal label");
            }
        }
    });

    test("plan not found shows Failed terminal label", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["/nonexistent/plan.md"], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "footer shows Failed label in orange"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(ORANGE + FAILED_LABEL + ANSI_RESET), "footer should show Failed terminal label");
            }
        }
    });

    test("plan malformed shows Failed terminal label", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, '# Plan\n\n- [done]{"it":0,"ot":0,"t":0} bad checkbox\n');
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "footer shows Failed label in orange"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(ORANGE + FAILED_LABEL + ANSI_RESET), "footer should show Failed terminal label");
            }
        }
    });

    test("plan empty shows Failed terminal label", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, "# Plan\n\nNo checkbox lines here.\n");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "footer shows Failed label in orange"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(ORANGE + FAILED_LABEL + ANSI_RESET), "footer should show Failed terminal label");
            }
        }
    });

    test("preflight failed shows Failed terminal label", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: " M src/dirty.ts\n", stderr: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "footer shows Failed label in orange"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(ORANGE + FAILED_LABEL + ANSI_RESET), "footer should show Failed terminal label");
            }
        }
    });

    test("hard stop shows Hard stop terminal label", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 2); // 5 worker-success iterations each run a post-worker add; gitRunQueue's 3 {code:0} replies cover the rest
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            for (let i = 0; i < 5; i++) {
                s.claudeQueue.push({ text: `worker iter ${i + 1}` });
                s.claudeQueue.push({ text: "found issues", errorLog: "not good enough" });
            }
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "footer shows Hard stop label in orange"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(ORANGE + HARD_STOP_LABEL + ANSI_RESET), "footer should show Hard stop terminal label");
            }
        }
    });

    test("interruption during run shows Interrupted terminal label", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            let spawnCount = 0;
            const originalSpawn = s.contexts.claude.spawn.bind(s.contexts.claude);
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = (...args) => {
                spawnCount++;
                if (spawnCount <= 1) {
                    return originalSpawn(...args);
                }
                const proc = fakeProcess();
                const realKill = proc.kill;
                proc.kill = (signal:"SIGINT"|"SIGTERM") => {
                    realKill.call(proc, signal);
                    setImmediate(() => proc.$emit("exit", null));
                };
                return proc;
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await flush();
            await cmd.dispose();
            return contexts;
        },
        ASSERTS: {
            "footer shows Interrupted label in orange"(_result, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(ORANGE + INTERRUPTED_LABEL + ANSI_RESET), "footer should show Interrupted terminal label");
            }
        }
    });

    test("block visible and cursor below block after failed exit", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, '# Plan\n\n- [done]{"it":0,"ot":0,"t":0} bad checkbox\n');
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "block separator remains visible"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(SEP.repeat(80)), "block should remain visible");
            },
            "cursor is on line below block"(_code, { written }) {
                const allOutput = written.join("");
                const labelStr = ORANGE + FAILED_LABEL + ANSI_RESET;
                const labelIdx = allOutput.lastIndexOf(labelStr);
                Assert.ok(labelIdx !== -1, "terminal label should be present");
                const afterLabel = allOutput.slice(labelIdx + labelStr.length);
                Assert.strictEqual(afterLabel, "\x1b[?7h\n");
            }
        }
    });

    test("dispose after completed run does not call finalize again", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            const finalizeCalls:TerminalLabel[] = [];
            const origFinalize = BottomBlock.prototype.finalize;
            BottomBlock.prototype.finalize = function(label:TerminalLabel) {
                finalizeCalls.push(label);
                origFinalize.call(this, label);
            };
            return { s, finalizeCalls, origFinalize };
        },
        async ACT({ s, finalizeCalls, origFinalize }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                const code = await cmd.result();
                await cmd.dispose();
                return { code, finalizeCalls: [...finalizeCalls] };
            } finally {
                BottomBlock.prototype.finalize = origFinalize;
            }
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "finalize is called exactly once"({ finalizeCalls }) {
                Assert.strictEqual(finalizeCalls.length, 1, "finalize should be called exactly once");
            },
            "finalize was called with Done"({ finalizeCalls }) {
                Assert.strictEqual(finalizeCalls[0], "Done");
            }
        }
    });

    test("dispose during active run with delayed stage closes with Interrupted", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            let spawnCount = 0;
            const originalSpawn = s.contexts.claude.spawn.bind(s.contexts.claude);
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = (...args) => {
                spawnCount++;
                if (spawnCount <= 1) {
                    return originalSpawn(...args);
                }
                const proc = fakeProcess();
                const realKill = proc.kill;
                proc.kill = (signal:"SIGINT"|"SIGTERM") => {
                    realKill.call(proc, signal);
                    setImmediate(() => proc.$emit("exit", null));
                };
                return proc;
            };
            const finalizeCalls:TerminalLabel[] = [];
            const origFinalize = BottomBlock.prototype.finalize;
            BottomBlock.prototype.finalize = function(label:TerminalLabel) {
                finalizeCalls.push(label);
                origFinalize.call(this, label);
            };
            return { s, finalizeCalls, origFinalize };
        },
        async ACT({ s, finalizeCalls, origFinalize }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                await flush();
                await cmd.dispose();
                return { finalizeCalls: [...finalizeCalls] };
            } finally {
                BottomBlock.prototype.finalize = origFinalize;
            }
        },
        ASSERTS: {
            "finalize is called exactly once"({ finalizeCalls }) {
                Assert.strictEqual(finalizeCalls.length, 1);
            },
            "finalize was called with Interrupted"({ finalizeCalls }) {
                Assert.strictEqual(finalizeCalls[0], "Interrupted");
            }
        }
    });
});


test.describe("Implement _selectPlan edge cases", test => {
    test("positional arg resolved via plans/ folder when direct path does not exist", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set("/project/plans/my-plan.md", PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["my-plan.md"], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 0);
        }
    });
    test("multiple positional args are joined with spaces", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set("/project/plans/my plan.md", PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["my", "plan.md"], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 0);
        }
    });
    test("no positional arg and empty plans folder shows diagnostic", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.contexts.fs.exists = async (p) => s.files.has(p) || p === "/project/plans";
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "error mentions plans folder"(_code, { written }) {
                const all = written.join("");
                Assert.ok(all.includes("No plan files found"));
            }
        }
    });

    test("no positional arg with exactly one plan file auto-selects it and runs", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            const origExists = s.contexts.fs.exists;
            (s.contexts.fs as { exists:typeof s.contexts.fs.exists }).exists = (p) => {
                if (p === "/project/plans") return Promise.resolve(true);
                return origExists(p);
            };
            const origReaddir = s.contexts.fs.readdir;
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = (p) => {
                if (p === "/project/plans") return Promise.resolve([{ name: "test.md", isFile: true, isDirectory: false }]);
                return origReaddir(p);
            };
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 0);
        }
    });
});

test.describe("Implement test-stage failure", test => {
    test("test script failure triggers retry and covers testOk continue path", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.files.set(WS_ROOT + "/test.sh", "npm test");
            // iter 1: worker ok, build skipped, test fails
            s.claudeQueue.push({ text: "worker iter 1" });
            s.scriptQueue.push({ code: 1, stdout: "FAIL\n", stderr: "err\n" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (test fails) still runs a post-worker add
            // iter 2: worker ok, test passes, reviewer passes
            s.claudeQueue.push({ text: "worker iter 2" });
            s.scriptQueue.push({ code: 0, stdout: "OK\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0 after retry"(code) {
                Assert.strictEqual(code, 0);
            },
            "test.1.log includes failure output"(_code, { files }) {
                const log = files.get(WS_ROOT + "/test.1.log")!;
                Assert.ok(log.includes("FAIL"));
            }
        }
    });
});

test.describe("Implement reviewer-stage error", test => {
    test("reviewer AI error causes retry", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            // iter 1: worker ok, reviewer throws
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "w1-review", error: true });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 worker succeeded (post-worker add ran) before the reviewer stage errored
            // iter 2: worker ok, reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 0);
        }
    });
});

test.describe("Implement error.log verdict protocol", test => {
    test("reviewer pass leaves error.log empty", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "aggregate error.log is absent (deleted before, never rewritten on pass)"(_code, { files }) {
                Assert.strictEqual(files.has(WS_ROOT + "/error.log"), false);
            },
            "per-reviewer error.log (in reviewer 1's own folder) is empty (reviewer reported clean)"(_code, { files }) {
                Assert.strictEqual(files.get(reviewerErrorLogPath(1))!, "");
            },
            "reviewer.1.1.log contains Verdict: PASS"(_code, { files }) {
                const rev1 = files.get(WS_ROOT + "/reviewer.1.1.log")!;
                Assert.ok(rev1.includes("Verdict: PASS"));
            }
        }
    });

    test("reviewer fail writes violations to error.log and triggers retry", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: reviewer writes violations
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "found issues", errorLog: "missing test for edge case" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0 after retry"(code) {
                Assert.strictEqual(code, 0);
            },
            "reviewer.1.1.log contains FAIL verdict with violations"(_code, { files }) {
                const rev1 = files.get(WS_ROOT + "/reviewer.1.1.log")!;
                Assert.ok(rev1.includes("Verdict: FAIL missing test for edge case"));
            },
            "reviewer.2.1.log contains PASS verdict"(_code, { files }) {
                const rev2 = files.get(WS_ROOT + "/reviewer.2.1.log")!;
                Assert.ok(rev2.includes("Verdict: PASS"));
            }
        }
    });

    test("on a failing review the orchestrator does not overwrite error.log with reviewer rejected: summary", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: reviewer writes violations
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "found issues", errorLog: "violation X" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "error.log does not contain reviewer rejected:"(_code, { files }) {
                const errorLog = files.get(WS_ROOT + "/error.log") ?? "";
                Assert.ok(!errorLog.includes("reviewer rejected:"));
            }
        }
    });

    test("empty-before invariant — stale error.log content is cleared before reviewer", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/error.log", "stale content from previous stage");
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "reviewer.1.1.log contains Verdict: PASS"(_code, { files }) {
                const rev1 = files.get(WS_ROOT + "/reviewer.1.1.log")!;
                Assert.ok(rev1.includes("Verdict: PASS"));
            }
        }
    });

    test("reviewer prompt receives hydrated error.log path", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, promptQueue }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, promptQueue };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer prompt contains hydrated per-reviewer error.log path inside the reviewer's own folder"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker, [2]=reviewer
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(reviewerPrompt.includes(reviewerErrorLogPath(1)));
            },
            "placeholder is fully replaced"({ promptQueue }) {
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(!reviewerPrompt.includes("<ERROR_LOG_PATH>"));
            }
        }
    });

    test("whitespace-only error.log counts as pass", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "  \n  " });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "reviewer.1.1.log shows PASS"(_code, { files }) {
                const rev1 = files.get(WS_ROOT + "/reviewer.1.1.log")!;
                Assert.ok(rev1.includes("Verdict: PASS"));
            }
        }
    });
});

test.describe("Implement reviewer delete-before and relaunch protocol", test => {
    test("error.log is deleted (not emptied) before the reviewer", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/error.log", "stale");
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, rmCalls }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, rmCalls };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "rm was called on error.log before the reviewer"({ rmCalls }) {
                Assert.ok(rmCalls.includes(WS_ROOT + "/error.log"), "clearErrorLog should call rm on error.log");
            }
        }
    });

    test("absent error.log after reviewer triggers relaunch until file exists", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            // reviewer #1: does not create error.log (no errorLog field)
            s.claudeQueue.push({ text: "no verdict" });
            // reviewer #2: creates empty error.log → PASS
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs, files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "two reviewer spawns occurred"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker, [2]=reviewer#1, [3]=reviewer#2
                Assert.strictEqual(claudeSpawnedArgs.length, 4);
            },
            "reviewer log contains the last invocation output"({ files }) {
                const log = files.get(WS_ROOT + "/reviewer.1.1.log")!;
                Assert.ok(log.includes("Verdict: PASS"), "reviewer log should reflect the invocation that produced the verdict");
            }
        }
    });

    test("relaunch does not increment worker iteration or restart worker/build/test", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            // reviewer #1: absent file
            s.claudeQueue.push({ text: "no verdict 1" });
            // reviewer #2: absent file
            s.claudeQueue.push({ text: "no verdict 2" });
            // reviewer #3: PASS
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "only one worker spawn"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker, [2]=reviewer#1, [3]=reviewer#2, [4]=reviewer#3
                Assert.strictEqual(claudeSpawnedArgs.length, 5);
            }
        }
    });

    test("tokens accumulate across reviewer relaunches", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            // reviewer #1: absent file, 200+80 tokens
            s.claudeQueue.push({ text: "no verdict", inputTokens: 200, outputTokens: 80 });
            // reviewer #2: PASS, 300+120 tokens
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 300, outputTokens: 120, errorLog: "" });
            return s;
        },
        async ACT({ contexts, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "task it accumulates both reviewer invocations"({ files }) {
                const plan = files.get(COMPLETED_PLAN_PATH)!;
                // worker(100) + reviewer#1(200) + reviewer#2(300) = 600
                Assert.ok(plan.includes('"it":600'), `it should be 600, got: ${plan}`);
            },
            "task ot accumulates both reviewer invocations"({ files }) {
                const plan = files.get(COMPLETED_PLAN_PATH)!;
                // worker(50) + reviewer#1(80) + reviewer#2(120) = 250
                Assert.ok(plan.includes('"ot":250'), `ot should be 250, got: ${plan}`);
            }
        }
    });

    test("each reviewer relaunch is a fresh invocation", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker", sessionId: "WORKER-S" });
            // reviewer #1: absent file
            s.claudeQueue.push({ text: "no verdict", sessionId: "REV-1" });
            // reviewer #2: PASS
            s.claudeQueue.push({ text: "reviewer ok", sessionId: "REV-2", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer #1 (the absent-file invocation) is fresh — no --resume"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker, [2]=reviewer#1, [3]=reviewer#2
                Assert.ok(!claudeSpawnedArgs[2]!.includes("--resume"));
            },
            "reviewer #2 (the relaunch) is fresh — no --resume"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--resume"));
            },
            "neither reviewer invocation carries a forked worker session id"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[2]!.includes("WORKER-S") && !claudeSpawnedArgs[3]!.includes("WORKER-S"));
            }
        }
    });

    test("error.log deleted before each reviewer relaunch", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/error.log", "stale");
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            // reviewer #1: absent file
            s.claudeQueue.push({ text: "no verdict" });
            // reviewer #2: PASS
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, rmCalls }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, rmCalls };
        },
        ASSERT({ code, rmCalls }) {
            Assert.strictEqual(code, 0);
            const errorLogRms = rmCalls.filter((p:string) => p === WS_ROOT + "/error.log");
            Assert.ok(errorLogRms.length >= 1, "clearErrorLog should call rm when error.log exists before reviewer invocation");
        }
    });

    test("present empty error.log is PASS", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer log shows PASS"({ files }) {
                const log = files.get(WS_ROOT + "/reviewer.1.1.log")!;
                Assert.ok(log.includes("Verdict: PASS"));
            }
        }
    });

    test("present non-empty error.log is FAIL and content preserved between iterations", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "reviewer output", errorLog: "missing edge case\nincorrect return type" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker ok, reviewer pass
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, files, rmCalls }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, files, rmCalls };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer.1.1.log shows FAIL with content"({ files }) {
                const log = files.get(WS_ROOT + "/reviewer.1.1.log")!;
                Assert.ok(log.includes("Verdict: FAIL missing edge case\nincorrect return type"));
            },
            "error.log survives until next iteration clears it"({ rmCalls }) {
                Assert.ok(rmCalls.includes(WS_ROOT + "/error.log"), "iteration 2 clearErrorLog should find and delete the violations file");
            }
        }
    });

    test("reviewer exception writes error.log and returns false", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            // reviewer throws
            s.claudeQueue.push({ text: "", error: true });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 worker succeeded (post-worker add ran) before the reviewer stage errored
            // iter 2: worker ok, reviewer pass
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, rmCalls }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, rmCalls };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "error.log was written by catch block and found by next iteration"({ rmCalls }) {
                Assert.ok(rmCalls.includes(WS_ROOT + "/error.log"), "clearErrorLog in iteration 2 should find the error.log written by the catch block");
            }
        }
    });
});

test.describe("Implement AI stderr forwarding", test => {
    test("AI stderr is captured in writeError output", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.claudeQueue.push({ text: "worker done", stderr: "warning: something happened\n" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, written }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, written };
        },
        ASSERTS: {
            "exits 0"(result) {
                Assert.strictEqual(result.code, 0);
            },
            "stderr forwarded through writeError to block output"(result) {
                const allWritten = result.written.join("");
                Assert.ok(allWritten.includes("warning: something happened"));
            }
        }
    });
});

test.describe("Implement _stringifyError non-Error", test => {
    test("non-Error value is stringified via String()", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.claudeQueue.push({ text: "worker" });
            // Throw a non-Error from script spawn by making it throw a string
            const origSpawn = s.contexts.script.spawn;
            let firstCall = true;
            s.contexts.script.spawn = (command, args, options) => {
                if (command !== "git" && firstCall) {
                    firstCall = false;
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("error", "string-error-value"));
                    return proc;
                }
                return origSpawn(command, args, options);
            };
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (build throws → fails) still runs a post-worker add
            // iter 2: build ok, reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 0);
        }
    });
});

test.describe("Implement .bat script path on Windows", test => {
    test("uses cmd.exe /c for .bat scripts when isWindows is true", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.contexts.platform.isWindows = () => true;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.files.set(WS_ROOT + "/build.bat", "@echo off\necho build ok");
            s.files.set(WS_ROOT + "/test.bat", "@echo off\necho test ok");
            s.claudeQueue.push({ text: "worker" });
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            const scriptSpawns:Array<{ command:string; args:readonly string[] }> = [];
            const origSpawn = s.contexts.script.spawn;
            s.contexts.script.spawn = (command, args, options) => {
                if (command !== "git") {
                    scriptSpawns.push({ command, args: [...args] });
                }
                return origSpawn(command, args, options);
            };
            return { ...s, scriptSpawns };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "build command is cmd.exe"(_code, { scriptSpawns }) {
                const build = scriptSpawns.find((s:{ command:string; args:readonly string[] }) => s.args.some((a:string) => a.includes("build.bat")));
                Assert.ok(build, "build.bat should have been spawned");
                Assert.strictEqual(build!.command, "cmd.exe");
            },
            "build first arg is /c"(_code, { scriptSpawns }) {
                const build = scriptSpawns.find((s:{ command:string; args:readonly string[] }) => s.args.some((a:string) => a.includes("build.bat")));
                Assert.ok(build, "build.bat should have been spawned");
                Assert.strictEqual(build!.args[0], "/c");
            },
            "test command is cmd.exe"(_code, { scriptSpawns }) {
                const t = scriptSpawns.find((s:{ command:string; args:readonly string[] }) => s.args.some((a:string) => a.includes("test.bat")));
                Assert.ok(t, "test.bat should have been spawned");
                Assert.strictEqual(t!.command, "cmd.exe");
            },
            "test first arg is /c"(_code, { scriptSpawns }) {
                const t = scriptSpawns.find((s:{ command:string; args:readonly string[] }) => s.args.some((a:string) => a.includes("test.bat")));
                Assert.ok(t, "test.bat should have been spawned");
                Assert.strictEqual(t!.args[0], "/c");
            }
        }
    });
});

test.describe("Implement adapter routing via getAdapter", test => {
    test("worker.tool=codex routes worker stage through codex binary", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "codex", model: "codex-model", effort: "high" }, reviewers: [{ tool: "claude", model: "rev-model", effort: "low", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.codexQueue.push({ text: "detect" });
            s.codexQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, codexSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return codexSpawnedArgs;
        },
        ASSERTS: {
            "worker spawn is second codex spawn"(codexSpawnedArgs) {
                const workerSpawn = codexSpawnedArgs[1];
                Assert.ok(workerSpawn !== undefined, "second codex spawn (worker) should exist");
            },
            "worker spawn args contain -m flag with configured model"(codexSpawnedArgs) {
                const workerSpawn = codexSpawnedArgs[1]!;
                const mIndex = workerSpawn.indexOf("-m");
                Assert.ok(mIndex >= 0, "-m flag should be present");
                Assert.strictEqual(workerSpawn[mIndex + 1], "codex-model");
            },
            "worker spawn args contain effort override"(codexSpawnedArgs) {
                const workerSpawn = codexSpawnedArgs[1]!;
                Assert.ok(workerSpawn.includes("model_reasoning_effort=high"), "effort override should be present");
            }
        }
    });

    test("reviewer.tool=claude routes reviewer stage through claude binary", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "codex", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "rev-model", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.codexQueue.push({ text: "detect" });
            s.codexQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return claudeSpawnedArgs;
        },
        ASSERTS: {
            "reviewer spawn args contain --print flag"(claudeSpawnedArgs) {
                Assert.strictEqual(claudeSpawnedArgs.length, 1, "exactly one claude spawn (reviewer)");
                Assert.ok(claudeSpawnedArgs[0]!.includes("--print"), "--print flag should be present");
            },
            "reviewer spawn args contain --model flag with configured model"(claudeSpawnedArgs) {
                const args = claudeSpawnedArgs[0]!;
                const modelIndex = args.indexOf("--model");
                Assert.ok(modelIndex >= 0, "--model flag should be present");
                Assert.strictEqual(args[modelIndex + 1], "rev-model");
            }
        }
    });

    test("detect agent uses the worker triple, not the reviewer triple", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "codex", model: "w-model", effort: "medium" }, reviewers: [{ tool: "claude", model: "r-model", effort: "low", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.codexQueue.push({ text: "detect" });
            s.codexQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, codexSpawnedArgs, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return { codexSpawnedArgs, claudeSpawnedArgs };
        },
        ASSERTS: {
            "detect is the first codex spawn"({ codexSpawnedArgs }) {
                Assert.ok(codexSpawnedArgs.length >= 1, "at least one codex spawn");
                Assert.strictEqual(codexSpawnedArgs[0]![0], "exec");
            },
            "detect spawn carries the worker model"({ codexSpawnedArgs }) {
                const detectArgs = codexSpawnedArgs[0]!;
                const mIndex = detectArgs.indexOf("-m");
                Assert.ok(mIndex >= 0, "-m flag present on detect spawn");
                Assert.strictEqual(detectArgs[mIndex + 1], "w-model");
            },
            "no claude spawn for detect"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 1, "only one claude spawn (reviewer), not detect");
            }
        }
    });

    test("session id is still captured from the worker via the runner", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "worker iter 1", sessionId: "worker-sess-1" });
            s.claudeQueue.push({ text: "violations", errorLog: "found a problem" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            s.claudeQueue.push({ text: "worker iter 2", sessionId: "worker-sess-2" });
            s.claudeQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "worker iter 2 resumes the captured session from iter 1"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker iter 1, [2]=reviewer iter 1, [3]=worker iter 2
                const workerIter2Args = claudeSpawnedArgs[3];
                Assert.ok(workerIter2Args !== undefined, "fourth claude spawn (worker iter 2) should exist");
                Assert.ok(workerIter2Args.includes("--resume"), "--resume flag should be present");
                Assert.ok(workerIter2Args.includes("worker-sess-1"), "session id from iter 1 should be used");
            }
        }
    });

    test("all-claude config routes all stages through claude binary", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "w-model", effort: "" }, reviewers: [{ tool: "claude", model: "r-model", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs, codexSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return { claudeSpawnedArgs, codexSpawnedArgs };
        },
        ASSERTS: {
            "all three AI stages go through claude"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 3);
            },
            "no codex spawns"({ codexSpawnedArgs }) {
                Assert.strictEqual(codexSpawnedArgs.length, 0);
            },
            "detect spawn carries the worker model"({ claudeSpawnedArgs }) {
                const detectArgs = claudeSpawnedArgs[0]!;
                const modelIndex = detectArgs.indexOf("--model");
                Assert.ok(modelIndex >= 0, "--model flag present on detect spawn");
                Assert.strictEqual(detectArgs[modelIndex + 1], "w-model");
            },
            "reviewer spawn carries the reviewer model"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker, [2]=reviewer
                const reviewerArgs = claudeSpawnedArgs[2]!;
                const modelIndex = reviewerArgs.indexOf("--model");
                Assert.ok(modelIndex >= 0, "--model flag present on reviewer spawn");
                Assert.strictEqual(reviewerArgs[modelIndex + 1], "r-model");
            }
        }
    });

    test("empty model and effort do not pass flags to the binary", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return claudeSpawnedArgs;
        },
        ASSERTS: {
            "no --model flag on any spawn"(claudeSpawnedArgs) {
                for (const args of claudeSpawnedArgs) {
                    Assert.ok(!args.includes("--model"), `--model should not appear when model is empty, got: ${args.join(" ")}`);
                }
            }
        }
    });
});

test.describe("Implement detect agent inherits worker triple", test => {
    test("codex worker with model and effort routes detect through codex adapter with those values", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "codex", model: "gpt-5-codex", effort: "high" }, reviewers: [{ tool: "claude", model: "rev-model", effort: "low", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.codexQueue.push({ text: "detect" });
            s.codexQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, codexSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return codexSpawnedArgs;
        },
        ASSERTS: {
            "detect is first codex spawn with exec subcommand"(codexSpawnedArgs) {
                Assert.ok(codexSpawnedArgs.length >= 1, "at least one codex spawn");
                Assert.strictEqual(codexSpawnedArgs[0]![0], "exec");
            },
            "detect spawn carries -m gpt-5-codex"(codexSpawnedArgs) {
                const detectArgs = codexSpawnedArgs[0]!;
                const mIndex = detectArgs.indexOf("-m");
                Assert.ok(mIndex >= 0, "-m flag present on detect spawn");
                Assert.strictEqual(detectArgs[mIndex + 1], "gpt-5-codex");
            },
            "detect spawn carries model_reasoning_effort=high"(codexSpawnedArgs) {
                const detectArgs = codexSpawnedArgs[0]!;
                Assert.ok(detectArgs.includes("model_reasoning_effort=high"), "effort override present on detect spawn");
            }
        }
    });

    test("claude worker with empty model and effort routes detect through claude with no flags", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return claudeSpawnedArgs;
        },
        ASSERTS: {
            "detect spawn does not contain --model flag"(claudeSpawnedArgs) {
                const detectArgs = claudeSpawnedArgs[0]!;
                Assert.ok(!detectArgs.includes("--model"), "--model should not appear when model is empty");
            },
            "detect spawn does not contain any effort-related arg"(claudeSpawnedArgs) {
                const detectArgs = claudeSpawnedArgs[0]!;
                const hasEffort = detectArgs.some((arg:string) => arg.includes("effort"));
                Assert.ok(!hasEffort, "no effort flag should appear when effort is empty");
            }
        }
    });

    test("detect prompt does not mention or include the reviewer triple", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "codex", model: "worker-model-abc", effort: "high" }, reviewers: [{ tool: "claude", model: "reviewer-sentinel-model", effort: "reviewer-sentinel-effort", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.codexQueue.push({ text: "detect" });
            s.codexQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, promptQueue }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return promptQueue;
        },
        ASSERTS: {
            "detect prompt does not contain reviewer tool value"(promptQueue) {
                Assert.ok(!promptQueue[0]!.includes("claude"), "detect prompt must not contain reviewer tool name");
            },
            "detect prompt does not contain reviewer model value"(promptQueue) {
                Assert.ok(!promptQueue[0]!.includes("reviewer-sentinel-model"), "detect prompt must not contain reviewer model");
            },
            "detect prompt does not contain reviewer effort value"(promptQueue) {
                Assert.ok(!promptQueue[0]!.includes("reviewer-sentinel-effort"), "detect prompt must not contain reviewer effort");
            }
        }
    });

    test("exactly one detect call per implement run through the runner", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, promptQueue, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return { promptQueue, claudeSpawnedArgs };
        },
        ASSERTS: {
            "3 total runner invocations: detect, worker, reviewer"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 3);
            },
            "exactly one prompt matches the detect pattern"({ promptQueue }) {
                const detectCount = promptQueue.filter((p:string) => p.includes("build/test detection agent")).length;
                Assert.strictEqual(detectCount, 1);
            },
            "detect prompt is the first runner invocation"({ promptQueue }) {
                Assert.ok(promptQueue[0]!.includes("build/test detection agent"), "first prompt must be detect");
            }
        }
    });
});

test.describe("Implement no prep agent", test => {
    test("under DEFAULT_CONFIG the orchestrator spawns no prep agent and forks no session", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            // DEFAULT_CONFIG: worker and the single reviewer share {claude,"",""} — the case the
            // retired prep optimization used to fork. There must be exactly detect, worker, reviewer.
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });          // detect
            s.claudeQueue.push({ text: "worker" });        // worker
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" }); // reviewer
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs, promptQueue }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs, promptQueue };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "exactly 3 claude spawns: detect, worker, reviewer — no prep"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 3);
            },
            "no prompt contains the prep-agent preamble"({ promptQueue }) {
                for (const p of promptQueue) {
                    Assert.ok(!p.includes("You are the prep agent"), "no prep prompt should be emitted");
                }
            },
            "the worker (spawn 1) is a fresh invocation — no --resume"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker, [2]=reviewer
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--resume"), "worker iteration 1 must be fresh");
            },
            "the worker (spawn 1) does not fork a session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--fork-session"), "worker iteration 1 must not fork");
            }
        }
    });

    test("a worker/codex-reviewer config also spawns no prep — 2 claude spawns and 1 codex spawn", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs, codexSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs, codexSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "2 claude spawns: detect and worker"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 2);
            },
            "1 codex spawn: reviewer"({ codexSpawnedArgs }) {
                Assert.strictEqual(codexSpawnedArgs.length, 1);
            }
        }
    });
});

function planWithLinkedFiles(contractLinks:string, ruleLinks:string):string {
    return [
        "# Plan",
        "",
        '- [ ]{"it":0,"ot":0,"t":0} 1.1 Task with links',
        "",
        "  Description.",
        "",
        `  Contracts: ${contractLinks}`,
        "",
        `  Rules: ${ruleLinks}`,
        ""
    ].join("\n");
}

function readdirForPaths(files:Map<string, string>) {
    return (dirPath:string) => {
        const entries:Array<{ name:string; isFile:boolean; isDirectory:boolean }> = [];
        const prefix = dirPath.endsWith("/") ? dirPath : dirPath + "/";
        for (const key of files.keys()) {
            if (key.startsWith(prefix) && !key.slice(prefix.length).includes("/")) {
                entries.push({ name: key.slice(prefix.length), isFile: true, isDirectory: false });
            }
        }
        return Promise.resolve(entries);
    };
}

test.describe("Implement worker iter 1 deterministic injection", test => {
    test("worker iteration 1 is a fresh invocation whose prompt carries the full task text and consolidates the linked content into spec.md", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const plan = planWithLinkedFiles(
                "[.spec/contracts/linked-c.md](/.spec/contracts/linked-c.md)",
                "[.spec/rules/linked-r.md](/.spec/rules/linked-r.md)"
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/linked-c.md", "UNIQUE_CONTRACT_SNIPPET_BETA");
            s.files.set("/project/.spec/rules/linked-r.md", "UNIQUE_RULE_SNIPPET_BETA");
            s.files.set("/project/.spec/contracts/unlinked-global.md", "UNLINKED_GLOBAL_SNIPPET");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // detect, worker, reviewer — DEFAULT_CONFIG (worker and reviewer share the triple), which is
            // exactly the case the retired prep optimization used to fork; the worker must still be fresh.
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done", sessionId: "worker-beta" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs, promptQueue, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs, promptQueue, files };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "worker iteration 1 has no --resume flag (fresh invocation)"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker, [2]=reviewer
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--resume"), "worker iteration 1 must be a fresh invocation");
            },
            "worker iteration 1 has no --fork-session flag"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--fork-session"), "worker iteration 1 must not fork a session");
            },
            "worker prompt carries the task line verbatim"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker
                Assert.ok(promptQueue[1]!.includes("1.1 Task with links"), "worker prompt must carry the full task text (task line)");
            },
            "worker prompt carries the task body verbatim"({ promptQueue }) {
                Assert.ok(promptQueue[1]!.includes("Description."), "worker prompt must carry the full task text (body)");
            },
            "worker prompt directs reading the consolidated spec.md by path"({ promptQueue }) {
                Assert.ok(promptQueue[1]!.includes(WS_ROOT + "/spec.md"), "worker prompt must name the consolidated spec.md path");
            },
            "the consolidated spec.md holds the linked contract body"({ files }) {
                Assert.ok(files.get(WS_ROOT + "/spec.md")!.includes("UNIQUE_CONTRACT_SNIPPET_BETA"), "linked contract content must be in spec.md");
            },
            "the consolidated spec.md holds the linked rule body"({ files }) {
                Assert.ok(files.get(WS_ROOT + "/spec.md")!.includes("UNIQUE_RULE_SNIPPET_BETA"), "linked rule content must be in spec.md");
            },
            "the worker prompt does NOT inline the linked contract body"({ promptQueue }) {
                Assert.strictEqual(promptQueue[1]!.includes("UNIQUE_CONTRACT_SNIPPET_BETA"), false, "linked contract content must NOT be inlined in the prompt");
            },
            "the worker prompt does NOT inline the linked rule body"({ promptQueue }) {
                Assert.strictEqual(promptQueue[1]!.includes("UNIQUE_RULE_SNIPPET_BETA"), false, "linked rule content must NOT be inlined in the prompt");
            },
            "the consolidated spec.md does NOT contain unlinked global file content"({ files }) {
                Assert.strictEqual(files.get(WS_ROOT + "/spec.md")!.includes("UNLINKED_GLOBAL_SNIPPET"), false, "unlinked file content must NOT be consolidated");
            },
            "the consolidated spec.md excludes the task text"({ files }) {
                const spec = files.get(WS_ROOT + "/spec.md")!;
                Assert.ok(!spec.includes("1.1 Task with links") && !spec.includes("Description."), "the task line and body must NOT be consolidated into spec.md");
            }
        }
    });

    test("the worker receives each distinct referenced file exactly once even when the task links it multiple times", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            // The same contract and the same rule are each linked twice, via different section anchors.
            const plan = planWithLinkedFiles(
                "[.spec/contracts/dup-c.md#a](/.spec/contracts/dup-c.md#a) [.spec/contracts/dup-c.md#b](/.spec/contracts/dup-c.md#b)",
                "[.spec/rules/dup-r.md#x](/.spec/rules/dup-r.md#x) [.spec/rules/dup-r.md#y](/.spec/rules/dup-r.md#y)"
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/dup-c.md", "DUP_WORKER_CONTRACT_SNIPPET");
            s.files.set("/project/.spec/rules/dup-r.md", "DUP_WORKER_RULE_SNIPPET");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, files };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the doubly-linked contract content is consolidated exactly once"({ files }) {
                const occurrences = (files.get(WS_ROOT + "/spec.md")!.match(/DUP_WORKER_CONTRACT_SNIPPET/g) ?? []).length;
                Assert.strictEqual(occurrences, 1);
            },
            "the doubly-linked rule content is consolidated exactly once"({ files }) {
                const occurrences = (files.get(WS_ROOT + "/spec.md")!.match(/DUP_WORKER_RULE_SNIPPET/g) ?? []).length;
                Assert.strictEqual(occurrences, 1);
            }
        }
    });

    test("the worker resumes its captured session id on iteration 2 and never forks", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "a", effort: "" }, reviewers: [{ tool: "codex", model: "b", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles("[.spec/contracts/c.md](/.spec/contracts/c.md)", "[.spec/rules/r.md](/.spec/rules/r.md)");
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/c.md", "c");
            s.files.set("/project/.spec/rules/r.md", "r");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            // worker iteration 1 emits its session id
            s.claudeQueue.push({ text: "worker", sessionId: "worker-cap-B" });
            // reviewer FAIL, then retry
            s.codexQueue.push({ text: "found issues", errorLog: "fix it" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker resumes with captured session
            s.claudeQueue.push({ text: "worker2" });
            // reviewer PASS
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "iter 2 worker resumes with captured session id from iter 1"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker iter 1, [2]=worker iter 2
                const iter2WorkerArgs = claudeSpawnedArgs[2]!;
                Assert.strictEqual(iter2WorkerArgs[0], "--resume");
                Assert.strictEqual(iter2WorkerArgs[1], "worker-cap-B");
            },
            "iter 2 worker has no --fork-session"({ claudeSpawnedArgs }) {
                const iter2WorkerArgs = claudeSpawnedArgs[2]!;
                Assert.ok(!iter2WorkerArgs.includes("--fork-session"));
            }
        }
    });

    test("a missing referenced file is a stage failure that records a briefing and restarts the inner loop until the iteration cap", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 1); // iterations 2-5 each run a post-worker add before the reviewer stage fails
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles(
                "[.spec/contracts/exists.md](/.spec/contracts/exists.md) [.spec/contracts/missing.md](/.spec/contracts/missing.md)",
                ""
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/exists.md", "EXISTS_CONTENT");
            // .spec/contracts/missing.md is deliberately absent: reference injection cannot read it on
            // iteration 1 (worker stage) nor on any later iteration (reviewer stage). A missing
            // referenced file must surface as a stage failure (briefing written, inner loop restarted),
            // never as a placeholder and never as an immediate command-level abort.
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            const errorLogWrites:string[] = [];
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p, c) => {
                if (p === WS_ROOT + "/error.log") errorLogWrites.push(c);
                return origWriteFile(p, c);
            };
            s.claudeQueue.push({ text: "ok" });               // detect
            // iterations 2-5: the fresh-fallback worker launches and "succeeds"; each iteration's
            // reviewer stage then fails because its reference injection cannot read the missing file.
            for (let i = 0; i < 4; i++) {
                s.claudeQueue.push({ text: "worker done" });
            }
            return { ...s, errorLogWrites };
        },
        async ACT({ contexts, promptQueue, written, errors, rmCalls }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, promptQueue, output: written.join("") + errors.join(""), rmCalls };
        },
        ASSERTS: {
            "exits non-zero at the iteration cap"({ code }) {
                Assert.strictEqual(code, 1);
            },
            "the hard stop is reached by iterating, not by an immediate command abort"({ output }) {
                Assert.ok(output.includes("Hard stop") && output.includes("exceeded"), `expected the iteration-cap hard-stop message, got: ${output}`);
            },
            "iteration 1 records a worker-stage-failure briefing naming the missing file"(_r, { errorLogWrites }) {
                Assert.ok(errorLogWrites.some(c => c.includes("worker stage failed") && c.includes("missing.md")), `expected a worker-stage-failure briefing naming the missing file, got: ${JSON.stringify(errorLogWrites)}`);
            },
            "the workspace is preserved on the hard stop (not cleaned up as a command abort would)"({ rmCalls }) {
                Assert.ok(!rmCalls.includes(WS_ROOT), "the hard stop must preserve the workspace");
            },
            "no '(file not found)' placeholder is ever injected into a prompt"({ promptQueue }) {
                Assert.strictEqual(promptQueue.some(p => p.includes("(file not found)")), false);
            }
        }
    });
});

test.describe("Implement worker iter n>1 — resume, no context replay", test => {
    test("iter 2 with captured session invokes worker with resumeSessionId and no fork parent", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns sessionId "w-abc", reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "w-abc" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix it" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker, reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "iter 2 worker has --resume w-abc"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker1, [2]=reviewer1, [3]=worker2, [4]=reviewer2
                Assert.strictEqual(claudeSpawnedArgs[3]![0], "--resume");
                Assert.strictEqual(claudeSpawnedArgs[3]![1], "w-abc");
            },
            "iter 2 worker has no --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--fork-session"));
            }
        }
    });

    test("iter 2 prompt does NOT re-inject the linked contract or rule body consolidated on iteration 1", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles(
                "[.spec/contracts/linked-c.md](/.spec/contracts/linked-c.md)",
                "[.spec/rules/linked-r.md](/.spec/rules/linked-r.md)"
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/linked-c.md", "UNIQUE_CONTRACT_ITER2_NOREPLAY");
            s.files.set("/project/.spec/rules/linked-r.md", "UNIQUE_RULE_ITER2_NOREPLAY");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // detect
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker — inlines content, reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "w-iter1" });
            s.codexQueue.push({ text: "found issues", errorLog: "fix it" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker resumes, reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, promptQueue, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, promptQueue, files };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "iter 1 prompt contains the full task text"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker iter 1
                Assert.ok(promptQueue[1]!.includes("Task with links"), "iter 1 must carry the full task text");
            },
            "iter 1 consolidates the linked contract body into spec.md"({ files }) {
                Assert.ok(files.get(WS_ROOT + "/spec.md")!.includes("UNIQUE_CONTRACT_ITER2_NOREPLAY"));
            },
            "iter 1 consolidates the linked rule body into spec.md"({ files }) {
                Assert.ok(files.get(WS_ROOT + "/spec.md")!.includes("UNIQUE_RULE_ITER2_NOREPLAY"));
            },
            "iter 1 prompt directs reading the consolidated spec.md by path"({ promptQueue }) {
                Assert.ok(promptQueue[1]!.includes(WS_ROOT + "/spec.md"), "iter 1 worker prompt must name the consolidated spec.md path");
            },
            "iter 1 prompt does NOT inline the linked contract body"({ promptQueue }) {
                Assert.strictEqual(promptQueue[1]!.includes("UNIQUE_CONTRACT_ITER2_NOREPLAY"), false, "linked contract content must NOT be inlined in the prompt");
            },
            "iter 2 prompt does NOT re-inject the full task text"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker iter 1, [2]=reviewer iter 1, [3]=worker iter 2
                Assert.ok(!promptQueue[3]!.includes("Task with links"), "the task text must NOT be re-injected in iter 2");
            },
            "iter 2 prompt does NOT contain linked contract body"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("UNIQUE_CONTRACT_ITER2_NOREPLAY"), "linked contract content must NOT be inlined in iter 2");
            },
            "iter 2 prompt does NOT contain linked rule body"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("UNIQUE_RULE_ITER2_NOREPLAY"), "linked rule content must NOT be inlined in iter 2");
            },
            "iter 1 prompt carries the consolidated spec.md directive"({ promptQueue }) {
                Assert.ok(promptQueue[1]!.includes("## Linked reference content"), "iter 1 (which writes spec.md) directs the worker to read it");
            },
            "iter 2 prompt does NOT carry the consolidated spec.md directive"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("## Linked reference content"), "iter 2 resumes the session, so it must not re-append the directive");
            },
            "iter 2 prompt does NOT make the unconditional 'full task is provided in this prompt' claim"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("the full task is provided in this prompt"), "iter 2 must not claim the full task is inlined");
            }
        }
    });

    test("iter 2 with null session invokes worker with no resume and no fork", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns NO sessionId, reviewer FAIL
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix it" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker (no session to resume), reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "iter 2 worker has no --resume"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker1, [2]=reviewer1, [3]=worker2, [4]=reviewer2
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--resume"), "iter 2 with null session must not have --resume");
            },
            "iter 2 worker has no --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--fork-session"), "iter 2 with null session must not have --fork-session");
            }
        }
    });

    test("iteration 2 with no captured session is a fresh fallback that directs the worker without re-injecting task text or referenced content", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const plan = planWithLinkedFiles(
                "[.spec/contracts/fb-c.md](/.spec/contracts/fb-c.md)",
                "[.spec/rules/fb-r.md](/.spec/rules/fb-r.md)"
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/fb-c.md", "FALLBACK_CONTRACT_SNIPPET");
            s.files.set("/project/.spec/rules/fb-r.md", "FALLBACK_RULE_SNIPPET");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns NO sessionId (not resumable), reviewer FAIL
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix it" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker fresh fallback (no session to resume), reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, promptQueue, claudeSpawnedArgs, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, promptQueue, claudeSpawnedArgs, files };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "iter 2 worker is a fresh invocation — no --resume"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker1, [2]=reviewer1, [3]=worker2, [4]=reviewer2
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--resume"));
            },
            "iter 2 worker has no --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--fork-session"));
            },
            "iter 1 worker prompt carries the full task body"({ promptQueue }) {
                Assert.ok(promptQueue[1]!.includes("Description."), "iter 1 must inject the full task text");
            },
            "iter 1 consolidates the referenced contract and rule content into spec.md"({ files }) {
                const spec = files.get(WS_ROOT + "/spec.md")!;
                Assert.ok(spec.includes("FALLBACK_CONTRACT_SNIPPET") && spec.includes("FALLBACK_RULE_SNIPPET"), "iter 1 must consolidate the referenced content into spec.md");
            },
            "iter 2 fresh-fallback prompt identifies the task to implement"({ promptQueue }) {
                Assert.ok(promptQueue[3]!.includes("Task with links"), "the fresh-fallback worker must be told which task to implement");
            },
            "iter 2 fresh-fallback prompt points the worker at the consolidated spec.md by path"({ promptQueue }) {
                Assert.ok(promptQueue[3]!.includes(WS_ROOT + "/spec.md"), "the fresh fallback must direct the worker to reread the consolidated spec.md");
            },
            "iter 2 fresh-fallback prompt does NOT re-inject the full task body"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("Description."), "the fresh fallback must not replay the full task text");
            },
            "iter 2 fresh-fallback prompt does NOT re-inject the referenced contract content"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("FALLBACK_CONTRACT_SNIPPET"), "the fresh fallback must not replay referenced contract content");
            },
            "iter 2 fresh-fallback prompt does NOT re-inject the referenced rule content"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("FALLBACK_RULE_SNIPPET"), "the fresh fallback must not replay referenced rule content");
            },
            "iter 2 fresh-fallback prompt does NOT falsely claim session continuity"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("through session continuity"), "the fresh fallback has no session, so it must not claim continuity");
            }
        }
    });

    test("the worker's spec.md is written on iteration 1 and not regenerated on iterations n>1", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const plan = planWithLinkedFiles(
                "[.spec/contracts/regen-c.md](/.spec/contracts/regen-c.md)",
                "[.spec/rules/regen-r.md](/.spec/rules/regen-r.md)"
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/regen-c.md", "REGEN_CONTRACT_SNIPPET");
            s.files.set("/project/.spec/rules/regen-r.md", "REGEN_RULE_SNIPPET");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // Capture every write to the worker's spec.md path across the run.
            const specWrites:string[] = [];
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p, c) => {
                if (p === WS_ROOT + "/spec.md") specWrites.push(c);
                return origWriteFile(p, c);
            };
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker captures session, reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "w-regen" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix it" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker resumes, reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { ...s, specWrites };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker's spec.md is written exactly once across both iterations"(_code, { specWrites }) {
                Assert.strictEqual(specWrites.length, 1);
            },
            "the single worker spec.md write holds the consolidated referenced content"(_code, { specWrites }) {
                Assert.ok(specWrites[0]!.includes("REGEN_CONTRACT_SNIPPET") && specWrites[0]!.includes("REGEN_RULE_SNIPPET"));
            }
        }
    });

    test("defensive capture: iter 2 emits new session.id, iter 3 uses the new id", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns sessionId "w-old", reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "w-old" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix 1" });
            // iter 2: worker emits NEW sessionId "w-new", reviewer FAIL
            s.claudeQueue.push({ text: "w2", sessionId: "w-new" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix 2" });
            extraWorkerAdds(s.gitQueue, 2); // iters 1 and 2 (review fails) each run a post-worker add
            // iter 3: worker, reviewer PASS
            s.claudeQueue.push({ text: "w3" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "iter 2 resumes with w-old"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker1, [2]=reviewer1, [3]=worker2, [4]=reviewer2, [5]=worker3, [6]=reviewer3
                Assert.strictEqual(claudeSpawnedArgs[3]![0], "--resume");
                Assert.strictEqual(claudeSpawnedArgs[3]![1], "w-old");
            },
            "iter 3 resumes with w-new"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[5]![0], "--resume");
                Assert.strictEqual(claudeSpawnedArgs[5]![1], "w-new");
            },
            "iter 3 does not use w-old"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[5]!.includes("w-old"), "iter 3 must use the updated session id, not the old one");
            }
        }
    });

    test("previousIterationBriefing is appended in all iter n>1 cases", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker, reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "w-briefing" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix it" });
            // iter 2: worker, reviewer FAIL
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix again" });
            extraWorkerAdds(s.gitQueue, 2); // iters 1 and 2 (review fails) each run a post-worker add
            // iter 3: worker, reviewer PASS
            s.claudeQueue.push({ text: "w3" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, promptQueue }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, promptQueue };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "iter 1 prompt does not contain briefing"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker1
                Assert.ok(!promptQueue[1]!.includes("This is iteration"), "iter 1 prompt must not contain briefing");
            },
            "iter 2 prompt contains iteration 2 briefing"({ promptQueue }) {
                // promptQueue: [2]=reviewer1, [3]=worker2
                Assert.ok(promptQueue[3]!.includes("This is iteration 2 for this task"), "iter 2 prompt must contain iteration 2 briefing");
            },
            "iter 3 prompt contains iteration 3 briefing"({ promptQueue }) {
                // promptQueue: [4]=reviewer2, [5]=worker3
                Assert.ok(promptQueue[5]!.includes("This is iteration 3 for this task"), "iter 3 prompt must contain iteration 3 briefing");
            }
        }
    });

    test("cross-task discard: the worker session does not carry from one task's iteration 1 to the next task", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue, 2);
            const twoTaskPlan = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task Alpha\n- [ ]{"it":0,"ot":0,"t":0} Task Beta\n';
            s.files.set(PLAN_PATH, twoTaskPlan);
            s.claudeQueue.push({ text: "ok" });
            // Task Alpha: worker (returns sessionId "alpha-ws"), reviewer PASS
            s.claudeQueue.push({ text: "w-alpha", sessionId: "alpha-ws" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            // Task Beta iter 1: worker (returns NO sessionId), reviewer FAIL
            s.claudeQueue.push({ text: "w-beta-1" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix it" });
            extraWorkerAdds(s.gitQueue, 1); // Task Beta iter 1 (review fails) still runs a post-worker add
            // Task Beta iter 2: worker (no session to resume since iter 1 had null), reviewer PASS
            s.claudeQueue.push({ text: "w-beta-2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "task Beta iter 1 worker is a fresh invocation — no --resume"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker-alpha, [2]=reviewer-alpha, [3]=worker-beta-1, [4]=reviewer-beta-1, [5]=worker-beta-2, [6]=reviewer-beta-2
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--resume"), "task Beta iteration 1 must be a fresh invocation");
            },
            "task Beta iter 1 worker does not carry over alpha-ws from task Alpha"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("alpha-ws"), "task Beta must not carry over alpha-ws from task Alpha");
            },
            "task Beta iter 1 worker has no --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--fork-session"));
            },
            "task Beta iter 2 worker has no --resume (no session captured in iter 1)"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[5]!.includes("--resume"), "iter 2 of task Beta with null session must not have --resume");
            }
        }
    });
});

test.describe("Implement reviewer deterministic injection", test => {
    test("a reviewer invocation is fresh and its prompt carries the full task text and consolidates the linked content into its spec.md", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles(
                "[.spec/contracts/linked-c.md](/.spec/contracts/linked-c.md)",
                "[.spec/rules/linked-r.md](/.spec/rules/linked-r.md)"
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/linked-c.md", "UNIQUE_REVIEWER_CONTRACT_BETA");
            s.files.set("/project/.spec/rules/linked-r.md", "UNIQUE_REVIEWER_RULE_BETA");
            s.files.set("/project/.spec/contracts/unlinked-global.md", "UNLINKED_REVIEWER_GLOBAL_SNIPPET");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done", sessionId: "worker-rev-b" });
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, codexSpawnedArgs, promptQueue, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, codexSpawnedArgs, promptQueue, files };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer has no fork subcommand"({ codexSpawnedArgs }) {
                Assert.ok(!codexSpawnedArgs[0]!.includes("fork"), "reviewer must be fresh — no fork");
            },
            "reviewer has no resume subcommand"({ codexSpawnedArgs }) {
                Assert.ok(!codexSpawnedArgs[0]!.includes("resume"), "reviewer must be fresh — no resume");
            },
            "reviewer prompt carries the task line verbatim"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker, [2]=reviewer
                Assert.ok(promptQueue[2]!.includes("1.1 Task with links"), "reviewer prompt must carry the task line");
            },
            "reviewer prompt carries the task body verbatim"({ promptQueue }) {
                Assert.ok(promptQueue[2]!.includes("Description."), "reviewer prompt must carry the full task body, not just the task line");
            },
            "reviewer prompt directs reading its own spec.md by path"({ promptQueue }) {
                Assert.ok(promptQueue[2]!.includes(reviewerRoot(1) + "/spec.md"), "reviewer prompt must name its own per-reviewer spec.md");
            },
            "the reviewer's spec.md holds the linked contract body"({ files }) {
                Assert.ok(files.get(reviewerRoot(1) + "/spec.md")!.includes("UNIQUE_REVIEWER_CONTRACT_BETA"), "linked contract content must be in the reviewer's spec.md");
            },
            "the reviewer's spec.md holds the linked rule body"({ files }) {
                Assert.ok(files.get(reviewerRoot(1) + "/spec.md")!.includes("UNIQUE_REVIEWER_RULE_BETA"), "linked rule content must be in the reviewer's spec.md");
            },
            "reviewer prompt does NOT inline the linked contract body"({ promptQueue }) {
                Assert.strictEqual(promptQueue[2]!.includes("UNIQUE_REVIEWER_CONTRACT_BETA"), false, "linked contract content must NOT be inlined in the reviewer prompt");
            },
            "reviewer prompt does NOT inline the linked rule body"({ promptQueue }) {
                Assert.strictEqual(promptQueue[2]!.includes("UNIQUE_REVIEWER_RULE_BETA"), false, "linked rule content must NOT be inlined in the reviewer prompt");
            },
            "the reviewer's spec.md does NOT contain unlinked global file content"({ files }) {
                Assert.strictEqual(files.get(reviewerRoot(1) + "/spec.md")!.includes("UNLINKED_REVIEWER_GLOBAL_SNIPPET"), false, "unlinked file content must NOT be consolidated for the reviewer");
            }
        }
    });

    test("across two iterations, every reviewer call is fresh and re-consolidates the linked content into its spec.md", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const plan = planWithLinkedFiles(
                "[.spec/contracts/linked-c.md](/.spec/contracts/linked-c.md)",
                "[.spec/rules/linked-r.md](/.spec/rules/linked-r.md)"
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/linked-c.md", "ALPHA_2ITER_CONTRACT");
            s.files.set("/project/.spec/rules/linked-r.md", "ALPHA_2ITER_RULE");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // Capture every write to the reviewer's per-reviewer spec.md so each iteration's
            // re-provisioning is observable even though both writes target the same path.
            const reviewerSpecWrites:string[] = [];
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p, c) => {
                if (p === reviewerRoot(1) + "/spec.md") reviewerSpecWrites.push(c);
                return origWriteFile(p, c);
            };
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "w1", sessionId: "worker-rev-2iter" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix it" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { ...s, reviewerSpecWrites };
        },
        async ACT({ contexts, claudeSpawnedArgs, promptQueue }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs, promptQueue };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer iter 1 is fresh — no --resume"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker1, [2]=reviewer1, [3]=worker2, [4]=reviewer2
                Assert.ok(!claudeSpawnedArgs[2]!.includes("--resume"), "reviewer iter 1 must be fresh");
            },
            "reviewer iter 1 has no --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[2]!.includes("--fork-session"));
            },
            "reviewer iter 2 is fresh — no --resume"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[4]!.includes("--resume"), "reviewer iter 2 must be fresh");
            },
            "reviewer iter 2 has no --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[4]!.includes("--fork-session"));
            },
            "reviewer iter 1 prompt carries the full task text"({ promptQueue }) {
                Assert.ok(promptQueue[2]!.includes("1.1 Task with links") && promptQueue[2]!.includes("Description."), "reviewer iter 1 must carry the task line and body");
            },
            "reviewer iter 1 prompt directs reading its own spec.md and does not inline content"({ promptQueue }) {
                Assert.ok(promptQueue[2]!.includes(reviewerRoot(1) + "/spec.md") && !promptQueue[2]!.includes("ALPHA_2ITER_CONTRACT"), "reviewer iter 1 must reference its spec.md and not inline content");
            },
            "reviewer iter 2 prompt carries the full task text"({ promptQueue }) {
                Assert.ok(promptQueue[4]!.includes("1.1 Task with links") && promptQueue[4]!.includes("Description."), "reviewer iter 2 must carry the task line and body");
            },
            "reviewer iter 2 prompt directs reading its own spec.md and does not inline content"({ promptQueue }) {
                Assert.ok(promptQueue[4]!.includes(reviewerRoot(1) + "/spec.md") && !promptQueue[4]!.includes("ALPHA_2ITER_RULE"), "reviewer iter 2 must reference its spec.md and not inline content");
            },
            "each reviewer iteration re-consolidates its spec.md with the linked content"(_r, { reviewerSpecWrites }) {
                Assert.strictEqual(reviewerSpecWrites.length, 2);
            },
            "every reviewer spec.md write holds the linked contract and rule content"(_r, { reviewerSpecWrites }) {
                Assert.ok(reviewerSpecWrites.every(c => c.includes("ALPHA_2ITER_CONTRACT") && c.includes("ALPHA_2ITER_RULE")));
            }
        }
    });

    test("a reviewer receives each distinct referenced file exactly once even when the task links it multiple times", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "", optional: false }], minimumReviews: 1 };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            // The same contract and the same rule are each linked twice, via different section anchors.
            const plan = planWithLinkedFiles(
                "[.spec/contracts/dup-c.md#a](/.spec/contracts/dup-c.md#a) [.spec/contracts/dup-c.md#b](/.spec/contracts/dup-c.md#b)",
                "[.spec/rules/dup-r.md#x](/.spec/rules/dup-r.md#x) [.spec/rules/dup-r.md#y](/.spec/rules/dup-r.md#y)"
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/dup-c.md", "DUP_REVIEWER_CONTRACT_SNIPPET");
            s.files.set("/project/.spec/rules/dup-r.md", "DUP_REVIEWER_RULE_SNIPPET");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, files };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the doubly-linked contract content is consolidated exactly once"({ files }) {
                const occurrences = (files.get(reviewerRoot(1) + "/spec.md")!.match(/DUP_REVIEWER_CONTRACT_SNIPPET/g) ?? []).length;
                Assert.strictEqual(occurrences, 1);
            },
            "the doubly-linked rule content is consolidated exactly once"({ files }) {
                const occurrences = (files.get(reviewerRoot(1) + "/spec.md")!.match(/DUP_REVIEWER_RULE_SNIPPET/g) ?? []).length;
                Assert.strictEqual(occurrences, 1);
            }
        }
    });
});

test.describe("Implement multiple parallel reviewers", test => {
    test("two reviewers, mixed tools — both are fresh and each receives the linked content via its own spec.md", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "codex", model: "", effort: "", optional: false }
                ],
                minimumReviews: 2
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles(
                "[.spec/contracts/linked-c.md](/.spec/contracts/linked-c.md)",
                "[.spec/rules/linked-r.md](/.spec/rules/linked-r.md)"
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/.spec/contracts/linked-c.md", "MIXED_CONTRACT_SNIPPET");
            s.files.set("/project/.spec/rules/linked-r.md", "MIXED_RULE_SNIPPET");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // detect, worker — 2 claude spawns (no prep)
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done", sessionId: "WORKER-MIXED" });
            // reviewer 1 (claude) — fresh
            s.claudeQueue.push({ text: "reviewer 1 ok", errorLog: "" });
            // reviewer 2 (codex) — fresh
            s.codexQueue.push({ text: "reviewer 2 ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, promptQueue, claudeSpawnedArgs, codexSpawnedArgs, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, promptQueue, claudeSpawnedArgs, codexSpawnedArgs, files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer 1 prompt references reviewer 1's own per-reviewer-folder error.log"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker, [2]=reviewer-claude, [3]=reviewer-codex
                Assert.ok(promptQueue[2]!.includes(reviewerErrorLogPath(1)));
            },
            "reviewer 2 prompt references reviewer 2's own per-reviewer-folder error.log"({ promptQueue }) {
                Assert.ok(promptQueue[3]!.includes(reviewerErrorLogPath(2)));
            },
            "claude reviewer is fresh — no --resume"({ claudeSpawnedArgs }) {
                // claudeSpawnedArgs: [0]=detect, [1]=worker, [2]=reviewer-claude
                Assert.ok(!claudeSpawnedArgs[2]!.includes("--resume"));
            },
            "claude reviewer is fresh — no --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[2]!.includes("--fork-session"));
            },
            "codex reviewer does NOT use the fork subcommand"({ codexSpawnedArgs }) {
                Assert.ok(!codexSpawnedArgs[0]!.includes("fork"));
            },
            "codex reviewer does NOT use the resume subcommand"({ codexSpawnedArgs }) {
                Assert.ok(!codexSpawnedArgs[0]!.includes("resume"));
            },
            "reviewer 1's own spec.md holds the linked content"({ files }) {
                const spec = files.get(reviewerRoot(1) + "/spec.md")!;
                Assert.ok(spec.includes("MIXED_CONTRACT_SNIPPET") && spec.includes("MIXED_RULE_SNIPPET"), "reviewer 1's spec.md must hold the linked content");
            },
            "reviewer 2's own spec.md holds the linked content"({ files }) {
                const spec = files.get(reviewerRoot(2) + "/spec.md")!;
                Assert.ok(spec.includes("MIXED_CONTRACT_SNIPPET") && spec.includes("MIXED_RULE_SNIPPET"), "reviewer 2's spec.md must hold the linked content");
            },
            "reviewer 1 prompt directs reading its own spec.md (in its own folder) and does not inline content"({ promptQueue }) {
                Assert.ok(promptQueue[2]!.includes(reviewerRoot(1) + "/spec.md") && !promptQueue[2]!.includes("MIXED_CONTRACT_SNIPPET"), "reviewer 1 must reference its own spec.md and not inline content");
            },
            "reviewer 2 prompt directs reading its own spec.md (in its own folder) and does not inline content"({ promptQueue }) {
                Assert.ok(promptQueue[3]!.includes(reviewerRoot(2) + "/spec.md") && !promptQueue[3]!.includes("MIXED_RULE_SNIPPET"), "reviewer 2 must reference its own spec.md and not inline content");
            },
            "reviewer 1's spec.md is in a folder not shared with reviewer 2"({ promptQueue }) {
                Assert.strictEqual(promptQueue[2]!.includes(reviewerRoot(2) + "/spec.md"), false, "reviewer 1 must not point at reviewer 2's spec.md");
            },
            "reviewer 2's spec.md is in a folder not shared with reviewer 1"({ promptQueue }) {
                Assert.strictEqual(promptQueue[3]!.includes(reviewerRoot(1) + "/spec.md"), false, "reviewer 2 must not point at reviewer 1's spec.md");
            }
        }
    });

    test("two reviewers both PASS — aggregate verdict is empty and error.log is absent", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "codex", model: "", effort: "", optional: false }
                ],
                minimumReviews: 2
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "reviewer 1 ok", errorLog: "" });
            s.codexQueue.push({ text: "reviewer 2 ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "aggregate error.log is absent on pass"(_code, { files }) {
                Assert.strictEqual(files.has(WS_ROOT + "/error.log"), false);
            },
            "reviewer.1.1.log contains Verdict: PASS"(_code, { files }) {
                Assert.ok(files.get(WS_ROOT + "/reviewer.1.1.log")!.includes("Verdict: PASS"));
            },
            "reviewer.1.2.log contains Verdict: PASS"(_code, { files }) {
                Assert.ok(files.get(WS_ROOT + "/reviewer.1.2.log")!.includes("Verdict: PASS"));
            }
        }
    });

    test("two reviewers, one FAIL and one PASS — aggregate is concat in reviewer order with newline separator", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "codex", model: "", effort: "", optional: false }
                ],
                minimumReviews: 2
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // Capture every write to the aggregate error.log path before iteration 2 overwrites it.
            const errorLogWrites:string[] = [];
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p, c) => {
                if (p === WS_ROOT + "/error.log") errorLogWrites.push(c);
                return origWriteFile(p, c);
            };
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker + reviewer 1 (FAIL) + reviewer 2 (PASS)
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "reviewer 1 fail", errorLog: "violation from reviewer 1" });
            s.codexQueue.push({ text: "reviewer 2 ok", errorLog: "" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker + reviewer 1 (PASS) + reviewer 2 (PASS)
            s.claudeQueue.push({ text: "worker iter2" });
            s.claudeQueue.push({ text: "reviewer 1 ok", errorLog: "" });
            s.codexQueue.push({ text: "reviewer 2 ok", errorLog: "" });
            return { ...s, errorLogWrites };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0 after retry"(code) {
                Assert.strictEqual(code, 0);
            },
            "reviewer 1 iter1 wrote violation"(_code, { files }) {
                Assert.ok(files.get(WS_ROOT + "/reviewer.1.1.log")!.includes("Verdict: FAIL violation from reviewer 1"));
            },
            "reviewer 2 iter1 was PASS"(_code, { files }) {
                Assert.ok(files.get(WS_ROOT + "/reviewer.1.2.log")!.includes("Verdict: PASS"));
            },
            "aggregate error.log was written exactly once (iteration-1 failure)"(_code, { errorLogWrites }) {
                Assert.strictEqual(errorLogWrites.length, 1);
            },
            "aggregate equals exactly the reviewer-1 violation (reviewer 2 contributed empty, trim drops trailing newline)"(_code, { errorLogWrites }) {
                Assert.strictEqual(errorLogWrites[0], "violation from reviewer 1");
            }
        }
    });

    test("two reviewers BOTH FAIL — aggregate equals reviewer-1\\nreviewer-2 (newline separator and reviewer order)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "codex", model: "", effort: "", optional: false }
                ],
                minimumReviews: 2
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            const errorLogWrites:string[] = [];
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p, c) => {
                if (p === WS_ROOT + "/error.log") errorLogWrites.push(c);
                return origWriteFile(p, c);
            };
            s.claudeQueue.push({ text: "ok" });
            // iter 1: both reviewers FAIL with distinct violations
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "rev1 fail", errorLog: "A1" });
            s.codexQueue.push({ text: "rev2 fail", errorLog: "B2" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: both reviewers PASS
            s.claudeQueue.push({ text: "worker iter2" });
            s.claudeQueue.push({ text: "rev1 ok", errorLog: "" });
            s.codexQueue.push({ text: "rev2 ok", errorLog: "" });
            return { ...s, errorLogWrites };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0 after retry"(code) {
                Assert.strictEqual(code, 0);
            },
            "aggregate error.log was written exactly once (iter 1 failure)"(_code, { errorLogWrites }) {
                Assert.strictEqual(errorLogWrites.length, 1);
            },
            "aggregate equals exactly 'A1\\nB2' (newline separator, reviewer order)"(_code, { errorLogWrites }) {
                Assert.strictEqual(errorLogWrites[0], "A1\nB2");
            }
        }
    });

    test("two reviewers, both files whitespace-only — aggregate trims to empty, verdict is PASS, no aggregate write", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "codex", model: "", effort: "", optional: false }
                ],
                minimumReviews: 2
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            const errorLogWrites:string[] = [];
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p, c) => {
                if (p === WS_ROOT + "/error.log") errorLogWrites.push(c);
                return origWriteFile(p, c);
            };
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            // Both reviewers produce whitespace-only content — aggregate "  \n  \n  \n  " trims to ""
            s.claudeQueue.push({ text: "rev1 ok", errorLog: "  \n  " });
            s.codexQueue.push({ text: "rev2 ok", errorLog: "  \n  " });
            return { ...s, errorLogWrites };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0 (whitespace-only files trim to empty → PASS)"(code) {
                Assert.strictEqual(code, 0);
            },
            "aggregate error.log was never written (no failure)"(_code, { errorLogWrites }) {
                Assert.strictEqual(errorLogWrites.length, 0);
            }
        }
    });

    test("absent per-reviewer error.log relaunches only that reviewer", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "claude", model: "", effort: "", optional: false }
                ],
                minimumReviews: 2
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            // reviewer 1: writes its per-reviewer-folder error.log (PASS)
            s.claudeQueue.push({ text: "reviewer 1 ok", errorLog: "" });
            // reviewer 2: does NOT write its file (absent) — must relaunch
            s.claudeQueue.push({ text: "reviewer 2 no verdict" });
            // reviewer 2 relaunch: writes its per-reviewer-folder error.log (PASS)
            s.claudeQueue.push({ text: "reviewer 2 ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "5 claude spawns: detect, worker, reviewer1, reviewer2, reviewer2-relaunch"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 5);
            }
        }
    });

    test("dispose mid-review aborts every in-flight reviewer session", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "claude", model: "", effort: "", optional: false }
                ],
                minimumReviews: 2
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            // Two reviewer spawns that never complete (held processes)
            const killed:number[] = [];
            const heldProcs:FakeProcess[] = [];
            let reviewerSpawnIdx = 0;
            const origSpawn = s.contexts.claude.spawn;
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = (cmd, args, opts) => {
                // detect (0) and worker (1) complete normally; reviewer spawns (index 2+) are held.
                if (s.claudeSpawnedArgs.length >= 2) {
                    s.claudeSpawnedArgs.push([...args]);
                    const proc = fakeProcess();
                    (proc as { stdin:{write:(c:string) => void; end:() => void} }).stdin = { write() {}, end() {} };
                    const myIdx = reviewerSpawnIdx++;
                    (proc as { kill:typeof proc.kill }).kill = () => { killed.push(myIdx); proc.$emit("exit", null, "SIGINT"); };
                    heldProcs.push(proc);
                    return proc;
                }
                return origSpawn.call(s.contexts.claude, cmd, args, opts);
            };
            return { ...s, killed, getHeldCount: () => heldProcs.length };
        },
        async ACT({ contexts, getHeldCount }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            while (getHeldCount() < 2) {
                await new Promise(r => setTimeout(r, 1));
            }
            await cmd.dispose();
            const code = await cmd.result();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "both reviewer processes received kill (SIGINT)"(_code, { killed }) {
                Assert.deepStrictEqual(killed.sort(), [0, 1]);
            }
        }
    });

    test("rate-limit on one reviewer: state transitions running→waiting→running→ok, no global waiting, metrics not frozen", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const time = controllableTime();
            (s.contexts as any).time = time.ctx;
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                // Distinct model/effort lets the test verify the reviewing footer renders the
                // configured per-reviewer fields verbatim.
                reviewers: [
                    { tool: "claude", model: "claude-opus-4-1", effort: "high", optional: false }
                ],
                minimumReviews: 1
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            type FooterSnapshot = { kind:string; reviewers?:Array<{tool:string; model:string; effort:string; state:string}> };
            const footerCalls:FooterSnapshot[] = [];
            const origSetFooter = BottomBlock.prototype.setFooter;
            BottomBlock.prototype.setFooter = function(state) {
                if (state.kind === "reviewing") {
                    footerCalls.push({ kind: state.kind, reviewers: state.reviewers.map(r => ({ tool: r.tool, model: r.model, effort: r.effort, state: r.state })) });
                } else {
                    footerCalls.push({ kind: state.kind });
                }
                origSetFooter.call(this, state);
            };
            let spawnCount = 0;
            (s.contexts.claude as any).spawn = () => {
                spawnCount++;
                const proc = fakeProcess();
                const origStdin = proc.stdin!;
                let capturedPrompt = "";
                (proc as any).stdin = {
                    write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; s.promptQueue.push(p.message.content); } } catch {} },
                    end() { origStdin.end(); }
                };
                if (spawnCount === 3) {
                    // First reviewer call (after detect + worker): rate-limit.
                    time.advance(1000);
                    setImmediate(() => {
                        proc.$emitStdout(rateLimitEvent(time.ctx.now(), 5) + "\n");
                        proc.$emit("exit", 0);
                    });
                } else {
                    time.advance(1000);
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
                        if (response.errorLog !== undefined) {
                            const target = targetErrorLogFromPrompt(capturedPrompt);
                            s.files.set(target, response.errorLog);
                        }
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    });
                }
                return proc;
            };
            s.claudeQueue.push({ text: "ok", inputTokens: 5, outputTokens: 5 });
            s.claudeQueue.push({ text: "worker", inputTokens: 50, outputTokens: 25 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 50, outputTokens: 25, errorLog: "" });
            return { s, time, footerCalls, origSetFooter };
        },
        async ACT({ s, time, origSetFooter }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                await flush();
                time.advance(5000);
                await flush();
                const code = await cmd.result();
                await cmd.dispose();
                return code;
            } finally {
                BottomBlock.prototype.setFooter = origSetFooter;
            }
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "reviewer rate-limit wait does NOT subtract from t (metrics not frozen)"({}, { s }) {
                const plan = s.files.get(COMPLETED_PLAN_PATH)!;
                // detect (1s) → 1000 (task starts here)
                // worker (1s) → 2000
                // reviewer rate-limit (1s spawn + 5s wait) → 8000
                // reviewer retry (1s) → 9000
                // active = (9000 - 1000 - 0) / 1000 = 8 (reviewer wait is NOT subtracted)
                Assert.ok(plan.includes('"t":8}'), `t should NOT exclude reviewer rate-limit wait, got: ${plan}`);
            },
            "no global waiting footer state was set during the reviewer rate-limit"({}, { footerCalls }) {
                Assert.ok(!footerCalls.some(c => c.kind === "waiting"), `expected no global waiting state, got kinds: ${footerCalls.map(c => c.kind).join(", ")}`);
            },
            "at least one reviewing footer snapshot was emitted"({}, { footerCalls }) {
                Assert.ok(footerCalls.some(c => c.kind === "reviewing"));
            },
            "every reviewing snapshot renders the configured tool/model/effort verbatim"({}, { footerCalls }) {
                const reviewingSnapshots = footerCalls.filter(c => c.kind === "reviewing");
                for (const snap of reviewingSnapshots) {
                    Assert.strictEqual(snap.reviewers!.length, 1);
                    Assert.strictEqual(snap.reviewers![0]!.tool, "claude");
                    Assert.strictEqual(snap.reviewers![0]!.model, "claude-opus-4-1");
                    Assert.strictEqual(snap.reviewers![0]!.effort, "high");
                }
            },
            "the FIRST reviewing snapshot has reviewer state = running (initial)"({}, { footerCalls }) {
                const first = footerCalls.find(c => c.kind === "reviewing");
                Assert.strictEqual(first!.reviewers![0]!.state, "running");
            },
            "at least one reviewing snapshot has reviewer state = waiting (during rate-limit)"({}, { footerCalls }) {
                const reviewingSnapshots = footerCalls.filter(c => c.kind === "reviewing");
                Assert.ok(reviewingSnapshots.some(s => s.reviewers![0]!.state === "waiting"), `expected at least one 'waiting' snapshot, got states: ${reviewingSnapshots.map(s => s.reviewers![0]!.state).join(", ")}`);
            },
            "after the waiting state, there is at least one running snapshot before the final ok"({}, { footerCalls }) {
                const reviewingSnapshots = footerCalls.filter(c => c.kind === "reviewing");
                const waitingIdx = reviewingSnapshots.findIndex(s => s.reviewers![0]!.state === "waiting");
                Assert.ok(waitingIdx >= 0, "precondition: must have a waiting snapshot");
                const tailStates = reviewingSnapshots.slice(waitingIdx + 1).map(s => s.reviewers![0]!.state);
                Assert.ok(tailStates.includes("running"), `expected 'running' after 'waiting', got tail states: ${tailStates.join(", ")}`);
            },
            "the FINAL reviewing snapshot has reviewer state = ok (verdict)"({}, { footerCalls }) {
                const reviewingSnapshots = footerCalls.filter(c => c.kind === "reviewing");
                const last = reviewingSnapshots[reviewingSnapshots.length - 1]!;
                Assert.strictEqual(last.reviewers![0]!.state, "pass");
            },
            "state transition order: running → waiting → running → ok"({}, { footerCalls }) {
                const states = footerCalls.filter(c => c.kind === "reviewing").map(s => s.reviewers![0]!.state);
                const compressed:string[] = [];
                for (const st of states) {
                    if (compressed[compressed.length - 1] !== st) compressed.push(st);
                }
                Assert.deepStrictEqual(compressed, ["running", "waiting", "running", "pass"]);
            }
        }
    });

    test("a rate-limited reviewer carries its endTime into the reviewing footer entry", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const time = controllableTime();
            (s.contexts as any).time = time.ctx;
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [
                    { tool: "claude", model: "claude-opus-4-1", effort: "high", optional: false }
                ],
                minimumReviews: 1
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // Capture the full ReviewerEntry of every reviewing snapshot (preserving
            // endTime) so the test can assert the end time the production path carries
            // into BottomBlock. The rendered terminal output (s.written) is asserted
            // below too, so the test pins both the structured endTime and that it
            // renders as this reviewer's compact countdown in the live reviewing footer.
            type FooterSnapshot = { kind:string; reviewers?:ReviewerEntry[] };
            const footerCalls:FooterSnapshot[] = [];
            const origSetFooter = BottomBlock.prototype.setFooter;
            BottomBlock.prototype.setFooter = function(state) {
                if (state.kind === "reviewing") {
                    footerCalls.push({ kind: state.kind, reviewers: state.reviewers.map(r => ({ ...r })) });
                } else {
                    footerCalls.push({ kind: state.kind });
                }
                origSetFooter.call(this, state);
            };
            let spawnCount = 0;
            (s.contexts.claude as any).spawn = () => {
                spawnCount++;
                const proc = fakeProcess();
                const origStdin = proc.stdin!;
                let capturedPrompt = "";
                (proc as any).stdin = {
                    write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; s.promptQueue.push(p.message.content); } } catch {} },
                    end() { origStdin.end(); }
                };
                if (spawnCount === 3) {
                    // First reviewer call (after detect + worker): rate-limit. now=3000 at
                    // emission, retryAfter 5s → resetsAt 8 → waitUntilMs (endTime) 8000.
                    time.advance(1000);
                    setImmediate(() => {
                        proc.$emitStdout(rateLimitEvent(time.ctx.now(), 5) + "\n");
                        proc.$emit("exit", 0);
                    });
                } else {
                    time.advance(1000);
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
                        if (response.errorLog !== undefined) {
                            const target = targetErrorLogFromPrompt(capturedPrompt);
                            s.files.set(target, response.errorLog);
                        }
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    });
                }
                return proc;
            };
            s.claudeQueue.push({ text: "ok", inputTokens: 5, outputTokens: 5 });
            s.claudeQueue.push({ text: "worker", inputTokens: 50, outputTokens: 25 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 50, outputTokens: 25, errorLog: "" });
            return { s, time, footerCalls, origSetFooter };
        },
        async ACT({ s, time, origSetFooter }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
                await flush();
                time.advance(5000);
                await flush();
                const code = await cmd.result();
                await cmd.dispose();
                return code;
            } finally {
                BottomBlock.prototype.setFooter = origSetFooter;
            }
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the waiting reviewing snapshot carries the reviewer's rate-limit endTime"(_code, { footerCalls }) {
                const waiting = footerCalls.filter(c => c.kind === "reviewing").find(c => c.reviewers![0]!.state === "waiting");
                Assert.ok(waiting, "expected a waiting reviewing snapshot");
                Assert.strictEqual(waiting!.reviewers![0]!.endTime, 8000);
            },
            "non-waiting reviewing snapshots carry no endTime"(_code, { footerCalls }) {
                const nonWaiting = footerCalls.filter(c => c.kind === "reviewing").filter(c => c.reviewers![0]!.state !== "waiting");
                Assert.ok(nonWaiting.length > 0, "expected non-waiting reviewing snapshots");
                for (const snap of nonWaiting) {
                    Assert.strictEqual(snap.reviewers![0]!.endTime, undefined);
                }
            },
            "the rendered reviewing footer shows this reviewer's compact countdown"(_code, { s }) {
                // onLongWaitStart fires at now=3000 with endTime=8000, so the live footer
                // renders remaining=5000ms as formatCompactCountdown → the compact "1m"
                // (not the verbose "1 minutes"). Asserting this reviewer's reviewing-footer
                // entry ties the countdown to it; a regression that dropped the endTime would
                // render the bare "waiting" without the " 1m" suffix and fail. The leading
                // animated indicator sits at the start of the line, before the `review: `
                // prefix, so the assertion matches the entry itself rather than the whole line.
                const rendered = stripAnsi(s.written.join(""));
                Assert.ok(
                    rendered.includes("claude (claude-opus-4-1 high): waiting 1m"),
                    `expected the rendered footer to show this reviewer's compact countdown, got: ${rendered}`
                );
            }
        }
    });

    test("FAIL verdict surfaces as reviewer state = fail in the final reviewing snapshot", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [{ tool: "claude", model: "", effort: "", optional: false }],
                minimumReviews: 1
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            type FooterSnapshot = { kind:string; reviewers?:Array<{state:string}> };
            const footerCalls:FooterSnapshot[] = [];
            const origSetFooter = BottomBlock.prototype.setFooter;
            BottomBlock.prototype.setFooter = function(state) {
                if (state.kind === "reviewing") {
                    footerCalls.push({ kind: state.kind, reviewers: state.reviewers.map(r => ({ state: r.state })) });
                } else {
                    footerCalls.push({ kind: state.kind });
                }
                origSetFooter.call(this, state);
            };
            s.claudeQueue.push({ text: "ok" });
            // iter 1: reviewer FAIL
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "reviewer fail", errorLog: "violation" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { ...s, footerCalls, origSetFooter };
        },
        async ACT({ contexts, origSetFooter }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
                const code = await cmd.result();
                await cmd.dispose();
                return code;
            } finally {
                BottomBlock.prototype.setFooter = origSetFooter;
            }
        },
        ASSERTS: {
            "exits 0 after iter-2 PASS"(code) {
                Assert.strictEqual(code, 0);
            },
            "at least one reviewing snapshot shows reviewer state = fail (the iter-1 verdict)"(_code, { footerCalls }) {
                const reviewingSnapshots = footerCalls.filter(c => c.kind === "reviewing");
                Assert.ok(reviewingSnapshots.some(s => s.reviewers![0]!.state === "fail"), `expected at least one 'fail' snapshot, got states: ${reviewingSnapshots.map(s => s.reviewers![0]!.state).join(", ")}`);
            },
            "the iter-2 final reviewing snapshot is 'ok' (the iter-2 verdict)"(_code, { footerCalls }) {
                const reviewingSnapshots = footerCalls.filter(c => c.kind === "reviewing");
                const last = reviewingSnapshots[reviewingSnapshots.length - 1]!;
                Assert.strictEqual(last.reviewers![0]!.state, "pass");
            }
        }
    });

    test("transient retryable error on a reviewer leaves the reviewer at running (no waiting state)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const time = controllableTime();
            (s.contexts as any).time = time.ctx;
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [{ tool: "claude", model: "", effort: "", optional: false }],
                minimumReviews: 1
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            type FooterSnapshot = { kind:string; reviewers?:Array<{state:string}> };
            const footerCalls:FooterSnapshot[] = [];
            const origSetFooter = BottomBlock.prototype.setFooter;
            BottomBlock.prototype.setFooter = function(state) {
                if (state.kind === "reviewing") {
                    footerCalls.push({ kind: state.kind, reviewers: state.reviewers.map(r => ({ state: r.state })) });
                } else {
                    footerCalls.push({ kind: state.kind });
                }
                origSetFooter.call(this, state);
            };
            let spawnCount = 0;
            (s.contexts.claude as any).spawn = () => {
                spawnCount++;
                const proc = fakeProcess();
                const origStdin = proc.stdin!;
                let capturedPrompt = "";
                (proc as any).stdin = {
                    write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; s.promptQueue.push(p.message.content); } } catch {} },
                    end() { origStdin.end(); }
                };
                if (spawnCount === 3) {
                    // First reviewer call: transient 503 (retryable, NOT a rate_limit).
                    time.advance(1000);
                    setImmediate(() => {
                        proc.$emitStdout(JSON.stringify({
                            type: "result",
                            is_error: true,
                            api_error_status: 503,
                            error: { message: "service unavailable" }
                        }) + "\n");
                        proc.$emit("exit", 1);
                    });
                } else {
                    time.advance(1000);
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
                        if (response.errorLog !== undefined) {
                            const target = targetErrorLogFromPrompt(capturedPrompt);
                            s.files.set(target, response.errorLog);
                        }
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    });
                }
                return proc;
            };
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return { ...s, footerCalls, origSetFooter, time };
        },
        async ACT({ contexts, time, origSetFooter }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
                await flush();
                time.advance(1100); // wait past the 1s transient backoff
                await flush();
                const code = await cmd.result();
                await cmd.dispose();
                return code;
            } finally {
                BottomBlock.prototype.setFooter = origSetFooter;
            }
        },
        ASSERTS: {
            "exits 0 after transient retry"(code) {
                Assert.strictEqual(code, 0);
            },
            "no reviewing snapshot has reviewer state = waiting during a transient backoff"({}, { footerCalls }) {
                const reviewingSnapshots = footerCalls.filter(c => c.kind === "reviewing");
                Assert.ok(!reviewingSnapshots.some(s => s.reviewers![0]!.state === "waiting"), `transient backoff must not surface as 'waiting'; got states: ${reviewingSnapshots.map(s => s.reviewers![0]!.state).join(", ")}`);
            },
            "no global waiting footer state during the transient backoff"({}, { footerCalls }) {
                Assert.ok(!footerCalls.some(c => c.kind === "waiting"));
            },
            "the final reviewing snapshot is ok (after the transient retry succeeded)"({}, { footerCalls }) {
                const reviewingSnapshots = footerCalls.filter(c => c.kind === "reviewing");
                const last = reviewingSnapshots[reviewingSnapshots.length - 1]!;
                Assert.strictEqual(last.reviewers![0]!.state, "pass");
            }
        }
    });

    test("reviewer that finishes early flips to ok WHILE another reviewer is still in flight", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "claude", model: "", effort: "", optional: false }
                ],
                minimumReviews: 2
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            type FooterSnapshot = { kind:string; reviewers?:Array<{state:string}> };
            const footerCalls:FooterSnapshot[] = [];
            const origSetFooter = BottomBlock.prototype.setFooter;
            BottomBlock.prototype.setFooter = function(state) {
                if (state.kind === "reviewing") {
                    footerCalls.push({ kind: state.kind, reviewers: state.reviewers.map(r => ({ state: r.state })) });
                } else {
                    footerCalls.push({ kind: state.kind });
                }
                origSetFooter.call(this, state);
            };
            let releaseReviewer2:(() => void)|null = null;
            const reviewer2HeldGate = new Promise<void>(resolve => {
                releaseReviewer2 = resolve;
            });
            (s.contexts.claude as any).spawn = (_command:string, args:readonly string[]) => {
                s.claudeSpawnedArgs.push([...args]);
                const proc = fakeProcess();
                const origStdin = proc.stdin!;
                let capturedPrompt = "";
                (proc as any).stdin = {
                    write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; s.promptQueue.push(p.message.content); } } catch {} },
                    end() { origStdin.end(); }
                };
                // The reviewer 2 prompt is the only one whose error log placeholder lives in
                // reviewer 2's own per-reviewer folder. For that prompt we hold the spawn open
                // until the test fires the gate. Every other spawn (detect, worker,
                // reviewer 1) completes immediately.
                setImmediate(() => {
                    const promptIsReviewer2 = capturedPrompt.includes(reviewerErrorLogPath(2));
                    if (promptIsReviewer2) {
                        // Hold reviewer 2 in flight until the test releases the gate.
                        reviewer2HeldGate.then(() => {
                            // After release, reviewer 2 produces an empty per-reviewer error.log and exits.
                            s.files.set(reviewerErrorLogPath(2), "");
                            proc.$emitStdout(claudeResultEvents("rev2 ok"));
                            proc.$emit("exit", 0);
                        });
                        return;
                    }
                    const response = s.claudeQueue.shift()!;
                    if (response.errorLog !== undefined) {
                        const target = targetErrorLogFromPrompt(capturedPrompt);
                        s.files.set(target, response.errorLog);
                    }
                    proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                    proc.$emit("exit", 0);
                });
                return proc;
            };
            s.claudeQueue.push({ text: "ok" });                       // detect
            s.claudeQueue.push({ text: "worker done" });              // worker
            s.claudeQueue.push({ text: "rev1 ok", errorLog: "" });    // reviewer 1 — fast PASS
            return { ...s, footerCalls, origSetFooter, getRelease: () => releaseReviewer2! };
        },
        async ACT({ contexts, origSetFooter, getRelease, footerCalls }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
                // Spin until reviewer 1 has emitted its ok snapshot AND reviewer 2 is still pending.
                let snapshotWhileR2InFlight:Array<{state:string}>|null = null;
                for (let i = 0; i < 200; i++) {
                    await new Promise(r => setImmediate(r));
                    const lastReviewing = [...footerCalls].reverse().find(c => c.kind === "reviewing");
                    if (lastReviewing
                        && lastReviewing.reviewers![0]!.state === "pass"
                        && lastReviewing.reviewers![1]!.state === "running") {
                        snapshotWhileR2InFlight = lastReviewing.reviewers!;
                        break;
                    }
                }
                // Now release reviewer 2 so the run can complete.
                getRelease()();
                const code = await cmd.result();
                await cmd.dispose();
                return { code, snapshotWhileR2InFlight };
            } finally {
                BottomBlock.prototype.setFooter = origSetFooter;
            }
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer 1 flipped to ok while reviewer 2 was still running"({ snapshotWhileR2InFlight }) {
                Assert.notStrictEqual(snapshotWhileR2InFlight, null);
                Assert.deepStrictEqual(snapshotWhileR2InFlight, [{ state: "pass" }, { state: "running" }]);
            },
            "final reviewing snapshot is ['ok','ok'] after reviewer 2 completes"({}, { footerCalls }) {
                const reviewingSnapshots = footerCalls.filter(c => c.kind === "reviewing");
                const last = reviewingSnapshots[reviewingSnapshots.length - 1]!;
                Assert.deepStrictEqual(last.reviewers, [{ state: "pass" }, { state: "pass" }]);
            }
        }
    });
});

type ReviewerAction = { rateLimit:number } | { verdict:string };

// A controllable-time harness for the weighted-review round-completion tests. The worker and the
// reviewers are all claude, so every spawn is a claude spawn handled here: detect and worker draw from claudeQueue,
// while each reviewer is identified by which per-reviewer error-log path its prompt references and
// driven by its own ordered action list. `{ rateLimit }` makes the invocation emit a usage-limit
// (rate_limit) event so the reviewer enters the `waiting` status; `{ verdict }` writes that reviewer's
// per-reviewer error.log and completes. A reviewer's actions are consumed in order across the runner's
// own rate-limit retries (a rate-limited invocation re-invokes after its wait clears).
function weightedReviewStub(reviewerActions:ReviewerAction[][]) {
    const s = stubContexts();
    gitRunQueue(s.gitQueue);
    const time = controllableTime();
    (s.contexts as { time:TimeContext }).time = time.ctx;
    s.files.set(PLAN_PATH, PLAN_ONE_TASK);
    const invocation:number[] = reviewerActions.map(() => 0);
    (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = (_command:string, args:readonly string[]) => {
        s.claudeSpawnedArgs.push([...args]);
        const proc = fakeProcess();
        const origStdin = proc.stdin!;
        let capturedPrompt = "";
        (proc as { stdin:{ write:(c:string) => void; end:() => void } }).stdin = {
            write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; s.promptQueue.push(p.message.content); } } catch {} },
            end() { origStdin.end(); }
        };
        setImmediate(() => {
            let reviewerIdx = -1;
            for (let i = 0; i < reviewerActions.length; i++) {
                if (capturedPrompt.includes(reviewerErrorLogPath(i + 1))) { reviewerIdx = i; break; }
            }
            if (reviewerIdx === -1) {
                const response = s.claudeQueue.shift()!;
                proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                proc.$emit("exit", 0);
                return;
            }
            const inv = invocation[reviewerIdx]!;
            invocation[reviewerIdx] = inv + 1;
            const action = reviewerActions[reviewerIdx]![inv]!;
            if ("rateLimit" in action) {
                proc.$emitStdout(rateLimitEvent(time.ctx.now(), action.rateLimit) + "\n");
                proc.$emit("exit", 0);
            } else {
                s.files.set(reviewerErrorLogPath(reviewerIdx + 1), action.verdict);
                proc.$emitStdout(claudeResultEvents("reviewer verdict"));
                proc.$emit("exit", 0);
            }
        });
        return proc;
    };
    return { s, time };
}

test.describe("Implement weighted-review round completion", test => {
    test("optional reviewer in a usage-limit wait is cancelled and excluded once the required reviewer's verdict meets the minimum", {
        ARRANGE() {
            // R0 required → PASS. R1 optional → enters a usage-limit wait and never clears on its own.
            const { s } = weightedReviewStub([
                [{ verdict: "" }],
                [{ rateLimit: 3600 }]
            ]);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "w", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "claude", model: "", effort: "", optional: true }
                ],
                minimumReviews: 1
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "worker" });
            return { s };
        },
        async ACT({ s }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, files: s.files };
        },
        ASSERTS: {
            "exits 0 (round completes without the cancelled optional reviewer)"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the cancelled optional reviewer produced no per-reviewer verdict file"({ files }) {
                Assert.strictEqual(files.has(reviewerErrorLogPath(2)), false);
            },
            "the cancelled optional reviewer wrote no per-reviewer output log (never ran to a verdict)"({ files }) {
                Assert.strictEqual(files.has(WS_ROOT + "/reviewer.1.2.log"), false);
            },
            "the required reviewer ran to a PASS verdict"({ files }) {
                Assert.ok(files.get(WS_ROOT + "/reviewer.1.1.log")!.includes("Verdict: PASS"));
            },
            "the aggregate briefing error.log is absent (the round passed)"({ files }) {
                Assert.strictEqual(files.has(WS_ROOT + "/error.log"), false);
            }
        }
    });

    test("optional reviewer is NOT cancelled while a required reviewer is still waiting, and contributes its verdict when its own wait clears first", {
        ARRANGE() {
            // Both enter a usage-limit wait. R1 (optional) clears first (10s) and runs to a verdict
            // while R0 (required) is still counting down its longer wait (100s); R0 then clears too.
            const { s, time } = weightedReviewStub([
                [{ rateLimit: 100 }, { verdict: "" }],
                [{ rateLimit: 10 }, { verdict: "" }]
            ]);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "w", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "claude", model: "", effort: "", optional: true }
                ],
                minimumReviews: 1
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "worker" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            time.advance(10000); // R1 (optional) wait clears first; R0 (required) still waiting
            await flush();
            time.advance(90000); // R0 (required) wait clears
            await flush();
            const code = await cmd.result();
            await cmd.dispose();
            return { code, files: s.files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the optional reviewer was not cancelled — it ran to a PASS verdict"({ files }) {
                Assert.ok(files.get(WS_ROOT + "/reviewer.1.2.log")!.includes("Verdict: PASS"));
            },
            "the required reviewer ran to a PASS verdict"({ files }) {
                Assert.ok(files.get(WS_ROOT + "/reviewer.1.1.log")!.includes("Verdict: PASS"));
            },
            "the optional reviewer's per-reviewer verdict file is present (it contributed)"({ files }) {
                Assert.strictEqual(files.has(reviewerErrorLogPath(2)), true);
            }
        }
    });

    test("a required reviewer in a usage-limit wait is never cancelled — the round waits it out", {
        ARRANGE() {
            // R0 optional → fast PASS. R1 required → enters a usage-limit wait, then clears and PASSes.
            const { s, time } = weightedReviewStub([
                [{ verdict: "" }],
                [{ rateLimit: 50 }, { verdict: "" }]
            ]);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "w", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: true },
                    { tool: "claude", model: "", effort: "", optional: false }
                ],
                minimumReviews: 1
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "worker" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            time.advance(50000); // required reviewer's wait clears; the round must have waited for it
            await flush();
            const code = await cmd.result();
            await cmd.dispose();
            return { code, files: s.files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the required reviewer was waited out — it ran to a PASS verdict"({ files }) {
                Assert.ok(files.get(WS_ROOT + "/reviewer.1.2.log")!.includes("Verdict: PASS"));
            },
            "the required reviewer's per-reviewer verdict file is present (never cancelled)"({ files }) {
                Assert.strictEqual(files.has(reviewerErrorLogPath(2)), true);
            }
        }
    });

    test("the minimum gates completion — with all reviewers optional the round waits until minimumReviews verdicts exist before cancelling the rest", {
        ARRANGE() {
            // All three optional, minimumReviews 2. R0 PASSes immediately (1 verdict — below the
            // minimum, so no cancellation yet). R1 enters a wait, then clears and PASSes (2nd verdict
            // → minimum met). R2 stays in its wait the whole time and is cancelled once the minimum is met.
            const { s, time } = weightedReviewStub([
                [{ verdict: "" }],
                [{ rateLimit: 50 }, { verdict: "" }],
                [{ rateLimit: 3600 }]
            ]);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "w", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: true },
                    { tool: "claude", model: "", effort: "", optional: true },
                    { tool: "claude", model: "", effort: "", optional: true }
                ],
                minimumReviews: 2
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "worker" });
            return { s, time };
        },
        async ACT({ s, time }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            await flush();
            time.advance(50000); // R1's wait clears → 2nd verdict → minimum met → R2 cancelled
            await flush();
            const code = await cmd.result();
            await cmd.dispose();
            return { code, files: s.files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the reviewer whose wait cleared before the minimum was met ran to a PASS verdict (not cancelled early)"({ files }) {
                Assert.ok(files.get(WS_ROOT + "/reviewer.1.2.log")!.includes("Verdict: PASS"));
            },
            "the immediately-passing reviewer ran to a PASS verdict"({ files }) {
                Assert.ok(files.get(WS_ROOT + "/reviewer.1.1.log")!.includes("Verdict: PASS"));
            },
            "the reviewer still waiting once the minimum was met was cancelled — no verdict file"({ files }) {
                Assert.strictEqual(files.has(reviewerErrorLogPath(3)), false);
            },
            "the cancelled reviewer wrote no per-reviewer output log"({ files }) {
                Assert.strictEqual(files.has(WS_ROOT + "/reviewer.1.3.log"), false);
            }
        }
    });

    test("a reviewer that errors (not a cancellation) still fails the stage and writes the briefing, even when the reviewer is optional", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "w", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "", optional: false },
                    { tool: "claude", model: "", effort: "", optional: true }
                ],
                minimumReviews: 1
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            const errorLogWrites:string[] = [];
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p, c) => {
                if (p === WS_ROOT + "/error.log") errorLogWrites.push(c);
                return origWriteFile(p, c);
            };
            // iter 1: worker, R0 (required) PASS, R1 (optional) errors with a non-retryable spawn error.
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "rev0 ok", errorLog: "" });
            s.claudeQueue.push({ text: "rev1 err", error: true });
            // iter 2: worker, both reviewers PASS.
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "rev0 ok", errorLog: "" });
            s.claudeQueue.push({ text: "rev1 ok", errorLog: "" });
            return { ...s, errorLogWrites };
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0 after the iter-2 retry"(code) {
                Assert.strictEqual(code, 0);
            },
            "the optional reviewer's error failed the stage and wrote the reviewer-stage briefing"(_code, { errorLogWrites }) {
                Assert.ok(errorLogWrites.some(w => w.startsWith("reviewer stage failed: ")), `expected a reviewer-stage failure briefing; got writes: ${JSON.stringify(errorLogWrites)}`);
            },
            "the iteration was rerun (iter-2 review ran), proving the error was not silently dropped as a cancellation"(_code, { files }) {
                Assert.strictEqual(files.has(WS_ROOT + "/reviewer.2.1.log"), true);
            }
        }
    });
});
