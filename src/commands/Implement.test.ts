import * as Assert from "assert";

import test from "arrange-act-assert";

import { Implement } from "./Implement";
import type { ImplementContexts } from "./Implement";
import type { FlandersConfig } from "../workspace/FlandersConfig";
import type { SpawnedProcess, TimeContext, TimeoutHandle } from "../contexts";
import { BottomBlock } from "../ui/BottomBlock";
import type { HeaderFields, MetricsFields, TerminalLabel } from "../ui/BottomBlock";
import { CYAN, YELLOW, MAGENTA, GREEN, BLUE, DIM, SEPARATOR_GLYPH, stripAnsi } from "../ui/formatters";

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
type CodexResponse = { text:string; sessionId?:string; error?:true; errorLog?:string };
type ScriptResponse = { code:number; stdout:string; stderr:string };

function codexResultEvents(text:string, sessionId?:string):string {
    let out = "";
    if (sessionId) {
        out += JSON.stringify({ type: "thread.started", thread_id: sessionId }) + "\n";
    }
    out += JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }) + "\n";
    out += JSON.stringify({ type: "turn.completed" }) + "\n";
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
                            proc.$emitStdout(codexResultEvents(response.text, response.sessionId));
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
const PLAN_ONE_TASK = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Implement feature A\n';
const WS_ROOT = "/tmp/flanders-ws123";
function reviewerRoot(n:number):string { return `/tmp/flanders-rev${n}`; }
function reviewerErrorLogPath(n:number):string { return `${reviewerRoot(n)}/error.log`; }
function targetErrorLogFromPrompt(capturedPrompt:string):string {
    const m = capturedPrompt.match(/(\/tmp\/flanders-rev\d+)\/error\.log/);
    return m ? `${m[1]}/error.log` : `${WS_ROOT}/error.log`;
}
const PREP_RESPONSE:ClaudeResponse = { text: "READY", sessionId: "prep-session" };
const DEFAULT_CONFIG:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "" }] };
const CONFIG_PATH = "/project/.flanders/config.json";

test.describe("Implement per-iteration logs", test => {
    test("writes all four log files after one successful iteration", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "No build or test scripts needed." });
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep runs once per task, before the iteration loop
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                Assert.ok(stripped.includes("Failed"));
            }
        }
    });

    test("valid project-scope config proceeds and is stashed on instance", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const projectConfig:FlandersConfig = { worker: { tool: "codex", model: "test-model", effort: "high" }, reviewers: [{ tool: "claude", model: "rev-model", effort: "low" }] };
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
            const projectConfig:FlandersConfig = { worker: { tool: "claude", model: "project-sentinel", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "" }] };
            const globalConfig:FlandersConfig = { worker: { tool: "codex", model: "global-sentinel", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(projectConfig));
            s.files.set("/home/test/.flanders/config.json", JSON.stringify(globalConfig));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push(PREP_RESPONSE);
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
                Assert.ok(stripped.includes("Failed"));
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
                Assert.ok(stripAnsi(written.join("")).includes("Failed"));
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
            "noop metrics plan pair has accumulated values"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 1, "need at least 1 metrics call");
                Assert.deepStrictEqual(metricsCalls[0]!.plan, { tokens: 150, seconds: 5 });
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            "first metrics call has zero plan pair"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 1, "need at least 1 metrics call");
                Assert.deepStrictEqual(metricsCalls[0]!.plan, { tokens: 0, seconds: 0 });
            },
            "footer shows Working in output"(_result, { s }) {
                const allOutput = s.written.join("");
                Assert.ok(allOutput.includes("Working"), "footer should show Working label");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            Assert.ok(allOutput.includes("Working"), "footer should contain Working label");
            Assert.ok(allOutput.includes(ANSI_RESET), "footer should contain reset escape");
        }
    });

    test("animation is stopped when block is unmounted (no lingering timers)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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

function rateLimitStub(rateLimitOnSpawn:number, retryAfterSeconds:number) {
    const s = stubContexts();
    gitRunQueue(s.gitQueue);
    const time = controllableTime();
    (s.contexts as any).time = time.ctx;
    s.files.set(PLAN_PATH, PLAN_ONE_TASK);
    let spawnCount = 0;
    (s.contexts.claude as any).spawn = (_command:string, args:readonly string[]) => {
        s.claudeSpawnedArgs.push([...args]);
        spawnCount++;
        const proc = fakeProcess();
        const origStdin = proc.stdin!;
        let capturedPrompt = "";
        (proc as any).stdin = {
            write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { capturedPrompt = p.message.content; s.promptQueue.push(p.message.content); } } catch {} },
            end() { origStdin.end(); }
        };
        if (spawnCount === rateLimitOnSpawn) {
            setImmediate(() => {
                proc.$emitStdout(rateLimitEvent(time.ctx.now(), retryAfterSeconds) + "\n");
                proc.$emit("exit", 0);
            });
        } else {
            const response = s.claudeQueue.shift();
            if (!response) {
                setImmediate(() => proc.$emit("error", new Error("claude queue exhausted")));
                return proc;
            }
            setImmediate(() => {
                if (response.errorLog !== undefined) {
                    const target = targetErrorLogFromPrompt(capturedPrompt);
                    s.files.set(target, response.errorLog);
                }
                if (response.stderr) {
                    proc.$emitStderr(response.stderr);
                }
                proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                proc.$emit("exit", 0);
            });
        }
        return proc;
    };
    return { s, time };
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                Assert.ok(afterPortion.includes("Working"));
            }
        }
    });

    test("Working animation does not fire during rate-limit wait", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 10);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
});

