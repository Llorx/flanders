import * as Assert from "assert";

import test from "arrange-act-assert";

import { ClaudeAdapter, ClaudeAdapterContexts, formatToolInput } from "./ClaudeAdapter";
import type { ToolEvent, ToolAdapterInvokeArgs } from "./ToolAdapter";
import type { ScriptContext, SpawnedProcess, SpawnedReadable, TimeContext, TimeoutHandle } from "../contexts";

type SpawnedProcessSpy = SpawnedProcess & {
    $emit(event:"exit", code:number|null, signal?:string|null):void;
    $emit(event:"error", e:unknown):void;
    $emitStdout(chunk:string):void;
    $emitStderr(chunk:string):void;
    $kills:Array<"SIGINT"|"SIGTERM">;
    $stdinWrites:string[];
    $stdinEnded:boolean;
};

function spawnedProcessSpy():SpawnedProcessSpy {
    const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stdoutListeners:Array<(chunk:Buffer|string) => void> = [];
    const stderrListeners:Array<(chunk:Buffer|string) => void> = [];
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
        stderr: { on(_event, listener) { stderrListeners.push(listener); } } as SpawnedReadable,
        $emit(event:string, codeOrError:unknown, signal?:unknown) {
            if (event === "exit") for (const l of exitListeners) l(codeOrError as number|null, (signal ?? null) as string|null);
            else if (event === "error") for (const l of errorListeners) l(codeOrError);
        },
        $emitStdout(chunk:string) { for (const l of stdoutListeners) l(chunk); },
        $emitStderr(chunk:string) { for (const l of stderrListeners) l(chunk); },
        $kills: kills,
        $stdinWrites: stdinWrites,
        get $stdinEnded() { return stdinEnded; }
    };
}

