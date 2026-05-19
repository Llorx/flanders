import * as Assert from "assert";

import test from "arrange-act-assert";

import { Implement } from "./Implement";
import type { ImplementContexts } from "./Implement";
import type { OutputContext, SpawnedProcess, TimeContext, TimeoutHandle } from "../contexts";
import { BottomBlock } from "../ui/BottomBlock";
import type { HeaderFields, MetricsFields, TerminalLabel } from "../ui/BottomBlock";
import { CYAN, YELLOW, MAGENTA, GREEN, BLUE, DIM, SEPARATOR_GLYPH } from "../ui/formatters";

function stripAnsi(s:string):string {
    return s.replace(/\x1b\[[0-9;]*m/g, "");
}

type FakeProcess = SpawnedProcess & {
    $emitStdout(chunk:string):void;
    $emitStderr(chunk:string):void;
    $emit(event:"exit", code:number|null):void;
    $emit(event:"error", e:unknown):void;
};

function fakeProcess():FakeProcess {
    const exitListeners:Array<(code:number|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stdoutListeners:Array<(chunk:Buffer|string) => void> = [];
    const stderrListeners:Array<(chunk:Buffer|string) => void> = [];
    return {
        kill() {},
        on(event:"exit"|"error", listener:((code:number|null) => void)|((e:unknown) => void)) {
            if (event === "exit") exitListeners.push(listener as (code:number|null) => void);
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
        $emit(event:string, payload:unknown) {
            if (event === "exit") for (const l of exitListeners) l(payload as number|null);
            else if (event === "error") for (const l of errorListeners) l(payload);
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
        type: "rate_limit_event",
        rate_limit_info: {
            status: "rejected",
            resetsAt: Math.ceil((nowMs + retryAfterSeconds * 1000) / 1000),
            rateLimitType: "five_hour",
            isUsingOverage: false,
            overageStatus: "rejected"
        }
    });
}

type ClaudeResponse = { text:string; inputTokens?:number; outputTokens?:number; sessionId?:string; error?:true; stderr?:string };
type ScriptResponse = { code:number; stdout:string; stderr:string };

function stubContexts() {
    const files = new Map<string, string>();
    const rmCalls:string[] = [];
    const written:string[] = [];
    const errors:string[] = [];

    const claudeQueue:ClaudeResponse[] = [];
    const promptQueue:string[] = [];
    const scriptQueue:ScriptResponse[] = [];
    const gitQueue:ScriptResponse[] = [];
    const gitSpawns:Array<{command:string; args:readonly string[]}> = [];
    const claudeSpawnedArgs:string[][] = [];

    const contexts:ImplementContexts = {
        claude: {
            spawn(_command:string, args:readonly string[]) {
                claudeSpawnedArgs.push([...args]);
                const proc = fakeProcess();
                const origStdin = proc.stdin!;
                (proc as any).stdin = {
                    write(chunk:string) { origStdin.write(chunk); try { const p = JSON.parse(chunk.trim()); if (p.type === "user" && p.message?.content) { promptQueue.push(p.message.content); } } catch {} },
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
            readdir() { return Promise.resolve([]); },
            stat(p) {
                if (files.has(p)) return Promise.resolve({ size: files.get(p)!.length, isFile: true, isDirectory: false });
                return Promise.reject(new Error("not found: " + p));
            },
            exists(p) { return Promise.resolve(files.has(p)); },
            mkdir() { return Promise.resolve(); },
            mkdtemp(prefix) { return Promise.resolve(prefix + "ws123"); },
            rm(p:string) { rmCalls.push(p); return Promise.resolve(); }
        },
        time: {
            now() { return 0; },
            setTimeout(handler, ms):TimeoutHandle {
                const id = globalThis.setTimeout(handler, ms);
                return { cancel() { globalThis.clearTimeout(id); } };
            }
        },
        platform: {
            isWindows() { return false; },
            tmpdir() { return "/tmp"; },
            homedir() { return "/home/test"; }
        },
        ask: {
            askChoices() { return Promise.resolve([]); },
            askText() { return Promise.resolve(""); }
        },
        output: {
            write(text) { written.push(text); },
            writeError(text) { errors.push(text); },
            columns() { return 80; },
            rows() { return 24; },
            onResize() { return () => {}; }
        }
    };
    return { contexts, files, rmCalls, written, errors, claudeQueue, promptQueue, scriptQueue, gitQueue, gitSpawns, claudeSpawnedArgs };
}

const PLAN_PATH = "/project/plans/test.md";
const PLAN_ONE_TASK = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Implement feature A\n';
const WS_ROOT = "/tmp/flanders-ws123";
const PREP_RESPONSE:ClaudeResponse = { text: "READY", sessionId: "prep-session" };

test.describe("Implement per-iteration logs", test => {
    test("writes all four log files after one successful iteration", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            // Claude run 1: detect build/test (no scripts written)
            s.claudeQueue.push({ text: "No build or test scripts needed." });
            // Claude run 2: prep
            s.claudeQueue.push(PREP_RESPONSE);
            // Claude run 3: worker
            s.claudeQueue.push({ text: "Worker output for feature A" });
            // Script run 1: build (skipped — no build script)
            // Script run 2: test (skipped — no test script)
            // Claude run 3: reviewer
            s.claudeQueue.push({ text: "Looks good.\n\nPASS" });
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
            Assert.ok(files.has(WS_ROOT + "/reviewer.1.log"), "reviewer.1.log should exist");
            Assert.ok(files.get(WS_ROOT + "/reviewer.1.log")!.includes("Looks good."));
            Assert.ok(files.get(WS_ROOT + "/reviewer.1.log")!.includes("Verdict: PASS"));
        }
    });

    test("writes build and test logs when scripts exist", {
        ARRANGE() {
            const s = stubContexts();
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
            s.claudeQueue.push({ text: "PASS" });
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
            s.claudeQueue.push({ text: "PASS" });
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
            s.claudeQueue.push({ text: "PASS" });
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
            const errorLog = files.get(WS_ROOT + "/error.log")!;
            Assert.ok(errorLog.includes("err2"), "error.log should contain last failure");
            Assert.ok(!errorLog.includes("err1"), "error.log should not contain first failure");
        }
    });

    test("reviewer FAIL writes reviewer log with verdict and preserves across iterations", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker ok, build/test skipped, reviewer fails
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "Missing edge case.\n\nFAIL needs error handling" });
            // iter 2: worker ok, reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
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
            const rev1 = files.get(WS_ROOT + "/reviewer.1.log")!;
            Assert.ok(rev1.includes("Missing edge case."));
            Assert.ok(rev1.includes("Verdict: FAIL needs error handling"));
            const rev2 = files.get(WS_ROOT + "/reviewer.2.log")!;
            Assert.ok(rev2.includes("Verdict: PASS"));
        }
    });

    test("hard stop message points to workspace with per-iteration logs", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep runs once per task, before the iteration loop
            s.claudeQueue.push(PREP_RESPONSE);
            // 5 iterations of worker success + reviewer failure => hard stop at iter 6
            for (let i = 0; i < 5; i++) {
                s.claudeQueue.push({ text: `worker iter ${i + 1}` });
                s.claudeQueue.push({ text: "FAIL not good enough" });
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
                Assert.ok(files.has(WS_ROOT + "/reviewer.5.log"), "iteration 5 reviewer log preserved");
            },
            "workspace folder is not removed on dispose"(_code, { rmCalls }) {
                Assert.ok(!rmCalls.includes(WS_ROOT), "fs.rm should not be called with workspace root");
            }
        }
    });

    test("non-hard-stop run still removes the workspace on dispose", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker output line\n" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "make");
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "implemented" });
            s.scriptQueue.push({ code: 0, stdout: "build stdout line\n", stderr: "build stderr line\n" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "echo");
            const proc = fakeProcess();
            let spawnCount = 0;
            (s.contexts.script as { spawn:typeof s.contexts.script.spawn }).spawn = () => {
                spawnCount++;
                if (spawnCount === 1) {
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
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "echo");
            s.scriptQueue.push({ code: 0, stdout: "\x1b[31mred text\x1b[0m\n", stderr: "" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "implemented" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, "# Plan\n\n- [done] bad checkbox\n");
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
            "malformed error appears in output via writeAbove"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("malformed"), "plan error should appear in output above block");
            },
            "error appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                const malformedIdx = allOutput.indexOf("malformed");
                const clearBefore = allOutput.lastIndexOf(CLEAR_SEQ, malformedIdx);
                Assert.ok(malformedIdx !== -1 && clearBefore !== -1, "error text should be preceded by block clear");
            }
        }
    });
});