test.describe("Implement preparing stage header and footer", test => {
    test("prep-active task: header/footer are preparing while the prep call is in flight and switch to implementing/Working at the worker stage", {
        ARRANGE() {
            // DEFAULT_CONFIG: worker and the single reviewer are both {claude,"",""} → prep is active.
            // A numbered plan so the prep header exercises index, plan number and title together.
            // The prep (spawn 2) and the worker (spawn 3) are held so the live state is observed mid-call.
            const numberedPlan = '# Plan\n\n## 3. Section\n\n### 3.2 Subsection\n\n- [ ]{"it":0,"ot":0,"t":0} Do the thing\n';
            const gated = gatedClaudeStub(numberedPlan);
            gated.hold(2, 3);
            gated.s.claudeQueue.push({ text: "ok" });            // detect (spawn 1)
            gated.s.claudeQueue.push(PREP_RESPONSE);             // prep (spawn 2, held)
            gated.s.claudeQueue.push({ text: "worker" });        // worker (spawn 3, held)
            gated.s.claudeQueue.push({ text: "reviewer ok", errorLog: "" }); // reviewer (spawn 4)
            const { footerKinds, restore } = recordFooterKinds();
            return { gated, footerKinds, restore };
        },
        async ACT({ gated, footerKinds, restore }) {
            try {
                const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, gated.s.contexts);
                await flush();
                const outputDuringPrep = gated.s.written.join("");
                const footerKindsDuringPrep = [...footerKinds];
                gated.release(2);
                await flush();
                const outputDuringWorker = gated.s.written.join("");
                const footerKindsAtWorker = [...footerKinds];
                gated.release(3);
                const code = await cmd.result();
                await cmd.dispose();
                return { code, outputDuringPrep, footerKindsDuringPrep, outputDuringWorker, footerKindsAtWorker };
            } finally {
                restore();
            }
        },
        ASSERTS: {
            "exits successfully"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "while the prep call is in flight the header is the contiguous '<index> preparing <plan number> <title>' with no iter token"({ outputDuringPrep }) {
                Assert.ok(
                    stripAnsi(outputDuringPrep).includes("1/1 preparing 3.2 Do the thing"),
                    "prep header should show index, preparing, plan number and title with a blank iteration field while the prep runs"
                );
            },
            "while the prep call is in flight the live footer line shows the Preparing label"({ outputDuringPrep }) {
                const footerLine = stripAnsi(outputDuringPrep.split("\n").pop() ?? "");
                Assert.ok(footerLine.endsWith("Preparing"), `live footer during prep should end with 'Preparing', got: ${JSON.stringify(footerLine)}`);
            },
            "while the prep call is in flight the only footer state set is preparing"({ footerKindsDuringPrep }) {
                Assert.deepStrictEqual(footerKindsDuringPrep, ["preparing"]);
            },
            "while the worker call is in flight the header shows 'iter 1 implementing' for the same task"({ outputDuringWorker }) {
                Assert.ok(
                    stripAnsi(outputDuringWorker).includes("1/1 iter 1 implementing 3.2 Do the thing"),
                    "worker-stage header should show iter 1 and the implementing activity while the worker runs"
                );
            },
            "while the worker call is in flight the live footer line shows the Working label"({ outputDuringWorker }) {
                const footerLine = stripAnsi(outputDuringWorker.split("\n").pop() ?? "");
                Assert.ok(footerLine.endsWith("Working"), `live footer at worker start should end with 'Working', got: ${JSON.stringify(footerLine)}`);
            },
            "the footer state transitioned exactly preparing→working by the time the worker stage begins"({ footerKindsAtWorker }) {
                Assert.deepStrictEqual(footerKindsAtWorker, ["preparing", "working"]);
            }
        }
    });

    test("prep-skipped task: the worker stage runs at implementing/iter 1 with the Working footer and no preparing state ever appears", {
        ARRANGE() {
            // Reviewer tool (codex) differs from the worker (claude) → no reviewer matches → prep skipped.
            // The worker (claude spawn 2; spawn 1 is detect, no prep) is held so the live state is observed mid-call.
            const gated = gatedClaudeStub(PLAN_ONE_TASK);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "" }] };
            gated.s.files.set(CONFIG_PATH, JSON.stringify(config));
            gated.hold(2);
            gated.s.claudeQueue.push({ text: "ok" });        // detect (spawn 1)
            gated.s.claudeQueue.push({ text: "worker" });     // worker (spawn 2, held)
            gated.s.codexQueue.push({ text: "reviewer ok", errorLog: "" }); // reviewer (codex)
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
                Assert.ok(!fullOutput.includes("Preparing"), "no Preparing footer should be rendered when prep is skipped");
            },
            "the preparing activity never appears in the header"({ fullOutput }) {
                Assert.ok(!stripAnsi(fullOutput).includes("preparing"), "no preparing activity should be shown when prep is skipped");
            },
            "the footer never enters the preparing state"({ footerKinds }) {
                Assert.ok(!footerKinds.includes("preparing"), `footer kinds should not include preparing, got: ${footerKinds.join(", ")}`);
            },
            "while the worker call is in flight the header shows 'iter 1 implementing' for the first task"({ outputDuringWorker }) {
                Assert.ok(
                    stripAnsi(outputDuringWorker).includes("1/1 iter 1 implementing Implement feature A"),
                    "first activity should be implementing with iter 1"
                );
            },
            "no footer state is set before the worker stage — the footer stays the initial Working render"({ footerKindsAtWorker }) {
                Assert.deepStrictEqual(footerKindsAtWorker, []);
            },
            "while the worker call is in flight the live footer line shows the Working label"({ outputDuringWorker }) {
                const footerLine = stripAnsi(outputDuringWorker.split("\n").pop() ?? "");
                Assert.ok(footerLine.endsWith("Working"), `live footer at worker start should end with 'Working', got: ${JSON.stringify(footerLine)}`);
            }
        }
    });

    test("a rate-limit wait that ends during the prep stage returns the footer to Preparing, not Working", {
        ARRANGE() {
            // Rate-limit fires on spawn 2 = the prep call (spawn 1 is detect). Prep is active under DEFAULT_CONFIG.
            const { s, time } = rateLimitStub(2, 300);
            s.claudeQueue.push({ text: "ok" });            // detect (spawn 1)
            s.claudeQueue.push(PREP_RESPONSE);             // prep retry (spawn 3)
            s.claudeQueue.push({ text: "worker" });        // worker (spawn 4)
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" }); // reviewer (spawn 5)
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
            "the footer set when the prep-stage wait ends is preparing"({ footerKinds }) {
                const waitingIdx = footerKinds.indexOf("waiting");
                Assert.ok(waitingIdx >= 0, "precondition: a waiting footer was set during the prep rate-limit");
                Assert.strictEqual(footerKinds[waitingIdx + 1], "preparing");
            }
        }
    });

    test("a rate-limit wait that ends during the worker stage returns the footer to Working", {
        ARRANGE() {
            // Rate-limit fires on spawn 3 = the worker call (spawn 1 detect, spawn 2 prep). Prep is active under DEFAULT_CONFIG.
            const { s, time } = rateLimitStub(3, 300);
            s.claudeQueue.push({ text: "ok" });            // detect (spawn 1)
            s.claudeQueue.push(PREP_RESPONSE);             // prep (spawn 2)
            s.claudeQueue.push({ text: "worker" });        // worker retry (spawn 4)
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" }); // reviewer (spawn 5)
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
            // prep runs once per task, before the iteration loop
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = files.get(PLAN_PATH)!;
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = files.get(PLAN_PATH)!;
            Assert.ok(plan.includes('[x]{"it":390,"ot":180,"t":0}'), `plan should accumulate across iterations, got: ${plan}`);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = files.get(PLAN_PATH)!;
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = s.files.get(PLAN_PATH)!;
            // _taskStartedAt is captured at the start of _runTask (after the detect spawn), so only
            // spawns within the task count. Each script spawn advances 4000; the post-worker git add -A
            // is now one such spawn. Within the task: prep (+3000), worker (+2000),
            // post-worker git add -A (+4000), build (+4000); the reviewer spawn does not advance.
            // active = (3000 + 2000 + 4000 + 4000) / 1000 = 13.
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
                if (spawnCount === 3) {
                    time.advance(1000);
                    setImmediate(() => {
                        proc.$emitStdout(rateLimitEvent(time.ctx.now(), 10) + "\n");
                        proc.$emit("exit", 1);
                    });
                } else {
                    const advance = spawnCount === 1 ? 2000 : spawnCount === 5 ? 2000 : 1000;
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = s.files.get(PLAN_PATH)!;
            // detect spawn(1): time→2000. Task starts: _taskStartedAt=2000
            // prep spawn(2): time→3000
            // worker spawn(3) (rate-limited): time→4000. _enterRateLimit: _taskRateLimitStartedAt=4000
            // time.advance(10000): time→14000. Rate-limit timer fires, _exitRateLimit: _taskRateLimitMs=10000
            // worker retry spawn(4): time→15000
            // reviewer spawn(5): time→17000
            // active = (17000 - 2000 - 10000) / 1000 = 5
            Assert.ok(plan.includes('"t":5}'), `t should exclude rate-limit window, got: ${plan}`);
        }
    });

    test("detect-build-and-test tokens do not appear in any task metrics", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok", inputTokens: 500, outputTokens: 200 });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = files.get(PLAN_PATH)!;
            Assert.ok(plan.includes('[x]{"it":180,"ot":80,"t":0}'), `detect tokens should not appear in task metrics, got: ${plan}`);
        }
    });

    test("persist failure is logged but does not abort the iteration loop", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = files.get(PLAN_PATH)!;
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
                if (spawnCount === 3 || spawnCount === 5) {
                    const seconds = spawnCount === 3 ? 5 : 3;
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = s.files.get(PLAN_PATH)!;
            // detect (1s) → task starts at 1000
            // prep (1s) → 2000
            // worker rate-limited (1s spawn + 5s wait) → 8000
            // worker retry (1s) → 9000
            // reviewer rate-limited (1s spawn + 3s wait) → 13000  (reviewer wait does NOT freeze metrics time)
            // reviewer retry (1s) → 14000
            // active = (14000 - 1000 - 5000) / 1000 = 8 — only the worker rate-limit is subtracted
            Assert.ok(plan.includes('"t":8}'), `t should exclude only worker rate-limit (reviewer waits do not freeze metrics), got: ${plan}`);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = s.files.get(PLAN_PATH)!;
            // detect rate-limited (1s spawn + 10s wait) → 11000
            // detect retry (1s) → 12000
            // task starts at 12000, _taskRateLimitMs = 0
            // prep (1s) → 13000
            // worker (1s) → 14000
            // reviewer (1s) → 15000
            // active = (15000 - 12000 - 0) / 1000 = 3
            Assert.ok(plan.includes('"t":3}'), `pre-task rate-limit should not affect task t, got: ${plan}`);
        }
    });

    test("setMetrics is not called on BottomBlock during rate-limit wait", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 10);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // Expect 5 plan writes: after prep, after worker, after build, after reviewer, markDone
            Assert.ok(planSnapshots.length >= 5, `should have at least 5 plan writes, got ${planSnapshots.length}`);
            Assert.ok(planSnapshots[0]!.includes('"it":0'), "first persist (prep) should have zero tokens");
            Assert.ok(planSnapshots[0]!.includes('[ ]'), "first persist should still be open");
            Assert.ok(planSnapshots[1]!.includes('"it":100'), "second persist should have worker tokens");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            "setMetrics is called 6 times"({ metricsCalls }) {
                Assert.strictEqual(metricsCalls.length, 6);
            },
            "plan-level metrics has no task pair"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 1, "need at least 1 call");
                Assert.strictEqual(metricsCalls[0]!.task, undefined);
            },
            "plan-level metrics has zero plan pair"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 1, "need at least 1 call");
                Assert.deepStrictEqual(metricsCalls[0]!.plan, { tokens: 0, seconds: 0 });
            },
            "initial task call has zero task metrics"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 2, "need at least 2 calls");
                Assert.deepStrictEqual(metricsCalls[1]!.task, { tokens: 0, seconds: 0 });
            },
            "initial task call has zero plan metrics"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 2, "need at least 2 calls");
                Assert.deepStrictEqual(metricsCalls[1]!.plan, { tokens: 0, seconds: 0 });
            },
            "after-prep call task metrics are still zero"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 3, "need at least 3 calls");
                Assert.deepStrictEqual(metricsCalls[2]!.task, { tokens: 0, seconds: 0 });
            },
            "after-prep call plan metrics are still zero"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 3, "need at least 3 calls");
                Assert.deepStrictEqual(metricsCalls[2]!.plan, { tokens: 0, seconds: 0 });
            },
            "after-worker call task metrics accumulate worker tokens"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 4, "need at least 4 calls");
                Assert.deepStrictEqual(metricsCalls[3]!.task, { tokens: 1500, seconds: 0 });
            },
            "after-worker call plan metrics accumulate worker tokens"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 4, "need at least 4 calls");
                Assert.deepStrictEqual(metricsCalls[3]!.plan, { tokens: 1500, seconds: 0 });
            },
            "after-reviewer call task metrics accumulate reviewer tokens"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 5, "need at least 5 calls");
                Assert.deepStrictEqual(metricsCalls[4]!.task, { tokens: 2600, seconds: 0 });
            },
            "after-reviewer call plan metrics accumulate reviewer tokens"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 5, "need at least 5 calls");
                Assert.deepStrictEqual(metricsCalls[4]!.plan, { tokens: 2600, seconds: 0 });
            },
            "after-markDone call task metrics preserve final tokens"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 6, "need at least 6 calls");
                Assert.deepStrictEqual(metricsCalls[5]!.task, { tokens: 2600, seconds: 0 });
            },
            "after-markDone call plan metrics preserve final tokens"({ metricsCalls }) {
                Assert.ok(metricsCalls.length >= 6, "need at least 6 calls");
                Assert.deepStrictEqual(metricsCalls[5]!.plan, { tokens: 2600, seconds: 0 });
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
                if (spawnCount === 4) {
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            // Task 2: prep + worker + reviewer
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            s.claudeQueue.push(PREP_RESPONSE);
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
            const completedIdx = plain.indexOf("all tasks completed");
            Assert.ok(completedIdx !== -1, "should contain all tasks completed");
            Assert.ok(completedIdx > lastDone, "all tasks completed should appear after the last snapshot");
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
            "prints tasks completed"(_code, { written }) {
                const plain = stripAnsi(written.join(""));
                Assert.ok(plain.includes("tasks completed"), "should print tasks completed");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 80, outputTokens: 30, errorLog: "" });
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                Assert.ok(written.join("").includes(ORANGE + "Failed" + ANSI_RESET), "footer should show the Failed terminal label");
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
                Assert.ok(written.join("").includes(ORANGE + "Failed" + ANSI_RESET), "footer should show the Failed terminal label");
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                Assert.ok(stripAnsi(written.join("")).includes("Failed"));
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = files.get(PLAN_PATH)!;
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = files.get(PLAN_PATH)!;
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = files.get(PLAN_PATH)!;
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
            // prep runs once per task, before the iteration loop
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep runs once per task, before the iteration loop
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                const plan = files.get(PLAN_PATH)!;
                Assert.ok(plan.includes("[x]") && !plan.includes("[ ]"), "task should be marked done after the retry");
            },
            "the failing post-worker add streams its output to the output region"(_code, { written }) {
                Assert.ok(stripAnsi(written.join("")).includes("post-worker add boom"), "the failing post-worker add's stderr is streamed to the output");
            },
            "iteration 2's worker prompt carries the previous-iteration briefing (the loop restarted)"(_code, { promptQueue }) {
                // promptQueue: [0]=detect, [1]=prep, [2]=worker iter1, [3]=worker iter2, [4]=reviewer iter2
                Assert.ok(promptQueue[3]!.includes(WS_ROOT + "/error.log"), "iter2 worker prompt should reference the briefing error.log");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "parser implemented" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging, task 1)
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage, task 1)
            s.gitQueue.push({ code: 0, stdout: "[main abc1234] 1 Build the parser\n", stderr: "" }); // git commit (task 1)
            // Task 2: prep → worker → build → test → reviewer
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = files.get(PLAN_PATH)!;
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
            Assert.ok(plain.includes("all tasks completed"), "should print all tasks completed");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            const plan = files.get(PLAN_PATH)!;
            Assert.ok(plan.includes("[x]"), "task should be marked done after second iteration");
            Assert.ok(!plan.includes("[ ]"), "no open tasks should remain");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes("iter 2"), "snapshot should show iter 2");
            Assert.ok(plain.includes("done"), "snapshot should contain done header");
            Assert.ok(plain.includes("all tasks completed"), "should print all tasks completed");
        }
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
            "the command succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker contract list is exactly the surviving .spec contract namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available contracts"), ".spec/contracts/c1.md");
            },
            "the worker rule list is exactly the surviving nested .spec rule namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available rules"), "src/x/.spec/rules/r1.md");
            },
            "the worker behavior-rule list is exactly the surviving .spec/flanders namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available behavior rules"), ".spec/flanders/naming.md");
            },
            "the prep behavior-rule list is exactly the surviving .spec/flanders namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[1]!, "## Available behavior rules"), ".spec/flanders/naming.md");
            },
            "neither list contains the git-ignored namespace"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[2]!.includes("node-ish/.spec/rules/ignored.md"), "the git-ignored namespace must not appear in the worker prompt");
            },
            "the CONTRACT_LIST placeholder is substituted"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[2]!.includes("<CONTRACT_LIST>"), "CONTRACT_LIST placeholder should be substituted");
            },
            "the RULE_LIST placeholder is substituted"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[2]!.includes("<RULE_LIST>"), "RULE_LIST placeholder should be substituted");
            },
            "the BEHAVIOR_RULE_LIST placeholder is substituted in the worker prompt"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[2]!.includes("<BEHAVIOR_RULE_LIST>"), "BEHAVIOR_RULE_LIST placeholder should be substituted");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
            "the command succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "the prep behavior-rule list renders (none)"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[1]!, "## Available behavior rules"), "(none)");
            },
            "the worker behavior-rule list renders (none)"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available behavior rules"), "(none)");
            },
            "the reviewer behavior-rule list renders (none)"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[3]!, "## Available behavior rules"), "(none)");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
            Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available rules"), ".spec/rules/testing/coverage.md");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            s.claudeQueue.push(PREP_RESPONSE);
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
            // promptQueue: [0]=detect, [1]=prep1, [2]=worker1, [3]=reviewer1, [4]=prep2, [5]=worker2, [6]=reviewer2
            "the run succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "git ls-files is spawned exactly once for the whole run"(_code, { gitSpawns }) {
                Assert.strictEqual(gitSpawns.filter(g => g.args[0] === "ls-files").length, 1, "discovery should run exactly once at startup");
            },
            "the first worker prompt carries the discovered contract"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available contracts"), ".spec/contracts/initial.md");
            },
            "the second worker prompt carries the same discovered contract (lists reused)"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[5]!, "## Available contracts"), ".spec/contracts/initial.md");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "found issues", errorLog: "not ready" });
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            // Task B: prep + worker + reviewer
            s.claudeQueue.push(PREP_RESPONSE);
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
            // promptQueue: [0]=detect, [1]=prep A, [2]=worker A iter 1, [3]=reviewer A iter 1,
            // [4]=worker A iter 2, [5]=reviewer A iter 2,
            // [6]=prep B, [7]=worker B, [8]=reviewer B
            const w1Contracts = extractPromptList(promptQueue[2]!, "## Available contracts");
            const w2Contracts = extractPromptList(promptQueue[4]!, "## Available contracts");
            const w3Contracts = extractPromptList(promptQueue[7]!, "## Available contracts");
            Assert.strictEqual(w1Contracts, w2Contracts, "contract lists should be identical across iterations");
            Assert.strictEqual(w1Contracts, w3Contracts, "contract lists should be identical across tasks");
            const w1Rules = extractPromptList(promptQueue[2]!, "## Available rules");
            const w2Rules = extractPromptList(promptQueue[4]!, "## Available rules");
            const w3Rules = extractPromptList(promptQueue[7]!, "## Available rules");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
            "the command succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker contract list is the discovered namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available contracts"), ".spec/contracts/overview.md");
            },
            "the reviewer contract list matches the worker's"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[3]!, "## Available contracts"), extractPromptList(promptQueue[2]!, "## Available contracts"));
            },
            "the worker rule list is the discovered nested namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[2]!, "## Available rules"), "src/x/.spec/rules/r1.md");
            },
            "the reviewer rule list matches the worker's"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[3]!, "## Available rules"), extractPromptList(promptQueue[2]!, "## Available rules"));
            },
            "the reviewer behavior-rule list is the discovered .spec/flanders namespace"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[3]!, "## Available behavior rules"), ".spec/flanders/naming.md");
            },
            "the reviewer behavior-rule list matches the worker's"(_code, { promptQueue }) {
                Assert.strictEqual(extractPromptList(promptQueue[3]!, "## Available behavior rules"), extractPromptList(promptQueue[2]!, "## Available behavior rules"));
            }
        }
    });

    test("reviewer prompt contains the four explicit FAIL conditions", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
            const reviewerPrompt = promptQueue[3]!;
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            "first worker spawn args[0] is --resume"(_code, { claudeSpawnedArgs }) {
                // claudeSpawnedArgs: [0]=detect, [1]=prep, [2]=worker iter 1
                Assert.strictEqual(claudeSpawnedArgs[2]![0], "--resume");
            },
            "first worker spawn args[1] is prep-session"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[2]![1], "prep-session");
            },
            "first worker spawn args[2] is --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[2]![2], "--fork-session");
            },
            "second worker spawn has --resume WS"(_code, { claudeSpawnedArgs }) {
                // claudeSpawnedArgs: [3] = worker iter 2
                Assert.strictEqual(hasResume(claudeSpawnedArgs[3]!), "WS");
            },
            "second worker spawn has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--fork-session"));
            }
        }
    });

    test("reviewer never receives the worker session_id", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                // claudeSpawnedArgs: [0]=detect, [1]=prep, [2]=worker1, [3]=reviewer1, [4]=worker2, [5]=reviewer2
                Assert.notStrictEqual(hasResume(claudeSpawnedArgs[3]!), "WS");
            },
            "reviewer iter 2 does not receive worker session_id"(_code, { claudeSpawnedArgs }) {
                Assert.notStrictEqual(hasResume(claudeSpawnedArgs[5]!), "WS");
            },
            "reviewer iter 1 forks from prep"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(hasResume(claudeSpawnedArgs[3]!), "prep-session");
            },
            "reviewer iter 2 forks from prep"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(hasResume(claudeSpawnedArgs[5]!), "prep-session");
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
            s.claudeQueue.push({ text: "READY", sessionId: "prep-session-1" });
            s.claudeQueue.push({ text: "w1", sessionId: "WS1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            // Task 2: prep + worker + reviewer
            s.claudeQueue.push({ text: "READY", sessionId: "prep-session-2" });
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
            "task 2 worker args[0] is --resume"(_code, { claudeSpawnedArgs }) {
                // claudeSpawnedArgs: [0]=detect, [1]=task1 prep, [2]=task1 worker, [3]=task1 reviewer, [4]=task2 prep, [5]=task2 worker, [6]=task2 reviewer
                Assert.strictEqual(claudeSpawnedArgs[5]![0], "--resume");
            },
            "task 2 worker args[1] is prep-session-2"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[5]![1], "prep-session-2");
            },
            "task 2 worker args[2] is --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[5]![2], "--fork-session");
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
            "iter 1 worker args[0] is --resume"(_code, { claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep, [2]=worker1, [3]=worker2, [4]=worker3, [5]=reviewer
                Assert.strictEqual(claudeSpawnedArgs[2]![0], "--resume");
            },
            "iter 1 worker args[1] is prep-session"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[2]![1], "prep-session");
            },
            "iter 1 worker args[2] is --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[2]![2], "--fork-session");
            },
            "iter 3 worker has --resume WS"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(hasResume(claudeSpawnedArgs[4]!), "WS");
            },
            "iter 3 worker has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[4]!.includes("--fork-session"));
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                // [0]=detect, [1]=prep, [2]=worker1, [3]=reviewer1, [4]=worker2(error), [5]=worker3, [6]=reviewer3
                Assert.strictEqual(hasResume(claudeSpawnedArgs[5]!), "WS");
            },
            "iter 3 worker has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[5]!.includes("--fork-session"));
            }
        }
    });

    test("iteration 1 forks from prep, iteration 2 resumes worker session", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-S" });
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
            "iter 1 worker args[0] is --resume"(_code, { claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep, [2]=worker iter 1
                Assert.strictEqual(claudeSpawnedArgs[2]![0], "--resume");
            },
            "iter 1 worker args[1] is the prep session id"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[2]![1], "PREP-S");
            },
            "iter 1 worker args[2] is --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[2]![2], "--fork-session");
            },
            "iter 2 worker args[0] is --resume"(_code, { claudeSpawnedArgs }) {
                // [3]=worker iter 2
                Assert.strictEqual(claudeSpawnedArgs[3]![0], "--resume");
            },
            "iter 2 worker args[1] is the worker session id"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[3]![1], "WORKER-S");
            },
            "iter 2 worker has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[3]!.includes("--fork-session"));
            },
            "exactly 2 worker spawns"(_code, { claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep, [2]=worker1, [3]=worker2, [4]=reviewer
                Assert.strictEqual(claudeSpawnedArgs.length, 5);
            }
        }
    });

});

