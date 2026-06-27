import * as Assert from "assert";

import test from "arrange-act-assert";

import { AntigravityAdapter, AntigravityAdapterContexts } from "./AntigravityAdapter";
import type { ToolEvent, ToolAdapterInvokeArgs } from "./ToolAdapter";
import type { FsContext, RandomContext, ScriptContext, SpawnedProcess, SpawnedReadable, TimeContext, TimeoutHandle } from "../contexts";
import type { PlatformContext } from "../workspace/Workspace";

type SpawnedProcessSpy = SpawnedProcess & {
    $emit(event:"exit", code:number|null, signal?:string|null):void;
    $emit(event:"error", e:unknown):void;
    $emitStderr(chunk:string):void;
    $kills:Array<"SIGINT"|"SIGTERM">;
};

function spawnedProcessSpy():SpawnedProcessSpy {
    const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stderrListeners:Array<(chunk:Buffer|string) => void> = [];
    const kills:Array<"SIGINT"|"SIGTERM"> = [];
    return {
        kill(signal) { kills.push(signal); },
        on(event, listener) {
            if (event === "exit") exitListeners.push(listener as (code:number|null, signal:string|null) => void);
            else if (event === "error") errorListeners.push(listener as (e:unknown) => void);
        },
        stderr: { on(_event, listener) { stderrListeners.push(listener); } } as SpawnedReadable,
        $emit(event:string, codeOrError:unknown, signal?:unknown) {
            if (event === "exit") for (const l of exitListeners) l(codeOrError as number|null, (signal ?? null) as string|null);
            else if (event === "error") for (const l of errorListeners) l(codeOrError);
        },
        $emitStderr(chunk:string) { for (const l of stderrListeners) l(chunk); },
        $kills: kills
    };
}

function scriptContext() {
    const spawned:Array<{ command:string; args:readonly string[] }> = [];
    const processes:SpawnedProcessSpy[] = [];
    const waiters:Array<(p:SpawnedProcessSpy) => void> = [];
    return {
        $spawned: spawned,
        $processes: processes,
        $waitForSpawn():Promise<SpawnedProcessSpy> {
            if (processes.length > 0) return Promise.resolve(processes[processes.length - 1]!);
            return new Promise(resolve => waiters.push(resolve));
        },
        ...({
            spawn(command, args) {
                const proc = spawnedProcessSpy();
                spawned.push({ command, args });
                processes.push(proc);
                const w = waiters.shift();
                if (w) w(proc);
                return proc;
            }
        } satisfies ScriptContext)
    };
}

