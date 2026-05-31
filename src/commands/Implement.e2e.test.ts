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
        out += JSON.stringify({ type: "item.completed", session_id: sessionId, item: { type: "message", role: "assistant", content: [{ type: "text", text }] } }) + "\n";
    } else {
        out += JSON.stringify({ type: "item.completed", item: { type: "message", role: "assistant", content: [{ type: "text", text }] } }) + "\n";
    }
    out += JSON.stringify({ type: "turn.completed" }) + "\n";
    return out;
}

type ClaudeResponse = { text:string; inputTokens?:number; outputTokens?:number; sessionId?:string; error?:true; stderr?:string; errorLog?:string };
type CodexResponse = { text:string; sessionId?:string; error?:true; errorLog?:string };
type ScriptResponse = { code:number; stdout:string; stderr:string };

const PLAN_PATH = "/project/plans/test.md";
const WS_ROOT = "/tmp/flanders-ws123";
const CONFIG_PATH = "/project/.flanders/config.json";

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

function stubContexts(config:FlandersConfig) {
    const files = new Map<string, string>();
    files.set(CONFIG_PATH, JSON.stringify(config));

    const claudeQueue:ClaudeResponse[] = [];
    const codexQueue:CodexResponse[] = [];
    const promptQueue:string[] = [];
    const scriptQueue:ScriptResponse[] = [];
    const claudeSpawnedArgs:string[][] = [];
    const codexSpawnedArgs:string[][] = [];

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
                        if (response.errorLog !== undefined) {
                            files.set(WS_ROOT + "/error.log", response.errorLog);
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
                    (proc as any).stdin = {
                        write(chunk:string) { origStdin.write(chunk); promptQueue.push(chunk); },
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
                                files.set(WS_ROOT + "/error.log", response.errorLog);
                            }
                            proc.$emitStdout(codexResultEvents(response.text, response.sessionId));
                            proc.$emit("exit", 0);
                        }
                    });
                    return proc;
                }
                const isGit = command === "git";
                const response = (isGit ? [] : scriptQueue).shift();
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
            mkdtemp(prefix) { return Promise.resolve(prefix + "ws123"); },
            rm(p:string) { files.delete(p); return Promise.resolve(); }
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
        output: {
            write() {},
            writeError() {},
            columns() { return 80; },
            rows() { return 24; },
            onResize() { return () => {}; }
        }
    };
    return { contexts, files, claudeQueue, codexQueue, promptQueue, scriptQueue, claudeSpawnedArgs, codexSpawnedArgs };
}

const LINKED_PLAN = planWithLinkedFiles(
    "`contracts/e2e-c1.md`. `contracts/e2e-c2.md`.",
    "`rules/e2e-r1.md`. `rules/e2e-r2.md`."
);
const CONTRACT_SNIPPET_1 = "E2E_CONTRACT_SNIPPET_ONE";
const CONTRACT_SNIPPET_2 = "E2E_CONTRACT_SNIPPET_TWO";
const RULE_SNIPPET_1 = "E2E_RULE_SNIPPET_ONE";
const RULE_SNIPPET_2 = "E2E_RULE_SNIPPET_TWO";

function setLinkedFiles(files:Map<string, string>):void {
    files.set("/project/contracts/e2e-c1.md", CONTRACT_SNIPPET_1);
    files.set("/project/contracts/e2e-c2.md", CONTRACT_SNIPPET_2);
    files.set("/project/rules/e2e-r1.md", RULE_SNIPPET_1);
    files.set("/project/rules/e2e-r2.md", RULE_SNIPPET_2);
}

type E2eResult = {
    code:number;
    claudeSpawnedArgs:string[][];
    codexSpawnedArgs:string[][];
    promptQueue:string[];
};