test.describe("Implement reviewer forks from prep", test => {
    test("reviewer iteration 1 is spawned with --resume <prep_session_id> --fork-session", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-R" });
            // iter 1: worker, reviewer PASS
            s.claudeQueue.push({ text: "w1", sessionId: "WORKER-R" });
            s.claudeQueue.push({ text: "reviewer ok", sessionId: "REVIEWER-1", errorLog: "" });
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
            "reviewer args[0] is --resume"(_code, { claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
                Assert.strictEqual(claudeSpawnedArgs[3]![0], "--resume");
            },
            "reviewer args[1] is the prep session id"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[3]![1], "PREP-R");
            },
            "reviewer args[2] is --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[3]![2], "--fork-session");
            }
        }
    });

    test("reviewer iteration 2 forks from the same prep session id as iteration 1", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-R2" });
            // iter 1: worker, reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "WORKER-R2" });
            s.claudeQueue.push({ text: "found issues", sessionId: "REVIEWER-ITER1", errorLog: "not ready" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker, reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", sessionId: "REVIEWER-ITER2", errorLog: "" });
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
            "reviewer iter 1 args[0] is --resume"(_code, { claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep, [2]=worker1, [3]=reviewer1, [4]=worker2, [5]=reviewer2
                Assert.strictEqual(claudeSpawnedArgs[3]![0], "--resume");
            },
            "reviewer iter 1 args[1] is prep session id"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[3]![1], "PREP-R2");
            },
            "reviewer iter 1 args[2] is --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[3]![2], "--fork-session");
            },
            "reviewer iter 2 args[0] is --resume"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[5]![0], "--resume");
            },
            "reviewer iter 2 args[1] is the same prep session id"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[5]![1], "PREP-R2");
            },
            "reviewer iter 2 args[2] is --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[5]![2], "--fork-session");
            }
        }
    });

    test("reviewer session_id is not stored as worker or prep session — observed via iter-2 --resume args", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-NOSAVE" });
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
            // claudeSpawnedArgs positions: [0]=detect, [1]=prep, [2]=worker-iter1,
            // [3]=reviewer-iter1, [4]=worker-iter2, [5]=reviewer-iter2.
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "iter 2 worker resumes the iter-1 worker session id (never a reviewer's id)"({ claudeSpawnedArgs }) {
                const iter2WorkerArgs = claudeSpawnedArgs[4]!;
                Assert.strictEqual(iter2WorkerArgs[0], "--resume");
                Assert.strictEqual(iter2WorkerArgs[1], "WORKER-NOSAVE");
            },
            "iter 2 reviewer forks from the prep session id (never a reviewer's id)"({ claudeSpawnedArgs }) {
                const iter2ReviewerArgs = claudeSpawnedArgs[5]!;
                Assert.strictEqual(iter2ReviewerArgs[0], "--resume");
                Assert.strictEqual(iter2ReviewerArgs[1], "PREP-NOSAVE");
                Assert.ok(iter2ReviewerArgs.includes("--fork-session"));
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                Assert.ok(allOutput.includes(ORANGE + "Done" + ANSI_RESET), "footer should show Done terminal label");
            },
            "block remains visible after exit"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes(SEP.repeat(80)), "block separator should remain visible");
            },
            "cursor is on line below block"(_code, { written }) {
                const allOutput = written.join("");
                const labelStr = ORANGE + "Done" + ANSI_RESET;
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
                Assert.ok(allOutput.includes(ORANGE + "Done" + ANSI_RESET), "footer should show Done terminal label");
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
                Assert.ok(allOutput.includes(ORANGE + "Failed" + ANSI_RESET), "footer should show Failed terminal label");
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
                Assert.ok(allOutput.includes(ORANGE + "Failed" + ANSI_RESET), "footer should show Failed terminal label");
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
                Assert.ok(allOutput.includes(ORANGE + "Failed" + ANSI_RESET), "footer should show Failed terminal label");
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
                Assert.ok(allOutput.includes(ORANGE + "Failed" + ANSI_RESET), "footer should show Failed terminal label");
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
                Assert.ok(allOutput.includes(ORANGE + "Failed" + ANSI_RESET), "footer should show Failed terminal label");
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
            // prep runs once per task, before the iteration loop
            s.claudeQueue.push(PREP_RESPONSE);
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
                Assert.ok(allOutput.includes(ORANGE + "Hard stop" + ANSI_RESET), "footer should show Hard stop terminal label");
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
                Assert.ok(allOutput.includes(ORANGE + "Interrupted" + ANSI_RESET), "footer should show Interrupted terminal label");
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
                const labelStr = ORANGE + "Failed" + ANSI_RESET;
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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

test.describe("Implement prep stage", test => {
    test("prep is spawned before worker and reviewer in 1-task plan", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push(PREP_RESPONSE);
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
            "4 spawns total: detect, prep, worker, reviewer"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 4);
            },
            "prep spawn has no --resume"(_code, { claudeSpawnedArgs }) {
                Assert.strictEqual(hasResume(claudeSpawnedArgs[1]!), null);
            },
            "prep spawn has no --fork-session"(_code, { claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--fork-session"));
            }
        }
    });

    test("prep output is persisted to ws.prepLog(taskIndex)", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push(PREP_RESPONSE);
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
            "prep.0.log file exists"(_code, { files }) {
                Assert.ok(files.has(WS_ROOT + "/prep.0.log"));
            },
            "prep.0.log contains prep output"(_code, { files }) {
                Assert.ok(files.get(WS_ROOT + "/prep.0.log")!.includes("READY"));
            }
        }
    });

    test("prep tokens are accumulated into task metrics", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "READY", sessionId: "prep-session", inputTokens: 200, outputTokens: 100 });
            s.claudeQueue.push({ text: "worker", inputTokens: 300, outputTokens: 150 });
            s.claudeQueue.push({ text: "reviewer ok", inputTokens: 50, outputTokens: 25, errorLog: "" });
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
            "task it = prep(200) + worker(300) + reviewer(50) = 550"(_code, { files }) {
                const plan = files.get(PLAN_PATH)!;
                Assert.ok(plan.includes('"it":550,'), `got: ${plan}`);
            },
            "task ot = prep(100) + worker(150) + reviewer(25) = 275"(_code, { files }) {
                const plan = files.get(PLAN_PATH)!;
                Assert.ok(plan.includes('"ot":275,'), `got: ${plan}`);
            }
        }
    });

    test("prep failure (rejection) causes hard stop and preserves workspace", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "prep", error: true });
            return s;
        },
        async ACT({ contexts, written, errors }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, output: written.join("") + errors.join("") };
        },
        ASSERTS: {
            "exits with code 1"({ code }) {
                Assert.strictEqual(code, 1);
            },
            "error contains Hard stop"({ output }) {
                Assert.ok(output.includes("Hard stop"));
            },
            "error names the task title"({ output }) {
                Assert.ok(output.includes("Implement feature A"));
            },
            "error.log is written"(_result, { files }) {
                Assert.ok(files.has(WS_ROOT + "/error.log"));
            },
            "workspace folder is not removed on dispose"(_result, { rmCalls }) {
                Assert.ok(!rmCalls.includes(WS_ROOT));
            },
            "worker stage is never reached"(_result, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 2);
            }
        }
    });

    test("prep returns null sessionId causes hard stop", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "READY" });
            return s;
        },
        async ACT({ contexts, written, errors }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, output: written.join("") + errors.join("") };
        },
        ASSERTS: {
            "exits with code 1"({ code }) {
                Assert.strictEqual(code, 1);
            },
            "error contains Hard stop"({ output }) {
                Assert.ok(output.includes("Hard stop"));
            },
            "error mentions no session id"({ output }) {
                Assert.ok(output.includes("no session id"));
            },
            "error names the task title"({ output }) {
                Assert.ok(output.includes("Implement feature A"));
            },
            "error.log is written"(_result, { files }) {
                Assert.ok(files.has(WS_ROOT + "/error.log"));
            },
            "workspace folder is not removed on dispose"(_result, { rmCalls }) {
                Assert.ok(!rmCalls.includes(WS_ROOT));
            },
            "prep log was written before hard stop"(_result, { files }) {
                Assert.ok(files.has(WS_ROOT + "/prep.0.log"));
            },
            "worker stage is never reached"(_result, { claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 2);
            }
        }
    });

    test("prep session id is captured per task and reset between tasks — observed via per-task worker fork args", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue, 2);
            s.files.set(PLAN_PATH, PLAN_TWO_TASKS);
            s.claudeQueue.push({ text: "ok" });
            // task 1
            s.claudeQueue.push({ text: "READY", sessionId: "prep-sess-1" });
            s.claudeQueue.push({ text: "worker1" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            // task 2
            s.claudeQueue.push({ text: "READY", sessionId: "prep-sess-2" });
            s.claudeQueue.push({ text: "worker2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            // claudeSpawnedArgs positions:
            //   [0]=detect,
            //   [1]=task-1 prep, [2]=task-1 worker, [3]=task-1 reviewer,
            //   [4]=task-2 prep, [5]=task-2 worker, [6]=task-2 reviewer.
            return { code, claudeSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "task-1 worker forks from task-1 prep session id (capture)"({ claudeSpawnedArgs }) {
                const args = claudeSpawnedArgs[2]!;
                Assert.strictEqual(args[0], "--resume");
                Assert.strictEqual(args[1], "prep-sess-1");
                Assert.ok(args.includes("--fork-session"));
            },
            "task-2 worker forks from task-2 prep session id, NOT task-1's (reset between tasks)"({ claudeSpawnedArgs }) {
                const args = claudeSpawnedArgs[5]!;
                Assert.strictEqual(args[0], "--resume");
                Assert.strictEqual(args[1], "prep-sess-2");
                Assert.ok(args.includes("--fork-session"));
            },
            "task-2 reviewer forks from task-2 prep session id, NOT task-1's"({ claudeSpawnedArgs }) {
                const args = claudeSpawnedArgs[6]!;
                Assert.strictEqual(args[0], "--resume");
                Assert.strictEqual(args[1], "prep-sess-2");
                Assert.ok(args.includes("--fork-session"));
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
                const reviewerPrompt = promptQueue[3]!;
                Assert.ok(reviewerPrompt.includes(reviewerErrorLogPath(1)));
            },
            "placeholder is fully replaced"({ promptQueue }) {
                const reviewerPrompt = promptQueue[3]!;
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
                // [0]=detect, [1]=prep, [2]=worker, [3]=reviewer#1, [4]=reviewer#2
                Assert.strictEqual(claudeSpawnedArgs.length, 5);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
                // [0]=detect, [1]=prep, [2]=worker, [3]=reviewer#1, [4]=reviewer#2, [5]=reviewer#3
                Assert.strictEqual(claudeSpawnedArgs.length, 6);
            }
        }
    });

    test("tokens accumulate across reviewer relaunches", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push(PREP_RESPONSE);
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
                const plan = files.get(PLAN_PATH)!;
                // prep(0) + worker(100) + reviewer#1(200) + reviewer#2(300) = 600
                Assert.ok(plan.includes('"it":600'), `it should be 600, got: ${plan}`);
            },
            "task ot accumulates both reviewer invocations"({ files }) {
                const plan = files.get(PLAN_PATH)!;
                // prep(0) + worker(50) + reviewer#1(80) + reviewer#2(120) = 250
                Assert.ok(plan.includes('"ot":250'), `ot should be 250, got: ${plan}`);
            }
        }
    });

    test("each reviewer relaunch forks from prep session", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-RELAUNCH" });
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
            "reviewer #1 forks from prep"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep, [2]=worker, [3]=reviewer#1, [4]=reviewer#2
                const revArgs = claudeSpawnedArgs[3]!;
                Assert.ok(revArgs.includes("--resume") && revArgs.includes("PREP-RELAUNCH") && revArgs.includes("--fork-session"));
            },
            "reviewer #2 forks from same prep"({ claudeSpawnedArgs }) {
                const revArgs = claudeSpawnedArgs[4]!;
                Assert.ok(revArgs.includes("--resume") && revArgs.includes("PREP-RELAUNCH") && revArgs.includes("--fork-session"));
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            s.claudeQueue.push(PREP_RESPONSE);
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
            const config:FlandersConfig = { worker: { tool: "codex", model: "codex-model", effort: "high" }, reviewers: [{ tool: "claude", model: "rev-model", effort: "low" }] };
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
            const config:FlandersConfig = { worker: { tool: "codex", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "rev-model", effort: "" }] };
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
            const config:FlandersConfig = { worker: { tool: "codex", model: "w-model", effort: "medium" }, reviewers: [{ tool: "claude", model: "r-model", effort: "low" }] };
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

    test("prep stage uses the worker triple", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "codex", model: "w-model", effort: "medium" }, reviewers: [{ tool: "codex", model: "w-model", effort: "medium" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.codexQueue.push({ text: "detect" });
            s.codexQueue.push({ text: "READY", sessionId: "prep-session" });
            s.codexQueue.push({ text: "worker output" });
            s.codexQueue.push({ text: "review ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, codexSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            await cmd.result();
            await cmd.dispose();
            return codexSpawnedArgs;
        },
        ASSERTS: {
            "prep is the second codex spawn"(codexSpawnedArgs) {
                Assert.ok(codexSpawnedArgs.length >= 2, "at least two codex spawns");
            },
            "prep spawn carries the worker model"(codexSpawnedArgs) {
                const prepArgs = codexSpawnedArgs[1]!;
                const mIndex = prepArgs.indexOf("-m");
                Assert.ok(mIndex >= 0, "-m flag present on prep spawn");
                Assert.strictEqual(prepArgs[mIndex + 1], "w-model");
            }
        }
    });

    test("session id is still captured from the worker via the runner", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "READY", sessionId: "prep-session" });
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
                const workerIter2Args = claudeSpawnedArgs[4];
                Assert.ok(workerIter2Args !== undefined, "fifth claude spawn (worker iter 2) should exist");
                Assert.ok(workerIter2Args.includes("--resume"), "--resume flag should be present");
                Assert.ok(workerIter2Args.includes("worker-sess-1"), "session id from iter 1 should be used");
            }
        }
    });

    test("all-claude config routes all stages through claude binary", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "w-model", effort: "" }, reviewers: [{ tool: "claude", model: "r-model", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push({ text: "READY", sessionId: "prep-session" });
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
            "all four AI stages go through claude"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 4);
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
                const reviewerArgs = claudeSpawnedArgs[3]!;
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
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push(PREP_RESPONSE);
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
            const config:FlandersConfig = { worker: { tool: "codex", model: "gpt-5-codex", effort: "high" }, reviewers: [{ tool: "claude", model: "rev-model", effort: "low" }] };
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
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push(PREP_RESPONSE);
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
            const config:FlandersConfig = { worker: { tool: "codex", model: "worker-model-abc", effort: "high" }, reviewers: [{ tool: "claude", model: "reviewer-sentinel-model", effort: "reviewer-sentinel-effort" }] };
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

    test("detect agent uses worker values even when config JSON contains an extra detect section", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config = JSON.stringify({
                worker: { tool: "codex", model: "worker-model", effort: "high" },
                reviewers: [{ tool: "claude", model: "reviewer-model", effort: "low" }],
                detect: { tool: "claude", model: "detect-model", effort: "detect-effort" }
            });
            s.files.set(CONFIG_PATH, config);
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
            "detect uses codex adapter (worker tool) not claude (hypothetical third-section tool)"(codexSpawnedArgs) {
                Assert.ok(codexSpawnedArgs.length >= 1, "at least one codex spawn for detect");
                Assert.strictEqual(codexSpawnedArgs[0]![0], "exec");
            },
            "detect spawn carries worker-model not third-section model"(codexSpawnedArgs) {
                const detectArgs = codexSpawnedArgs[0]!;
                const mIndex = detectArgs.indexOf("-m");
                Assert.ok(mIndex >= 0, "-m flag present");
                Assert.strictEqual(detectArgs[mIndex + 1], "worker-model");
            }
        }
    });

    test("exactly one detect call per implement run through the runner", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect" });
            s.claudeQueue.push(PREP_RESPONSE);
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
            "4 total runner invocations: detect, prep, worker, reviewer"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 4);
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