test.describe("Implement block present on early routes", test => {
    test("unknown flag keeps block present and emits error above the block", {
        ARRANGE() {
            const s = stubContexts();
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
            s.files.set(PLAN_PATH, "# Plan\n\n- [done] bad1\n- [nope] bad2\n");
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
            "first malformed line appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("bad1"), "first malformed line appears");
                const clearBefore = allOutput.lastIndexOf(CLEAR_SEQ, allOutput.indexOf("bad1"));
                Assert.ok(clearBefore !== -1, "first malformed line should be preceded by block clear");
            },
            "second malformed line appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("bad2"), "second malformed line appears");
                const clearBefore = allOutput.lastIndexOf(CLEAR_SEQ, allOutput.indexOf("bad2"));
                Assert.ok(clearBefore !== -1, "second malformed line should be preceded by block clear");
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
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("commit or stash"), "error text should appear in output");
                const clearIdx = allOutput.lastIndexOf(CLEAR_SEQ, allOutput.indexOf("commit or stash"));
                Assert.ok(clearIdx !== -1, "error should be preceded by block clear");
            }
        }
    });
});

test.describe("Implement interactive plan prompt routed through block", test => {
    const PLAN_A = '# Plan A\n\n- [ ]{"it":0,"ot":0,"t":0} Task A\n';
    const PLAN_B = '# Plan B\n\n- [ ]{"it":0,"ot":0,"t":0} Task B\n';

    function withMultiplePlans(s:ReturnType<typeof stubContexts>) {
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
    }

    test("valid plan selection writes question text above the block", {
        ARRANGE() {
            const s = stubContexts();
            withMultiplePlans(s);
            (s.contexts.ask as any).askChoices = (_questions:any, output?:OutputContext) => {
                if (output) {
                    output.write("[?] Plan file: Which one?\n");
                    output.write("  1) plan-a.md\n");
                    output.write("  2) plan-b.md\n");
                }
                return Promise.resolve([{ picked: [{ label: "plan-a.md" }] }]);
            };
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "block separator is present"(_code, { written }) {
                Assert.ok(written.join("").includes(SEP.repeat(80)), "block should be present");
            },
            "question text appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("[?] Plan file: Which one?"), "question text should appear in output");
                const questionIdx = allOutput.indexOf("[?] Plan file: Which one?");
                const clearBefore = allOutput.lastIndexOf(CLEAR_SEQ, questionIdx);
                Assert.ok(clearBefore !== -1, "question should be preceded by block clear");
            },
            "option text appears in output"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("plan-a.md"), "first option should appear");
                Assert.ok(allOutput.includes("plan-b.md"), "second option should appear");
            }
        }
    });

    test("invalid response triggers retry message above the block then succeeds", {
        ARRANGE() {
            const s = stubContexts();
            withMultiplePlans(s);
            let callCount = 0;
            (s.contexts.ask as any).askChoices = (_questions:any, output?:OutputContext) => {
                callCount++;
                if (output) {
                    output.write(`[?] attempt ${callCount}\n`);
                }
                if (callCount === 1) {
                    return Promise.resolve([{ picked: [] }]);
                }
                return Promise.resolve([{ picked: [{ label: "plan-a.md" }] }]);
            };
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "retry message appears via writeAbove (preceded by block clear)"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("Please pick one of the listed plans by its number."), "retry message should appear");
                const retryIdx = allOutput.indexOf("Please pick one of the listed plans by its number.");
                const clearBefore = allOutput.lastIndexOf(CLEAR_SEQ, retryIdx);
                Assert.ok(clearBefore !== -1, "retry message should be preceded by block clear");
            },
            "second attempt question text appears via writeAbove"(_code, { written }) {
                const allOutput = written.join("");
                Assert.ok(allOutput.includes("[?] attempt 2"), "second attempt question should appear");
                const attempt2Idx = allOutput.indexOf("[?] attempt 2");
                const clearBefore = allOutput.lastIndexOf(CLEAR_SEQ, attempt2Idx);
                Assert.ok(clearBefore !== -1, "second attempt should be preceded by block clear");
            },
            "block separator is present"(_code, { written }) {
                Assert.ok(written.join("").includes(SEP.repeat(80)), "block should be present");
            }
        }
    });
});

