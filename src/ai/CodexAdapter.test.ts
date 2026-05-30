import * as Assert from "assert";
import * as fs from "fs";
import * as path from "path";

import test from "arrange-act-assert";

import { CodexAdapter, CodexAdapterContexts, formatCodexToolArgs } from "./CodexAdapter";
import type { ToolEvent, ToolAdapterInvokeArgs } from "./ToolAdapter";
import type { ScriptContext, SpawnedProcess, SpawnedReadable, TimeContext, TimeoutHandle } from "../contexts";

type SpawnedProcessSpy = SpawnedProcess & {
    $emit(event:"exit", code:number|null, signal?:string|null):void;
    $emit(event:"error", e:unknown):void;
    $emitStdout(chunk:string):void;
    $kills:Array<"SIGINT"|"SIGTERM">;
    $stdinWrites:string[];
    $stdinEnded:boolean;
};

function spawnedProcessSpy():SpawnedProcessSpy {
    const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stdoutListeners:Array<(chunk:Buffer|string) => void> = [];
    const kills:Array<"SIGINT"|"SIGTERM"> = [];
    const stdinWrites:string[] = [];
    let stdinEnded = false;
    return {
        stdin: {
            write(chunk:string) { stdinWrites.push(chunk); },
            end() { stdinEnded = true; }
        },
        kill(signal) { kills.push(signal); },
        on(event, listener) {
            if (event === "exit") exitListeners.push(listener as (code:number|null, signal:string|null) => void);
            else if (event === "error") errorListeners.push(listener as (e:unknown) => void);
        },
        stdout: { on(_event, listener) { stdoutListeners.push(listener); } } as SpawnedReadable,
        $emit(event:string, codeOrError:unknown, signal?:unknown) {
            if (event === "exit") for (const l of exitListeners) l(codeOrError as number|null, (signal ?? null) as string|null);
            else if (event === "error") for (const l of errorListeners) l(codeOrError);
        },
        $emitStdout(chunk:string) { for (const l of stdoutListeners) l(chunk); },
        $kills: kills,
        $stdinWrites: stdinWrites,
        get $stdinEnded() { return stdinEnded; }
    };
}

function scriptContext() {
    const spawned:Array<{ command:string; args:readonly string[] }> = [];
    const processes:SpawnedProcessSpy[] = [];
    return {
        $spawned: spawned,
        $processes: processes,
        ...({
            spawn(command, args) {
                const proc = spawnedProcessSpy();
                spawned.push({ command, args });
                processes.push(proc);
                return proc;
            }
        } satisfies ScriptContext)
    };
}

function timeContext(nowMs = 1_000_000):TimeContext {
    return {
        now() { return nowMs; },
        setTimeout(_handler:() => void, _ms:number):TimeoutHandle {
            return { cancel() {} };
        }
    };
}

function makeContexts(overrides?:Partial<{ script:ReturnType<typeof scriptContext>; time:TimeContext }>):{
    contexts:CodexAdapterContexts;
    script:ReturnType<typeof scriptContext>;
    time:TimeContext;
} {
    const script = overrides?.script ?? scriptContext();
    const time = overrides?.time ?? timeContext();
    return {
        contexts: { script, time },
        script,
        time
    };
}

function baseArgs(overrides?:Partial<ToolAdapterInvokeArgs>):ToolAdapterInvokeArgs {
    return {
        prompt: "test prompt",
        model: "",
        effort: "",
        abortSignal: new AbortController().signal,
        ...overrides
    };
}

async function collectEvents(adapter:CodexAdapter, args:ToolAdapterInvokeArgs, script:ReturnType<typeof scriptContext>, setup:(proc:SpawnedProcessSpy) => void):Promise<ToolEvent[]> {
    const iterable = adapter.invoke(args);
    const proc = script.$processes[script.$processes.length - 1]!;
    setup(proc);
    const events:ToolEvent[] = [];
    for await (const e of iterable) events.push(e);
    return events;
}

function emitTurnCompletedAndExit(proc:SpawnedProcessSpy):void {
    proc.$emitStdout(JSON.stringify({ type: "turn.completed" }) + "\n");
    proc.$emit("exit", 0, null);
}