test.describe("Implement prep-optimization condition", test => {
    test("prepActive=true when worker and reviewer share tool, model, and effort", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
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
            "4 spawns total: detect, prep, worker, reviewer"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 4);
            }
        }
    });

    test("prepActive=false when tools differ — no prep launched", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, claudeSpawnedArgs, codexSpawnedArgs, promptQueue }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs, codexSpawnedArgs, promptQueue };
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
            },
            "no prompt contains the prep preamble"({ promptQueue }) {
                for (const p of promptQueue) {
                    Assert.ok(!p.includes("You are the prep agent"), `unexpected prep prompt found`);
                }
            }
        }
    });

    test("prepActive=false when effort differs — no prep launched", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "codex", model: "m", effort: "medium" }, reviewers: [{ tool: "codex", model: "m", effort: "high" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.codexQueue.push({ text: "detect" });
            s.codexQueue.push({ text: "worker" });
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, codexSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, codexSpawnedArgs };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "3 codex spawns: detect, worker, reviewer — no prep"({ codexSpawnedArgs }) {
                Assert.strictEqual(codexSpawnedArgs.length, 3);
            }
        }
    });

    test("prepActive=true when both model and effort are empty strings", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
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
            "4 spawns: detect, prep, worker, reviewer"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 4);
            }
        }
    });

    test("prepActive=true and prep returns no session id causes hard stop", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "READY" });
            return s;
        },
        async ACT({ contexts, written, errors, files }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, output: written.join("") + errors.join(""), files };
        },
        ASSERTS: {
            "exits with code 1"({ code }) {
                Assert.strictEqual(code, 1);
            },
            "error contains Hard stop"({ output }) {
                Assert.ok(output.includes("Hard stop"));
            },
            "error mentions no session id"({ output }) {
                Assert.ok(output.includes("returned no session id"));
            },
            "error.log is written"({ files }) {
                Assert.ok(files.has(WS_ROOT + "/error.log"));
            }
        }
    });

    test("prepActive=false — worker and reviewer succeed without prep session", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "a", effort: "" }, reviewers: [{ tool: "codex", model: "b", effort: "" }] };
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
            "worker spawned via claude"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 2);
            },
            "reviewer spawned via codex"({ codexSpawnedArgs }) {
                Assert.strictEqual(codexSpawnedArgs.length, 1);
            },
            "worker has no --fork-session flag"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[1]!.includes("--fork-session"));
            }
        }
    });

    test("prepActive=false when model differs — no prep launched", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "a", effort: "" }, reviewers: [{ tool: "claude", model: "b", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker" });
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
            "3 spawns: detect, worker, reviewer — no prep"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 3);
            }
        }
    });
});