test.describe("Implement intermediate header and metrics states", test => {
    test("noop tasks completed shows header N/N and plan metrics", {
        ARRANGE() {
            const s = stubContexts();
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
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.files.set(WS_ROOT + "/test.sh", "test");
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
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
            const numberedPlan = '# Plan\n\n## 3. Section\n\n### 3.2 Subsection\n\n- [ ]{"it":0,"ot":0,"t":0} Do the thing\n';
            s.files.set(PLAN_PATH, numberedPlan);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            (s.contexts.output as any).columns = () => 20;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "FAIL not ready" });
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
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
            const numberedPlan = '# Plan\n\n## 3. Section\n\n- [ ]{"it":0,"ot":0,"t":0} Do the thing\n';
            s.files.set(PLAN_PATH, numberedPlan);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
    const time = controllableTime();
    (s.contexts as any).time = time.ctx;
    s.files.set(PLAN_PATH, PLAN_ONE_TASK);
    let spawnCount = 0;
    (s.contexts.claude as any).spawn = () => {
        spawnCount++;
        const proc = fakeProcess();
        if (spawnCount === rateLimitOnSpawn) {
            setImmediate(() => {
                proc.$emitStdout(rateLimitEvent(time.ctx.now(), retryAfterSeconds) + "\n");
                proc.$emit("exit", 1);
            });
        } else {
            const response = s.claudeQueue.shift()!;
            setImmediate(() => {
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

test.describe("Implement rate-limit footer", test => {
    test("footer switches to rate-limit state during Claude wait", {
        ARRANGE() {
            const { s, time } = rateLimitStub(2, 300);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.claudeQueue.push({ text: "PASS" });
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
            s.claudeQueue.push({ text: "PASS" });
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
            s.claudeQueue.push({ text: "PASS" });
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
            s.claudeQueue.push({ text: "PASS" });
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
            s.claudeQueue.push({ text: "PASS" });
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

test.describe("Implement cleanup on exit", test => {
    test("dispose during active Claude session stops timers but block stays visible", {
        ARRANGE() {
            const s = stubContexts();
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep runs once per task, before the iteration loop
            s.claudeQueue.push(PREP_RESPONSE);
            for (let i = 0; i < 5; i++) {
                s.claudeQueue.push({ text: `worker iter ${i + 1}` });
                s.claudeQueue.push({ text: "FAIL not good enough" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "FAIL not ready", inputTokens: 80, outputTokens: 30 });
            s.claudeQueue.push({ text: "w2", inputTokens: 120, outputTokens: 60 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 90, outputTokens: 40 });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.files.set(WS_ROOT + "/test.sh", "test");
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
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
            Assert.ok(plan.includes('[x]{"it":180,"ot":80,"t":0}'), `tokens should only come from Claude calls, got: ${plan}`);
        }
    });

    test("active seconds reflect elapsed time with scripts", {
        ARRANGE() {
            const s = stubContexts();
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
            s.claudeQueue.push({ text: "PASS", inputTokens: 10, outputTokens: 5 });
            return { s };
        },
        async ACT({ s }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { s }) {
            Assert.strictEqual(code, 0);
            const plan = s.files.get(PLAN_PATH)!;
            // detect at time=0, advances to 5000
            // task starts at time=5000 (_taskStartedAt=5000)
            // worker spawn advances to 8000
            // build spawn advances to 12000
            // reviewer spawn advances to 14000
            // active = (14000 - 5000) / 1000 = 9
            Assert.ok(plan.includes('"t":9}'), `plan should reflect elapsed time including scripts, got: ${plan}`);
        }
    });

    test("persisted t excludes rate-limit window", {
        ARRANGE() {
            const s = stubContexts();
            const time = controllableTime();
            (s.contexts as any).time = time.ctx;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            let spawnCount = 0;
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = () => {
                spawnCount++;
                const proc = fakeProcess();
                if (spawnCount === 1) {
                    time.advance(2000);
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    });
                } else if (spawnCount === 2) {
                    time.advance(1000);
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    });
                } else if (spawnCount === 3) {
                    time.advance(1000);
                    setImmediate(() => {
                        proc.$emitStdout(rateLimitEvent(time.ctx.now(), 10) + "\n");
                        proc.$emit("exit", 1);
                    });
                } else if (spawnCount === 4) {
                    time.advance(1000);
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
                        proc.$emitStdout(claudeResultEvents(response.text, response.inputTokens, response.outputTokens, response.sessionId));
                        proc.$emit("exit", 0);
                    });
                } else {
                    time.advance(2000);
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
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
            s.claudeQueue.push({ text: "PASS", inputTokens: 50, outputTokens: 25 });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok", inputTokens: 500, outputTokens: 200 });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
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
            const time = controllableTime();
            (s.contexts as any).time = time.ctx;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            let spawnCount = 0;
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = () => {
                spawnCount++;
                const proc = fakeProcess();
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
            s.claudeQueue.push({ text: "PASS", inputTokens: 50, outputTokens: 25 });
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
            // reviewer rate-limited (1s spawn + 3s wait) → 13000
            // reviewer retry (1s) → 14000
            // active = (14000 - 1000 - 8000) / 1000 = 5
            Assert.ok(plan.includes('"t":5}'), `t should exclude both rate-limit windows, got: ${plan}`);
        }
    });

    test("rate-limit before any task is picked does not affect task accumulator", {
        ARRANGE() {
            const s = stubContexts();
            const time = controllableTime();
            (s.contexts as any).time = time.ctx;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            let spawnCount = 0;
            (s.contexts.claude as { spawn:typeof s.contexts.claude.spawn }).spawn = () => {
                spawnCount++;
                const proc = fakeProcess();
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
            s.claudeQueue.push({ text: "PASS", inputTokens: 50, outputTokens: 25 });
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
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
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

    test("setMetrics is called after each Claude call with expected structured data", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 1000, outputTokens: 500 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 800, outputTokens: 300 });
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
                if (spawnCount === 4) {
                    new Promise<void>(r => { releaseReviewer = r; }).then(() => {
                        setImmediate(() => {
                            proc.$emitStdout(claudeResultEvents("PASS", 800, 300));
                            proc.$emit("exit", 0);
                        });
                    });
                } else {
                    const response = s.claudeQueue.shift()!;
                    setImmediate(() => {
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 1000, outputTokens: 500 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 800, outputTokens: 300 });
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
            s.files.set(PLAN_PATH, PLAN_TWO_TASKS);
            s.claudeQueue.push({ text: "ok" });
            // Task 1: worker + reviewer
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
            // Task 2: prep + worker + reviewer
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w2", inputTokens: 200, outputTokens: 100 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 120, outputTokens: 60 });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 1500, outputTokens: 500 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 1000, outputTokens: 300 });
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
            (s.contexts.output as any).columns = () => 10;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
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
            s.files.set(PLAN_PATH, PLAN_TWO_TASKS);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w2", inputTokens: 200, outputTokens: 100 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 120, outputTokens: 60 });
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
            s.files.set(PLAN_PATH, PLAN_TWO_TASKS);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w2", inputTokens: 200, outputTokens: 100 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 120, outputTokens: 60 });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker", inputTokens: 100, outputTokens: 50 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 80, outputTokens: 30 });
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

test.describe("Implement --no-git flag parsing", test => {
    test("--no-git with auto-discovered plan selects the plan and succeeds", {
        ARRANGE() {
            const s = stubContexts();
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
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git"], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 0);
        }
    });

    test("--no-git after plan path is equivalent to --no-git before plan path", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts, files }) {
            const cmd1 = new Implement([PLAN_PATH, "--no-git"], { projectRoot: "/project" }, contexts);
            const code1 = await cmd1.result();
            await cmd1.dispose();
            files.set(PLAN_PATH, PLAN_ONE_TASK);
            const cmd2 = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code2 = await cmd2.result();
            await cmd2.dispose();
            return { code1, code2 };
        },
        ASSERT({ code1, code2 }) {
            Assert.strictEqual(code1, 0, "plan.md --no-git should succeed");
            Assert.strictEqual(code2, 0, "--no-git plan.md should succeed");
        }
    });

    test("flag absent — normal invocation still works", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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

test.describe("Implement git activation", test => {
    test("--no-git flag prevents all git spawn calls", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { gitSpawns }) {
            Assert.strictEqual(code, 0);
            Assert.strictEqual(gitSpawns.length, 0, "no git calls should be made when --no-git is set");
        }
    });

    test("git not available — only git --version is spawned, no work-tree check", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 1, stdout: "", stderr: "" });
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            Assert.strictEqual(gitSpawns.length, 1, "should only spawn git --version");
            Assert.deepStrictEqual(gitSpawns[0]!.args, ["--version"]);
        }
    });

    test("git available but not inside work tree — both checks spawned, no error", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "false\n", stderr: "" });
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { gitSpawns, errors }) {
            Assert.strictEqual(code, 0);
            Assert.strictEqual(gitSpawns.length, 2, "should spawn git --version and git rev-parse");
            Assert.deepStrictEqual(gitSpawns[0]!.args, ["--version"]);
            Assert.deepStrictEqual(gitSpawns[1]!.args, ["rev-parse", "--is-inside-work-tree"]);
            Assert.strictEqual(errors.length, 0, "not inside work tree should not produce an error");
        }
    });

    test("git available and inside work tree — gitActive is true, command completes", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            // git add + commit after task accepted
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
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
            Assert.ok(gitSpawns.length >= 2, "should spawn both git checks");
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
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            // git add + commit after task accepted
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
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
            "asks to commit or stash"(_code, { written }) {
                Assert.ok(written.join("").includes("commit or stash"));
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
            "workspace is not set up"(_code, { files }) {
                Assert.ok(!files.has(WS_ROOT + "/build.sh"));
            }
        }
    });

    test("gitActive false — no git status spawned", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { gitSpawns }) {
            Assert.strictEqual(code, 0, "should complete without error");
            const statusSpawns = gitSpawns.filter(s => s.args[0] === "status");
            Assert.strictEqual(statusSpawns.length, 0, "no git status should be spawned when gitActive is false");
        }
    });
});

test.describe("Implement commit per task", test => {
    test("gitActive false — no git invocations during _runTask, plan marked done, snapshot emitted", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { gitSpawns, files, written }) {
            Assert.strictEqual(code, 0);
            Assert.strictEqual(gitSpawns.length, 0, "no git calls when --no-git");
            const plan = files.get(PLAN_PATH)!;
            Assert.ok(plan.includes("[x]"), "plan should be marked done");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes("done"), "snapshot should be emitted");
        }
    });

    test("gitActive true, both git commands succeed — add and commit appear in order with correct message", {
        ARRANGE() {
            const s = stubContexts();
            const numberedPlan = '# Plan\n\n## 3. Section\n\n- [ ]{"it":0,"ot":0,"t":0} 3.1 Validate input\n';
            s.files.set(PLAN_PATH, numberedPlan);
            // git activation: --version, rev-parse, status
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            // git add -A + git commit
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
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
            // After preflight (3 git calls), expect exactly add + commit
            const postPreflight = gitSpawns.slice(3);
            Assert.strictEqual(postPreflight.length, 2, "should have exactly 2 git calls after preflight");
            Assert.deepStrictEqual(postPreflight[0]!.args, ["add", "-A"]);
            Assert.strictEqual(postPreflight[1]!.args[0], "commit");
            Assert.strictEqual(postPreflight[1]!.args[1], "--allow-empty");
            Assert.strictEqual(postPreflight[1]!.args[2], "-m");
            Assert.strictEqual(postPreflight[1]!.args[3], "3 3.1 Validate input");
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
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker + reviewer pass, add fails
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "PASS" });
            s.gitQueue.push({ code: 128, stdout: "", stderr: "add error output\n" });
            // iter 2: worker + reviewer pass, add + commit succeed
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
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
            const errorLog = files.get(WS_ROOT + "/error.log")!;
            Assert.ok(errorLog.includes("git add -A failed (exit 128)"), "error.log should describe add failure");
            Assert.ok(errorLog.includes("add error output"), "error.log should contain stderr");
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
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker + reviewer pass, add succeeds, commit fails
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "PASS" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // add ok
            s.gitQueue.push({ code: 1, stdout: "hook output\n", stderr: "pre-commit hook failed\n" }); // commit fails
            // iter 2: worker + reviewer pass, add + commit succeed
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
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
            const errorLog = files.get(WS_ROOT + "/error.log")!;
            Assert.ok(errorLog.includes("git commit failed (exit 1)"), "error.log should describe commit failure");
            Assert.ok(errorLog.includes("pre-commit hook failed"), "error.log should contain stderr");
            Assert.ok(errorLog.includes("hook output"), "error.log should contain stdout");
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
            s.claudeQueue.push({ text: "ok" });
            // prep runs once per task, before the iteration loop
            s.claudeQueue.push(PREP_RESPONSE);
            // 5 iterations: worker + reviewer pass, add succeeds, commit fails each time
            for (let i = 0; i < 5; i++) {
                s.claudeQueue.push({ text: `w${i + 1}` });
                s.claudeQueue.push({ text: "PASS" });
                s.gitQueue.push({ code: 0, stdout: "", stderr: "" }); // add ok
                s.gitQueue.push({ code: 1, stdout: "", stderr: "hook failed\n" }); // commit fails
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
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
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

function gitActivationQueue(gitQueue:ScriptResponse[]):void {
    gitQueue.push({ code: 0, stdout: "git version 2.40.0\n", stderr: "" });
    gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });
    gitQueue.push({ code: 0, stdout: "", stderr: "" });
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
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "[main abc1234] 1 Build the parser\n", stderr: "" });
            // Task 2: prep → worker → build → test → reviewer
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "validation added" });
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "[main def5678] 2 Add validation\n", stderr: "" });
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
            const postPreflight = gitSpawns.slice(3);
            Assert.strictEqual(postPreflight.length, 4, "should have exactly 4 git calls after preflight (add+commit per task)");
            Assert.deepStrictEqual(postPreflight[0]!.args, ["add", "-A"]);
            Assert.strictEqual(postPreflight[1]!.args[0], "commit");
            Assert.strictEqual(postPreflight[1]!.args[3], "1 Build the parser");
            Assert.deepStrictEqual(postPreflight[2]!.args, ["add", "-A"]);
            Assert.strictEqual(postPreflight[3]!.args[0], "commit");
            Assert.strictEqual(postPreflight[3]!.args[3], "2 Add validation");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes("all tasks completed"), "should print all tasks completed");
        }
    });

    test("Scenario B — --no-git disables git even when binary and work tree are available", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.files.set(WS_ROOT + "/build.sh", "npm run build");
            s.files.set(WS_ROOT + "/test.sh", "npm test");
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker output" });
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { gitSpawns, files, written }) {
            Assert.strictEqual(code, 0);
            Assert.strictEqual(gitSpawns.length, 0, "no git calls should appear when --no-git is set");
            const plan = files.get(PLAN_PATH)!;
            Assert.ok(plan.includes("[x]"), "task should be marked done");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes("all tasks completed"), "should print all tasks completed");
        }
    });

    test("Scenario C — git not available, integration inactive, plan completes normally", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.gitQueue.push({ code: 1, stdout: "", stderr: "git: command not found\n" });
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "PASS" });
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
            Assert.strictEqual(gitSpawns.length, 1, "only git --version should be spawned");
            Assert.deepStrictEqual(gitSpawns[0]!.args, ["--version"]);
            const plan = files.get(PLAN_PATH)!;
            Assert.ok(plan.includes("[x]"), "task should be marked done");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes("all tasks completed"), "should print all tasks completed");
        }
    });

    test("Scenario D — preflight fails, exits 1 with block present, no workspace", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            gitActivationQueue(s.gitQueue);
            // Override the status response to report external changes
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
            "asks to commit or stash"(_code, { written }) {
                Assert.ok(written.join("").includes("commit or stash"));
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
            // Iteration 1: worker → build → test → reviewer → add (ok) → commit (fail)
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "iter 1 worker" });
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 1, stdout: "hook output\n", stderr: "pre-commit hook rejected\n" });
            // Iteration 2: worker → build → test → reviewer → add → commit (ok)
            s.claudeQueue.push({ text: "iter 2 worker" });
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
            s.gitQueue.push({ code: 0, stdout: "", stderr: "" });
            s.gitQueue.push({ code: 0, stdout: "[main abc1234] committed\n", stderr: "" });
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
            const errorLog = files.get(WS_ROOT + "/error.log")!;
            Assert.ok(errorLog.includes("git commit failed"), "error.log should describe commit failure");
            Assert.ok(errorLog.includes("pre-commit hook rejected"), "error.log should contain stderr from failed commit");
            Assert.ok(errorLog.includes("hook output"), "error.log should contain stdout from failed commit");
            const plain = stripAnsi(written.join(""));
            Assert.ok(plain.includes("iter 2"), "snapshot should show iter 2");
            Assert.ok(plain.includes("done"), "snapshot should contain done header");
            Assert.ok(plain.includes("all tasks completed"), "should print all tasks completed");
        }
    });
});

