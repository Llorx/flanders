import * as Assert from "assert";

import test from "arrange-act-assert";

import { Implement } from "./Implement";
import type { ImplementContexts } from "./Implement";
import type { FlandersConfig, SpawnedProcess, TimeoutHandle } from "..";

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

function codexResultEvents(text:string, sessionId?:string):string {
    let out = "";
    if (sessionId) {
        out += JSON.stringify({ type: "thread.started", thread_id: sessionId }) + "\n";
    }
    out += JSON.stringify({ type: "item.completed", item: { type: "agent_message", text } }) + "\n";
    out += JSON.stringify({ type: "turn.completed" }) + "\n";
    return out;
}

type ClaudeResponse = { text:string; inputTokens?:number; outputTokens?:number; sessionId?:string; error?:true; stderr?:string; errorLog?:string };
type CodexResponse = { text:string; sessionId?:string; error?:true; errorLog?:string };
type ScriptResponse = { code:number; stdout:string; stderr:string };

const PLAN_PATH = "/project/plans/test.md";
const WS_ROOT = "/tmp/flanders-ws123";
const CONFIG_PATH = "/project/.flanders/config.json";
function reviewerRoot(n:number):string { return `/tmp/flanders-rev${n}`; }
// The reviewer's verdict file lives in its own per-reviewer folder (ws.reviewerErrorLog(n) =
// reviewerRoot(n)/error.log). The stub must write a reviewer's errorLog response to the same path
// the orchestrator reads, so it recovers that reviewer's root from the prompt; a prompt that names
// no reviewer root (e.g. a worker-stage write) falls back to the main folder's error.log.
function targetErrorLogFromPrompt(capturedPrompt:string):string {
    const m = capturedPrompt.match(/(\/tmp\/flanders-rev\d+)\/error\.log/);
    return m ? `${m[1]}/error.log` : `${WS_ROOT}/error.log`;
}

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

function stubContexts(config:FlandersConfig) {
    const files = new Map<string, string>();
    files.set(CONFIG_PATH, JSON.stringify(config));
    const mkdtempState = { count: 0 };

    const claudeQueue:ClaudeResponse[] = [];
    const codexQueue:CodexResponse[] = [];
    const promptQueue:string[] = [];
    const scriptQueue:ScriptResponse[] = [];
    const gitQueue:ScriptResponse[] = [];
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
                            files.set(targetErrorLogFromPrompt(capturedPrompt), response.errorLog);
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
                                files.set(targetErrorLogFromPrompt(capturedPrompt), response.errorLog);
                            }
                            proc.$emitStdout(codexResultEvents(response.text, response.sessionId));
                            proc.$emit("exit", 0);
                        }
                    });
                    return proc;
                }
                const isGit = command === "git";
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
                // The first allocation is the main workspace root; each subsequent allocation is a
                // distinct per-reviewer root, so reviewer spec.md/error.log never collide with the
                // main folder or with one another.
                mkdtempState.count++;
                if (mkdtempState.count === 1) return Promise.resolve(prefix + "ws123");
                return Promise.resolve(prefix + `rev${mkdtempState.count - 1}`);
            },
            rm(p:string) { files.delete(p); return Promise.resolve(); }
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
            write() {},
            writeError() {},
            columns() { return 80; },
            rows() { return 24; },
            onResize() { return () => {}; }
        }
    };
    return { contexts, files, claudeQueue, codexQueue, promptQueue, scriptQueue, gitQueue, claudeSpawnedArgs, codexSpawnedArgs };
}

// Arranges a full git run for an e2e scenario: the version/rev-parse/clean-status preflight
// triple plus, per task the scenario accepts in a single worker-success iteration, the three
// {code:0} git calls that iteration makes — the post-worker `git add -A`, the commit-stage
// `git add -A`, and the `git commit`.
function gitRunQueue(gitQueue:ScriptResponse[], taskCount = 1):void {
    gitQueue.push({ code: 0, stdout: "git version 2.40.0\n", stderr: "" }); // git --version
    gitQueue.push({ code: 0, stdout: "true\n", stderr: "" });                // rev-parse --is-inside-work-tree
    gitQueue.push({ code: 0, stdout: "", stderr: "" });                      // status (clean)
    gitQueue.push({ code: 0, stdout: "", stderr: "" });                      // ls-files discovery (empty → empty global lists, no check-ignore)
    for (let i = 0; i < taskCount; i++) {
        gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (post-worker staging)
        gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git add -A (commit stage)
        gitQueue.push({ code: 0, stdout: "", stderr: "" }); // git commit
    }
}

