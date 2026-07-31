import * as Assert from "assert";

import test from "arrange-act-assert";
import type { TestFunction } from "arrange-act-assert";

import { CodexAdapter, CodexAdapterContexts, formatCodexCommand } from "./CodexAdapter";
import type { ToolEvent, ToolEventError, ToolAdapterInvokeArgs } from "./ToolAdapter";
import { UNKNOWN_TOOL_ERROR_MESSAGE } from "./toolErrorClassification";
import type { RandomContext, ScriptContext, SpawnedProcess, SpawnedReadable, TimeContext, TimeoutHandle } from "../contexts";
import { manualTimeContext } from "../system/manualTimeContext.fixtures";
import { removeSpawnedProcessListener } from "../system/spawnedProcessListeners.fixtures";

type SpawnedProcessSpy = SpawnedProcess & {
    $emit(event:"exit", code:number|null, signal?:string|null):void;
    $emit(event:"error", e:unknown):void;
    $emitStdout(chunk:string):void;
    $kills:Array<"SIGINT"|"SIGTERM">;
    $stdinWrites:string[];
    $stdinEnded:boolean;
};

function spawnedProcessSpy(pid:number|null = 1):SpawnedProcessSpy {
    const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stdoutListeners:Array<(chunk:Buffer|string) => void> = [];
    const kills:Array<"SIGINT"|"SIGTERM"> = [];
    const stdinWrites:string[] = [];
    let stdinEnded = false;
    return {
        pid: pid ?? undefined,
        stdin: {
            write(chunk:string) { stdinWrites.push(chunk); },
            end() { stdinEnded = true; }
        },
        kill(signal) { kills.push(signal); },
        on(event, listener) {
            if (event === "exit") exitListeners.push(listener as (code:number|null, signal:string|null) => void);
            else if (event === "error") errorListeners.push(listener as (e:unknown) => void);
        },
        off(event, listener) {
            removeSpawnedProcessListener(event, listener, exitListeners, errorListeners);
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

function scriptContext(pid:number|null = 1) {
    const spawned:Array<{ command:string; args:readonly string[] }> = [];
    const processes:SpawnedProcessSpy[] = [];
    return {
        $spawned: spawned,
        $processes: processes,
        ...({
            spawn(command, args) {
                const proc = spawnedProcessSpy(pid);
                spawned.push({ command, args });
                processes.push(proc);
                return proc;
            }
        } satisfies ScriptContext)
    };
}

const NOW_MS = 1_000_000;
const MID_DRAW = 0.5;
const RECONNECT_WAIT_MS = 120_000;

function timeContext(nowMs = NOW_MS):TimeContext {
    return {
        now() { return nowMs; },
        setTimeout(_handler:() => void, _ms:number):TimeoutHandle {
            return { cancel() {} };
        }
    };
}

function randomContext(value = 0):RandomContext {
    return {
        random() { return value; }
    };
}

function makeContexts(overrides?:Partial<{ script:ReturnType<typeof scriptContext>; time:TimeContext; random:RandomContext }>):{
    contexts:CodexAdapterContexts;
    script:ReturnType<typeof scriptContext>;
    time:TimeContext;
    random:RandomContext;
} {
    const script = overrides?.script ?? scriptContext();
    const time = overrides?.time ?? timeContext();
    const random = overrides?.random ?? randomContext();
    return {
        contexts: { script, time, random },
        script,
        time,
        random
    };
}

function baseArgs(overrides?:Partial<ToolAdapterInvokeArgs>):ToolAdapterInvokeArgs {
    return {
        prompt: "test prompt",
        model: "",
        effort: "",
        fast: false,
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

function emitEvent(proc:SpawnedProcessSpy, event:object):void {
    proc.$emitStdout(JSON.stringify(event) + "\n");
}

function emitEventAndExit(proc:SpawnedProcessSpy, event:object, exitCode:number):void {
    emitEvent(proc, event);
    proc.$emit("exit", exitCode, null);
}

function emitTurnCompletedAndExit(proc:SpawnedProcessSpy):void {
    emitEventAndExit(proc, { type: "turn.completed" }, 0);
}

function emitErrorAndExit(proc:SpawnedProcessSpy, message:string):void {
    emitEventAndExit(proc, { type: "error", message }, 1);
}

function emitTurnFailedAndExit(proc:SpawnedProcessSpy, message:string):void {
    emitEventAndExit(proc, { type: "turn.failed", error: { message } }, 1);
}

type ErrorClassification<E = ToolEventError> = E extends unknown ? Omit<E, "type"|"message"> : never;

function errorEvent(classification:ErrorClassification, message:string):ToolEvent {
    return { type: "error", ...classification, message };
}

function retryable(message:string):ToolEvent {
    return errorEvent({ retryable: true }, message);
}

function nonRetryable(message:string):ToolEvent {
    return errorEvent({ retryable: false }, message);
}

function fatalLogin(message:string):ToolEvent {
    return errorEvent({ retryable: false, fatal: true }, message);
}

const RECONNECT_WAIT:ToolEvent = { type: "rate_limit", waitUntilMs: NOW_MS + RECONNECT_WAIT_MS };

function messageCarryingOnly(token:string):string {
    return `the tool reported ${token}`;
}

type ClassificationCase = [name:string, message:string, expected:ToolEvent];

function classificationCases<T>(
    items:readonly T[],
    name:(item:T) => string,
    message:(item:T) => string,
    expected:(message:string) => ToolEvent
):ClassificationCase[] {
    return items.map((item):ClassificationCase => {
        const text = message(item);
        return [name(item), text, expected(text)];
    });
}

function standaloneTokenCases(tokens:readonly string[], outcome:string, expected:(message:string) => ToolEvent):ClassificationCase[] {
    return classificationCases(
        tokens,
        token => `a message whose only signal is the standalone ${token} token ${outcome}`,
        messageCarryingOnly,
        expected
    );
}

const WORD_CHARACTERS = ["x", "1", "_"];

function nonStandaloneTokenCases(token:string):ClassificationCase[] {
    return classificationCases(
        WORD_CHARACTERS.flatMap(char => [`${char}${token}`, `${token}${char}`, `${char}${token}${char}`]),
        adjacent => `${adjacent} carries no standalone ${token} token`,
        messageCarryingOnly,
        nonRetryable
    );
}

function retryableSubstringCases(cases:ReadonlyArray<[marker:string, message:string]>):ClassificationCase[] {
    return classificationCases(
        cases,
        ([marker]) => `a message whose only recognized substring is "${marker}" produces a retryable error`,
        ([, message]) => message,
        retryable
    );
}

function registerClassificationCases(
    test:TestFunction,
    cases:readonly ClassificationCase[],
    emit:(proc:SpawnedProcessSpy, message:string) => void = emitErrorAndExit,
    draw = MID_DRAW
):void {
    for (const [name, message, expected] of cases) {
        test(name, {
            ARRANGE() {
                const { contexts, script } = makeContexts({ time: timeContext(NOW_MS), random: randomContext(draw) });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script, message, expected };
            },
            async ACT({ adapter, args, script, message }) {
                return await collectEvents(adapter, args, script, proc => {
                    emit(proc, message);
                });
            },
            ASSERT(result, { expected }) {
                Assert.deepStrictEqual(result, [expected]);
            }
        });
    }
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

        test("fast:true leaves the spawned argv unchanged (no fast-mode flag)", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs({ fast: true });
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
                    "exec", "resume", "abc", "--json",
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
                    emitEvent(proc, {
                        type: "item.completed",
                        item: { type: "agent_message", text: "hi" }
                    });
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
                    emitEvent(proc, {
                        type: "item.completed",
                        item: { type: "agent_message" }
                    });
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
                    emitEvent(proc, {
                        type: "item.completed",
                        item: {
                            type: "command_execution",
                            command: "pwsh -Command Get-Location",
                            aggregated_output: "C:\\x",
                            exit_code: 0,
                            status: "succeeded"
                        }
                    });
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
                    emitEvent(proc, {
                        type: "item.completed",
                        item: { type: "command_execution", aggregated_output: "out" }
                    });
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
                    emitEvent(proc, {
                        type: "item.completed",
                        item: { type: "command_execution", command: "", aggregated_output: "" }
                    });
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
                    emitEvent(proc, {
                        type: "item.completed",
                        item: { type: "command_execution", command: "ls" }
                    });
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
                    emitEvent(proc, {
                        type: "item.completed",
                        item: { type: "command_execution", command: longCommand, aggregated_output: "" }
                    });
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
                    emitEvent(proc, {
                        type: "item.completed",
                        item: { type: "reasoning", text: "Let me think..." }
                    });
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
                    emitEvent(proc, {
                        type: "item.completed",
                        item: { type: "reasoning" }
                    });
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
                    emitEvent(proc, {
                        type: "item.completed",
                        item: { type: "some_unknown_item_type", text: "ignored" }
                    });
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
                    emitEvent(proc, { type: "item.completed" });
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
                    emitEvent(proc, { type: "turn.started" });
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
                    emitEvent(proc, {
                        type: "item.started",
                        item: { type: "agent_message", text: "in progress", status: "in_progress" }
                    });
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
                    emitEvent(proc, { type: "response.created", something: true });
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

    test.describe("turn.completed usage reporting", test => {

        test("usage with input_tokens and output_tokens invokes onUsage once with those values and ignores cached_input_tokens and reasoning_output_tokens", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const captured:Array<{ inputTokens:number; outputTokens:number }> = [];
                const args = baseArgs({ onUsage(usage) { captured.push(usage); } });
                return { adapter, args, script, captured };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitEventAndExit(proc, {
                        type: "turn.completed",
                        usage: {
                            input_tokens: 100,
                            cached_input_tokens: 30,
                            output_tokens: 50,
                            reasoning_output_tokens: 10
                        }
                    }, 0);
                });
            },
            ASSERTS: {
                "onUsage is called exactly once"(_result, { captured }) {
                    Assert.strictEqual(captured.length, 1);
                },
                "onUsage receives input_tokens and output_tokens with no double-counting of cached_input_tokens or reasoning_output_tokens"(_result, { captured }) {
                    Assert.deepStrictEqual(captured[0], { inputTokens: 100, outputTokens: 50 });
                },
                "done is still emitted after turn.completed and exit 0"(result) {
                    Assert.deepStrictEqual(result, [{ type: "done" }]);
                }
            }
        });

        test("absent input_tokens and output_tokens fields default to zero", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const captured:Array<{ inputTokens:number; outputTokens:number }> = [];
                const args = baseArgs({ onUsage(usage) { captured.push(usage); } });
                return { adapter, args, script, captured };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitEventAndExit(proc, {
                        type: "turn.completed",
                        usage: {}
                    }, 0);
                });
            },
            ASSERT(_result, { captured }) {
                Assert.deepStrictEqual(captured, [{ inputTokens: 0, outputTokens: 0 }]);
            }
        });

        test("turn.completed without a usage object does not invoke onUsage", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const captured:Array<{ inputTokens:number; outputTokens:number }> = [];
                const args = baseArgs({ onUsage(usage) { captured.push(usage); } });
                return { adapter, args, script, captured };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, emitTurnCompletedAndExit);
            },
            ASSERTS: {
                "onUsage is not invoked"(_result, { captured }) {
                    Assert.deepStrictEqual(captured, []);
                },
                "done is still emitted"(result) {
                    Assert.deepStrictEqual(result, [{ type: "done" }]);
                }
            }
        });

        test("turn.completed carrying usage without an onUsage callback does not throw and still drives the normal terminal behavior", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitEventAndExit(proc, {
                        type: "turn.completed",
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }, 0);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "done" }]);
            }
        });

        test("a resumed invocation reports the cumulative total minus the priorSessionUsage baseline", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const captured:Array<{ inputTokens:number; outputTokens:number }> = [];
                const args = baseArgs({
                    resumeSessionId: "sess-1",
                    priorSessionUsage: { inputTokens: 70, outputTokens: 20 },
                    onUsage(usage) { captured.push(usage); }
                });
                return { adapter, args, script, captured };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitEventAndExit(proc, {
                        type: "turn.completed",
                        usage: { input_tokens: 100, cached_input_tokens: 60, output_tokens: 50, reasoning_output_tokens: 10 }
                    }, 0);
                });
            },
            ASSERTS: {
                "reports this invocation's own consumption (cumulative minus baseline)"(_result, { captured }) {
                    Assert.deepStrictEqual(captured, [{ inputTokens: 30, outputTokens: 30 }]);
                },
                "ends with done"(result) {
                    Assert.deepStrictEqual(result, [{ type: "done" }]);
                }
            }
        });

        test("a fresh invocation does not subtract priorSessionUsage even when one is supplied", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const captured:Array<{ inputTokens:number; outputTokens:number }> = [];
                const args = baseArgs({
                    priorSessionUsage: { inputTokens: 70, outputTokens: 20 },
                    onUsage(usage) { captured.push(usage); }
                });
                return { adapter, args, script, captured };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitEventAndExit(proc, {
                        type: "turn.completed",
                        usage: { input_tokens: 100, output_tokens: 50 }
                    }, 0);
                });
            },
            ASSERT(_result, { captured }) {
                Assert.deepStrictEqual(captured, [{ inputTokens: 100, outputTokens: 50 }]);
            }
        });

        test("unsupported resume emits non-retryable error and does not report usage", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const captured:Array<{ inputTokens:number; outputTokens:number }> = [];
                const args = baseArgs({
                    resumeSessionId: "old-session",
                    priorSessionUsage: { inputTokens: 70, outputTokens: 20 },
                    onUsage(usage) { captured.push(usage); }
                });
                return { adapter, args, script, captured };
            },
            async ACT({ adapter, args, script }) {
                const iterable = adapter.invoke(args);
                const iter = iterable[Symbol.asyncIterator]();
                script.$processes[0]!.$emit("exit", 1, null);
                const events:ToolEvent[] = [];
                for (;;) {
                    const r = await iter.next();
                    if (r.done) break;
                    events.push(r.value);
                }
                return events;
            },
            ASSERTS: {
                "emits a non-retryable unsupported-resume error"(result) {
                    Assert.deepStrictEqual(result, [{
                        type: "error",
                        retryable: false,
                        message: "codex exec resume unavailable in installed CLI"
                    }]);
                },
                "does not report usage from a fresh fallback"(_result, { captured }) {
                    Assert.deepStrictEqual(captured, []);
                }
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
                    emitEvent(proc, { type: "thread.started", thread_id: "T1" });
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
                    emitEvent(proc, { type: "thread.started", thread_id: "T1" });
                    emitEvent(proc, { type: "thread.started", thread_id: "T1" });
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
                    emitEvent(proc, { type: "thread.started", thread_id: "T1" });
                    emitEvent(proc, { type: "thread.started", thread_id: "T2" });
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
                    emitEvent(proc, { type: "thread.started", thread_id: "" });
                    emitTurnCompletedAndExit(proc);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result.filter(e => e.type === "session"), []);
            }
        });
    });

    test.describe("process exit scenarios", test => {

        test("completed turn waits ten seconds, terminates a stuck child, then emits done", {
            ARRANGE() {
                const time = manualTimeContext();
                const { contexts, script } = makeContexts({ time });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script, time };
            },
            async ACT({ adapter, args, script, time }) {
                const iter = adapter.invoke(args)[Symbol.asyncIterator]();
                const proc = script.$processes[0]!;
                emitEvent(proc, { type: "turn.completed" });
                proc.$emit("error", new Error("live process error after terminal"));
                let terminalResolved = false;
                const terminalPromise = iter.next().then(result => {
                    terminalResolved = true;
                    return result;
                });
                await Promise.resolve();
                const durations = [...time.$durations];
                time.$advance(9_999);
                const killsBeforeGrace = [...proc.$kills];
                time.$advance(1);
                await Promise.resolve();
                const killsAtGrace = [...proc.$kills];
                const resolvedBeforeExit = terminalResolved;
                proc.$emit("exit", null, "SIGINT");
                const terminal = await terminalPromise;
                const end = await iter.next();
                return { durations, killsBeforeGrace, killsAtGrace, resolvedBeforeExit, terminal, end };
            },
            ASSERTS: {
                "uses one ten-second grace timer from the injected time context"(result) {
                    Assert.deepStrictEqual(result.durations, [10_000]);
                },
                "does not terminate before the grace expires"(result) {
                    Assert.deepStrictEqual(result.killsBeforeGrace, []);
                },
                "requests tree termination when the grace expires"(result) {
                    Assert.deepStrictEqual(result.killsAtGrace, ["SIGINT"]);
                },
                "does not emit the terminal event before child termination"(result) {
                    Assert.strictEqual(result.resolvedBeforeExit, false);
                },
                "preserves the determined done event after signal exit"(result) {
                    Assert.deepStrictEqual(result.terminal, { value: { type: "done" }, done: false });
                },
                "closes after the terminal event"(result) {
                    Assert.strictEqual(result.end.done, true);
                }
            }
        });

        test("completed turn cancels its grace timer when the child exits naturally", {
            ARRANGE() {
                const time = manualTimeContext();
                const { contexts, script } = makeContexts({ time });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script, time };
            },
            async ACT({ adapter, args, script, time }) {
                let pendingTimersBeforeExit = 0;
                let pendingTimersAfterExit = 0;
                const events = await collectEvents(adapter, args, script, proc => {
                    emitEvent(proc, { type: "turn.completed" });
                    pendingTimersBeforeExit = time.$pendingTimerCount();
                    time.$advance(9_999);
                    proc.$emit("exit", 0, null);
                    pendingTimersAfterExit = time.$pendingTimerCount();
                    time.$advance(1);
                });
                return {
                    events,
                    kills: [...script.$processes[0]!.$kills],
                    pendingTimersBeforeExit,
                    pendingTimersAfterExit
                };
            },
            ASSERTS: {
                "emits done"(result) {
                    Assert.deepStrictEqual(result.events, [{ type: "done" }]);
                },
                "does not request termination"(result) {
                    Assert.deepStrictEqual(result.kills, []);
                },
                "has an active grace timer before exit"(result) {
                    Assert.strictEqual(result.pendingTimersBeforeExit, 1);
                },
                "cancels the grace timer on exit"(result) {
                    Assert.strictEqual(result.pendingTimersAfterExit, 0);
                }
            }
        });

        test("classified error survives termination of a stuck child", {
            ARRANGE() {
                const time = manualTimeContext();
                const { contexts, script } = makeContexts({ time });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script, time };
            },
            async ACT({ adapter, args, script, time }) {
                const events = await collectEvents(adapter, args, script, proc => {
                    emitEvent(proc, { type: "error", message: "the tool declined the request" });
                    time.$advance(10_000);
                    proc.$emit("exit", null, "SIGINT");
                });
                return { events, kills: [...script.$processes[0]!.$kills] };
            },
            ASSERTS: {
                "preserves the classified error"(result) {
                    Assert.deepStrictEqual(result.events, [{
                        type: "error",
                        retryable: false,
                        message: "the tool declined the request"
                    }]);
                },
                "requests termination once"(result) {
                    Assert.deepStrictEqual(result.kills, ["SIGINT"]);
                }
            }
        });

        test("classified rate limit survives termination of a stuck child", {
            ARRANGE() {
                const time = manualTimeContext(NOW_MS);
                const { contexts, script } = makeContexts({ time, random: randomContext(MID_DRAW) });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script, time };
            },
            async ACT({ adapter, args, script, time }) {
                const events = await collectEvents(adapter, args, script, proc => {
                    emitEvent(proc, { type: "error", message: "rate limit exceeded" });
                    time.$advance(10_000);
                    proc.$emit("exit", null, "SIGINT");
                });
                return { events, kills: [...script.$processes[0]!.$kills] };
            },
            ASSERTS: {
                "preserves the classified rate limit"(result) {
                    Assert.deepStrictEqual(result.events, [
                        { type: "rate_limit", waitUntilMs: NOW_MS + 600_000 }
                    ]);
                },
                "requests termination once"(result) {
                    Assert.deepStrictEqual(result.kills, ["SIGINT"]);
                }
            }
        });

        test("live process error starts the grace instead of counting as child exit", {
            ARRANGE() {
                const time = manualTimeContext();
                const { contexts, script } = makeContexts({ time });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script, time };
            },
            async ACT({ adapter, args, script, time }) {
                const iter = adapter.invoke(args)[Symbol.asyncIterator]();
                const proc = script.$processes[0]!;
                proc.$emit("error", new Error("live process error"));
                let terminalResolved = false;
                const terminalPromise = iter.next().then(result => {
                    terminalResolved = true;
                    return result;
                });
                await Promise.resolve();
                time.$advance(10_000);
                await Promise.resolve();
                const resolvedBeforeExit = terminalResolved;
                const killsBeforeExit = [...proc.$kills];
                proc.$emit("exit", null, "SIGINT");
                const terminal = await terminalPromise;
                await iter.next();
                return { resolvedBeforeExit, killsBeforeExit, terminal };
            },
            ASSERTS: {
                "does not emit before actual exit"(result) {
                    Assert.strictEqual(result.resolvedBeforeExit, false);
                },
                "terminates the still-live child after the grace"(result) {
                    Assert.deepStrictEqual(result.killsBeforeExit, ["SIGINT"]);
                },
                "preserves the process error terminal"(result) {
                    Assert.deepStrictEqual(result.terminal, {
                        value: { type: "error", retryable: false, message: "live process error" },
                        done: false
                    });
                }
            }
        });

        test("ENOENT emits non-retryable error with codex binary not found", {
            ARRANGE() {
                const script = scriptContext(null);
                const { contexts } = makeContexts({ script });
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

        test("resumed signal exit before any event emits retryable signal error", {
            ARRANGE() {
                const { contexts, script } = makeContexts();
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs({ resumeSessionId: "thread-1" });
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

    test.describe("rate-limit / credit-exhaustion substring detection synthesizes an 8-12 minute wait", test => {

        // R = EIGHT_MINUTES_MS + round(random * (TWELVE_MINUTES_MS - EIGHT_MINUTES_MS)); random 0.5 => 480000 + 120000.
        const MID_R = 600_000;

        const MID_WAIT:ToolEvent = { type: "rate_limit", waitUntilMs: NOW_MS + MID_R };

        registerClassificationCases(test, [
            [`a message containing "out of credits" yields the synthesized wait`, "you are out of credits, please upgrade", MID_WAIT],
            [`a message containing "refill" yields the synthesized wait`, "your credits will refill at midnight", MID_WAIT],
            [`a message containing "usage limit" yields the synthesized wait`, "you have hit your usage limit", MID_WAIT],
            [`a message containing "rate limit" yields the synthesized wait`, "the request was rate limited", MID_WAIT],
            [`a message containing "rate-limit" yields the synthesized wait`, "rate-limit threshold exceeded", MID_WAIT],
            [`a message containing "rate_limit" yields the synthesized wait`, "rate_limit error occurred", MID_WAIT],
            [`a message containing "quota" yields the synthesized wait`, "quota exceeded for this organization", MID_WAIT],
            [`a message containing "too many requests" yields the synthesized wait`, "too many requests, slow down", MID_WAIT],
            ["matching is case-insensitive and trims surrounding whitespace", "   OUT OF CREDITS   ", MID_WAIT],
            ["a mid random draw of 0.5 yields the 10-minute midpoint (now + 600000)", "rate limit exceeded", MID_WAIT],
            ["a formerly duration-bearing message now produces the synthesized 8-12 minute wait, not a 30-second wait", "rate limit exceeded, try again in 30 seconds", MID_WAIT],
            ...standaloneTokenCases(["429"], "yields the synthesized wait", () => MID_WAIT),
            ...nonStandaloneTokenCases("429"),
            ...classificationCases(
                ["428", "430"],
                digits => `${digits} is not the 429 rate-limit token`,
                messageCarryingOnly,
                nonRetryable
            )
        ]);

        registerClassificationCases(test, [
            ["a random draw of 0 yields the 8-minute floor (now + 480000)", "out of credits", { type: "rate_limit", waitUntilMs: NOW_MS + 480_000 }]
        ], emitErrorAndExit, 0);

        registerClassificationCases(test, [
            ["a random draw of 1 yields the 12-minute ceiling (now + 720000)", "usage limit reached", { type: "rate_limit", waitUntilMs: NOW_MS + 720_000 }]
        ], emitErrorAndExit, 1);

        registerClassificationCases(test, [
            ["a turn.failed event carrying a credit-exhaustion message produces a single rate_limit event", "out of credits", MID_WAIT]
        ], emitTurnFailedAndExit);

        test("an error event immediately followed by a turn.failed event with the same text yields exactly one rate_limit event", {
            ARRANGE() {
                const { contexts, script } = makeContexts({ time: timeContext(NOW_MS), random: randomContext(MID_DRAW) });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitEvent(proc, { type: "error", message: "out of credits" });
                    emitEventAndExit(proc, { type: "turn.failed", error: { message: "out of credits" } }, 1);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "rate_limit", waitUntilMs: NOW_MS + MID_R }
                ]);
            }
        });

        test("a turn.failed event without a nested error message falls back to a non-retryable error", {
            ARRANGE() {
                const { contexts, script } = makeContexts({ time: timeContext(NOW_MS), random: randomContext(MID_DRAW) });
                const adapter = new CodexAdapter(contexts);
                const args = baseArgs();
                return { adapter, args, script };
            },
            async ACT({ adapter, args, script }) {
                return await collectEvents(adapter, args, script, proc => {
                    emitEventAndExit(proc, { type: "turn.failed" }, 1);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "error", retryable: false, message: UNKNOWN_TOOL_ERROR_MESSAGE }
                ]);
            }
        });
    });

    test.describe("reconnect substring detection synthesizes a fixed two-minute wait", test => {

        const REAL_MESSAGE = "Reconnecting... 2/5 (We're currently experiencing high demand, which may cause temporary errors.)";

        registerClassificationCases(test, [
            ["the real reconnect message produces a single rate_limit event two minutes out", REAL_MESSAGE, RECONNECT_WAIT],
            ["the reconnect substring is tested before the rate-limit family", "Reconnecting... 1/5 (rate limit exceeded)", RECONNECT_WAIT],
            ["the reconnect substring is tested before the 5xx HTTP-status family", "Reconnecting... 2/5 (internal server error 503)", RECONNECT_WAIT],
            ["the reconnect substring is tested before the 408/425 HTTP-status family", "Reconnecting... 2/5 (error 408)", RECONNECT_WAIT],
            ["the reconnect substring is tested before the transport family", "Reconnecting... 2/5 (connection reset)", RECONNECT_WAIT],
            ["matching is case-sensitive: a lowercased reconnecting marker is not recognized", "reconnecting... 2/5", nonRetryable("reconnecting... 2/5")],
            ["surrounding whitespace is trimmed before the reconnect match", "   Reconnecting... 3/5   ", RECONNECT_WAIT]
        ]);

        registerClassificationCases(test, [
            ["a turn.failed event carrying the reconnect message produces the two-minute wait", REAL_MESSAGE, RECONNECT_WAIT]
        ], emitTurnFailedAndExit);
    });

    test.describe("login/authentication substring detection emits a fatal non-retryable error", test => {

        const LOGIN_CASES:ReadonlyArray<[marker:string, message:string]> = [
            ["not logged in", "stream error: you are not logged in"],
            ["codex login", "authentication required, run codex login to continue"],
            ["not authenticated", "request rejected: not authenticated"],
            ["unauthorized", "the API returned unauthorized"],
            ["401", messageCarryingOnly("401")]
        ];

        const CASE_VARIANT_CASES:ReadonlyArray<[marker:string, message:string]> = [
            ["not logged in", "   NOT LOGGED IN   "],
            ["codex login", "Authentication required, run CODEX LOGIN to continue"],
            ["not authenticated", "Request rejected: Not Authenticated"],
            ["unauthorized", "The API returned UNAUTHORIZED"]
        ];

        const COMPETING_FAMILY_CASES:ReadonlyArray<[family:string, text:string]> = [
            ["rate-limit substring family", "usage limit reached"],
            ["429 rate-limit token", "429 returned"],
            ["5xx HTTP-status family", "503 from the upstream"],
            ["408 retryable-status token", "408 on the request"],
            ["425 retryable-status token", "425 on the request"],
            ["transport family", "connection reset by peer"]
        ];

        const COMPETING_FAMILY_PAIRS = LOGIN_CASES.flatMap(([marker, loginMessage]) =>
            COMPETING_FAMILY_CASES.map(([family, competingText]) => ({ marker, loginMessage, family, competingText }))
        );

        registerClassificationCases(test, classificationCases(LOGIN_CASES,
            ([marker]) => `an error event whose message contains "${marker}" produces a single fatal non-retryable error`,
            ([, message]) => message,
            fatalLogin));

        registerClassificationCases(test, classificationCases(LOGIN_CASES,
            ([marker]) => `a turn.failed event whose nested error message contains "${marker}" produces the same fatal error`,
            ([, message]) => message,
            fatalLogin), emitTurnFailedAndExit);

        registerClassificationCases(test, classificationCases(CASE_VARIANT_CASES,
            ([marker]) => `matching "${marker}" is case-insensitive and the message passes through verbatim`,
            ([, message]) => message,
            fatalLogin));

        registerClassificationCases(test, classificationCases(COMPETING_FAMILY_PAIRS,
            ({ family, marker }) => `the login family is tested before the ${family} so "${marker}" co-occurring with it still yields the fatal error`,
            ({ loginMessage, competingText }) => `${loginMessage} (${competingText})`,
            fatalLogin));

        registerClassificationCases(test, classificationCases(LOGIN_CASES,
            ([marker]) => `the reconnect family is tested before the login family so a co-occurring "${marker}" still yields the two-minute wait`,
            ([, loginMessage]) => `Reconnecting... 2/5 (${loginMessage})`,
            () => RECONNECT_WAIT));

        registerClassificationCases(test, nonStandaloneTokenCases("401"));

        registerClassificationCases(test, classificationCases(
            ["400", "402"],
            digits => `${digits} is not the 401 login token`,
            messageCarryingOnly,
            nonRetryable
        ));
    });

    test.describe("5xx HTTP status detection", test => {

        const FIVE_XX_TOKENS = Array.from({ length: 100 }, (_unused, offset) => String(500 + offset));

        registerClassificationCases(test, standaloneTokenCases(
            FIVE_XX_TOKENS,
            "produces a retryable error",
            retryable
        ));

        registerClassificationCases(test, ["500", "550", "599"].flatMap(token => nonStandaloneTokenCases(token)));

        registerClassificationCases(test, classificationCases(
            ["5", "50", "5000", "499", "600"],
            digits => `${digits} is not a three-digit 5xx token`,
            messageCarryingOnly,
            nonRetryable
        ));
    });

    test.describe("408 and 425 HTTP status detection", test => {

        registerClassificationCases(test, standaloneTokenCases(
            ["408", "425"],
            "produces a retryable error",
            retryable
        ));

        registerClassificationCases(test, ["408", "425"].flatMap(token => nonStandaloneTokenCases(token)));

        registerClassificationCases(test, classificationCases(
            ["400", "409", "424", "426"],
            digits => `${digits} is neither the 408 nor the 425 retryable-status token`,
            messageCarryingOnly,
            nonRetryable
        ));
    });

    test.describe("transport-level substring detection", test => {

        registerClassificationCases(test, retryableSubstringCases([
            ["timeout", "a timeout occurred while streaming"],
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
        ]));
    });

    test.describe("non-retryable errors", test => {

        registerClassificationCases(test, classificationCases(
            ["the tool declined the request", "invalid api key"],
            message => `an unrecognized message "${message}" produces a non-retryable error carrying no fatal marker`,
            message => message,
            nonRetryable
        ));
    });

    test("onUsage abort cannot reinstall a terminal event", {
        ARRANGE() {
            const controller = new AbortController();
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs({
                abortSignal: controller.signal,
                onUsage() { controller.abort(); }
            });
            return { adapter, args, script };
        },
        async ACT({ adapter, args, script }) {
            const iterable = adapter.invoke(args);
            const proc = script.$processes[0]!;
            emitEvent(proc, {
                type: "turn.completed",
                usage: { input_tokens: 1, output_tokens: 1 }
            });
            proc.$emit("exit", null, "SIGINT");
            const events:ToolEvent[] = [];
            for await (const event of iterable) events.push(event);
            return { events, kills: [...proc.$kills] };
        },
        ASSERTS: {
            "terminates the child"(result) {
                Assert.deepStrictEqual(result.kills, ["SIGINT"]);
            },
            "closes without a terminal event"(result) {
                Assert.deepStrictEqual(result.events, []);
            }
        }
    });

    test("abort discards a terminal queued behind an output event", {
        ARRANGE() {
            const controller = new AbortController();
            const { contexts, script } = makeContexts();
            const adapter = new CodexAdapter(contexts);
            const args = baseArgs({ abortSignal: controller.signal });
            return { adapter, args, script, controller };
        },
        async ACT({ adapter, args, script, controller }) {
            const iter = adapter.invoke(args)[Symbol.asyncIterator]();
            const proc = script.$processes[0]!;
            emitEvent(proc, { type: "item.completed", item: { type: "agent_message", text: "ready" } });
            emitEvent(proc, { type: "turn.completed" });
            proc.$emit("exit", 0, null);
            const output = await iter.next();
            controller.abort();
            const end = await iter.next();
            return { output, end, kills: [...proc.$kills] };
        },
        ASSERTS: {
            "yields the output before cancellation"(result) {
                Assert.deepStrictEqual(result.output, {
                    value: { type: "output", title: "Assistant", subtitle: "", details: "ready" },
                    done: false
                });
            },
            "closes without yielding the queued terminal"(result) {
                Assert.strictEqual(result.end.done, true);
            },
            "does not terminate an already exited child"(result) {
                Assert.deepStrictEqual(result.kills, []);
            }
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
            const events:ToolEvent[] = [];
            let iterableClosed = false;
            const collectPromise = (async () => {
                for await (const event of iterable) events.push(event);
                iterableClosed = true;
            })();
            await new Promise<void>(resolve => setImmediate(resolve));
            controller.abort();
            await new Promise<void>(resolve => setImmediate(resolve));
            const closedBeforeExit = iterableClosed;
            proc.$emit("exit", null, "SIGINT");
            await collectPromise;
            return { events, kills: proc.$kills, closedBeforeExit, closedAfterExit: iterableClosed };
        },
        ASSERTS: {
            "child receives SIGINT exactly once"(result) {
                Assert.deepStrictEqual(result.kills, ["SIGINT"]);
            },
            "iterable remains open until child exit"(result) {
                Assert.strictEqual(result.closedBeforeExit, false);
            },
            "iterable closes after child exit"(result) {
                Assert.strictEqual(result.closedAfterExit, true);
            },
            "iterable closes with no events"(result) {
                Assert.deepStrictEqual(result.events, []);
            }
        }
    });

    test("unsupported resume emits non-retryable error without fresh exec fallback", {
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
            for (;;) {
                const r = await iter.next();
                if (r.done) break;
                events.push(r.value);
            }
            return { events, spawns: script.$spawned };
        },
        ASSERTS: {
            "emits unsupported-resume as non-retryable error"(result) {
                Assert.deepStrictEqual(result.events, [{
                    type: "error",
                    retryable: false,
                    message: "codex exec resume unavailable in installed CLI"
                }]);
            },
            "spawn uses exec resume subcommand"(result) {
                Assert.deepStrictEqual(result.spawns[0]!.args.slice(0, 3), ["exec", "resume", "old-session"]);
            },
            "does not spawn a fresh exec fallback"(result) {
                Assert.strictEqual(result.spawns.length, 1);
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
                emitEventAndExit(proc, { type: "error" }, 1);
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result[0], { type: "error", retryable: false, message: UNKNOWN_TOOL_ERROR_MESSAGE });
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
                proc.$emit("exit", 1, null);
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
                proc.$emit("exit", 1, null);
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
            emitEvent(proc, {
                type: "item.completed",
                item: { type: "agent_message", text: "hi" }
            });
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
            emitEvent(proc, {
                type: "item.completed",
                item: { type: "agent_message", text: "delayed" }
            });
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
                emitErrorAndExit(proc, "the tool declined the request");
                emitEvent(proc, {
                    type: "item.completed",
                    item: { type: "agent_message", text: "late" }
                });
            });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [
                { type: "error", retryable: false, message: "the tool declined the request" }
            ]);
        }
    });

});