function withDirectoryTree(s:ReturnType<typeof stubContexts>, tree:Record<string, Array<{name:string; isFile:boolean; isDirectory:boolean}>>) {
    const origExists = s.contexts.fs.exists;
    (s.contexts.fs as { exists:typeof s.contexts.fs.exists }).exists = (p) => {
        if (p in tree) return Promise.resolve(true);
        return origExists(p);
    };
    const origReaddir = s.contexts.fs.readdir;
    (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = (p) => {
        if (p in tree) return Promise.resolve(tree[p]!);
        return origReaddir(p);
    };
}

test.describe("Implement detect prompt rule list", test => {
    test("detect prompt contains rule paths and substitutes RULE_LIST", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            withDirectoryTree(s, {
                "/project/rules": [
                    { name: "testing", isFile: false, isDirectory: true }
                ],
                "/project/rules/testing": [
                    { name: "runner-flag.md", isFile: true, isDirectory: false }
                ]
            });
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "the command succeeds"(code) {
                Assert.strictEqual(code, 0);
            },
            "the detect prompt contains the rule path"(_code, { promptQueue }) {
                Assert.ok(promptQueue[0]!.includes("rules/testing/runner-flag.md"), "detect prompt should contain rules/testing/runner-flag.md");
            },
            "the RULE_LIST placeholder is substituted"(_code, { promptQueue }) {
                Assert.ok(!promptQueue[0]!.includes("<RULE_LIST>"), "RULE_LIST placeholder should be substituted");
            }
        }
    });

    test("detect prompt shows (none) when rules/ is empty", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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
    test("worker prompt contains contract paths and (none) for absent rules", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            withDirectoryTree(s, {
                "/project/contracts": [
                    { name: "overview.md", isFile: true, isDirectory: false },
                    { name: "ai-skills", isFile: false, isDirectory: true }
                ],
                "/project/contracts/ai-skills": [
                    { name: "contract.md", isFile: true, isDirectory: false }
                ]
            });
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { promptQueue }) {
            Assert.strictEqual(code, 0);
            // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
            const workerPrompt = promptQueue[2]!;
            Assert.ok(workerPrompt.includes("contracts/overview.md"), "worker prompt should contain contracts/overview.md");
            Assert.ok(workerPrompt.includes("contracts/ai-skills/contract.md"), "worker prompt should contain contracts/ai-skills/contract.md");
            Assert.ok(workerPrompt.includes("(none)"), "worker prompt should show (none) for absent rules");
            Assert.ok(!workerPrompt.includes("<RULE_LIST>"), "RULE_LIST placeholder should be substituted");
            Assert.ok(!workerPrompt.includes("<CONTRACT_LIST>"), "CONTRACT_LIST placeholder should be substituted");
        }
    });

    test("worker prompt contains rule paths when rules/ exists", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            withDirectoryTree(s, {
                "/project/rules": [
                    { name: "testing", isFile: false, isDirectory: true }
                ],
                "/project/rules/testing": [
                    { name: "coverage.md", isFile: true, isDirectory: false }
                ]
            });
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { promptQueue }) {
            Assert.strictEqual(code, 0);
            // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
            const workerPrompt = promptQueue[2]!;
            Assert.ok(workerPrompt.includes("rules/testing/coverage.md"), "worker prompt should contain rules/testing/coverage.md");
        }
    });

    test("lists are cached — fs changes after startup are not reflected in prompts", {
        ARRANGE() {
            const s = stubContexts();
            const twoTaskPlan = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task A\n- [ ]{"it":0,"ot":0,"t":0} Task B\n';
            s.files.set(PLAN_PATH, twoTaskPlan);
            let readdirCallCount = 0;
            const origExists = s.contexts.fs.exists;
            (s.contexts.fs as { exists:typeof s.contexts.fs.exists }).exists = (p) => {
                if (p === "/project/contracts") return Promise.resolve(true);
                return origExists(p);
            };
            const origReaddir = s.contexts.fs.readdir;
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = (p) => {
                if (p === "/project/contracts") {
                    readdirCallCount++;
                    if (readdirCallCount === 1) {
                        return Promise.resolve([{ name: "initial.md", isFile: true, isDirectory: false }]);
                    }
                    return Promise.resolve([{ name: "changed.md", isFile: true, isDirectory: false }]);
                }
                return origReaddir(p);
            };
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "PASS" });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
            return { ...s, getReaddirCallCount: () => readdirCallCount };
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { promptQueue, getReaddirCallCount }) {
            Assert.strictEqual(code, 0);
            // promptQueue: [0]=detect, [1]=prep1, [2]=worker1, [3]=reviewer1, [4]=prep2, [5]=worker2, [6]=reviewer2
            const worker1Prompt = promptQueue[2]!;
            const worker2Prompt = promptQueue[5]!;
            Assert.ok(worker1Prompt.includes("contracts/initial.md"), "first worker prompt should contain initial contract");
            Assert.ok(worker2Prompt.includes("contracts/initial.md"), "second worker prompt should still contain initial contract (cached)");
            Assert.ok(!worker2Prompt.includes("contracts/changed.md"), "second worker prompt should NOT contain changed contract");
            Assert.strictEqual(getReaddirCallCount(), 1, "readdir for contracts should be called only once");
        }
    });

    test("lists are identical across tasks and iterations within a single run", {
        ARRANGE() {
            const s = stubContexts();
            const twoTaskPlan = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task A\n- [ ]{"it":0,"ot":0,"t":0} Task B\n';
            s.files.set(PLAN_PATH, twoTaskPlan);
            withDirectoryTree(s, {
                "/project/contracts": [
                    { name: "spec.md", isFile: true, isDirectory: false }
                ],
                "/project/rules": [
                    { name: "style.md", isFile: true, isDirectory: false }
                ]
            });
            s.claudeQueue.push({ text: "ok" });
            // Task A: worker fails, retries, then passes
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "FAIL not ready" });
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
            // Task B: prep + worker + reviewer
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w3" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { promptQueue }) {
            Assert.strictEqual(code, 0);
            // promptQueue: [0]=detect, [1]=prep A, [2]=worker A iter 1, [3]=reviewer A iter 1,
            // [4]=worker A iter 2, [5]=reviewer A iter 2,
            // [6]=prep B, [7]=worker B, [8]=reviewer B
            const extractList = (prompt:string, heading:string):string => {
                const idx = prompt.indexOf(heading);
                if (idx === -1) return "";
                const afterHeading = prompt.indexOf("\n", idx) + 1;
                const descEnd = prompt.indexOf("\n\n", afterHeading);
                if (descEnd === -1) return prompt.slice(afterHeading).trim();
                const listStart = descEnd + 2;
                const listEnd = prompt.indexOf("\n\n", listStart);
                return prompt.slice(listStart, listEnd === -1 ? undefined : listEnd).trim();
            };
            const w1Contracts = extractList(promptQueue[2]!, "## Available contracts");
            const w2Contracts = extractList(promptQueue[4]!, "## Available contracts");
            const w3Contracts = extractList(promptQueue[7]!, "## Available contracts");
            Assert.strictEqual(w1Contracts, w2Contracts, "contract lists should be identical across iterations");
            Assert.strictEqual(w1Contracts, w3Contracts, "contract lists should be identical across tasks");
            const w1Rules = extractList(promptQueue[2]!, "## Available rules");
            const w2Rules = extractList(promptQueue[4]!, "## Available rules");
            const w3Rules = extractList(promptQueue[7]!, "## Available rules");
            Assert.strictEqual(w1Rules, w2Rules, "rule lists should be identical across iterations");
            Assert.strictEqual(w1Rules, w3Rules, "rule lists should be identical across tasks");
        }
    });
});