const LINKED_PLAN = planWithLinkedFiles(
    "[.spec/contracts/e2e-c1.md](/.spec/contracts/e2e-c1.md) [.spec/contracts/e2e-c2.md](/.spec/contracts/e2e-c2.md)",
    "[.spec/rules/e2e-r1.md](/.spec/rules/e2e-r1.md) [.spec/rules/e2e-r2.md](/.spec/rules/e2e-r2.md)"
);
const CONTRACT_SNIPPET_1 = "E2E_CONTRACT_SNIPPET_ONE";
const CONTRACT_SNIPPET_2 = "E2E_CONTRACT_SNIPPET_TWO";
const RULE_SNIPPET_1 = "E2E_RULE_SNIPPET_ONE";
const RULE_SNIPPET_2 = "E2E_RULE_SNIPPET_TWO";

function setLinkedFiles(files:Map<string, string>):void {
    files.set("/project/.spec/contracts/e2e-c1.md", CONTRACT_SNIPPET_1);
    files.set("/project/.spec/contracts/e2e-c2.md", CONTRACT_SNIPPET_2);
    files.set("/project/.spec/rules/e2e-r1.md", RULE_SNIPPET_1);
    files.set("/project/.spec/rules/e2e-r2.md", RULE_SNIPPET_2);
}

type E2eResult = {
    code:number;
    claudeSpawnedArgs:string[][];
    codexSpawnedArgs:string[][];
    promptQueue:string[];
    files:Map<string, string>;
};