function fsContext(opts?:{ response?:string; readRejects?:boolean; writeRejects?:boolean; gateWrite?:boolean; gateRead?:boolean }) {
    const writes:Array<{ path:string; content:string }> = [];
    const reads:string[] = [];
    const removes:Array<{ path:string; force:boolean }> = [];
    let releaseWrite:(() => void)|null = null;
    let rejectWrite:((e:unknown) => void)|null = null;
    let releaseRead:((value:string) => void)|null = null;
    const fs:FsContext = {
        writeFile(path, content) {
            writes.push({ path, content });
            if (opts?.writeRejects) return Promise.reject(new Error("disk full"));
            if (opts?.gateWrite) return new Promise<void>((resolve, reject) => { releaseWrite = resolve; rejectWrite = reject; });
            return Promise.resolve();
        },
        readFile(path) {
            reads.push(path);
            if (opts?.readRejects) return Promise.reject(new Error("ENOENT"));
            if (opts?.gateRead) return new Promise<string>(resolve => { releaseRead = resolve; });
            return Promise.resolve(opts?.response ?? "");
        },
        rm(path, options) { removes.push({ path, force: !!options?.force }); return Promise.resolve(); },
        rename() { return Promise.reject(new Error("unused")); },
        readdir() { return Promise.resolve([]); },
        stat() { return Promise.reject(new Error("unused")); },
        exists() { return Promise.resolve(false); },
        mkdir() { return Promise.resolve(); },
        mkdtemp(prefix) { return Promise.resolve(prefix); }
    };
    return {
        fs,
        $writes: writes,
        $reads: reads,
        $removes: removes,
        $releaseWrite() { releaseWrite?.(); },
        $rejectWrite(e:unknown) { rejectWrite?.(e); },
        $releaseRead(value:string) { releaseRead?.(value); }
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

function randomContext(value = 0):RandomContext {
    return { random() { return value; } };
}

function platformContext():PlatformContext {
    return {
        isWindows() { return false; },
        tmpdir() { return "/tmp"; },
        homedir() { return "/home"; }
    };
}

function makeEnv(overrides?:{ fs?:ReturnType<typeof fsContext>; time?:TimeContext; random?:RandomContext }) {
    const script = scriptContext();
    const fs = overrides?.fs ?? fsContext();
    const time = overrides?.time ?? timeContext();
    const random = overrides?.random ?? randomContext();
    const platform = platformContext();
    const contexts:AntigravityAdapterContexts = { script, fs: fs.fs, time, random, platform };
    return { contexts, script, fs, time, random, platform };
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

// Drives the adapter against a freshly-spawned simulated agy process: it waits for the spawn to
// happen (the adapter writes the prompt file before spawning, so the spawn is asynchronous), runs
// the caller's setup against the spawned process, then drains the iterable.
async function run(
    adapter:AntigravityAdapter,
    args:ToolAdapterInvokeArgs,
    env:ReturnType<typeof makeEnv>,
    setup:(proc:SpawnedProcessSpy) => void
):Promise<ToolEvent[]> {
    const iterable = adapter.invoke(args);
    const proc = await env.script.$waitForSpawn();
    setup(proc);
    const events:ToolEvent[] = [];
    for await (const e of iterable) events.push(e);
    return events;
}

function successExit(proc:SpawnedProcessSpy):void {
    proc.$emit("exit", 0, null);
}

function printDirective(env:ReturnType<typeof makeEnv>):string {
    const args = env.script.$spawned[0]!.args;
    const printIdx = args.indexOf("--print");
    return args[printIdx + 1] ?? "";
}

test.describe("AntigravityAdapter", test => {

    test.describe("invocation args", test => {

        test("spawns the agy binary via ScriptContext", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERT(env) {
                Assert.strictEqual(env.script.$spawned[0]!.command, "agy");
            }
        });

        test("fresh invocation with empty model carries exactly --print, the directive, and --dangerously-skip-permissions", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ model: "" }), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERTS: {
                "argv begins with --print"(env) {
                    Assert.strictEqual(env.script.$spawned[0]!.args[0], "--print");
                },
                "the flag after the directive is --dangerously-skip-permissions"(env) {
                    Assert.strictEqual(env.script.$spawned[0]!.args[2], "--dangerously-skip-permissions");
                },
                "argv has exactly three elements (no model, conversation, or effort flag)"(env) {
                    Assert.strictEqual(env.script.$spawned[0]!.args.length, 3);
                }
            }
        });

        test("fast:true leaves the spawned argv unchanged (no fast-mode flag)", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ model: "", fast: true }), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERTS: {
                "argv begins with --print"(env) {
                    Assert.strictEqual(env.script.$spawned[0]!.args[0], "--print");
                },
                "the directive at args[1] still references the written prompt file"(env) {
                    Assert.strictEqual(printDirective(env).includes(env.fs.$writes[0]!.path), true);
                },
                "the flag after the directive is --dangerously-skip-permissions"(env) {
                    Assert.strictEqual(env.script.$spawned[0]!.args[2], "--dangerously-skip-permissions");
                },
                "argv has exactly three elements (no fast-mode flag added)"(env) {
                    Assert.strictEqual(env.script.$spawned[0]!.args.length, 3);
                }
            }
        });

        test("non-empty model appends --model <model> and nothing else", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ model: "gemini-3-pro" }), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERT(env) {
                Assert.deepStrictEqual(env.script.$spawned[0]!.args.slice(2), [
                    "--dangerously-skip-permissions",
                    "--model", "gemini-3-pro"
                ]);
            }
        });

        test("empty model omits the --model flag entirely", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ model: "" }), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERT(env) {
                Assert.strictEqual(env.script.$spawned[0]!.args.includes("--model"), false);
            }
        });

        test("a non-empty effort never produces any effort flag", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ model: "gemini-3-pro", effort: "high" }), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERTS: {
                "argv carries no --effort flag"(env) {
                    Assert.strictEqual(env.script.$spawned[0]!.args.includes("--effort"), false);
                },
                "no argv element mentions effort at all"(env) {
                    Assert.strictEqual(env.script.$spawned[0]!.args.some(a => a.toLowerCase().includes("effort")), false);
                }
            }
        });

        test("resume invocation appends --conversation <id> and never --continue or -c", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ resumeSessionId: "conv-42" }), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERTS: {
                "tail of argv is --conversation conv-42"(env) {
                    Assert.deepStrictEqual(env.script.$spawned[0]!.args.slice(2), [
                        "--dangerously-skip-permissions",
                        "--conversation", "conv-42"
                    ]);
                },
                "argv never contains --continue"(env) {
                    Assert.strictEqual(env.script.$spawned[0]!.args.includes("--continue"), false);
                },
                "argv never contains -c"(env) {
                    Assert.strictEqual(env.script.$spawned[0]!.args.includes("-c"), false);
                }
            }
        });

        test("resume with a model places --model before --conversation", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ model: "gemini-3-pro", resumeSessionId: "conv-9" }), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERT(env) {
                Assert.deepStrictEqual(env.script.$spawned[0]!.args.slice(2), [
                    "--dangerously-skip-permissions",
                    "--model", "gemini-3-pro",
                    "--conversation", "conv-9"
                ]);
            }
        });
    });

    test.describe("prompt delivery through a file", test => {

        test("the full prompt is written to a temp file verbatim", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ prompt: "the entire multi-line\nprompt body" }), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERTS: {
                "exactly one prompt file is written"(env) {
                    Assert.strictEqual(env.fs.$writes.length, 1);
                },
                "the written content is the prompt verbatim"(env) {
                    Assert.strictEqual(env.fs.$writes[0]!.content, "the entire multi-line\nprompt body");
                }
            }
        });

        test("the --print directive references the written prompt file and the response file", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERTS: {
                "the directive contains the written prompt file path"(env) {
                    Assert.strictEqual(printDirective(env).includes(env.fs.$writes[0]!.path), true);
                },
                "the directive contains the response file path that is later read"(env) {
                    Assert.strictEqual(printDirective(env).includes(env.fs.$reads[0]!), true);
                },
                "the response read path differs from the prompt write path"(env) {
                    Assert.notStrictEqual(env.fs.$reads[0]!, env.fs.$writes[0]!.path);
                }
            }
        });

        test("a prompt that would overflow the command line is never placed in argv", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                const longPrompt = "X".repeat(200_000);
                return { adapter, args: baseArgs({ prompt: longPrompt }), env, longPrompt };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERTS: {
                "no argv element contains the prompt text"(env, { longPrompt }) {
                    Assert.strictEqual(env.script.$spawned[0]!.args.some(a => a.includes(longPrompt)), false);
                },
                "the full prompt still reaches the file"(env, { longPrompt }) {
                    Assert.strictEqual(env.fs.$writes[0]!.content, longPrompt);
                }
            }
        });

        test("both temp files are removed once the invocation ends", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "ok" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return env;
            },
            ASSERTS: {
                "two files are removed"(env) {
                    Assert.strictEqual(env.fs.$removes.length, 2);
                },
                "the prompt file is among the removed paths"(env) {
                    Assert.strictEqual(env.fs.$removes.some(r => r.path === env.fs.$writes[0]!.path), true);
                },
                "the response file is among the removed paths"(env) {
                    Assert.strictEqual(env.fs.$removes.some(r => r.path === env.fs.$reads[0]!), true);
                },
                "removals are forced"(env) {
                    Assert.deepStrictEqual(env.fs.$removes.map(r => r.force), [true, true]);
                }
            }
        });
    });

    test.describe("response capture and mapping", test => {

        test("a captured plain-text response surfaces as a single Assistant output then done, with no session event", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "the assistant answer" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, successExit);
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "output", title: "Assistant", subtitle: "", details: "the assistant answer" },
                    { type: "done" }
                ]);
            }
        });

        test("a zero exit with an empty response file is a retryable transport error", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, successExit);
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "error", retryable: true, message: "antigravity produced no response" }
                ]);
            }
        });

        test("a zero exit where the response file cannot be read is a retryable transport error", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ readRejects: true }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, successExit);
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "error", retryable: true, message: "antigravity produced no response" }
                ]);
            }
        });

        test("token usage is never reported", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "answer" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                const captured:Array<{ inputTokens:number; outputTokens:number }> = [];
                return { adapter, args: baseArgs({ onUsage(u) { captured.push(u); } }), env, captured };
            },
            async ACT({ adapter, args, env }) {
                await run(adapter, args, env, successExit);
                return undefined;
            },
            ASSERT(_result, { captured }) {
                Assert.deepStrictEqual(captured, []);
            }
        });
    });

    test.describe("terminal classification from process exit and stderr", test => {

        const NOW_MS = 1_000_000;
        const MID_DRAW = 0.5;
        const MID_R = 600_000;

        for (const [substring, stderr] of [
            ["out of credits", "you are out of credits"],
            ["refill", "credits refill at midnight"],
            ["usage limit", "you hit your usage limit"],
            ["rate limit", "the request was rate limited"],
            ["rate-limit", "rate-limit threshold exceeded"],
            ["rate_limit", "rate_limit error occurred"],
            ["quota", "quota exceeded"],
            ["too many requests", "too many requests, slow down"],
            ["429", "received error 429"]
        ] as [string, string][]) {
            test(`stderr containing "${substring}" on a non-zero exit synthesizes an 8-12 minute rate_limit wait`, {
                ARRANGE() {
                    const env = makeEnv({ fs: fsContext(), time: timeContext(NOW_MS), random: randomContext(MID_DRAW) });
                    const adapter = new AntigravityAdapter(env.contexts);
                    return { adapter, args: baseArgs(), env, stderr };
                },
                async ACT({ adapter, args, env, stderr }) {
                    return await run(adapter, args, env, proc => {
                        proc.$emitStderr(stderr);
                        proc.$emit("exit", 1, null);
                    });
                },
                ASSERT(result) {
                    Assert.deepStrictEqual(result, [
                        { type: "rate_limit", waitUntilMs: NOW_MS + MID_R }
                    ]);
                }
            });
        }

        test("a random draw of 0 yields the 8-minute floor", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext(), time: timeContext(NOW_MS), random: randomContext(0) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    proc.$emitStderr("rate limit");
                    proc.$emit("exit", 1, null);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "rate_limit", waitUntilMs: NOW_MS + 480_000 }]);
            }
        });

        test("a random draw of 1 yields the 12-minute ceiling", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext(), time: timeContext(NOW_MS), random: randomContext(1) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    proc.$emitStderr("usage limit reached");
                    proc.$emit("exit", null, "SIGTERM");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "rate_limit", waitUntilMs: NOW_MS + 720_000 }]);
            }
        });

        test("matching is case-insensitive over trimmed stderr", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext(), time: timeContext(NOW_MS), random: randomContext(MID_DRAW) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    proc.$emitStderr("   OUT OF CREDITS   ");
                    proc.$emit("exit", 1, null);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "rate_limit", waitUntilMs: NOW_MS + MID_R }]);
            }
        });

        for (const [status, stderr] of [
            ["500", "internal server error 500"],
            ["502", "bad gateway 502"],
            ["599", "error code 599"],
            ["408", "request timeout 408"],
            ["425", "too early 425"]
        ] as [string, string][]) {
            test(`stderr containing HTTP ${status} is a retryable error carrying the stderr text`, {
                ARRANGE() {
                    const env = makeEnv({ fs: fsContext() });
                    const adapter = new AntigravityAdapter(env.contexts);
                    return { adapter, args: baseArgs(), env, stderr };
                },
                async ACT({ adapter, args, env, stderr }) {
                    return await run(adapter, args, env, proc => {
                        proc.$emitStderr(stderr);
                        proc.$emit("exit", 1, null);
                    });
                },
                ASSERT(result, { stderr }) {
                    Assert.deepStrictEqual(result, [{ type: "error", retryable: true, message: stderr }]);
                }
            });
        }

        test("a transport substring with no HTTP status is a retryable error", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext() });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    proc.$emitStderr("read ECONNRESET");
                    proc.$emit("exit", 1, null);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "error", retryable: true, message: "read ECONNRESET" }]);
            }
        });

        test("a signal exit carrying no recognized substring is a retryable error naming the signal", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext() });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    proc.$emitStderr("interrupted");
                    proc.$emit("exit", null, "SIGKILL");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "error", retryable: true, message: "antigravity terminated by signal SIGKILL" }]);
            }
        });

        test("a non-zero exit with unrecognized stderr is a non-retryable error carrying the stderr", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext() });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    proc.$emitStderr("invalid api key");
                    proc.$emit("exit", 2, null);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "error", retryable: false, message: "invalid api key" }]);
            }
        });

        test("a non-zero exit with empty stderr is a non-retryable error naming the exit code", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext() });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    proc.$emit("exit", 7, null);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "error", retryable: false, message: "antigravity exited with code 7" }]);
            }
        });
    });

    test.describe("process error handling", test => {

        test("ENOENT spawn error is a non-retryable agy-binary-not-found error", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext() });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    const err = new Error("spawn agy ENOENT") as Error & { code:string };
                    err.code = "ENOENT";
                    proc.$emit("error", err);
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "error", retryable: false, message: "agy binary not found" }]);
            }
        });

        test("a non-ENOENT Error passes its message through as a non-retryable error", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext() });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    proc.$emit("error", new Error("something broke"));
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "error", retryable: false, message: "something broke" }]);
            }
        });

        test("a non-Error thrown value is wrapped into a non-retryable error", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext() });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    proc.$emit("error", "string failure");
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [{ type: "error", retryable: false, message: "string failure" }]);
            }
        });

        test("an error arriving after a successful exit is ignored", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "answer" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                return await run(adapter, args, env, proc => {
                    proc.$emit("exit", 0, null);
                    proc.$emit("error", new Error("late"));
                });
            },
            ASSERT(result) {
                Assert.deepStrictEqual(result, [
                    { type: "output", title: "Assistant", subtitle: "", details: "answer" },
                    { type: "done" }
                ]);
            }
        });

        test("a write failure aborts the invocation with a non-retryable error and never spawns", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ writeRejects: true }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                const iterable = adapter.invoke(args);
                const events:ToolEvent[] = [];
                for await (const e of iterable) events.push(e);
                return { events, spawned: env.script.$spawned };
            },
            ASSERTS: {
                "the terminal event is a non-retryable write error"({ events }) {
                    Assert.deepStrictEqual(events, [{ type: "error", retryable: false, message: "failed to write antigravity prompt file" }]);
                },
                "no agy process is spawned"({ spawned }) {
                    Assert.strictEqual(spawned.length, 0);
                }
            }
        });
    });

    test.describe("cancellation", test => {

        test("abort after spawn sends SIGINT, ends the iterable with no events, and removes both temp files", {
            ARRANGE() {
                const controller = new AbortController();
                const env = makeEnv({ fs: fsContext({ response: "unused" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ abortSignal: controller.signal }), env, controller };
            },
            async ACT({ adapter, args, env, controller }) {
                const iterable = adapter.invoke(args);
                const proc = await env.script.$waitForSpawn();
                controller.abort();
                proc.$emit("exit", null, "SIGINT");
                const events:ToolEvent[] = [];
                for await (const e of iterable) events.push(e);
                return { events, kills: proc.$kills, env };
            },
            ASSERTS: {
                "the child receives SIGINT exactly once"({ kills }) {
                    Assert.deepStrictEqual(kills, ["SIGINT"]);
                },
                "the iterable ends with no events"({ events }) {
                    Assert.deepStrictEqual(events, []);
                },
                "both temp files are removed"({ env }) {
                    Assert.strictEqual(env.fs.$removes.length, 2);
                },
                "the prompt file is among the removed paths"({ env }) {
                    Assert.strictEqual(env.fs.$removes.some(r => r.path === env.fs.$writes[0]!.path), true);
                }
            }
        });

        test("a pre-aborted signal spawns nothing, writes nothing, and ends empty", {
            ARRANGE() {
                const controller = new AbortController();
                controller.abort();
                const env = makeEnv({ fs: fsContext() });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ abortSignal: controller.signal }), env };
            },
            async ACT({ adapter, args, env }) {
                const iterable = adapter.invoke(args);
                const events:ToolEvent[] = [];
                for await (const e of iterable) events.push(e);
                return { events, spawned: env.script.$spawned, writes: env.fs.$writes, removes: env.fs.$removes };
            },
            ASSERTS: {
                "no process is spawned"({ spawned }) {
                    Assert.strictEqual(spawned.length, 0);
                },
                "no prompt file is written"({ writes }) {
                    Assert.strictEqual(writes.length, 0);
                },
                "no temp file removal is attempted"({ removes }) {
                    Assert.strictEqual(removes.length, 0);
                },
                "the iterable ends with no events"({ events }) {
                    Assert.deepStrictEqual(events, []);
                }
            }
        });

        test("abort during the prompt-file write holds cleanup until the write settles, then removes both files exactly once", {
            ARRANGE() {
                const controller = new AbortController();
                const env = makeEnv({ fs: fsContext({ gateWrite: true }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ abortSignal: controller.signal }), env, controller };
            },
            async ACT({ adapter, args, env, controller }) {
                const iterable = adapter.invoke(args);
                controller.abort();
                // Begin draining without releasing the still-pending write. Cleanup (_settle) must
                // block on that in-flight write rather than removing the temp files ahead of it.
                const drained:ToolEvent[] = [];
                const drain = (async () => { for await (const e of iterable) drained.push(e); })();
                // Flush the microtask/timer queues so cleanup reaches — and parks on — the write.
                await new Promise<void>(resolve => setImmediate(resolve));
                const writesWhilePending = env.fs.$writes.length;
                const removesWhilePending = env.fs.$removes.length;
                // Only now does the write settle; the prompt file becomes real, then cleanup removes it.
                env.fs.$releaseWrite();
                await drain;
                return {
                    drained,
                    writesWhilePending,
                    removesWhilePending,
                    finalRemoves: env.fs.$removes,
                    writes: env.fs.$writes,
                    spawned: env.script.$spawned
                };
            },
            ASSERTS: {
                "no process is spawned"({ spawned }) {
                    Assert.strictEqual(spawned.length, 0);
                },
                "the iterable ends with no events"({ drained }) {
                    Assert.deepStrictEqual(drained, []);
                },
                "the prompt write is in flight when cleanup begins"({ writesWhilePending }) {
                    Assert.strictEqual(writesWhilePending, 1);
                },
                "cleanup removes nothing until the in-flight write settles"({ removesWhilePending }) {
                    Assert.strictEqual(removesWhilePending, 0);
                },
                "both temp files are removed once the write settles"({ finalRemoves }) {
                    Assert.strictEqual(finalRemoves.length, 2);
                },
                "the prompt file is among the removed paths"({ finalRemoves, writes }) {
                    Assert.strictEqual(finalRemoves.some(r => r.path === writes[0]!.path), true);
                }
            }
        });

        test("abort during a prompt-file write that then rejects surfaces no error and removes both files", {
            ARRANGE() {
                const controller = new AbortController();
                const env = makeEnv({ fs: fsContext({ gateWrite: true }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ abortSignal: controller.signal }), env, controller };
            },
            async ACT({ adapter, args, env, controller }) {
                const iterable = adapter.invoke(args);
                controller.abort();
                // The still-pending write now fails after the cancellation. A cancelled invocation
                // must end with no result, so the write-failure error must be suppressed.
                env.fs.$rejectWrite(new Error("disk full after abort"));
                // Flush microtasks so the write-rejection handler runs (and, under a regression that
                // ignores _aborted, would enqueue the spurious error) BEFORE the iterable is drained;
                // otherwise next() would short-circuit to done before any error could be observed.
                await new Promise<void>(resolve => setImmediate(resolve));
                const events:ToolEvent[] = [];
                for await (const e of iterable) events.push(e);
                return { events, spawned: env.script.$spawned, removes: env.fs.$removes };
            },
            ASSERTS: {
                "no process is spawned"({ spawned }) {
                    Assert.strictEqual(spawned.length, 0);
                },
                "the iterable ends with no events, surfacing no write-failure error"({ events }) {
                    Assert.deepStrictEqual(events, []);
                },
                "both temp files are still removed"({ removes }) {
                    Assert.strictEqual(removes.length, 2);
                }
            }
        });

        test("abort while reading the response file commits no events", {
            ARRANGE() {
                const controller = new AbortController();
                const env = makeEnv({ fs: fsContext({ gateRead: true }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ abortSignal: controller.signal }), env, controller };
            },
            async ACT({ adapter, args, env, controller }) {
                const iterable = adapter.invoke(args);
                const proc = await env.script.$waitForSpawn();
                proc.$emit("exit", 0, null);
                controller.abort();
                env.fs.$releaseRead("a response that arrives too late");
                const events:ToolEvent[] = [];
                for await (const e of iterable) events.push(e);
                return { events, kills: proc.$kills };
            },
            ASSERTS: {
                "the iterable ends with no events"({ events }) {
                    Assert.deepStrictEqual(events, []);
                },
                "the child receives SIGINT"({ kills }) {
                    Assert.deepStrictEqual(kills, ["SIGINT"]);
                }
            }
        });

        test("an error arriving after abort is ignored", {
            ARRANGE() {
                const controller = new AbortController();
                const env = makeEnv({ fs: fsContext() });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs({ abortSignal: controller.signal }), env, controller };
            },
            async ACT({ adapter, args, env, controller }) {
                const iterable = adapter.invoke(args);
                const proc = await env.script.$waitForSpawn();
                controller.abort();
                proc.$emit("error", new Error("late error after abort"));
                const events:ToolEvent[] = [];
                for await (const e of iterable) events.push(e);
                return { events, kills: proc.$kills };
            },
            ASSERTS: {
                "the iterable ends with no events"({ events }) {
                    Assert.deepStrictEqual(events, []);
                },
                "the child receives SIGINT"({ kills }) {
                    Assert.deepStrictEqual(kills, ["SIGINT"]);
                }
            }
        });

        test("return() sends SIGINT, removes both temp files, and closes the iterable", {
            ARRANGE() {
                const env = makeEnv({ fs: fsContext({ response: "partial" }) });
                const adapter = new AntigravityAdapter(env.contexts);
                return { adapter, args: baseArgs(), env };
            },
            async ACT({ adapter, args, env }) {
                const iterable = adapter.invoke(args);
                const iter = iterable[Symbol.asyncIterator]();
                const proc = await env.script.$waitForSpawn();
                const returnPromise = iter.return!();
                proc.$emit("exit", null, "SIGINT");
                const result = await returnPromise;
                return { result, kills: proc.$kills, env };
            },
            ASSERTS: {
                "return resolves as a closed iterator result"({ result }) {
                    Assert.deepStrictEqual(result, { value: undefined, done: true });
                },
                "the child receives SIGINT"({ kills }) {
                    Assert.deepStrictEqual(kills, ["SIGINT"]);
                },
                "both temp files are removed"({ env }) {
                    Assert.strictEqual(env.fs.$removes.length, 2);
                }
            }
        });
    });

});