test.describe("Implement reviewer prompt contract and rule lists", test => {
    test("reviewer prompt contains the same formatted lists as the worker prompt", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            withDirectoryTree(s, {
                "/project/contracts": [
                    { name: "overview.md", isFile: true, isDirectory: false },
                    { name: "ai-skills", isFile: false, isDirectory: true }
                ],
                "/project/contracts/ai-skills": [
                    { name: "contract.md", isFile: true, isDirectory: false }
                ],
                "/project/rules": [
                    { name: "testing", isFile: false, isDirectory: true }
                ],
                "/project/rules/testing": [
                    { name: "coverage.md", isFile: true, isDirectory: false }
                ]
            });
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code, { promptQueue }) {
            Assert.strictEqual(code, 0);
            // promptQueue: [0]=detect, [1]=prep, [2]=worker, [3]=reviewer
            const workerPrompt = promptQueue[2]!;
            const reviewerPrompt = promptQueue[3]!;
            Assert.ok(reviewerPrompt.includes("contracts/overview.md"), "reviewer prompt should contain contracts/overview.md");
            Assert.ok(reviewerPrompt.includes("contracts/ai-skills/contract.md"), "reviewer prompt should contain contracts/ai-skills/contract.md");
            Assert.ok(reviewerPrompt.includes("rules/testing/coverage.md"), "reviewer prompt should contain rules/testing/coverage.md");
            Assert.ok(!reviewerPrompt.includes("<CONTRACT_LIST>"), "CONTRACT_LIST placeholder should be substituted");
            Assert.ok(!reviewerPrompt.includes("<RULE_LIST>"), "RULE_LIST placeholder should be substituted");
            const extractList = (prompt:string, heading:string):string => {
                const idx = prompt.indexOf(heading);
                if (idx === -1) return "";
                const afterHeading = prompt.indexOf("\n", idx) + 1;
                const descEnd = prompt.indexOf("\n\n", afterHeading);
                if (descEnd === -1) return prompt.slice(afterHeading).trim();
                const listStart = descEnd + 2;
                const listEnd = prompt.indexOf("\n\n", listStart);
                return prompt.slice(listStart, listEnd === -1 ? undefined : listEnd).trim();
            };
            const wContracts = extractList(workerPrompt, "## Available contracts");
            const rContracts = extractList(reviewerPrompt, "## Available contracts");
            Assert.strictEqual(rContracts, wContracts, "reviewer contract list should match worker contract list");
            const wRules = extractList(workerPrompt, "## Available rules");
            const rRules = extractList(reviewerPrompt, "## Available rules");
            Assert.strictEqual(rRules, wRules, "reviewer rule list should match worker rule list");
        }
    });

    test("reviewer prompt contains the four explicit FAIL conditions", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker done" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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

    test("reviewer PASS/FAIL verdict parsing still works with updated prompt", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker ok, reviewer fails
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "Checking contracts and rules...\n\nFAIL missing test for edge case" });
            // iter 2: worker ok, reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "All four conditions verified.\n\nPASS" });
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
            const rev1 = files.get(WS_ROOT + "/reviewer.1.log")!;
            Assert.ok(rev1.includes("Verdict: FAIL missing test for edge case"), "reviewer.1.log should contain FAIL verdict");
            const rev2 = files.get(WS_ROOT + "/reviewer.2.log")!;
            Assert.ok(rev2.includes("Verdict: PASS"), "reviewer.2.log should contain PASS verdict");
            const errorLog = files.get(WS_ROOT + "/error.log")!;
            Assert.ok(errorLog.includes("reviewer rejected: missing test for edge case"), "error.log should contain reviewer rejection reason");
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns sessionId, build fails
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1", sessionId: "WS" });
            s.scriptQueue.push({ code: 1, stdout: "compile error\n", stderr: "" });
            // iter 2: worker again, build ok, reviewer ok
            s.claudeQueue.push({ text: "w2" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            // iter 1: worker returns sessionId, reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "WS" });
            s.claudeQueue.push({ text: "FAIL not ready" });
            // iter 2: worker + reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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
            const twoTaskPlan = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task Alpha\n- [ ]{"it":0,"ot":0,"t":0} Task Beta\n';
            s.files.set(PLAN_PATH, twoTaskPlan);
            s.claudeQueue.push({ text: "ok" });
            // Task 1: worker returns sessionId, reviewer PASS
            s.claudeQueue.push({ text: "READY", sessionId: "prep-session-1" });
            s.claudeQueue.push({ text: "w1", sessionId: "WS1" });
            s.claudeQueue.push({ text: "PASS" });
            // Task 2: prep + worker + reviewer
            s.claudeQueue.push({ text: "READY", sessionId: "prep-session-2" });
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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
            // iter 3: worker, build ok, reviewer PASS
            s.claudeQueue.push({ text: "w3" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // iter 1: worker returns sessionId, reviewer FAIL
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "w1", sessionId: "WS" });
            s.claudeQueue.push({ text: "FAIL not ready" });
            // iter 2: worker errors (rejection)
            s.claudeQueue.push({ text: "", error: true });
            // iter 3: worker, reviewer PASS
            s.claudeQueue.push({ text: "w3" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.files.set(WS_ROOT + "/build.sh", "make");
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-S" });
            // iter 1: worker returns sessionId, build fails
            s.claudeQueue.push({ text: "w1", sessionId: "WORKER-S" });
            s.scriptQueue.push({ code: 1, stdout: "compile error\n", stderr: "" });
            // iter 2: worker, build ok, reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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

    test("null _currentPrepSessionId on worker iteration 1 causes error", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep succeeds
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-S" });
            return s;
        },
        async ACT({ contexts, written, errors }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const origPrepStage = (cmd as any)._prepStage.bind(cmd);
            (cmd as any)._prepStage = async function(...args:unknown[]) {
                const result = await origPrepStage(...args);
                (cmd as any)._currentPrepSessionId = null;
                return result;
            };
            const code = await cmd.result();
            await cmd.dispose();
            return { code, output: written.join("") + errors.join("") };
        },
        ASSERTS: {
            "exits with code 1"({ code }) {
                Assert.strictEqual(code, 1);
            },
            "error mentions prep session id"({ output }) {
                Assert.ok(output.includes("requires a prep session id"));
            },
            "error names the task title"({ output }) {
                Assert.ok(output.includes("Implement feature A"));
            },
            "worker spawn never happens"(_result, { claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep — no worker spawn
                Assert.strictEqual(claudeSpawnedArgs.length, 2);
            }
        }
    });
});

test.describe("Implement reviewer forks from prep", test => {
    test("reviewer iteration 1 is spawned with --resume <prep_session_id> --fork-session", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-R" });
            // iter 1: worker, reviewer PASS
            s.claudeQueue.push({ text: "w1", sessionId: "WORKER-R" });
            s.claudeQueue.push({ text: "PASS", sessionId: "REVIEWER-1" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-R2" });
            // iter 1: worker, reviewer FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "WORKER-R2" });
            s.claudeQueue.push({ text: "FAIL not ready", sessionId: "REVIEWER-ITER1" });
            // iter 2: worker, reviewer PASS
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS", sessionId: "REVIEWER-ITER2" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
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

    test("reviewer session_id is not stored on the Implement instance", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-NOSAVE" });
            // iter 1: worker, reviewer returns a sessionId, FAIL
            s.claudeQueue.push({ text: "w1", sessionId: "WORKER-NOSAVE" });
            s.claudeQueue.push({ text: "FAIL not ready", sessionId: "REVIEWER-SESS-1" });
            // iter 2: worker, reviewer returns a different sessionId, PASS
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS", sessionId: "REVIEWER-SESS-2" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement(["--no-git", PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            const workerSessionId = (cmd as any)._currentWorkerSessionId;
            const prepSessionId = (cmd as any)._currentPrepSessionId;
            await cmd.dispose();
            return { code, workerSessionId, prepSessionId };
        },
        ASSERTS: {
            "exits with code 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "iter 1 reviewer session id not stored as worker session"({ workerSessionId }) {
                Assert.notStrictEqual(workerSessionId, "REVIEWER-SESS-1");
            },
            "iter 2 reviewer session id not stored as worker session"({ workerSessionId }) {
                Assert.notStrictEqual(workerSessionId, "REVIEWER-SESS-2");
            },
            "iter 1 reviewer session id not stored as prep session"({ prepSessionId }) {
                Assert.notStrictEqual(prepSessionId, "REVIEWER-SESS-1");
            },
            "iter 2 reviewer session id not stored as prep session"({ prepSessionId }) {
                Assert.notStrictEqual(prepSessionId, "REVIEWER-SESS-2");
            }
        }
    });

    test("null _currentPrepSessionId on reviewer causes error", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep succeeds
            s.claudeQueue.push({ text: "READY", sessionId: "PREP-REV-NULL" });
            // worker succeeds
            s.claudeQueue.push({ text: "w1", sessionId: "WORKER-REV-NULL" });
            return s;
        },
        async ACT({ contexts, written, errors }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const origReviewerStage = (cmd as any)._reviewerStage.bind(cmd);
            (cmd as any)._reviewerStage = async function(...args:unknown[]) {
                (cmd as any)._currentPrepSessionId = null;
                return origReviewerStage(...args);
            };
            const code = await cmd.result();
            await cmd.dispose();
            return { code, output: written.join("") + errors.join("") };
        },
        ASSERTS: {
            "exits with code 1"({ code }) {
                Assert.strictEqual(code, 1);
            },
            "error mentions prep session id"({ output }) {
                Assert.ok(output.includes("requires a prep session id"));
            },
            "error names the task title"({ output }) {
                Assert.ok(output.includes("Implement feature A"));
            },
            "reviewer spawn never happens"(_result, { claudeSpawnedArgs }) {
                // [0]=detect, [1]=prep, [2]=worker — no reviewer spawn
                Assert.strictEqual(claudeSpawnedArgs.length, 3);
            }
        }
    });
});