function planWithLinkedFiles(linkedContracts:string, linkedRules:string):string {
    return [
        "# Plan",
        "",
        '- [ ]{"it":0,"ot":0,"t":0} 1.1 Task with links',
        "",
        "  Description.",
        "",
        `  Linked contracts: ${linkedContracts}`,
        "",
        `  Linked rules: ${linkedRules}`,
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

test.describe("Implement worker iter 1 branch A vs branch B", test => {
    test("branch A: prepActive=true — worker forks from prep and prompt does NOT inline linked content", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const plan = planWithLinkedFiles(
                "`contracts/linked-c.md`.",
                "`rules/linked-r.md`."
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/contracts/linked-c.md", "UNIQUE_CONTRACT_SNIPPET_ALPHA");
            s.files.set("/project/rules/linked-r.md", "UNIQUE_RULE_SNIPPET_ALPHA");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // detect
            s.claudeQueue.push({ text: "ok" });
            // prep (prepActive=true because worker and reviewer share tool/model/effort)
            s.claudeQueue.push({ text: "READY", sessionId: "prep-abc" });
            // worker
            s.claudeQueue.push({ text: "worker done", sessionId: "worker-abc" });
            // reviewer
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
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
            "worker forks from prep session id"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
                const workerArgs = claudeSpawnedArgs[2]!;
                Assert.strictEqual(workerArgs[0], "--resume");
                Assert.strictEqual(workerArgs[1], "prep-abc");
                Assert.ok(workerArgs.includes("--fork-session"));
            },
            "worker prompt does NOT contain linked contract body"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
                const workerPrompt = promptQueue[2]!;
                Assert.ok(!workerPrompt.includes("UNIQUE_CONTRACT_SNIPPET_ALPHA"), "linked contract content must NOT be inlined in branch A");
            },
            "worker prompt does NOT contain linked rule body"({ promptQueue }) {
                const workerPrompt = promptQueue[2]!;
                Assert.ok(!workerPrompt.includes("UNIQUE_RULE_SNIPPET_ALPHA"), "linked rule content must NOT be inlined in branch A");
            }
        }
    });

    test("branch B: prepActive=false — worker is fresh and prompt inlines linked content", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles(
                "`contracts/linked-c.md`.",
                "`rules/linked-r.md`."
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/contracts/linked-c.md", "UNIQUE_CONTRACT_SNIPPET_BETA");
            s.files.set("/project/rules/linked-r.md", "UNIQUE_RULE_SNIPPET_BETA");
            s.files.set("/project/contracts/unlinked-global.md", "UNLINKED_GLOBAL_SNIPPET");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // detect
            s.claudeQueue.push({ text: "ok" });
            // worker (no prep)
            s.claudeQueue.push({ text: "worker done", sessionId: "worker-beta" });
            // reviewer
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
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
            "worker has no --resume flag"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=worker (no prep)
                const workerArgs = claudeSpawnedArgs[1]!;
                Assert.ok(!workerArgs.includes("--resume"), "worker must not have --resume in branch B");
            },
            "worker has no --fork-session flag"({ claudeSpawnedArgs }) {
                const workerArgs = claudeSpawnedArgs[1]!;
                Assert.ok(!workerArgs.includes("--fork-session"), "worker must not have --fork-session in branch B");
            },
            "worker prompt contains linked contract body"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker
                const workerPrompt = promptQueue[1]!;
                Assert.ok(workerPrompt.includes("UNIQUE_CONTRACT_SNIPPET_BETA"), "linked contract content must be inlined in branch B");
            },
            "worker prompt contains linked rule body"({ promptQueue }) {
                const workerPrompt = promptQueue[1]!;
                Assert.ok(workerPrompt.includes("UNIQUE_RULE_SNIPPET_BETA"), "linked rule content must be inlined in branch B");
            },
            "worker prompt does NOT contain unlinked global file content"({ promptQueue }) {
                const workerPrompt = promptQueue[1]!;
                Assert.ok(!workerPrompt.includes("UNLINKED_GLOBAL_SNIPPET"), "unlinked file content must NOT be inlined");
            }
        }
    });

    test("branch A: captured _currentWorkerSessionId equals the session.id emitted", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const plan = planWithLinkedFiles("`contracts/c.md`.", "`rules/r.md`.");
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/contracts/c.md", "c");
            s.files.set("/project/rules/r.md", "r");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "READY", sessionId: "prep-cap" });
            s.claudeQueue.push({ text: "worker", sessionId: "worker-cap-A" });
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
            "iter 2 would use captured worker session"(_code, { claudeSpawnedArgs }) {
                // If iteration 2 ran, it would use worker-cap-A via --resume.
                // Since the task passed on iter 1, we verify the worker fork args show the prep (branch A pattern).
                const workerArgs = claudeSpawnedArgs[2]!;
                Assert.strictEqual(workerArgs[0], "--resume");
                Assert.strictEqual(workerArgs[1], "prep-cap");
                Assert.ok(workerArgs.includes("--fork-session"));
            }
        }
    });

    test("branch B: captured _currentWorkerSessionId equals the session.id emitted", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "a", effort: "" }, reviewers: [{ tool: "codex", model: "b", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles("`contracts/c.md`.", "`rules/r.md`.");
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/contracts/c.md", "c");
            s.files.set("/project/rules/r.md", "r");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            // worker — prepActive=false, so no prep
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

    test("branch B: missing linked file produces '(file not found)' in prompt", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles(
                "`contracts/exists.md` `contracts/missing.md`.",
                ""
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/contracts/exists.md", "EXISTS_CONTENT");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done" });
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
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
            "existing file content is inlined"({ promptQueue }) {
                const workerPrompt = promptQueue[1]!;
                Assert.ok(workerPrompt.includes("EXISTS_CONTENT"));
            },
            "missing file gets placeholder"({ promptQueue }) {
                const workerPrompt = promptQueue[1]!;
                Assert.ok(workerPrompt.includes("(file not found)"));
                Assert.ok(workerPrompt.includes("contracts/missing.md"));
            }
        }
    });

    test("branch B: no throw when _currentPrepSessionId is null", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "a", effort: "" }, reviewers: [{ tool: "claude", model: "b", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // no prep (models differ)
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
});