function emitErrorAndExit(proc:SpawnedProcessSpy, message:string):void {
    proc.$emitStdout(JSON.stringify({ type: "error", message }) + "\n");
    proc.$emit("exit", 1, null);
}

test.describe("CodexAdapter", test => {

    test.describe("invocation args", test => {

        test("default args with empty model and effort", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, emitTurnCompletedAndExit);
            },
            ASSERT(_result, { script }) {
                Assert.deepStrictEqual(script.$spawned[0]!.args, [
                    "exec", "--json",
                    "-c", "approval_policy=never",
                    "-c", "sandbox_mode=danger-full-access",
                    "-"
                ]);
            }
        });

        test("with model gpt-5-codex and effort high", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs({ model: "gpt-5-codex", effort: "high" });
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, emitTurnCompletedAndExit);
            },
            ASSERT(_result, { script }) {
                Assert.deepStrictEqual(script.$spawned[0]!.args, [
                    "exec", "--json",
                    "-c", "approval_policy=never",
                    "-c", "sandbox_mode=danger-full-access",
                    "-m", "gpt-5-codex",
                    "-c", "model_reasoning_effort=high",
                    "-"
                ]);
            }
        });

        test("empty model and effort produce no -m or effort flags", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs({ model: "", effort: "" });
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, emitTurnCompletedAndExit);
            },
            ASSERTS: {
                "argv does not contain -m"(_result, { script }) {
                    Assert.strictEqual(script.$spawned[0]!.args.includes("-m"), false);
                },
                "argv does not contain model_reasoning_effort"(_result, { script }) {
                    Assert.strictEqual(script.$spawned[0]!.args.some(a => a.includes("model_reasoning_effort")), false);
                }
            }
        });

        test("resumeSessionId switches to resume subcommand", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs({ resumeSessionId: "abc" });
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, emitTurnCompletedAndExit);
            },
            ASSERT(_result, { script }) {
                Assert.deepStrictEqual(script.$spawned[0]!.args, [
                    "resume", "abc", "--json",
                    "-c", "approval_policy=never",
                    "-c", "sandbox_mode=danger-full-access",
                    "-"
                ]);
            }
        });

        test("forkParentSessionId switches to fork subcommand", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs({ forkParentSessionId: "parent" });
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, emitTurnCompletedAndExit);
            },
            ASSERT(_result, { script }) {
                Assert.deepStrictEqual(script.$spawned[0]!.args, [
                    "fork", "parent", "--json",
                    "-c", "approval_policy=never",
                    "-c", "sandbox_mode=danger-full-access",
                    "-"
                ]);
            }
        });

        test("prompt is written to stdin and stdin is closed", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs({ prompt: "hello world" });
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, emitTurnCompletedAndExit);
            },
            ASSERTS: {
                "stdin receives the prompt"(_result, { script }) {
                    Assert.deepStrictEqual(script.$processes[0]!.$stdinWrites, ["hello world"]);
                },
                "stdin is closed"(_result, { script }) {
                    Assert.strictEqual(script.$processes[0]!.$stdinEnded, true);
                }
            }
        });

        test("spawns codex binary via ScriptContext", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, emitTurnCompletedAndExit);
            },
            ASSERT(_result, { script }) {
                Assert.strictEqual(script.$spawned[0]!.command, "codex");
            }
        });
    });

    test.describe("event mapping", test => {

        test("assistant text item emits output with title Assistant", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({
                        type: "item.completed",
                        item: { type: "message", role: "assistant", content: [{ type: "output_text", text: "Hello world" }] }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "Assistant",
                    subtitle: "",
                    details: "Hello world"
                });
            }
        });

        test("tool call item emits output with tool name and summary", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({
                        type: "item.completed",
                        item: {
                            type: "function_call",
                            name: "shell",
                            arguments: JSON.stringify({ command: "ls -la" }),
                            output: "file1.txt\nfile2.txt"
                        }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "shell",
                    subtitle: "ls -la",
                    details: "file1.txt\nfile2.txt"
                });
            }
        });

        test("reasoning item emits output with title Thinking", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({
                        type: "item.completed",
                        item: { type: "reasoning", content: [{ type: "text", text: "Let me think..." }] }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "Thinking",
                    subtitle: "",
                    details: "Let me think..."
                });
            }
        });

        test("turn.completed then exit 0 emits done", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, emitTurnCompletedAndExit);
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "done" }]);
            }
        });

        test("unknown event type is filtered", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({ type: "response.created", something: true }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "done" }]);
            }
        });
    });

    test.describe("session id tracking", test => {

        test("first session id emits session event", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({ type: "item.completed", session_id: "sess-1", item: { type: "message", role: "assistant", content: [{ text: "hi" }] } }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], { type: "session", id: "sess-1" });
            }
        });

        test("duplicate session id is absorbed", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({ type: "item.completed", session_id: "sess-1", item: { type: "message", role: "assistant", content: [{ text: "hi" }] } }) + "\n");
                    proc.$emitStdout(JSON.stringify({ type: "item.completed", session_id: "sess-1", item: { type: "message", role: "assistant", content: [{ text: "again" }] } }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                const sessionEvents = result.filter(e => e.type === "session");
                Assert.strictEqual(sessionEvents.length, 1);
            }
        });

        test("different session id replaces and emits new session event", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({ type: "item.completed", session_id: "sess-1", item: { type: "message", role: "assistant", content: [{ text: "hi" }] } }) + "\n");
                    proc.$emitStdout(JSON.stringify({ type: "item.completed", session_id: "sess-2", item: { type: "message", role: "assistant", content: [{ text: "new" }] } }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                const sessionEvents = result.filter(e => e.type === "session");
                Assert.deepStrictEqual(sessionEvents, [
                    { type: "session", id: "sess-1" },
                    { type: "session", id: "sess-2" }
                ]);
            }
        });
    });

    test.describe("process exit scenarios", test => {

        test("ENOENT emits non-retryable error with codex binary not found", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    const err = new Error("spawn codex ENOENT") as Error & { code:string };
                    err.code = "ENOENT";
                    proc.$emit("error", err);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "error", retryable: false, message: "codex binary not found" }
                ]);
            }
        });

        test("unexpected exit with code 1 emits retryable error with synthesized message", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emit("exit", 1, null);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "error", retryable: true, message: "codex exited unexpectedly (code 1 signal null)" }
                ]);
            }
        });

        test("signal exit with SIGTERM emits retryable error with signal message", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emit("exit", null, "SIGTERM");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "error", retryable: true, message: "codex terminated by signal SIGTERM" }
                ]);
            }
        });
    });

    test.describe("rate-limit substring detection", test => {

        const RATE_LIMIT_CASES:[string, string][] = [
            ["rate limit", "the request was rate limited"],
            ["rate-limit", "rate-limit threshold exceeded"],
            ["rate_limit", "rate_limit error occurred"],
            ["quota", "quota exceeded for this organization"],
            ["too many requests", "too many requests, slow down"],
            ["429", "received error 429 from API"]
        ];

        for (const [substring, testMessage] of RATE_LIMIT_CASES) {
            test(`message containing "${substring}" produces retryable error`, {
                ARRANGE() {
                    const { contexts, script } = makeContexts();
                    const adapter = new CodexAdapter(contexts);
                    const args = baseArgs();
                    return { adapter, args, script, testMessage };
                },
                async ACT({ adapter, args, script, testMessage }) {
                    return await collectEvents(adapter, args, script, proc => {
                        emitErrorAndExit(proc, testMessage);
                    });
                },
                ASSERT(result) {
                    Assert.deepStrictEqual(result, [
                        { type: "error", retryable: true, message: testMessage }
                    ]);
                }
            });
        }
    });

    test.describe("5xx HTTP status detection", test => {

        for (const [status, testMessage] of [
            ["500", "internal server error 500"],
            ["502", "bad gateway 502"],
            ["503", "service unavailable 503"],
            ["599", "error code 599"]
        ] as [string, string][]) {
            test(`message containing ${status} produces retryable error`, {
                ARRANGE() {
                    const { contexts, script } = makeContexts();
                    const adapter = new CodexAdapter(contexts);
                    const args = baseArgs();
                    return { adapter, args, script, testMessage };
                },
                async ACT({ adapter, args, script, testMessage }) {
                    return await collectEvents(adapter, args, script, proc => {
                        emitErrorAndExit(proc, testMessage);
                    });
                },
                ASSERT(result) {
                    Assert.deepStrictEqual(result, [
                        { type: "error", retryable: true, message: testMessage }
                    ]);
                }
            });
        }
    });

    test.describe("408 and 425 HTTP status detection", test => {

        for (const [status, testMessage] of [
            ["408", "request timeout 408"],
            ["425", "too early 425"]
        ] as [string, string][]) {
            test(`message containing ${status} produces retryable error`, {
                ARRANGE() {
                    const { contexts, script } = makeContexts();
                    const adapter = new CodexAdapter(contexts);
                    const args = baseArgs();
                    return { adapter, args, script, testMessage };
                },
                async ACT({ adapter, args, script, testMessage }) {
                    return await collectEvents(adapter, args, script, proc => {
                        emitErrorAndExit(proc, testMessage);
                    });
                },
                ASSERT(result) {
                    Assert.deepStrictEqual(result, [
                        { type: "error", retryable: true, message: testMessage }
                    ]);
                }
            });
        }
    });

    test.describe("transport-level substring detection", test => {

        const TRANSPORT_CASES:[string, string][] = [
            ["timeout", "the operation timed out due to timeout"],
            ["timed out", "connection timed out"],
            ["connection reset", "connection reset by peer"],
            ["connection refused", "connection refused on port 443"],
            ["socket hang up", "socket hang up during request"],
            ["temporarily unavailable", "resource temporarily unavailable"],
            ["service unavailable", "service unavailable right now"],
            ["gateway", "bad gateway error"],
            ["network", "network error occurred"],
            ["ECONNRESET", "read ECONNRESET"],
            ["ECONNREFUSED", "connect ECONNREFUSED 127.0.0.1:3000"],
            ["ENOTFOUND", "getaddrinfo ENOTFOUND api.example.com"],
            ["ETIMEDOUT", "connect ETIMEDOUT 10.0.0.1:443"],
            ["EAI_AGAIN", "getaddrinfo EAI_AGAIN api.example.com"]
        ];

        for (const [substring, testMessage] of TRANSPORT_CASES) {
            test(`message containing "${substring}" produces retryable error`, {
                ARRANGE() {
                    const { contexts, script } = makeContexts();
                    const adapter = new CodexAdapter(contexts);
                    const args = baseArgs();
                    return { adapter, args, script, testMessage };
                },
                async ACT({ adapter, args, script, testMessage }) {
                    return await collectEvents(adapter, args, script, proc => {
                        emitErrorAndExit(proc, testMessage);
                    });
                },
                ASSERT(result) {
                    Assert.deepStrictEqual(result, [
                        { type: "error", retryable: true, message: testMessage }
                    ]);
                }
            });
        }
    });

    test.describe("non-retryable errors", test => {

        test("unrecognized error message produces non-retryable error", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitErrorAndExit(proc, "unauthorized");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "error", retryable: false, message: "unauthorized" }
                ]);
            }
        });

        test("error with message invalid api key is non-retryable", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitErrorAndExit(proc, "invalid api key");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "error", retryable: false, message: "invalid api key" }
                ]);
            }
        });
    });

    test.describe("duration parser", test => {

        const NOW_MS = 1_000_000;

        test("try again in 30 seconds", {
            ARRANGE() {
                const { contexts, script } = makeContexts({ time: timeContext(NOW_MS) });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitErrorAndExit(proc, "rate limit exceeded, try again in 30 seconds");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "rate_limit", waitUntilMs: NOW_MS + 30_000 }
                ]);
            }
        });

        test("try again in 2 minutes", {
            ARRANGE() {
                const { contexts, script } = makeContexts({ time: timeContext(NOW_MS) });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitErrorAndExit(proc, "rate limit hit, try again in 2 minutes");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "rate_limit", waitUntilMs: NOW_MS + 120_000 }
                ]);
            }
        });

        test("retry after 45s", {
            ARRANGE() {
                const { contexts, script } = makeContexts({ time: timeContext(NOW_MS) });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitErrorAndExit(proc, "rate limit: retry after 45s");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "rate_limit", waitUntilMs: NOW_MS + 45_000 }
                ]);
            }
        });

        test("retry-after 90 interpreted as seconds", {
            ARRANGE() {
                const { contexts, script } = makeContexts({ time: timeContext(NOW_MS) });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitErrorAndExit(proc, "too many requests, retry-after 90");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "rate_limit", waitUntilMs: NOW_MS + 90_000 }
                ]);
            }
        });

        test("wait 5 minutes", {
            ARRANGE() {
                const { contexts, script } = makeContexts({ time: timeContext(NOW_MS) });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitErrorAndExit(proc, "rate limit exceeded, wait 5 minutes");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "rate_limit", waitUntilMs: NOW_MS + 300_000 }
                ]);
            }
        });
    });

    test("rate-limit without parseable duration produces retryable error not rate_limit", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                emitErrorAndExit(proc, "rate limit exceeded, please slow down");
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [
                { type: "error", retryable: true, message: "rate limit exceeded, please slow down" }
            ]);
        }
    });

    test("abortSignal sends SIGINT to child and closes iterable", {
        ARRANGE() {
            const controller = new AbortController();
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs({ abortSignal: controller.signal });
            return { adapter, args, script, controller };
        },
        async ACT({ adapter, args, script, controller }) {
            const iterable = adapter.invoke(args);
            const proc = script.$processes[0]!;
            controller.abort();
            proc.$emit("exit", null, "SIGINT");
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return { events, kills: proc.$kills };
        },
        ASSERTS: {
            "child receives SIGINT exactly once"(result) {
                Assert.deepStrictEqual(result.kills, ["SIGINT"]);
            },
            "iterable closes with no events"(result) {
                Assert.deepStrictEqual(result.events, []);
            }
        }
    });

    test("resume/fork fallback emits Continuity lost and retries with exec", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs({ resumeSessionId: "old-session" });
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            const iterable = adapter.invoke(args);
            const firstProc = script.$processes[0]!;
            firstProc.$emit("exit", 1, null);
            const events:ToolEvent[] = [];
            const iter = iterable[Symbol.asyncIterator]();
            const first = await iter.next();
            if (!first.done) events.push(first.value);
            const secondProc = script.$processes[1]!;
            emitTurnCompletedAndExit(secondProc);
            for (;;) {
                const r = await iter.next();
                if (r.done) break;
                events.push(r.value);
            }
            return { events, spawns: script.$spawned };
        },
        ASSERTS: {
            "first event is Continuity lost output"(result) {
                Assert.deepStrictEqual(result.events[0], {
                    type: "output",
                    title: "Continuity lost",
                    subtitle: "",
                    details: "codex resume/fork unavailable in installed CLI"
                });
            },
            "second spawn uses exec subcommand"(result) {
                Assert.strictEqual(result.spawns[1]!.args[0], "exec");
            },
            "ends with done"(result) {
                Assert.deepStrictEqual(result.events[result.events.length - 1], { type: "done" });
            }
        }
    });

    test.describe("formatCodexToolArgs", test => {

        test("extracts command field", {
            ARRANGE() { return {}; },
            ACT() { return formatCodexToolArgs(JSON.stringify({ command: "ls -la" })); },
            ASSERT(result) { Assert.strictEqual(result, "ls -la"); }
        });

        test("extracts file field", {
            ARRANGE() { return {}; },
            ACT() { return formatCodexToolArgs(JSON.stringify({ file: "/path/to/file.ts" })); },
            ASSERT(result) { Assert.strictEqual(result, "/path/to/file.ts"); }
        });

        test("returns empty for undefined", {
            ARRANGE() { return {}; },
            ACT() { return formatCodexToolArgs(undefined); },
            ASSERT(result) { Assert.strictEqual(result, ""); }
        });

        test("returns empty for invalid json", {
            ARRANGE() { return {}; },
            ACT() { return formatCodexToolArgs("not json"); },
            ASSERT(result) { Assert.strictEqual(result, ""); }
        });

        test("returns empty when no identifying field", {
            ARRANGE() { return {}; },
            ACT() { return formatCodexToolArgs(JSON.stringify({ foo: "bar" })); },
            ASSERT(result) { Assert.strictEqual(result, ""); }
        });

        test("truncates long values", {
            ARRANGE() {
                const longCommand = "a".repeat(200);
                return { longCommand };
            },
            ACT({ longCommand }) { return formatCodexToolArgs(JSON.stringify({ command: longCommand })); },
            ASSERT(result) {
                Assert.strictEqual(result.length, 120);
                Assert.ok(result.endsWith("..."));
            }
        });

        test("takes only first line of multiline value", {
            ARRANGE() { return {}; },
            ACT() { return formatCodexToolArgs(JSON.stringify({ command: "line1\nline2\nline3" })); },
            ASSERT(result) { Assert.strictEqual(result, "line1"); }
        });
    });

    test("formatCodexToolArgs returns empty for JSON-parsed non-object", {
        ARRANGE() { return {}; },
        ACT() { return formatCodexToolArgs(JSON.stringify(42)); },
        ASSERT(result) { Assert.strictEqual(result, ""); }
    });

    test("function_call with missing name falls back to Tool", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                proc.$emitStdout(JSON.stringify({
                    type: "item.completed",
                    item: { type: "function_call", arguments: JSON.stringify({ command: "ls" }), output: "result" }
                }) + "\n");
                emitTurnCompletedAndExit(proc);
            });
        },
        ASSERT(result) {
            Assert.strictEqual((result[0] as {title:string}).title, "Tool");
        }
    });

    test("function_call with missing output falls back to empty string", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                proc.$emitStdout(JSON.stringify({
                    type: "item.completed",
                    item: { type: "function_call", name: "shell" }
                }) + "\n");
                emitTurnCompletedAndExit(proc);
            });
        },
        ASSERT(result) {
            Assert.strictEqual((result[0] as {details:string}).details, "");
        }
    });

    test("error event without message field falls back to unknown error", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                proc.$emitStdout(JSON.stringify({ type: "error" }) + "\n");
                proc.$emit("exit", 1, null);
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result[0], { type: "error", retryable: false, message: "unknown error" });
        }
    });

    test("extractItemText returns empty when item has no content", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                proc.$emitStdout(JSON.stringify({
                    type: "item.completed",
                    item: { type: "message", role: "assistant" }
                }) + "\n");
                emitTurnCompletedAndExit(proc);
            });
        },
        ASSERT(result) {
            Assert.strictEqual((result[0] as {details:string}).details, "");
        }
    });

    test("parseDurationMs returns null for zero duration", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                emitErrorAndExit(proc, "rate limit exceeded, try again in 0 seconds");
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [
                { type: "error", retryable: true, message: "rate limit exceeded, try again in 0 seconds" }
            ]);
        }
    });

    test("process error with non-Error value wraps it", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                proc.$emit("error", "string error value");
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [
                { type: "error", retryable: false, message: "string error value" }
            ]);
        }
    });

    test("process error with non-ENOENT Error passes message through", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                proc.$emit("error", new Error("something broke"));
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [
                { type: "error", retryable: false, message: "something broke" }
            ]);
        }
    });

    test("non-JSON line in stdout is silently ignored", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                proc.$emitStdout("this is not json\n");
                emitTurnCompletedAndExit(proc);
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [{ type: "done" }]);
        }
    });

    test("JSON null line in stdout is silently ignored", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                proc.$emitStdout("null\n");
                emitTurnCompletedAndExit(proc);
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [{ type: "done" }]);
        }
    });

    test("pre-aborted signal sends SIGINT immediately", {
        ARRANGE() {
            const controller = new AbortController();
            controller.abort();
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs({ abortSignal: controller.signal });
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            const iterable = adapter.invoke(args);
            const proc = script.$processes[0]!;
            proc.$emit("exit", null, "SIGINT");
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return { events, kills: proc.$kills };
        },
        ASSERTS: {
            "child receives SIGINT"(result) {
                Assert.deepStrictEqual(result.kills, ["SIGINT"]);
            },
            "iterable closes with no events"(result) {
                Assert.deepStrictEqual(result.events, []);
            }
        }
    });

    test("error event after done is ignored", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                emitTurnCompletedAndExit(proc);
                proc.$emit("error", new Error("late error"));
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [{ type: "done" }]);
        }
    });

    test("return() kills child with SIGINT and closes iterable", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            const iterable = adapter.invoke(args);
            const iter = iterable[Symbol.asyncIterator]();
            const proc = script.$processes[0]!;
            proc.$emitStdout(JSON.stringify({
                type: "item.completed",
                item: { type: "message", role: "assistant", content: [{ text: "hi" }] }
            }) + "\n");
            const first = await iter.next();
            const events:ToolEvent[] = first.done ? [] : [first.value];
            const returnPromise = iter.return!();
            proc.$emit("exit", null, "SIGINT");
            await returnPromise;
            return { events, kills: proc.$kills };
        },
        ASSERTS: {
            "collects only first event"(result) {
                Assert.strictEqual(result.events.length, 1);
            },
            "child receives SIGINT from return"(result) {
                Assert.deepStrictEqual(result.kills, ["SIGINT"]);
            }
        }
    });

    test("next() waits for events that arrive asynchronously", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            const iterable = adapter.invoke(args);
            const proc = script.$processes[0]!;
            const iter = iterable[Symbol.asyncIterator]();
            const pendingNext = iter.next();
            proc.$emitStdout(JSON.stringify({
                type: "item.completed",
                item: { type: "message", role: "assistant", content: [{ text: "delayed" }] }
            }) + "\n");
            const first = await pendingNext;
            emitTurnCompletedAndExit(proc);
            const events:ToolEvent[] = [];
            if (!first.done) events.push(first.value);
            for (;;) {
                const r = await iter.next();
                if (r.done) break;
                events.push(r.value);
            }
            return events;
        },
        ASSERTS: {
            "first event is the delayed output"(result) {
                Assert.strictEqual((result[0] as {title:string}).title, "Assistant");
            },
            "ends with done"(result) {
                Assert.deepStrictEqual(result[result.length - 1], { type: "done" });
            }
        }
    });

    test("stdout data arriving after done is ignored", {
        ARRANGE() {
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            return await collectEvents(adapter, args, script, proc => {
                emitErrorAndExit(proc, "unauthorized");
                proc.$emitStdout(JSON.stringify({ type: "item.completed", item: { type: "message", role: "assistant", content: [{ text: "late" }] } }) + "\n");
            });
        },
        ASSERT(result) {
            Assert.strictEqual(result.length, 1);
            Assert.strictEqual(result[0]!.type, "error");
        }
    });

    test("no direct import of child_process at runtime", {
        ARRANGE() {
            const filePath = path.resolve(__dirname, "..", "..", "src", "ai", "CodexAdapter.ts");
            const content = fs.readFileSync(filePath, "utf-8");
            return { content };
        },
        ACT({ content }) {
            const childProcessImports = (content.match(/^import\s+(?!type\s).*from\s+["']child_process["']/gm) ?? []);
            return { childProcessImports };
        },
        ASSERT(result) {
            Assert.strictEqual(result.childProcessImports.length, 0);
        }
    });

    test("no process.argv or process.env references", {
        ARRANGE() {
            const filePath = path.resolve(__dirname, "..", "..", "src", "ai", "CodexAdapter.ts");
            const content = fs.readFileSync(filePath, "utf-8");
            return { content };
        },
        ACT({ content }) {
            const argvMatches = (content.match(/process\.argv/g) ?? []).length;
            const envMatches = (content.match(/process\.env/g) ?? []).length;
            const stdoutMatches = (content.match(/process\.stdout/g) ?? []).length;
            const stderrMatches = (content.match(/process\.stderr/g) ?? []).length;
            const consoleMatches = (content.match(/\bconsole\./g) ?? []).length;
            return { argvMatches, envMatches, stdoutMatches, stderrMatches, consoleMatches };
        },
        ASSERTS: {
            "no process.argv"(result) { Assert.strictEqual(result.argvMatches, 0); },
            "no process.env"(result) { Assert.strictEqual(result.envMatches, 0); },
            "no process.stdout"(result) { Assert.strictEqual(result.stdoutMatches, 0); },
            "no process.stderr"(result) { Assert.strictEqual(result.stderrMatches, 0); },
            "no console.*"(result) { Assert.strictEqual(result.consoleMatches, 0); }
        }
    });
});