test.describe("Implement terminal label on exit", test => {
    test("success path shows Done terminal label", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
                Assert.strictEqual(afterLabel, "\n");
            }
        }
    });

    test("noop tasks completed shows Done terminal label", {
        ARRANGE() {
            const s = stubContexts();
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
            s.files.set(PLAN_PATH, "# Plan\n\n- [done] bad checkbox\n");
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep runs once per task, before the iteration loop
            s.claudeQueue.push(PREP_RESPONSE);
            for (let i = 0; i < 5; i++) {
                s.claudeQueue.push({ text: `worker iter ${i + 1}` });
                s.claudeQueue.push({ text: "FAIL not good enough" });
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
            s.files.set(PLAN_PATH, "# Plan\n\n- [done] bad checkbox\n");
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
                Assert.strictEqual(afterLabel, "\n");
            }
        }
    });

    test("dispose after completed run does not call finalize again", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            // prep
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker output" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "ok" });
            s.claudeQueue.push({ text: "READY", sessionId: "prep-session", inputTokens: 200, outputTokens: 100 });
            s.claudeQueue.push({ text: "worker", inputTokens: 300, outputTokens: 150 });
            s.claudeQueue.push({ text: "PASS", inputTokens: 50, outputTokens: 25 });
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

    test("_currentPrepSessionId captures stub sessionId and resets per task", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_TWO_TASKS);
            s.claudeQueue.push({ text: "ok" });
            // task 1
            s.claudeQueue.push({ text: "READY", sessionId: "prep-sess-1" });
            s.claudeQueue.push({ text: "worker1" });
            s.claudeQueue.push({ text: "PASS" });
            // task 2
            s.claudeQueue.push({ text: "READY", sessionId: "prep-sess-2" });
            s.claudeQueue.push({ text: "worker2" });
            s.claudeQueue.push({ text: "PASS" });
            const capturedPrepSessionIds:Array<string|null> = [];
            return { ...s, capturedPrepSessionIds };
        },
        async ACT({ contexts, capturedPrepSessionIds }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const origPrepStage = (cmd as any)._prepStage.bind(cmd);
            (cmd as any)._prepStage = async function(...args:unknown[]) {
                capturedPrepSessionIds.push((cmd as any)._currentPrepSessionId);
                const result = await origPrepStage(...args);
                capturedPrepSessionIds.push((cmd as any)._currentPrepSessionId);
                return result;
            };
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "field is null at start of task 1 prep"(_code, { capturedPrepSessionIds }) {
                Assert.strictEqual(capturedPrepSessionIds[0], null);
            },
            "field has prep-sess-1 after task 1 prep"(_code, { capturedPrepSessionIds }) {
                Assert.strictEqual(capturedPrepSessionIds[1], "prep-sess-1");
            },
            "field is null at start of task 2 prep"(_code, { capturedPrepSessionIds }) {
                Assert.strictEqual(capturedPrepSessionIds[2], null);
            },
            "field has prep-sess-2 after task 2 prep"(_code, { capturedPrepSessionIds }) {
                Assert.strictEqual(capturedPrepSessionIds[3], "prep-sess-2");
            }
        }
    });
});