function claudeContext() {
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

function timeContext():TimeContext {
    return {
        now() { return 0; },
        setTimeout(handler:() => void, ms:number):TimeoutHandle {
            void ms;
            void handler;
            return { cancel() {} };
        }
    };
}

function makeContexts(overrides?:Partial<{ claude:ReturnType<typeof claudeContext>; time:TimeContext }>):{
    contexts:ClaudeAdapterContexts;
    claude:ReturnType<typeof claudeContext>;
    time:TimeContext;
} {
    const claude = overrides?.claude ?? claudeContext();
    const time = overrides?.time ?? timeContext();
    return {
        contexts: { claude, time },
        claude,
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

const BASE_ARGV = [
    "--input-format", "stream-json",
    "--output-format", "stream-json",
    "--include-partial-messages",
    "--verbose",
    "--print"
];

test.describe("ClaudeAdapter", test => {

    test("spawn args with empty model and empty effort", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return { spawnArgs: claude.$spawned[0]!.args, events };
        },
        ASSERTS: {
            "argv contains expected flags and no --model"(result) {
                Assert.deepStrictEqual(result.spawnArgs, BASE_ARGV);
            },
            "no effort output event emitted"(result) {
                const effortEvents = result.events.filter(e => e.type === "output" && e.title === "Effort unsupported");
                Assert.strictEqual(effortEvents.length, 0);
            }
        }
    });

    test("spawn args with model claude-opus-4-6", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs({ model: "claude-opus-4-6" });
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            for await (const _ of iterable) { void _; }
            return claude.$spawned[0]!.args;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["--model", "claude-opus-4-6", ...BASE_ARGV]);
        }
    });

    test("spawn args with effort high appends --effort and emits no unsupported event", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs({ effort: "high" });
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return { spawnArgs: claude.$spawned[0]!.args, events };
        },
        ASSERTS: {
            "argv has --effort immediately followed by the effort value"(result) {
                Assert.deepStrictEqual(result.spawnArgs, ["--effort", "high", ...BASE_ARGV]);
            },
            "no Effort unsupported output event emitted"(result) {
                const effortEvents = result.events.filter(e => e.type === "output" && e.title === "Effort unsupported");
                Assert.strictEqual(effortEvents.length, 0);
            }
        }
    });

    test("spawn args with both model and effort appends --model then --effort", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs({ model: "claude-opus-4-6", effort: "high" });
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            for await (const _ of iterable) { void _; }
            return claude.$spawned[0]!.args;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["--model", "claude-opus-4-6", "--effort", "high", ...BASE_ARGV]);
        }
    });

    test("resume invocation passes --resume <id>", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args:ToolAdapterInvokeArgs = { prompt: "p", model: "", effort: "", abortSignal: new AbortController().signal, resumeSessionId: "sess-abc" };
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            for await (const _ of iterable) { void _; }
            return claude.$spawned[0]!.args;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["--resume", "sess-abc", ...BASE_ARGV]);
        }
    });

    test("stdin is closed immediately after writing the prompt", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            for await (const _ of iterable) { void _; }
            return { stdinEnded: proc.$stdinEnded, writeCount: proc.$stdinWrites.length };
        },
        ASSERTS: {
            "stdin was ended"(result) {
                Assert.strictEqual(result.stdinEnded, true);
            },
            "only the prompt was written to stdin"(result) {
                Assert.strictEqual(result.writeCount, 1);
            }
        }
    });

    test("assistant text block maps to output event", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello world" }] } }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result[0], { type: "output", title: "Assistant", subtitle: "", details: "hello world" });
        }
    });

    test("assistant thinking block maps to output event", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "thinking", thinking: "let me think" }] } }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result[0], { type: "output", title: "Thinking", subtitle: "", details: "let me think" });
        }
    });

    test("assistant tool_use block maps to output event", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: "Read", input: { file_path: "/foo.ts" } }] } }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result[0], { type: "output", title: "Read", subtitle: "/foo.ts", details: "" });
        }
    });

    test("user tool_result block maps to output event", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "file contents here" }] } }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result[0], { type: "output", title: "Result", subtitle: "file contents here", details: "file contents here" });
        }
    });

    test("system event with session_id emits session event", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "system", session_id: "sess-42" }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result[0], { type: "session", id: "sess-42" });
        }
    });

    test("subsequent identical session_id is absorbed", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "system", session_id: "sess-42" }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false, session_id: "sess-42" }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.filter(e => e.type === "session");
        },
        ASSERT(result) {
            Assert.strictEqual(result.length, 1);
        }
    });

    test("differing session_id emits new session event", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "system", session_id: "sess-1" }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "assistant", session_id: "sess-2", message: { role: "assistant", content: [{ type: "text", text: "x" }] } }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.filter(e => e.type === "session");
        },
        ASSERTS: {
            "emits two session events"(result) {
                Assert.strictEqual(result.length, 2);
            },
            "first session event has id sess-1"(result) {
                Assert.deepStrictEqual(result[0], { type: "session", id: "sess-1" });
            },
            "second session event has id sess-2"(result) {
                Assert.deepStrictEqual(result[1], { type: "session", id: "sess-2" });
            }
        }
    });

    test("result is_error:false emits done", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result[result.length - 1], { type: "done" });
        }
    });

    test("result 429 with parseable resetsAt produces rate_limit event", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({
                type: "result",
                is_error: true,
                api_error_status: 429,
                error: { message: "rate limited" },
                rate_limit_info: { status: "rejected", resetsAt: 1700000000 }
            }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            const terminal = result.find(e => e.type === "rate_limit");
            Assert.deepStrictEqual(terminal, { type: "rate_limit", waitUntilMs: 1700000000 * 1000 });
        }
    });

    test("result 429 without parseable resetsAt produces retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({
                type: "result",
                is_error: true,
                api_error_status: 429,
                error: { message: "rate limited" }
            }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            const terminal = result.find(e => e.type === "error");
            Assert.deepStrictEqual(terminal, { type: "error", retryable: true, message: "rate limited" });
        }
    });

    test("result 429 with rate_limit_info but non-numeric resetsAt produces retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({
                type: "result",
                is_error: true,
                api_error_status: 429,
                error: { message: "rate limited" },
                rate_limit_info: { status: "rejected" }
            }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error" || e.type === "rate_limit");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: true, message: "rate limited" });
        }
    });

    test("api_error_status 500 produces retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, api_error_status: 500, error: { message: "internal" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: true, message: "internal" });
        }
    });

    test("api_error_status 503 produces retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, api_error_status: 503, error: { message: "unavailable" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: true, message: "unavailable" });
        }
    });

    test("api_error_status 599 produces retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, api_error_status: 599, error: { message: "5xx" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: true, message: "5xx" });
        }
    });

    test("api_error_status 408 produces retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, api_error_status: 408, error: { message: "timeout" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: true, message: "timeout" });
        }
    });

    test("api_error_status 425 produces retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, api_error_status: 425, error: { message: "too early" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: true, message: "too early" });
        }
    });

    test("api_error_status null produces retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, api_error_status: null, error: { message: "transport" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: true, message: "transport" });
        }
    });

    test("subtype error_during_execution produces retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, subtype: "error_during_execution", error: { message: "exec failed" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: true, message: "exec failed" });
        }
    });

    test("subtype error_max_turns produces non-retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, subtype: "error_max_turns", error: { message: "max turns" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: false, message: "max turns" });
        }
    });

    test("subtype error_max_budget_usd produces non-retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, subtype: "error_max_budget_usd", error: { message: "budget" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: false, message: "budget" });
        }
    });

    test("subtype error_max_structured_output_retries produces non-retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, subtype: "error_max_structured_output_retries", error: { message: "retries" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: false, message: "retries" });
        }
    });

    test("unknown error shape (api_error_status 418) produces non-retryable error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            return { adapter, contexts, claude };
        },
        async ACT({ adapter, claude }) {
            const iterable = adapter.invoke(baseArgs());
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, api_error_status: 418, error: { message: "teapot" } }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: false, message: "teapot" });
        }
    });

    test("abort during stream sends SIGINT and closes iterable", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const abort = new AbortController();
            const args = baseArgs({ abortSignal: abort.signal });
            return { adapter, args, claude, abort };
        },
        async ACT({ adapter, args, claude, abort }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } }) + "\n");
            await new Promise<void>(r => setImmediate(r));
            abort.abort();
            await new Promise<void>(r => setImmediate(r));
            proc.$emit("exit", null);
            const events:ToolEvent[] = [];
            let threw = false;
            try {
                for await (const e of iterable) events.push(e);
            } catch {
                threw = true;
            }
            return { kills: proc.$kills.slice(), threw };
        },
        ASSERTS: {
            "kill called with SIGINT exactly once"(result) {
                Assert.deepStrictEqual(result.kills, ["SIGINT"]);
            },
            "for-await exits without throwing"(result) {
                Assert.strictEqual(result.threw, false);
            }
        }
    });

    test("stderr is forwarded as output event with title stderr", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStderr("warning: something\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            const stderrEvent = result.find(e => e.type === "output" && e.title === "stderr");
            Assert.deepStrictEqual(stderrEvent, { type: "output", title: "stderr", subtitle: "", details: "warning: something\n" });
        }
    });

    test("prompt is delivered as stream-json user message on stdin", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs({ prompt: "hello world" });
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            for await (const _ of iterable) { void _; }
            return proc.$stdinWrites[0];
        },
        ASSERT(result) {
            Assert.deepStrictEqual(JSON.parse(result!.replace(/\n$/, "")), { type: "user", message: { role: "user", content: "hello world" } });
        }
    });

    test("usage callback is invoked with token counts from result event", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            let captured:{ inputTokens:number; outputTokens:number }|null = null;
            const args = baseArgs({ onUsage(usage) { captured = usage; } });
            return { adapter, args, claude, getCaptured() { return captured; } };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false, usage: { input_tokens: 100, output_tokens: 50, cache_creation_input_tokens: 10, cache_read_input_tokens: 5 } }) + "\n");
            proc.$emit("exit", 0);
            for await (const _ of iterable) { void _; }
        },
        ASSERT(_, { getCaptured }) {
            Assert.deepStrictEqual(getCaptured(), { inputTokens: 115, outputTokens: 50 });
        }
    });

    test("malformed JSON lines are silently ignored", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout("not json\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [{ type: "done" }]);
        }
    });

    test("process error event propagates as thrown error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emit("error", new Error("spawn failed"));
            let caught:Error|null = null;
            try {
                for await (const _ of iterable) { void _; }
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERT(result) {
            Assert.strictEqual(result!.message, "spawn failed");
        }
    });

    test("429 with overageResetsAt when isUsingOverage is true uses overage timestamp", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({
                type: "result",
                is_error: true,
                api_error_status: 429,
                error: { message: "rate limited" },
                rate_limit_info: { status: "rejected", resetsAt: 1000, isUsingOverage: true, overageResetsAt: 2000 }
            }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "rate_limit");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "rate_limit", waitUntilMs: 2000 * 1000 });
        }
    });

    test("system events other than initial are filtered (no output emitted)", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "system", session_id: "s1" }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "system" }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.filter(e => e.type === "output");
        },
        ASSERT(result) {
            Assert.strictEqual(result.length, 0);
        }
    });

    test("result event with no error.message falls back to 'unknown error'", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: true, api_error_status: 418 }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events.find(e => e.type === "error");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "error", retryable: false, message: "unknown error" });
        }
    });

    test("pre-aborted signal sends SIGINT immediately", {
        ARRANGE() {
            const abort = new AbortController();
            abort.abort();
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs({ abortSignal: abort.signal });
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emit("exit", null);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return proc.$kills.slice();
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["SIGINT"]);
        }
    });

    test("user tool_result with array content extracts text blocks", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({
                type: "user",
                message: { role: "user", content: [{ type: "tool_result", content: [{ type: "text", text: "line1" }, { type: "text", text: "line2" }] }] }
            }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events[0];
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "output", title: "Result", subtitle: "line1line2", details: "line1line2" });
        }
    });

    test("tool_result with non-string non-array content yields empty output", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({
                type: "user",
                message: { role: "user", content: [{ type: "tool_result", content: 42 }] }
            }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events[0];
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "output", title: "Result", subtitle: "", details: "" });
        }
    });

    test("tool_result array content with non-text and non-object blocks is skipped", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({
                type: "user",
                message: { role: "user", content: [{ type: "tool_result", content: [null, { type: "image" }, { type: "text", text: "kept" }] }] }
            }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events[0];
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { type: "output", title: "Result", subtitle: "kept", details: "kept" });
        }
    });

    test("process error with non-Error payload still propagates as Error", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emit("error", "string error");
            let caught:Error|null = null;
            try {
                for await (const _ of iterable) { void _; }
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERT(result) {
            Assert.strictEqual(result!.message, "string error");
        }
    });

    test("process exits without result event emits no terminal tool event", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emit("exit", 1);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, []);
        }
    });

    test("JSON null line is silently ignored", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout("null\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [{ type: "done" }]);
        }
    });

    test("usage with absent cache fields defaults to zero", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            let captured:{ inputTokens:number; outputTokens:number }|null = null;
            const args = baseArgs({ onUsage(usage) { captured = usage; } });
            return { adapter, args, claude, getCaptured() { return captured; } };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false, usage: { input_tokens: 50 } }) + "\n");
            proc.$emit("exit", 0);
            for await (const _ of iterable) { void _; }
        },
        ASSERT(_, { getCaptured }) {
            Assert.deepStrictEqual(getCaptured(), { inputTokens: 50, outputTokens: 0 });
        }
    });

    test("result event with session_id emits session when no prior session captured", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false, session_id: "from-result" }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) events.push(e);
            return events;
        },
        ASSERTS: {
            "session event emitted from result"(result) {
                Assert.deepStrictEqual(result[0], { type: "session", id: "from-result" });
            },
            "done event follows"(result) {
                Assert.deepStrictEqual(result[1], { type: "done" });
            }
        }
    });

    test("async wait path: events emitted after iteration starts", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            const events:ToolEvent[] = [];
            const collectPromise = (async () => {
                for await (const e of iterable) events.push(e);
            })();
            await new Promise<void>(r => setImmediate(r));
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            await collectPromise;
            return events;
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [{ type: "done" }]);
        }
    });

    test("break from for-await triggers return() and kills process", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const args = baseArgs();
            return { adapter, args, claude };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: "hello" }] } }) + "\n");
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false }) + "\n");
            proc.$emit("exit", 0);
            const events:ToolEvent[] = [];
            for await (const e of iterable) {
                events.push(e);
                break;
            }
            return { events, kills: proc.$kills.slice() };
        },
        ASSERTS: {
            "collected one event before break"(result) {
                Assert.strictEqual(result.events.length, 1);
            },
            "process killed with SIGINT on break"(result) {
                Assert.deepStrictEqual(result.kills, ["SIGINT"]);
            }
        }
    });

    test("usage with absent input_tokens defaults to zero", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            let captured:{ inputTokens:number; outputTokens:number }|null = null;
            const args = baseArgs({ onUsage(usage) { captured = usage; } });
            return { adapter, args, claude, getCaptured() { return captured; } };
        },
        async ACT({ adapter, args, claude }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            proc.$emitStdout(JSON.stringify({ type: "result", is_error: false, usage: { output_tokens: 25 } }) + "\n");
            proc.$emit("exit", 0);
            for await (const _ of iterable) { void _; }
        },
        ASSERT(_, { getCaptured }) {
            Assert.deepStrictEqual(getCaptured(), { inputTokens: 0, outputTokens: 25 });
        }
    });

    test("abort path awaits child process exit before closing iterable", {
        ARRANGE() {
            const { contexts, claude } = makeContexts();
            const adapter = new ClaudeAdapter(contexts);
            const abort = new AbortController();
            const args = baseArgs({ abortSignal: abort.signal });
            return { adapter, args, claude, abort };
        },
        async ACT({ adapter, args, claude, abort }) {
            const iterable = adapter.invoke(args);
            const proc = claude.$processes[0]!;
            let exitEmittedBeforeIterableClosed = false;
            abort.abort();
            await new Promise<void>(r => setImmediate(r));
            const collectPromise = (async () => {
                for await (const _ of iterable) { void _; }
            })();
            await new Promise<void>(r => setImmediate(r));
            proc.$emit("exit", null);
            exitEmittedBeforeIterableClosed = true;
            await collectPromise;
            return { exitEmittedBeforeIterableClosed, kills: proc.$kills.slice() };
        },
        ASSERTS: {
            "child process was killed"(result) {
                Assert.deepStrictEqual(result.kills, ["SIGINT"]);
            },
            "exit was emitted before iterable closed"(result) {
                Assert.strictEqual(result.exitEmittedBeforeIterableClosed, true);
            }
        }
    });
});