test.describe("Implement e2e: both tools and both prep-optimization branches", test => {
    test("shape 1: claude/claude (branch A) — prep active, worker and reviewer fork from prep", {
        ARRANGE() {
            const config:FlandersConfig = { worker: { tool: "claude", model: "m1", effort: "high" }, reviewer: { tool: "claude", model: "m1", effort: "high" } };
            const s = stubContexts(config);
            s.files.set(PLAN_PATH, LINKED_PLAN);
            setLinkedFiles(s.files);
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // [0] detect
            s.claudeQueue.push({ text: "no scripts" });
            // [1] prep
            s.claudeQueue.push({ text: "READY", sessionId: "prep-s1" });
            // [2] worker
            s.claudeQueue.push({ text: "worker done", sessionId: "worker-s1" });
            // [3] reviewer
            s.claudeQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT(s):Promise<E2eResult> {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs: s.claudeSpawnedArgs, codexSpawnedArgs: s.codexSpawnedArgs, promptQueue: s.promptQueue };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "spawns 4 claude processes and 0 codex"({ claudeSpawnedArgs, codexSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 4);
                Assert.strictEqual(codexSpawnedArgs.length, 0);
            },
            "worker forks from prep session"({ claudeSpawnedArgs }) {
                const workerArgs = claudeSpawnedArgs[2]!;
                Assert.strictEqual(workerArgs[0], "--resume");
                Assert.strictEqual(workerArgs[1], "prep-s1");
                Assert.ok(workerArgs.includes("--fork-session"));
            },
            "reviewer forks from prep session"({ claudeSpawnedArgs }) {
                const reviewerArgs = claudeSpawnedArgs[3]!;
                Assert.strictEqual(reviewerArgs[0], "--resume");
                Assert.strictEqual(reviewerArgs[1], "prep-s1");
                Assert.ok(reviewerArgs.includes("--fork-session"));
            },
            "worker prompt does NOT inline linked content"({ promptQueue }) {
                const workerPrompt = promptQueue[2]!;
                Assert.ok(!workerPrompt.includes(CONTRACT_SNIPPET_1), "contract 1 must NOT be inlined in branch A");
                Assert.ok(!workerPrompt.includes(CONTRACT_SNIPPET_2), "contract 2 must NOT be inlined in branch A");
                Assert.ok(!workerPrompt.includes(RULE_SNIPPET_1), "rule 1 must NOT be inlined in branch A");
                Assert.ok(!workerPrompt.includes(RULE_SNIPPET_2), "rule 2 must NOT be inlined in branch A");
            },
            "reviewer prompt does NOT inline linked content"({ promptQueue }) {
                const reviewerPrompt = promptQueue[3]!;
                Assert.ok(!reviewerPrompt.includes(CONTRACT_SNIPPET_1));
                Assert.ok(!reviewerPrompt.includes(CONTRACT_SNIPPET_2));
                Assert.ok(!reviewerPrompt.includes(RULE_SNIPPET_1));
                Assert.ok(!reviewerPrompt.includes(RULE_SNIPPET_2));
            }
        }
    });

    test("shape 2: codex/codex (branch A) — prep active, all spawns use codex binary", {
        ARRANGE() {
            const config:FlandersConfig = { worker: { tool: "codex", model: "m2", effort: "low" }, reviewer: { tool: "codex", model: "m2", effort: "low" } };
            const s = stubContexts(config);
            s.files.set(PLAN_PATH, LINKED_PLAN);
            setLinkedFiles(s.files);
            (s.contexts.fs as { readdir:typeof s.contexts.fs.readdir }).readdir = readdirForPaths(s.files);
            // [0] detect (inherits worker tool = codex)
            s.codexQueue.push({ text: "no scripts" });
            // [1] prep
            s.codexQueue.push({ text: "READY", sessionId: "prep-s2" });
            // [2] worker
            s.codexQueue.push({ text: "worker done", sessionId: "worker-s2" });
            // [3] reviewer
            s.codexQueue.push({ text: "reviewer ok", errorLog: "" });
            return s;
        },
        async ACT(s):Promise<E2eResult> {
            const cmd = new Implement([PLAN_PATH], { projectRoot: "/project" }, s.contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code, claudeSpawnedArgs: s.claudeSpawnedArgs, codexSpawnedArgs: s.codexSpawnedArgs, promptQueue: s.promptQueue };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "spawns 0 claude processes and 4 codex"({ claudeSpawnedArgs, codexSpawnedArgs }) {
                Assert.strictEqual(claudeSpawnedArgs.length, 0);
                Assert.strictEqual(codexSpawnedArgs.length, 4);
            },
            "worker forks from prep session via codex fork subcommand"({ codexSpawnedArgs }) {
                const workerArgs = codexSpawnedArgs[2]!;
                Assert.strictEqual(workerArgs[0], "fork");
                Assert.strictEqual(workerArgs[1], "prep-s2");
            },
            "reviewer forks from prep session via codex fork subcommand"({ codexSpawnedArgs }) {
                const reviewerArgs = codexSpawnedArgs[3]!;
                Assert.strictEqual(reviewerArgs[0], "fork");
                Assert.strictEqual(reviewerArgs[1], "prep-s2");
            },
            "worker prompt does NOT inline linked content"({ promptQueue }) {
                const workerPrompt = promptQueue[2]!;
                Assert.ok(!workerPrompt.includes(CONTRACT_SNIPPET_1));
                Assert.ok(!workerPrompt.includes(CONTRACT_SNIPPET_2));
                Assert.ok(!workerPrompt.includes(RULE_SNIPPET_1));
                Assert.ok(!workerPrompt.includes(RULE_SNIPPET_2));
            },
            "reviewer prompt does NOT inline linked content"({ promptQueue }) {
                const reviewerPrompt = promptQueue[3]!;
                Assert.ok(!reviewerPrompt.includes(CONTRACT_SNIPPET_1));
                Assert.ok(!reviewerPrompt.includes(CONTRACT_SNIPPET_2));
                Assert.ok(!reviewerPrompt.includes(RULE_SNIPPET_1));
                Assert.ok(!reviewerPrompt.includes(RULE_SNIPPET_2));
            }
        }
    });

    test("shape 3: claude/codex (branch B) — prep skipped, prompts inline linked content", {
        ARRANGE() {
            const config:FlandersConfig = { worker: { tool: "claude", model: "m3", effort: "mid" }, reviewer: { tool: "codex", model: "m3", effort: "mid" } };
            const s = stubContexts(config);
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
            return { code, claudeSpawnedArgs: s.claudeSpawnedArgs, codexSpawnedArgs: s.codexSpawnedArgs, promptQueue: s.promptQueue };
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
                Assert.ok(!workerArgs.includes("--resume"), "worker must not have --resume in branch B");
                Assert.ok(!workerArgs.includes("--fork-session"), "worker must not have --fork-session in branch B");
            },
            "reviewer has no fork or resume subcommand"({ codexSpawnedArgs }) {
                const reviewerArgs = codexSpawnedArgs[0]!;
                Assert.ok(!reviewerArgs.includes("fork"), "reviewer must not use fork in branch B");
                Assert.ok(!reviewerArgs.includes("resume"), "reviewer must not use resume in branch B");
            },
            "worker prompt inlines all linked content"({ promptQueue }) {
                const workerPrompt = promptQueue[1]!;
                Assert.ok(workerPrompt.includes(CONTRACT_SNIPPET_1), "contract 1 must be inlined");
                Assert.ok(workerPrompt.includes(CONTRACT_SNIPPET_2), "contract 2 must be inlined");
                Assert.ok(workerPrompt.includes(RULE_SNIPPET_1), "rule 1 must be inlined");
                Assert.ok(workerPrompt.includes(RULE_SNIPPET_2), "rule 2 must be inlined");
            },
            "reviewer prompt inlines all linked content"({ promptQueue }) {
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(reviewerPrompt.includes(CONTRACT_SNIPPET_1), "contract 1 must be inlined in reviewer");
                Assert.ok(reviewerPrompt.includes(CONTRACT_SNIPPET_2), "contract 2 must be inlined in reviewer");
                Assert.ok(reviewerPrompt.includes(RULE_SNIPPET_1), "rule 1 must be inlined in reviewer");
                Assert.ok(reviewerPrompt.includes(RULE_SNIPPET_2), "rule 2 must be inlined in reviewer");
            }
        }
    });

    test("shape 4: claude/claude different effort (branch B) — prep skipped, prompts inline linked content", {
        ARRANGE() {
            const config:FlandersConfig = { worker: { tool: "claude", model: "m4", effort: "high" }, reviewer: { tool: "claude", model: "m4", effort: "low" } };
            const s = stubContexts(config);
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
            return { code, claudeSpawnedArgs: s.claudeSpawnedArgs, codexSpawnedArgs: s.codexSpawnedArgs, promptQueue: s.promptQueue };
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
                Assert.ok(!workerArgs.includes("--resume"), "worker must not have --resume in branch B");
                Assert.ok(!workerArgs.includes("--fork-session"), "worker must not have --fork-session in branch B");
            },
            "reviewer has no fork or resume args"({ claudeSpawnedArgs }) {
                const reviewerArgs = claudeSpawnedArgs[2]!;
                Assert.ok(!reviewerArgs.includes("--resume"), "reviewer must not have --resume in branch B");
                Assert.ok(!reviewerArgs.includes("--fork-session"), "reviewer must not have --fork-session in branch B");
            },
            "worker prompt inlines all linked content"({ promptQueue }) {
                const workerPrompt = promptQueue[1]!;
                Assert.ok(workerPrompt.includes(CONTRACT_SNIPPET_1), "contract 1 must be inlined");
                Assert.ok(workerPrompt.includes(CONTRACT_SNIPPET_2), "contract 2 must be inlined");
                Assert.ok(workerPrompt.includes(RULE_SNIPPET_1), "rule 1 must be inlined");
                Assert.ok(workerPrompt.includes(RULE_SNIPPET_2), "rule 2 must be inlined");
            },
            "reviewer prompt inlines all linked content"({ promptQueue }) {
                const reviewerPrompt = promptQueue[2]!;
                Assert.ok(reviewerPrompt.includes(CONTRACT_SNIPPET_1), "contract 1 must be inlined in reviewer");
                Assert.ok(reviewerPrompt.includes(CONTRACT_SNIPPET_2), "contract 2 must be inlined in reviewer");
                Assert.ok(reviewerPrompt.includes(RULE_SNIPPET_1), "rule 1 must be inlined in reviewer");
                Assert.ok(reviewerPrompt.includes(RULE_SNIPPET_2), "rule 2 must be inlined in reviewer");
            }
        }
    });
});