test.describe("Implement worker iter n>1 — resume, no context replay", test => {
    test("iter 2 with captured session invokes worker with resumeSessionId and no fork parent", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                // [0]=detect, [1]=prep, [2]=worker1, [3]=reviewer1, [4]=worker2, [5]=reviewer2
                Assert.strictEqual(claudeSpawnedArgs[4]![0], "--resume");
                Assert.strictEqual(claudeSpawnedArgs[4]![1], "w-abc");
            },
            "iter 2 worker has no --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[4]!.includes("--fork-session"));
            }
        }
    });

    test("iter 2 prompt does NOT contain linked contract or rule body even after branch B inlined", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles(
                "`contracts/linked-c.md`.",
                "`rules/linked-r.md`."
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/contracts/linked-c.md", "UNIQUE_CONTRACT_ITER2_NOREPLAY");
            s.files.set("/project/rules/linked-r.md", "UNIQUE_RULE_ITER2_NOREPLAY");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // detect
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker (branch B, no prep) — inlines content, reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "w-branchB" });
            s.codexQueue.push({ text: "found issues", errorLog: "fix it" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            // iter 2: worker resumes, reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
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
            "iter 1 prompt contains linked contract body (branch B)"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker iter 1
                Assert.ok(promptQueue[1]!.includes("UNIQUE_CONTRACT_ITER2_NOREPLAY"));
            },
            "iter 1 prompt contains linked rule body (branch B)"({ promptQueue }) {
                Assert.ok(promptQueue[1]!.includes("UNIQUE_RULE_ITER2_NOREPLAY"));
            },
            "iter 2 prompt does NOT contain linked contract body"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker iter 1, [2]=reviewer iter 1, [3]=worker iter 2
                Assert.ok(!promptQueue[3]!.includes("UNIQUE_CONTRACT_ITER2_NOREPLAY"), "linked contract content must NOT be inlined in iter 2");
            },
            "iter 2 prompt does NOT contain linked rule body"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("UNIQUE_RULE_ITER2_NOREPLAY"), "linked rule content must NOT be inlined in iter 2");
            }
        }
    });

    test("iter 2 with null session invokes worker with no resume and no fork", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                // [0]=detect, [1]=prep, [2]=worker1, [3]=reviewer1, [4]=worker2, [5]=reviewer2
                Assert.ok(!claudeSpawnedArgs[4]!.includes("--resume"), "iter 2 with null session must not have --resume");
            },
            "iter 2 worker has no --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[4]!.includes("--fork-session"), "iter 2 with null session must not have --fork-session");
            }
        }
    });

    test("defensive capture: iter 2 emits new session.id, iter 3 uses the new id", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                // [0]=detect, [1]=prep, [2]=worker1, [3]=reviewer1, [4]=worker2, [5]=reviewer2, [6]=worker3, [7]=reviewer3
                Assert.strictEqual(claudeSpawnedArgs[4]![0], "--resume");
                Assert.strictEqual(claudeSpawnedArgs[4]![1], "w-old");
            },
            "iter 3 resumes with w-new"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[6]![0], "--resume");
                Assert.strictEqual(claudeSpawnedArgs[6]![1], "w-new");
            },
            "iter 3 does not use w-old"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[6]!.includes("w-old"), "iter 3 must use the updated session id, not the old one");
            }
        }
    });

    test("previousIterationBriefing is appended in all iter n>1 cases", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
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
                // promptQueue: [0]=detect, [1]=prep, [2]=worker1
                Assert.ok(!promptQueue[2]!.includes("This is iteration"), "iter 1 prompt must not contain briefing");
            },
            "iter 2 prompt contains iteration 2 briefing"({ promptQueue }) {
                // promptQueue: [3]=reviewer1, [4]=worker2
                Assert.ok(promptQueue[4]!.includes("This is iteration 2 for this task"), "iter 2 prompt must contain iteration 2 briefing");
            },
            "iter 3 prompt contains iteration 3 briefing"({ promptQueue }) {
                // promptQueue: [5]=reviewer2, [6]=worker3
                Assert.ok(promptQueue[6]!.includes("This is iteration 3 for this task"), "iter 3 prompt must contain iteration 3 briefing");
            }
        }
    });

    test("cross-task discard: _currentWorkerSessionId resets to null before iter 1 of new task", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue, 2);
            const twoTaskPlan = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task Alpha\n- [ ]{"it":0,"ot":0,"t":0} Task Beta\n';
            s.files.set(PLAN_PATH, twoTaskPlan);
            s.claudeQueue.push({ text: "ok" });
            // Task Alpha: prep, worker (returns sessionId "alpha-ws"), reviewer PASS
            s.claudeQueue.push({ text: "READY", sessionId: "prep-alpha" });
            s.claudeQueue.push({ text: "w-alpha", sessionId: "alpha-ws" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            // Task Beta: prep, worker (returns NO sessionId), reviewer FAIL
            s.claudeQueue.push({ text: "READY", sessionId: "prep-beta" });
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
            "task Beta iter 1 worker forks from prep-beta, not alpha-ws"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep-alpha, [2]=worker-alpha, [3]=reviewer-alpha, [4]=prep-beta, [5]=worker-beta-1, [6]=reviewer-beta-1, [7]=worker-beta-2, [8]=reviewer-beta-2
                Assert.strictEqual(claudeSpawnedArgs[5]![0], "--resume");
                Assert.strictEqual(claudeSpawnedArgs[5]![1], "prep-beta");
                Assert.ok(claudeSpawnedArgs[5]!.includes("--fork-session"));
            },
            "task Beta iter 1 worker does not use alpha-ws"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[5]!.includes("alpha-ws"), "task Beta must not carry over alpha-ws from task Alpha");
            },
            "task Beta iter 2 worker has no --resume (no session captured in iter 1)"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[7]!.includes("--resume"), "iter 2 of task Beta with null session must not have --resume");
            },
            "task Beta iter 2 worker has no --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(!claudeSpawnedArgs[7]!.includes("--fork-session"), "iter 2 of task Beta must not have --fork-session");
            }
        }
    });
});

