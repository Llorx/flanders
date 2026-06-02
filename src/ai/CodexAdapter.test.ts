import * as Assert from "assert";
import * as fs from "fs";
import * as path from "path";

import test from "arrange-act-assert";

import { CodexAdapter, CodexAdapterContexts, formatCodexCommand } from "./CodexAdapter";
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

    test.describe("event mapping (codex-cli 0.135.0 schema)", test => {

        test("agent_message item emits output with title Assistant and flat text", {
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
                        item: { type: "agent_message", text: "hi" }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "Assistant",
                    subtitle: "",
                    details: "hi"
                });
            }
        });

        test("agent_message with absent text yields empty details", {
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
                        item: { type: "agent_message" }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "Assistant",
                    subtitle: "",
                    details: ""
                });
            }
        });

        test("command_execution emits output with command title and one-line summary subtitle", {
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
                            type: "command_execution",
                            command: "pwsh -Command Get-Location",
                            aggregated_output: "C:\\x",
                            exit_code: 0,
                            status: "succeeded"
                        }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "command",
                    subtitle: "pwsh -Command Get-Location",
                    details: "C:\\x"
                });
            }
        });

        test("command_execution with absent command yields empty subtitle", {
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
                        item: { type: "command_execution", aggregated_output: "out" }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "command",
                    subtitle: "",
                    details: "out"
                });
            }
        });

        test("command_execution with empty command string yields empty subtitle", {
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
                        item: { type: "command_execution", command: "", aggregated_output: "" }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "command",
                    subtitle: "",
                    details: ""
                });
            }
        });

        test("command_execution with absent aggregated_output yields empty details", {
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
                        item: { type: "command_execution", command: "ls" }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "command",
                    subtitle: "ls",
                    details: ""
                });
            }
        });

        test("command_execution with command longer than 120 chars truncates subtitle to first 117 + ...", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                const longCommand = "a".repeat(200);
                return { adapter, args, script, longCommand };
            },
            async ACT({ adapter, args, script, longCommand }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({
                        type: "item.completed",
                        item: { type: "command_execution", command: longCommand, aggregated_output: "" }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "command",
                    subtitle: "a".repeat(117) + "...",
                    details: ""
                });
            }
        });

        test("reasoning item emits output with title Thinking and flat text", {
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
                        item: { type: "reasoning", text: "Let me think..." }
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

        test("reasoning item with absent text yields empty details", {
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
                        item: { type: "reasoning" }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "Thinking",
                    subtitle: "",
                    details: ""
                });
            }
        });

        test("unknown item.type is filtered (no output event emitted)", {
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
                        item: { type: "some_unknown_item_type", text: "ignored" }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "done" }]);
            }
        });

        test("item.completed without item field is filtered", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({ type: "item.completed" }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "done" }]);
            }
        });

        test("turn.started event produces no output event", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({ type: "turn.started" }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "done" }]);
            }
        });

        test("item.started event produces no output event", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({
                        type: "item.started",
                        item: { type: "agent_message", text: "in progress", status: "in_progress" }
                    }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "done" }]);
            }
        });

        test("unknown top-level event type is filtered", {
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
    });

    test.describe("session id tracking (thread.started carries thread_id)", test => {

        test("first thread_id emits session event", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({ type: "thread.started", thread_id: "T1" }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "session", id: "T1" },
                    { type: "done" }
                ]);
            }
        });

        test("duplicate thread_id is absorbed", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({ type: "thread.started", thread_id: "T1" }) + "\n");
                    proc.$emitStdout(JSON.stringify({ type: "thread.started", thread_id: "T1" }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result.filter(e => e.type === "session"), [
                    { type: "session", id: "T1" }
                ]);
            }
        });

        test("different thread_id within the same invocation emits a new session event", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({ type: "thread.started", thread_id: "T1" }) + "\n");
                    proc.$emitStdout(JSON.stringify({ type: "thread.started", thread_id: "T2" }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result.filter(e => e.type === "session"), [
                    { type: "session", id: "T1" },
                    { type: "session", id: "T2" }
                ]);
            }
        });

        test("empty thread_id does not emit a session event", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    proc.$emitStdout(JSON.stringify({ type: "thread.started", thread_id: "" }) + "\n");
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result.filter(e => e.type === "session"), []);
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

    test.describe("formatCodexCommand", test => {

        test("returns empty string for undefined", {
            ARRANGE() { return {}; },
            ACT() { return formatCodexCommand(undefined); },
            ASSERT(result) { Assert.strictEqual(result, ""); }
        });

        test("returns empty string for empty string input", {
            ARRANGE() { return {}; },
            ACT() { return formatCodexCommand(""); },
            ASSERT(result) { Assert.strictEqual(result, ""); }
        });

        test("returns the input unchanged when it is a single short line", {
            ARRANGE() { return {}; },
            ACT() { return formatCodexCommand("pwsh -Command Get-Location"); },
            ASSERT(result) { Assert.strictEqual(result, "pwsh -Command Get-Location"); }
        });

        test("takes only the first line of a multi-line command", {
            ARRANGE() { return {}; },
            ACT() { return formatCodexCommand("line1\nline2\nline3"); },
            ASSERT(result) { Assert.strictEqual(result, "line1"); }
        });

        test("returns a 120-char input unchanged (boundary, no truncation)", {
            ARRANGE() {
                const command = "a".repeat(120);
                return { command };
            },
            ACT({ command }) { return formatCodexCommand(command); },
            ASSERT(result, { command }) { Assert.strictEqual(result, command); }
        });

        test("truncates a 121-char input to first 117 chars followed by ...", {
            ARRANGE() {
                const command = "a".repeat(121);
                return { command };
            },
            ACT({ command }) { return formatCodexCommand(command); },
            ASSERT(result) { Assert.strictEqual(result, "a".repeat(117) + "..."); }
        });

        test("truncates a 200-char input to first 117 chars followed by ...", {
            ARRANGE() {
                const command = "a".repeat(200);
                return { command };
            },
            ACT({ command }) { return formatCodexCommand(command); },
            ASSERT(result) { Assert.strictEqual(result, "a".repeat(117) + "..."); }
        });
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
                item: { type: "agent_message", text: "hi" }
            }) + "\n");
            const first = await iter.next();
            const events:ToolEvent[] = first.done ? [] : [first.value];
            const returnPromise = iter.return!();
            proc.$emit("exit", null, "SIGINT");
            await returnPromise;
            return { events, kills: proc.$kills };
        },
        ASSERTS: {
            "collects only the first event"(result) {
                Assert.deepStrictEqual(result.events, [{
                    type: "output",
                    title: "Assistant",
                    subtitle: "",
                    details: "hi"
                }]);
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
                item: { type: "agent_message", text: "delayed" }
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
            "first event is the delayed assistant output"(result) {
                Assert.deepStrictEqual(result[0], {
                    type: "output",
                    title: "Assistant",
                    subtitle: "",
                    details: "delayed"
                });
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
                proc.$emitStdout(JSON.stringify({
                    type: "item.completed",
                    item: { type: "agent_message", text: "late" }
                }) + "\n");
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [
                { type: "error", retryable: false, message: "unauthorized" }
            ]);
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

    test("CodexAdapter source uses the 0.135.0 schema field names", {
        ARRANGE() {
            const filePath = path.resolve(__dirname, "..", "..", "src", "ai", "CodexAdapter.ts");
            const content = fs.readFileSync(filePath, "utf-8");
            return { content };
        },
        ACT({ content }) {
            return {
                sessionIdMatches: (content.match(/session_id/g) ?? []).length,
                contentArrayMatches: (content.match(/CodexNativeContentBlock|extractItemText/g) ?? []).length,
                functionCallMatches: (content.match(/"function_call"/g) ?? []).length,
                messageItemTypeMatches: (content.match(/"message"/g) ?? []).length,
                jsonArgumentsParseMatches: (content.match(/JSON\.parse\(argsStr/g) ?? []).length,
                threadIdMatches: (content.match(/thread_id/g) ?? []).length,
                agentMessageMatches: (content.match(/"agent_message"/g) ?? []).length,
                commandExecutionMatches: (content.match(/"command_execution"/g) ?? []).length,
                reasoningMatches: (content.match(/"reasoning"/g) ?? []).length
            };
        },
        ASSERTS: {
            "no session_id references remain"(result) { Assert.strictEqual(result.sessionIdMatches, 0); },
            "no content-array helper remains"(result) { Assert.strictEqual(result.contentArrayMatches, 0); },
            "no function_call literal remains"(result) { Assert.strictEqual(result.functionCallMatches, 0); },
            "no \"message\" item-type literal remains"(result) { Assert.strictEqual(result.messageItemTypeMatches, 0); },
            "no JSON.parse on a JSON argsStr remains"(result) { Assert.strictEqual(result.jsonArgumentsParseMatches, 0); },
            "thread_id is referenced"(result) { Assert.ok(result.threadIdMatches > 0); },
            "agent_message item type is matched"(result) { Assert.ok(result.agentMessageMatches > 0); },
            "command_execution item type is matched"(result) { Assert.ok(result.commandExecutionMatches > 0); },
            "reasoning item type is matched"(result) { Assert.ok(result.reasoningMatches > 0); }
        }
    });
});