test.describe("Implement e2e: deterministic injection across tools and configs", test => {
    test("shape 1: claude/claude same triple — no prep, worker and reviewer are fresh and deliver linked content via spec.md", {
        ARRANGE() {
            const config:FlandersConfig = { worker: { tool: "claude", model: "m1", effort: "high" }, reviewers: [{ tool: "claude", model: "m1", effort: "high", optional: false }], minimumReviews: 1 };
            const s = stubContexts(config);
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, LINKED_PLAN);
            setLinkedFiles(s.files);
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // [0] detect
            s.claudeQueue.push({ text: "no scripts" });
            // [1] worker
            s.claudeQueue.push({ text: "worker done", sessionId: "worker-s1" });
            // [2] reviewer
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT(s):Promise<E2eResult> {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs: s.claudeSpawnedArgs, codexSpawnedArgs: s.codexSpawnedArgs, promptQueue: s.promptQueue, files: s.files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "spawns 3 claude processes (detect, worker, reviewer) and 0 codex"({ claudeSpawnedArgs, codexSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 3);
                Assert.strictEqual(codexSpawnedArgs.length, 0);
            },
            "worker is fresh — no --resume and no --fork-session"({ claudeSpawnedArgs }) {
                const workerArgs = claudeSpawnedArgs[1]!;
                Assert.ok(!workerArgs.includes("--resume"));
                Assert.ok(!workerArgs.includes("--fork-session"));
            },
            "reviewer is fresh — no --resume and no --fork-session"({ claudeSpawnedArgs }) {
                const reviewerArgs = claudeSpawnedArgs[2]!;
                Assert.ok(!reviewerArgs.includes("--resume"));
                Assert.ok(!reviewerArgs.includes("--fork-session"));
            },
            "worker prompt directs reading the main-folder spec.md and does not inline content"({ promptQueue }) {
                const workerPrompt = promptQueue[1]!;
                Assert.ok(workerPrompt.includes(WS_ROOT + "/spec.md"), "worker prompt must name the main-folder spec.md");
                Assert.strictEqual(workerPrompt.includes(CONTRACT_SNIPPET_1), false, "linked content must not be inlined in the worker prompt");
            },
            "the worker's main-folder spec.md holds all linked content"({ files }) {
                const spec = files.get(WS_ROOT + "/spec.md")!;
                Assert.ok(spec.includes(CONTRACT_SNIPPET_1), "contract 1 must be consolidated");
                Assert.ok(spec.includes(CONTRACT_SNIPPET_2), "contract 2 must be consolidated");
                Assert.ok(spec.includes(RULE_SNIPPET_1), "rule 1 must be consolidated");
                Assert.ok(spec.includes(RULE_SNIPPET_2), "rule 2 must be consolidated");
            },
            "reviewer prompt directs reading its own per-reviewer spec.md and does not inline content"({ promptQueue }) {
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(reviewerPrompt.includes(reviewerRoot(1) + "/spec.md"), "reviewer prompt must name its own per-reviewer spec.md");
                Assert.strictEqual(reviewerPrompt.includes(CONTRACT_SNIPPET_1), false, "linked content must not be inlined in the reviewer prompt");
            },
            "the reviewer's own spec.md holds all linked content in its own per-reviewer folder"({ files }) {
                const spec = files.get(reviewerRoot(1) + "/spec.md")!;
                Assert.ok(spec.includes(CONTRACT_SNIPPET_1), "contract 1 must be consolidated for the reviewer");
                Assert.ok(spec.includes(CONTRACT_SNIPPET_2), "contract 2 must be consolidated for the reviewer");
                Assert.ok(spec.includes(RULE_SNIPPET_1), "rule 1 must be consolidated for the reviewer");
                Assert.ok(spec.includes(RULE_SNIPPET_2), "rule 2 must be consolidated for the reviewer");
            },
            "the reviewer's spec.md is in its own folder, not the shared main folder"({ promptQueue }) {
                Assert.strictEqual(promptQueue[2]!.includes(WS_ROOT + "/spec.md"), false, "reviewer prompt must not point at the main-folder spec.md");
            }
        }
    });

    test("shape 2: codex/codex same triple — no prep, all spawns use codex and deliver linked content via spec.md", {
        ARRANGE() {
            const config:FlandersConfig = { worker: { tool: "codex", model: "m2", effort: "low" }, reviewers: [{ tool: "codex", model: "m2", effort: "low", optional: false }], minimumReviews: 1 };
            const s = stubContexts(config);
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, LINKED_PLAN);
            setLinkedFiles(s.files);
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // [0] detect (inherits worker tool = codex)
            s.codexQueue.push({ text: "no scripts" });
            // [1] worker
            s.codexQueue.push({ text: "worker done", sessionId: "worker-s2" });
            // [2] reviewer
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT(s):Promise<E2eResult> {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs: s.claudeSpawnedArgs, codexSpawnedArgs: s.codexSpawnedArgs, promptQueue: s.promptQueue, files: s.files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "spawns 0 claude processes and 3 codex"({ claudeSpawnedArgs, codexSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 0);
                Assert.strictEqual(codexSpawnedArgs.length, 3);
            },
            "worker is fresh — no fork or resume subcommand"({ codexSpawnedArgs }) {
                const workerArgs = codexSpawnedArgs[1]!;
                Assert.ok(!workerArgs.includes("fork"));
                Assert.ok(!workerArgs.includes("resume"));
            },
            "reviewer is fresh — no fork or resume subcommand"({ codexSpawnedArgs }) {
                const reviewerArgs = codexSpawnedArgs[2]!;
                Assert.ok(!reviewerArgs.includes("fork"));
                Assert.ok(!reviewerArgs.includes("resume"));
            },
            "worker prompt directs reading the main-folder spec.md and does not inline content"({ promptQueue }) {
                const workerPrompt = promptQueue[1]!;
                Assert.ok(workerPrompt.includes(WS_ROOT + "/spec.md"), "worker prompt must name the main-folder spec.md");
                Assert.strictEqual(workerPrompt.includes(CONTRACT_SNIPPET_1), false, "linked content must not be inlined in the worker prompt");
            },
            "the worker's main-folder spec.md holds all linked content"({ files }) {
                const spec = files.get(WS_ROOT + "/spec.md")!;
                Assert.ok(spec.includes(CONTRACT_SNIPPET_1), "contract 1 must be consolidated");
                Assert.ok(spec.includes(CONTRACT_SNIPPET_2), "contract 2 must be consolidated");
                Assert.ok(spec.includes(RULE_SNIPPET_1), "rule 1 must be consolidated");
                Assert.ok(spec.includes(RULE_SNIPPET_2), "rule 2 must be consolidated");
            },
            "reviewer prompt directs reading its own per-reviewer spec.md and does not inline content"({ promptQueue }) {
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(reviewerPrompt.includes(reviewerRoot(1) + "/spec.md"), "reviewer prompt must name its own per-reviewer spec.md");
                Assert.strictEqual(reviewerPrompt.includes(CONTRACT_SNIPPET_1), false, "linked content must not be inlined in the reviewer prompt");
            },
            "the reviewer's own spec.md holds all linked content in its own per-reviewer folder"({ files }) {
                const spec = files.get(reviewerRoot(1) + "/spec.md")!;
                Assert.ok(spec.includes(CONTRACT_SNIPPET_1), "contract 1 must be consolidated for the reviewer");
                Assert.ok(spec.includes(CONTRACT_SNIPPET_2), "contract 2 must be consolidated for the reviewer");
                Assert.ok(spec.includes(RULE_SNIPPET_1), "rule 1 must be consolidated for the reviewer");
                Assert.ok(spec.includes(RULE_SNIPPET_2), "rule 2 must be consolidated for the reviewer");
            },
            "the reviewer's spec.md is in its own folder, not the shared main folder"({ promptQueue }) {
                Assert.strictEqual(promptQueue[2]!.includes(WS_ROOT + "/spec.md"), false, "reviewer prompt must not point at the main-folder spec.md");
            }
        }
    });

    test("shape 3: claude/codex — worker and reviewer are fresh and deliver linked content via spec.md", {
        ARRANGE() {
            const config:FlandersConfig = { worker: { tool: "claude", model: "m3", effort: "mid" }, reviewers: [{ tool: "codex", model: "m3", effort: "mid", optional: false }], minimumReviews: 1 };
            const s = stubContexts(config);
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, LINKED_PLAN);
            setLinkedFiles(s.files);
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // [0] detect (uses worker tool = claude)
            s.claudeQueue.push({ text: "no scripts" });
            // [1] worker (claude, no prep)
            s.claudeQueue.push({ text: "worker done", sessionId: "worker-s3" });
            // [2] reviewer (codex, no prep)
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT(s):Promise<E2eResult> {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs: s.claudeSpawnedArgs, codexSpawnedArgs: s.codexSpawnedArgs, promptQueue: s.promptQueue, files: s.files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "spawns 2 claude (detect + worker) and 1 codex (reviewer)"({ claudeSpawnedArgs, codexSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 2);
                Assert.strictEqual(codexSpawnedArgs.length, 1);
            },
            "worker has no fork or resume args"({ claudeSpawnedArgs }) {
                const workerArgs = claudeSpawnedArgs[1]!;
                Assert.ok(!workerArgs.includes("--resume"), "worker must not have --resume");
                Assert.ok(!workerArgs.includes("--fork-session"), "worker must not have --fork-session");
            },
            "reviewer has no fork or resume subcommand"({ codexSpawnedArgs }) {
                const reviewerArgs = codexSpawnedArgs[0]!;
                Assert.ok(!reviewerArgs.includes("fork"), "reviewer must not use fork");
                Assert.ok(!reviewerArgs.includes("resume"), "reviewer must not use resume");
            },
            "worker prompt directs reading the main-folder spec.md and does not inline content"({ promptQueue }) {
                const workerPrompt = promptQueue[1]!;
                Assert.ok(workerPrompt.includes(WS_ROOT + "/spec.md"), "worker prompt must name the main-folder spec.md");
                Assert.strictEqual(workerPrompt.includes(CONTRACT_SNIPPET_1), false, "linked content must not be inlined in the worker prompt");
            },
            "the worker's main-folder spec.md holds all linked content"({ files }) {
                const spec = files.get(WS_ROOT + "/spec.md")!;
                Assert.ok(spec.includes(CONTRACT_SNIPPET_1), "contract 1 must be consolidated");
                Assert.ok(spec.includes(CONTRACT_SNIPPET_2), "contract 2 must be consolidated");
                Assert.ok(spec.includes(RULE_SNIPPET_1), "rule 1 must be consolidated");
                Assert.ok(spec.includes(RULE_SNIPPET_2), "rule 2 must be consolidated");
            },
            "reviewer prompt directs reading its own per-reviewer spec.md and does not inline content"({ promptQueue }) {
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(reviewerPrompt.includes(reviewerRoot(1) + "/spec.md"), "reviewer prompt must name its own per-reviewer spec.md");
                Assert.strictEqual(reviewerPrompt.includes(CONTRACT_SNIPPET_1), false, "linked content must not be inlined in the reviewer prompt");
            },
            "the reviewer's own spec.md holds all linked content in its own per-reviewer folder"({ files }) {
                const spec = files.get(reviewerRoot(1) + "/spec.md")!;
                Assert.ok(spec.includes(CONTRACT_SNIPPET_1), "contract 1 must be consolidated for the reviewer");
                Assert.ok(spec.includes(CONTRACT_SNIPPET_2), "contract 2 must be consolidated for the reviewer");
                Assert.ok(spec.includes(RULE_SNIPPET_1), "rule 1 must be consolidated for the reviewer");
                Assert.ok(spec.includes(RULE_SNIPPET_2), "rule 2 must be consolidated for the reviewer");
            },
            "the reviewer's spec.md is in its own folder, not the shared main folder"({ promptQueue }) {
                Assert.strictEqual(promptQueue[2]!.includes(WS_ROOT + "/spec.md"), false, "reviewer prompt must not point at the main-folder spec.md");
            }
        }
    });

    test("shape 4: claude/claude with different effort — fresh worker and reviewer deliver linked content via spec.md", {
        ARRANGE() {
            const config:FlandersConfig = { worker: { tool: "claude", model: "m4", effort: "high" }, reviewers: [{ tool: "claude", model: "m4", effort: "low", optional: false }], minimumReviews: 1 };
            const s = stubContexts(config);
            gitRunQueue(s.gitQueue);
            s.files.set(PLAN_PATH, LINKED_PLAN);
            setLinkedFiles(s.files);
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // [0] detect (uses worker tool = claude)
            s.claudeQueue.push({ text: "no scripts" });
            // [1] worker (claude, no prep)
            s.claudeQueue.push({ text: "worker done", sessionId: "worker-s4" });
            // [2] reviewer (claude, no prep)
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT(s):Promise<E2eResult> {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs: s.claudeSpawnedArgs, codexSpawnedArgs: s.codexSpawnedArgs, promptQueue: s.promptQueue, files: s.files };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "spawns 3 claude (detect + worker + reviewer) and 0 codex"({ claudeSpawnedArgs, codexSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 3);
                Assert.strictEqual(codexSpawnedArgs.length, 0);
            },
            "worker has no fork or resume args"({ claudeSpawnedArgs }) {
                const workerArgs = claudeSpawnedArgs[1]!;
                Assert.ok(!workerArgs.includes("--resume"), "worker must not have --resume");
                Assert.ok(!workerArgs.includes("--fork-session"), "worker must not have --fork-session");
            },
            "reviewer has no fork or resume args"({ claudeSpawnedArgs }) {
                const reviewerArgs = claudeSpawnedArgs[2]!;
                Assert.ok(!reviewerArgs.includes("--resume"), "reviewer must not have --resume");
                Assert.ok(!reviewerArgs.includes("--fork-session"), "reviewer must not have --fork-session");
            },
            "worker prompt directs reading the main-folder spec.md and does not inline content"({ promptQueue }) {
                const workerPrompt = promptQueue[1]!;
                Assert.ok(workerPrompt.includes(WS_ROOT + "/spec.md"), "worker prompt must name the main-folder spec.md");
                Assert.strictEqual(workerPrompt.includes(CONTRACT_SNIPPET_1), false, "linked content must not be inlined in the worker prompt");
            },
            "the worker's main-folder spec.md holds all linked content"({ files }) {
                const spec = files.get(WS_ROOT + "/spec.md")!;
                Assert.ok(spec.includes(CONTRACT_SNIPPET_1), "contract 1 must be consolidated");
                Assert.ok(spec.includes(CONTRACT_SNIPPET_2), "contract 2 must be consolidated");
                Assert.ok(spec.includes(RULE_SNIPPET_1), "rule 1 must be consolidated");
                Assert.ok(spec.includes(RULE_SNIPPET_2), "rule 2 must be consolidated");
            },
            "reviewer prompt directs reading its own per-reviewer spec.md and does not inline content"({ promptQueue }) {
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(reviewerPrompt.includes(reviewerRoot(1) + "/spec.md"), "reviewer prompt must name its own per-reviewer spec.md");
                Assert.strictEqual(reviewerPrompt.includes(CONTRACT_SNIPPET_1), false, "linked content must not be inlined in the reviewer prompt");
            },
            "the reviewer's own spec.md holds all linked content in its own per-reviewer folder"({ files }) {
                const spec = files.get(reviewerRoot(1) + "/spec.md")!;
                Assert.ok(spec.includes(CONTRACT_SNIPPET_1), "contract 1 must be consolidated for the reviewer");
                Assert.ok(spec.includes(CONTRACT_SNIPPET_2), "contract 2 must be consolidated for the reviewer");
                Assert.ok(spec.includes(RULE_SNIPPET_1), "rule 1 must be consolidated for the reviewer");
                Assert.ok(spec.includes(RULE_SNIPPET_2), "rule 2 must be consolidated for the reviewer");
            },
            "the reviewer's spec.md is in its own folder, not the shared main folder"({ promptQueue }) {
                Assert.strictEqual(promptQueue[2]!.includes(WS_ROOT + "/spec.md"), false, "reviewer prompt must not point at the main-folder spec.md");
            }
        }
    });
});