test.describe("Implement reviewer branch A vs branch B", test => {
    test("branch A: prepActive=true — reviewer forks from prep and prompt does NOT inline linked content", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const plan = planWithLinkedFiles(
                "`contracts/linked-c.md`.",
                "`rules/linked-r.md`."
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/contracts/linked-c.md", "UNIQUE_REVIEWER_CONTRACT_ALPHA");
            s.files.set("/project/rules/linked-r.md", "UNIQUE_REVIEWER_RULE_ALPHA");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "READY", sessionId: "prep-rev-a" });
            s.claudeQueue.push({ text: "worker done", sessionId: "worker-rev-a" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
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
            "reviewer forks from prep session id"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
                Assert.strictEqual(claudeSpawnedArgs[3]![0], "--resume");
                Assert.strictEqual(claudeSpawnedArgs[3]![1], "prep-rev-a");
                Assert.ok(claudeSpawnedArgs[3]!.includes("--fork-session"));
            },
            "reviewer prompt does NOT contain linked contract body"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
                const reviewerPrompt = promptQueue[3]!;
                Assert.ok(!reviewerPrompt.includes("UNIQUE_REVIEWER_CONTRACT_ALPHA"), "linked contract content must NOT be inlined in branch A reviewer");
            },
            "reviewer prompt does NOT contain linked rule body"({ promptQueue }) {
                const reviewerPrompt = promptQueue[3]!;
                Assert.ok(!reviewerPrompt.includes("UNIQUE_REVIEWER_RULE_ALPHA"), "linked rule content must NOT be inlined in branch A reviewer");
            }
        }
    });

    test("branch B: prepActive=false — reviewer is fresh and prompt inlines linked content", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = { worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "codex", model: "", effort: "" }] };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles(
                "`contracts/linked-c.md`.",
                "`rules/linked-r.md`."
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/contracts/linked-c.md", "UNIQUE_REVIEWER_CONTRACT_BETA");
            s.files.set("/project/rules/linked-r.md", "UNIQUE_REVIEWER_RULE_BETA");
            s.files.set("/project/contracts/unlinked-global.md", "UNLINKED_REVIEWER_GLOBAL_SNIPPET");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "worker done", sessionId: "worker-rev-b" });
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, codexSpawnedArgs, promptQueue }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, codexSpawnedArgs, promptQueue };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer has no fork subcommand"({ codexSpawnedArgs }) {
                Assert.ok(!codexSpawnedArgs[0]!.includes("fork"), "reviewer must not use fork in branch B");
            },
            "reviewer has no resume subcommand"({ codexSpawnedArgs }) {
                Assert.ok(!codexSpawnedArgs[0]!.includes("resume"), "reviewer must not use resume in branch B");
            },
            "reviewer prompt contains linked contract body"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=worker, [2]=reviewer
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(reviewerPrompt.includes("UNIQUE_REVIEWER_CONTRACT_BETA"), "linked contract content must be inlined in branch B reviewer");
            },
            "reviewer prompt contains linked rule body"({ promptQueue }) {
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(reviewerPrompt.includes("UNIQUE_REVIEWER_RULE_BETA"), "linked rule content must be inlined in branch B reviewer");
            },
            "reviewer prompt does NOT contain unlinked global file content"({ promptQueue }) {
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(!reviewerPrompt.includes("UNLINKED_REVIEWER_GLOBAL_SNIPPET"), "unlinked file content must NOT be inlined in reviewer");
            }
        }
    });

    test("branch A: across two iterations, both reviewer calls fork from the same prep session id", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const plan = planWithLinkedFiles(
                "`contracts/linked-c.md`.",
                "`rules/linked-r.md`."
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/contracts/linked-c.md", "ALPHA_2ITER_CONTRACT");
            s.files.set("/project/rules/linked-r.md", "ALPHA_2ITER_RULE");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "READY", sessionId: "prep-rev-2iter" });
            s.claudeQueue.push({ text: "w1", sessionId: "worker-rev-2iter" });
            s.claudeQueue.push({ text: "found issues", errorLog: "fix it" });
            extraWorkerAdds(s.gitQueue, 1); // iter 1 (review fails) still runs a post-worker add
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
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
            "reviewer iter 1 forks from prep"({ claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep, [2]=worker1, [3]=reviewer1, [4]=worker2, [5]=reviewer2
                Assert.strictEqual(claudeSpawnedArgs[3]![1], "prep-rev-2iter");
                Assert.ok(claudeSpawnedArgs[3]!.includes("--fork-session"));
            },
            "reviewer iter 2 forks from same prep"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[5]![1], "prep-rev-2iter");
                Assert.ok(claudeSpawnedArgs[5]!.includes("--fork-session"));
            },
            "reviewer iter 1 prompt does NOT contain linked contract body"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("ALPHA_2ITER_CONTRACT"), "branch A reviewer iter 1 must not inline contract content");
            },
            "reviewer iter 1 prompt does NOT contain linked rule body"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("ALPHA_2ITER_RULE"), "branch A reviewer iter 1 must not inline rule content");
            },
            "reviewer iter 2 prompt does NOT contain linked contract body"({ promptQueue }) {
                Assert.ok(!promptQueue[5]!.includes("ALPHA_2ITER_CONTRACT"), "branch A reviewer iter 2 must not inline contract content");
            },
            "reviewer iter 2 prompt does NOT contain linked rule body"({ promptQueue }) {
                Assert.ok(!promptQueue[5]!.includes("ALPHA_2ITER_RULE"), "branch A reviewer iter 2 must not inline rule content");
            }
        }
    });
});