test.describe("formatToolInput", test => {
    test("extracts command field", {
        ARRANGE() {
            return { input: { command: "ls -la" } };
        },
        ACT({ input }) {
            return formatToolInput(input);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "ls -la");
        }
    });

    test("extracts file_path field", {
        ARRANGE() {
            return { input: { file_path: "/foo.ts" } };
        },
        ACT({ input }) {
            return formatToolInput(input);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "/foo.ts");
        }
    });

    test("extracts path field", {
        ARRANGE() {
            return { input: { path: "/bar" } };
        },
        ACT({ input }) {
            return formatToolInput(input);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "/bar");
        }
    });

    test("extracts pattern field", {
        ARRANGE() {
            return { input: { pattern: "*.ts" } };
        },
        ACT({ input }) {
            return formatToolInput(input);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "*.ts");
        }
    });

    test("extracts url field", {
        ARRANGE() {
            return { input: { url: "http://example.com" } };
        },
        ACT({ input }) {
            return formatToolInput(input);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "http://example.com");
        }
    });

    test("extracts query field", {
        ARRANGE() {
            return { input: { query: "search term" } };
        },
        ACT({ input }) {
            return formatToolInput(input);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "search term");
        }
    });

    test("falls back to JSON for unknown fields", {
        ARRANGE() {
            return { input: { x: 1 } };
        },
        ACT({ input }) {
            return formatToolInput(input);
        },
        ASSERT(result) {
            Assert.strictEqual(result, '{"x":1}');
        }
    });

    test("truncates long JSON", {
        ARRANGE() {
            return { input: { long: "a".repeat(200) } };
        },
        ACT({ input }) {
            return formatToolInput(input);
        },
        ASSERT(result) {
            Assert.strictEqual(result.length, 120);
            Assert.ok(result.endsWith("..."));
        }
    });

    test("returns empty for undefined input", {
        ARRANGE() {
            return {};
        },
        ACT() {
            return formatToolInput(undefined);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "");
        }
    });

    test("precedence: command over file_path", {
        ARRANGE() {
            return { input: { command: "ls", file_path: "/foo" } };
        },
        ACT({ input }) {
            return formatToolInput(input);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "ls");
        }
    });
});