test.describe("Implement _selectPlan edge cases", test => {
    test("positional arg resolved via plans/ folder when direct path does not exist", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set("/project/plans/my-plan.md", PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
            s.files.set("/project/plans/my plan.md", PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.claudeQueue.push({ text: "PASS" });
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
});

test.describe("Implement test-stage failure", test => {
    test("test script failure triggers retry and covers testOk continue path", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.files.set(WS_ROOT + "/test.sh", "npm test");
            s.claudeQueue.push(PREP_RESPONSE);
            // iter 1: worker ok, build skipped, test fails
            s.claudeQueue.push({ text: "worker iter 1" });
            s.scriptQueue.push({ code: 1, stdout: "FAIL\n", stderr: "err\n" });
            // iter 2: worker ok, test passes, reviewer passes
            s.claudeQueue.push({ text: "worker iter 2" });
            s.scriptQueue.push({ code: 0, stdout: "OK\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
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
            "error.log mentions test stage"(_code, { files }) {
                const errorLog = files.get(WS_ROOT + "/error.log")!;
                Assert.ok(errorLog.includes("test stage failed"));
            },
            "test.1.log includes failure output"(_code, { files }) {
                const log = files.get(WS_ROOT + "/test.1.log")!;
                Assert.ok(log.includes("FAIL"));
            }
        }
    });
});

test.describe("Implement reviewer-stage error", test => {
    test("reviewer Claude error causes retry", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            // iter 1: worker ok, reviewer throws
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "w1-review", error: true });
            // iter 2: worker ok, reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0 after reviewer retry"(code) {
                Assert.strictEqual(code, 0);
            },
            "error.log mentions reviewer stage"(_code, { files }) {
                const errorLog = files.get(WS_ROOT + "/error.log")!;
                Assert.ok(errorLog.includes("reviewer stage failed"));
            }
        }
    });
});