test.describe("Implement multiple parallel reviewers", test => {
    test("two reviewers, mixed config — per-reviewer branch A/B coexists in one review round", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [
                    { tool: "claude", model: "", effort: "" }, // matches worker → branch A (fork prep)
                    { tool: "codex", model: "", effort: "" }   // differs from worker → branch B (fresh + inline)
                ]
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            const plan = planWithLinkedFiles(
                "`contracts/linked-c.md`.",
                "`rules/linked-r.md`."
            );
            s.files.set(PLAN_PATH, plan);
            s.files.set("/project/contracts/linked-c.md", "MIXED_CONTRACT_SNIPPET");
            s.files.set("/project/rules/linked-r.md", "MIXED_RULE_SNIPPET");
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // detect, prep (captures PREP-MIXED), worker — 3 claude spawns
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-MIXED" });
            s.claudeQueue.push({ text: "worker done", sessionId: "WORKER-MIXED" });
            // reviewer 1 (claude, matches worker → branch A, forks prep)
            s.claudeQueue.push({ text: "reviewer 1 ok", errorLog: "" });
            // reviewer 2 (codex, does not match worker → branch B, fresh)
            s.codexQueue.push({ text: "reviewer 2 ok", errorLog: "" });
            return s;
        },
        async ACT({ contexts, promptQueue, claudeSpawnedArgs, codexSpawnedArgs }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, promptQueue, claudeSpawnedArgs, codexSpawnedArgs };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer 1 prompt references reviewer 1's own per-reviewer-folder error.log"({ promptQueue }) {
                // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer-claude, [4]=reviewer-codex
                Assert.ok(promptQueue[3]!.includes(reviewerErrorLogPath(1)));
            },
            "reviewer 2 prompt references reviewer 2's own per-reviewer-folder error.log"({ promptQueue }) {
                Assert.ok(promptQueue[4]!.includes(reviewerErrorLogPath(2)));
            },
            "branch A: claude reviewer args[0] is --resume"({ claudeSpawnedArgs }) {
                // claudeSpawnedArgs: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer-claude
                Assert.strictEqual(claudeSpawnedArgs[3]![0], "--resume");
            },
            "branch A: claude reviewer args[1] equals the prep session id"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs[3]![1], "PREP-MIXED");
            },
            "branch A: claude reviewer args include --fork-session"({ claudeSpawnedArgs }) {
                Assert.ok(claudeSpawnedArgs[3]!.includes("--fork-session"));
            },
            "branch B: codex reviewer does NOT use the fork subcommand"({ codexSpawnedArgs }) {
                Assert.ok(!codexSpawnedArgs[0]!.includes("fork"));
            },
            "branch B: codex reviewer does NOT use the resume subcommand"({ codexSpawnedArgs }) {
                Assert.ok(!codexSpawnedArgs[0]!.includes("resume"));
            },
            "branch A: claude reviewer prompt does NOT inline linked contract body"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("MIXED_CONTRACT_SNIPPET"), "branch A must not inline linked contract content");
            },
            "branch A: claude reviewer prompt does NOT inline linked rule body"({ promptQueue }) {
                Assert.ok(!promptQueue[3]!.includes("MIXED_RULE_SNIPPET"), "branch A must not inline linked rule content");
            },
            "branch B: codex reviewer prompt DOES inline linked contract body"({ promptQueue }) {
                Assert.ok(promptQueue[4]!.includes("MIXED_CONTRACT_SNIPPET"), "branch B must inline linked contract content");
            },
            "branch B: codex reviewer prompt DOES inline linked rule body"({ promptQueue }) {
                Assert.ok(promptQueue[4]!.includes("MIXED_RULE_SNIPPET"), "branch B must inline linked rule content");
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
                    { tool: "claude", model: "", effort: "" },
                    { tool: "codex", model: "", effort: "" }
                ]
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push(PREP_RESPONSE);
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
                    { tool: "claude", model: "", effort: "" },
                    { tool: "codex", model: "", effort: "" }
                ]
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
            s.claudeQueue.push(PREP_RESPONSE);
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
                    { tool: "claude", model: "", effort: "" },
                    { tool: "codex", model: "", effort: "" }
                ]
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
            s.claudeQueue.push(PREP_RESPONSE);
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
                    { tool: "claude", model: "", effort: "" },
                    { tool: "codex", model: "", effort: "" }
                ]
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
            s.claudeQueue.push(PREP_RESPONSE);
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
                    { tool: "claude", model: "", effort: "" },
                    { tool: "claude", model: "", effort: "" }
                ]
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push(PREP_RESPONSE);
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
            "6 claude spawns: detect, prep, worker, reviewer1, reviewer2, reviewer2-relaunch"({ claudeSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 6);
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
                    { tool: "claude", model: "", effort: "" },
                    { tool: "claude", model: "", effort: "" }
                ]
            };
            s.files.set(CONFIG_PATH, JSON.stringify(config));
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker done" });
            // Two reviewer spawns that never complete (held processes)
            const killed:number[] = [];
            const heldProcs:FakeProcess[] = [];
            let reviewerSpawnIdx = 0;
            const origSpawn = s.contexts.claude.spawn;
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = (cmd, args, opts) => {
                if (s.claudeSpawnedArgs.length >= 3) {
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
                // Reviewer differs from worker → branch B (no prep). Distinct model/effort lets the test
                // verify the reviewing footer renders the configured per-reviewer fields verbatim.
                reviewers: [
                    { tool: "claude", model: "claude-opus-4-1", effort: "high" }
                ]
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
                    // First reviewer call (after detect + worker, no prep because branch B): rate-limit.
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
                const plan = s.files.get(PLAN_PATH)!;
                // detect (1s, branch B no prep) → 1000 (task starts here)
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
                Assert.strictEqual(last.reviewers![0]!.state, "ok");
            },
            "state transition order: running → waiting → running → ok"({}, { footerCalls }) {
                const states = footerCalls.filter(c => c.kind === "reviewing").map(s => s.reviewers![0]!.state);
                const compressed:string[] = [];
                for (const st of states) {
                    if (compressed[compressed.length - 1] !== st) compressed.push(st);
                }
                Assert.deepStrictEqual(compressed, ["running", "waiting", "running", "ok"]);
            }
        }
    });

    test("FAIL verdict surfaces as reviewer state = fail in the final reviewing snapshot", {
        ARRANGE() {
            const s = stubContexts();
            gitRunQueue(s.gitQueue);
            const config:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [{ tool: "claude", model: "", effort: "" }]
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
            s.claudeQueue.push(PREP_RESPONSE);
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
                Assert.strictEqual(last.reviewers![0]!.state, "ok");
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
                reviewers: [{ tool: "claude", model: "", effort: "" }]
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
                if (spawnCount === 4) {
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
            s.claudeQueue.push(PREP_RESPONSE);
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
                Assert.strictEqual(last.reviewers![0]!.state, "ok");
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
                    { tool: "claude", model: "", effort: "" },
                    { tool: "claude", model: "", effort: "" }
                ]
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
                // until the test fires the gate. Every other spawn (detect, prep, worker,
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
            s.claudeQueue.push(PREP_RESPONSE);                        // prep
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
                        && lastReviewing.reviewers![0]!.state === "ok"
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
                Assert.deepStrictEqual(snapshotWhileR2InFlight, [{ state: "ok" }, { state: "running" }]);
            },
            "final reviewing snapshot is ['ok','ok'] after reviewer 2 completes"({}, { footerCalls }) {
                const reviewingSnapshots = footerCalls.filter(c => c.kind === "reviewing");
                const last = reviewingSnapshots[reviewingSnapshots.length - 1]!;
                Assert.deepStrictEqual(last.reviewers, [{ state: "ok" }, { state: "ok" }]);
            }
        }
    });
});