test.describe("Implement _parseReviewVerdict edge cases", test => {
    test("empty reviewer output triggers blank-line skip and causes retry", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            // iter 1: worker ok, reviewer returns only whitespace (trims to "")
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "  \n\n  " });
            // iter 2: worker ok, reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
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
    test("unrecognized verdict text causes retry", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            // iter 1: worker ok, reviewer returns garbage verdict
            s.claudeQueue.push({ text: "w1" });
            s.claudeQueue.push({ text: "Looks interesting, maybe?" });
            // iter 2: worker ok, reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.claudeQueue.push({ text: "PASS" });
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
            "error.log mentions unrecognized verdict"(_code, { files }) {
                const errorLog = files.get(WS_ROOT + "/error.log")!;
                Assert.ok(errorLog.includes("unrecognized reviewer verdict"));
            }
        }
    });
});


test.describe("Implement Claude stderr forwarding", test => {
    test("Claude stderr is captured in writeError output", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker done", stderr: "warning: something happened\n" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
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
            // iter 2: build ok, reviewer passes
            s.claudeQueue.push({ text: "w2" });
            s.scriptQueue.push({ code: 0, stdout: "ok\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
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
            "error.log contains the string error value"(_code, { files }) {
                const errorLog = files.get(WS_ROOT + "/error.log")!;
                Assert.ok(errorLog.includes("string-error-value"));
            }
        }
    });
});

test.describe("Implement .bat script path on Windows", test => {
    test("uses cmd.exe /c for .bat scripts when isWindows is true", {
        ARRANGE() {
            const s = stubContexts();
            s.contexts.platform.isWindows = () => true;
            s.files.set(PLAN_PATH, PLAN_ONE_TASK);
            s.claudeQueue.push({ text: "detect ok" });
            s.files.set(WS_ROOT + "/build.bat", "@echo off\necho build ok");
            s.files.set(WS_ROOT + "/test.bat", "@echo off\necho test ok");
            s.claudeQueue.push(PREP_RESPONSE);
            s.claudeQueue.push({ text: "worker" });
            s.scriptQueue.push({ code: 0, stdout: "build ok\n", stderr: "" });
            s.scriptQueue.push({ code: 0, stdout: "tests pass\n", stderr: "" });
            s.claudeQueue.push({ text: "PASS" });
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
