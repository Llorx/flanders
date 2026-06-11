import * as Assert from "assert";

import test from "arrange-act-assert";

import type { ScriptContext } from "../contexts";
import { ShellScriptContext } from "./ShellScriptContext";
import type { KillPrimitive, RawSpawnedChild, RawSpawner } from "./ShellScriptContext";
import type { PlatformContext } from "../workspace/Workspace";

type SpawnOpts = Parameters<ScriptContext["spawn"]>[2];

type SpawnCall = Readonly<{
    command:string;
    args:readonly string[];
    options:SpawnOpts;
}>;

type FakeChild = Readonly<{
    child:RawSpawnedChild;
    emitExit(code:number|null, signal?:string|null):void;
    emitError(e:unknown):void;
    emitStdout(chunk:string):void;
    emitStderr(chunk:string):void;
    stdinWrites:readonly string[];
    stdinEnded():boolean;
    rawKillSignals:ReadonlyArray<"SIGINT"|"SIGTERM">;
}>;

type FakeChildOpts = Readonly<{
    noStdout?:boolean;
    noStderr?:boolean;
    noStdin?:boolean;
}>;

function makeFakeChild(pid:number, opts?:FakeChildOpts):FakeChild {
    const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stdoutListeners:Array<(chunk:Buffer|string) => void> = [];
    const stderrListeners:Array<(chunk:Buffer|string) => void> = [];
    const stdinWrites:string[] = [];
    const rawKillSignals:Array<"SIGINT"|"SIGTERM"> = [];
    let stdinEnded = false;
    const child:RawSpawnedChild = {
        pid,
        kill(signal) {
            rawKillSignals.push(signal);
        },
        on(event, listener) {
            if (event === "exit") {
                exitListeners.push(listener as (code:number|null, signal:string|null) => void);
            } else {
                errorListeners.push(listener as (e:unknown) => void);
            }
        },
        stdout: opts?.noStdout ? undefined : {
            on(_event, l) { stdoutListeners.push(l); }
        },
        stderr: opts?.noStderr ? undefined : {
            on(_event, l) { stderrListeners.push(l); }
        },
        stdin: opts?.noStdin ? undefined : {
            write(chunk:string) { stdinWrites.push(chunk); },
            end() { stdinEnded = true; }
        }
    };
    return {
        child,
        emitExit(code, signal = null) {
            for (const l of exitListeners) l(code, signal);
        },
        emitError(e) {
            for (const l of errorListeners) l(e);
        },
        emitStdout(chunk) {
            for (const l of stdoutListeners) l(chunk);
        },
        emitStderr(chunk) {
            for (const l of stderrListeners) l(chunk);
        },
        stdinWrites,
        stdinEnded: () => stdinEnded,
        rawKillSignals
    };
}

function makeSpawner(makeChild:(call:SpawnCall) => RawSpawnedChild) {
    const calls:SpawnCall[] = [];
    const spawner:RawSpawner = (command, args, options) => {
        const call:SpawnCall = { command, args, options };
        calls.push(call);
        return makeChild(call);
    };
    return { spawner, calls };
}

function makeKillRecorder() {
    const calls:Array<Readonly<{ pid:number; signal:"SIGINT"|"SIGTERM" }>> = [];
    const kill:KillPrimitive = (pid, signal) => {
        calls.push({ pid, signal });
    };
    return { kill, calls };
}

function posixPlatform():PlatformContext {
    return {
        isWindows() { return false; },
        tmpdir() { return "/tmp"; },
        homedir() { return "/home/u"; }
    };
}

function windowsPlatform():PlatformContext {
    return {
        isWindows() { return true; },
        tmpdir() { return "C:\\Temp"; },
        homedir() { return "C:\\Users\\u"; }
    };
}

test.describe("ShellScriptContext", test => {
    test.describe("shell launch", test => {
        test("invokes the raw spawner with shell enabled on POSIX", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", ["hello"], { stdio: "pipe" });
            },
            ASSERT(_result, { calls }) {
                Assert.strictEqual(calls[0]!.options.shell, true);
            }
        });

        test("invokes the raw spawner with shell enabled on Windows", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, windowsPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", ["hello"], { stdio: "pipe" });
            },
            ASSERT(_result, { calls }) {
                Assert.strictEqual(calls[0]!.options.shell, true);
            }
        });

        test("preserves caller-supplied options alongside the shell flag", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("git", ["status"], { cwd: "/repo", stdio: "pipe" });
            },
            ASSERTS: {
                "shell is enabled"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.options.shell, true);
                },
                "cwd is forwarded"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.options.cwd, "/repo");
                },
                "stdio is forwarded"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.options.stdio, "pipe");
                }
            }
        });

        test("launches the spawned command with detached=true on POSIX", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", ["hello"], {});
            },
            ASSERT(_result, { calls }) {
                Assert.strictEqual(calls[0]!.options.detached, true);
            }
        });

        test("does not set detached on Windows", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, windowsPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", ["hello"], {});
            },
            ASSERT(_result, { calls }) {
                Assert.strictEqual(calls[0]!.options.detached, undefined);
            }
        });

        test("uses the bare command name as the command line when there are no args", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", [], {});
            },
            ASSERTS: {
                "the command line is only the command name"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.command, "echo");
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });

        test("passes an empty raw args array while shell is enabled for an argument-bearing spawn", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", ["hello world"], {});
            },
            ASSERTS: {
                "the escaped argument is assembled into the command line"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.command, "echo 'hello world'");
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                },
                "the same raw spawn call has shell enabled"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.options.shell, true);
                }
            }
        });

        test("places the command name verbatim at the head so the shell resolves it", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, windowsPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("codex.cmd", ["--version"], {});
            },
            ASSERTS: {
                "the assembled command line starts with the verbatim command name"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.command, `codex.cmd ^"--version^"`);
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });
    });

    test.describe("POSIX argument escaping", test => {
        test("wraps every argument in single quotes", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", ["hello world", "second arg"], {});
            },
            ASSERTS: {
                "the command line contains the single-quoted arguments"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.command, "echo 'hello world' 'second arg'");
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });

        test("escapes embedded single quotes", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", ["it's 'mine'"], {});
            },
            ASSERTS: {
                "the command line contains the escaped single quotes"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.command, "echo 'it'\\''s '\\''mine'\\'''");
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });

        test("keeps shell metacharacters literal inside single quotes", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", ["a&b|c;d>e<f $x `cmd` *glob*"], {});
            },
            ASSERTS: {
                "the command line contains the metacharacters inside one single-quoted argument"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.command, "echo 'a&b|c;d>e<f $x `cmd` *glob*'");
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });

        test("escapes empty string to an empty single-quoted pair", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", [""], {});
            },
            ASSERTS: {
                "the command line contains the empty quoted argument"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.command, "echo ''");
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });
    });

    test.describe("Windows argument escaping", test => {
        test("wraps a plain argument in caret-escaped double quotes", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, windowsPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", ["hello"], {});
            },
            ASSERTS: {
                "the command line contains the caret-escaped quoted argument"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.command, `echo ^"hello^"`);
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });

        test("caret-escapes cmd metacharacters inside the quoted argument", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, windowsPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", ["a&b|c<d>e^f(g)h!i%j"], {});
            },
            ASSERTS: {
                "the command line contains the caret-escaped metacharacters"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.command, `echo ^"a^&b^|c^<d^>e^^f^(g^)h^!i^%j^"`);
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });

        test("escapes embedded double quotes", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, windowsPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", [`a"b`], {});
            },
            ASSERTS: {
                "the command line contains the escaped embedded quote"(_result, { calls }) {
                    Assert.strictEqual(calls[0]!.command, `echo ^"a\\^"b^"`);
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });

        test("doubles backslashes preceding an embedded double quote", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, windowsPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", [`a\\"b`], {});
            },
            ASSERTS: {
                "the command line contains the doubled backslash before the escaped quote"(_result, { calls }) {
                    // Input: a\"b — 1 backslash before the quote.
                    // Step 1: doubles the 1 backslash to 2 and prefixes the quote with one more, then escapes the quote: a\\\"b
                    // Step 4: wraps and caret-escapes the surrounding quotes and the inner escaped quote: ^"a\\\^"b^"
                    Assert.strictEqual(calls[0]!.command, `echo ^"a\\\\\\^"b^"`);
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });

        test("doubles trailing backslashes so they do not escape the closing quote", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, windowsPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", [`C:\\path\\`], {});
            },
            ASSERTS: {
                "the command line contains doubled trailing backslashes before the closing quote"(_result, { calls }) {
                    // Input: C:\path\ (one trailing backslash)
                    // Step 2: doubles the trailing backslash run -> C:\path\\
                    // Step 3+4: wraps and caret-escapes the outer quotes -> ^"C:\path\\^"
                    Assert.strictEqual(calls[0]!.command, `echo ^"C:\\path\\\\^"`);
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });

        test("handles arguments with spaces, quotes, and cmd metacharacters together", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, windowsPlatform());
                return { ctx, calls };
            },
            ACT({ ctx }) {
                ctx.spawn("echo", [`hi & "x"`], {});
            },
            ASSERTS: {
                "the command line contains spaces, quotes, and metacharacters as one escaped argument"(_result, { calls }) {
                    // Input: hi & "x"
                    // Step 1: escapes the inner quotes -> hi & \"x\"
                    // Step 4: wraps then caret-escapes & and the three quote runs -> ^"hi ^& \^"x\^"^"
                    Assert.strictEqual(calls[0]!.command, `echo ^"hi ^& \\^"x\\^"^"`);
                },
                "the raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[0]!.args, []);
                }
            }
        });
    });

    test.describe("returned SpawnedProcess streams and events", test => {
        test("forwards stdout data from the raw child to listeners on the returned object", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const received:string[] = [];
                const proc = ctx.spawn("cat", [], {});
                proc.stdout!.on("data", chunk => received.push(String(chunk)));
                return { fake, received };
            },
            ACT({ fake }) {
                fake.emitStdout("chunk1");
                fake.emitStdout("chunk2");
            },
            ASSERT(_result, { received }) {
                Assert.deepStrictEqual(received, ["chunk1", "chunk2"]);
            }
        });

        test("forwards stderr data from the raw child to listeners on the returned object", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const received:string[] = [];
                const proc = ctx.spawn("cat", [], {});
                proc.stderr!.on("data", chunk => received.push(String(chunk)));
                return { fake, received };
            },
            ACT({ fake }) {
                fake.emitStderr("err1");
            },
            ASSERT(_result, { received }) {
                Assert.deepStrictEqual(received, ["err1"]);
            }
        });

        test("forwards stdin.write calls to the raw child's stdin", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const proc = ctx.spawn("cat", [], {});
                return { fake, proc };
            },
            ACT({ proc }) {
                proc.stdin!.write("input1");
                proc.stdin!.write("input2");
            },
            ASSERT(_result, { fake }) {
                Assert.deepStrictEqual(fake.stdinWrites, ["input1", "input2"]);
            }
        });

        test("forwards stdin.end to the raw child's stdin", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const proc = ctx.spawn("cat", [], {});
                return { fake, proc };
            },
            ACT({ proc }) {
                proc.stdin!.end();
            },
            ASSERT(_result, { fake }) {
                Assert.strictEqual(fake.stdinEnded(), true);
            }
        });

        test("forwards the exit event with code and signal", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const received:Array<{ code:number|null; signal:string|null }> = [];
                const proc = ctx.spawn("echo", [], {});
                proc.on("exit", (code, signal) => received.push({ code, signal }));
                return { fake, received };
            },
            ACT({ fake }) {
                fake.emitExit(0, null);
            },
            ASSERT(_result, { received }) {
                Assert.deepStrictEqual(received, [{ code: 0, signal: null }]);
            }
        });

        test("forwards the error event with the original error value", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const received:unknown[] = [];
                const proc = ctx.spawn("missing", [], {});
                proc.on("error", e => received.push(e));
                const err = new Error("ENOENT");
                return { fake, received, err };
            },
            ACT({ fake, err }) {
                fake.emitError(err);
            },
            ASSERT(_result, { received, err }) {
                Assert.deepStrictEqual(received, [err]);
            }
        });

        test("returns stdout undefined when the raw child has no stdout", {
            ARRANGE() {
                const fake = makeFakeChild(1000, { noStdout: true });
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx };
            },
            ACT({ ctx }) {
                return ctx.spawn("echo", [], {});
            },
            ASSERT(proc) {
                Assert.strictEqual(proc.stdout, undefined);
            }
        });

        test("returns stderr undefined when the raw child has no stderr", {
            ARRANGE() {
                const fake = makeFakeChild(1000, { noStderr: true });
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx };
            },
            ACT({ ctx }) {
                return ctx.spawn("echo", [], {});
            },
            ASSERT(proc) {
                Assert.strictEqual(proc.stderr, undefined);
            }
        });

        test("returns stdin undefined when the raw child has no stdin", {
            ARRANGE() {
                const fake = makeFakeChild(1000, { noStdin: true });
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx };
            },
            ACT({ ctx }) {
                return ctx.spawn("echo", [], {});
            },
            ASSERT(proc) {
                Assert.strictEqual(proc.stdin, undefined);
            }
        });
    });

    test.describe("kill on POSIX", test => {
        test("calls the injected kill primitive with the negated pid and SIGINT", {
            ARRANGE() {
                const fake = makeFakeChild(12345);
                const { spawner } = makeSpawner(() => fake.child);
                const recorder = makeKillRecorder();
                const ctx = new ShellScriptContext(spawner, recorder.kill, posixPlatform());
                const proc = ctx.spawn("echo", [], {});
                return { proc, killCalls: recorder.calls };
            },
            ACT({ proc }) {
                proc.kill("SIGINT");
            },
            ASSERT(_result, { killCalls }) {
                Assert.deepStrictEqual(killCalls, [{ pid: -12345, signal: "SIGINT" }]);
            }
        });

        test("calls the injected kill primitive with the negated pid and SIGTERM", {
            ARRANGE() {
                const fake = makeFakeChild(999);
                const { spawner } = makeSpawner(() => fake.child);
                const recorder = makeKillRecorder();
                const ctx = new ShellScriptContext(spawner, recorder.kill, posixPlatform());
                const proc = ctx.spawn("echo", [], {});
                return { proc, killCalls: recorder.calls };
            },
            ACT({ proc }) {
                proc.kill("SIGTERM");
            },
            ASSERT(_result, { killCalls }) {
                Assert.deepStrictEqual(killCalls, [{ pid: -999, signal: "SIGTERM" }]);
            }
        });

        test("does not invoke the raw spawner again on POSIX kill", {
            ARRANGE() {
                const fake = makeFakeChild(12345);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const proc = ctx.spawn("echo", [], {});
                return { proc, calls };
            },
            ACT({ proc }) {
                proc.kill("SIGINT");
            },
            ASSERT(_result, { calls }) {
                Assert.strictEqual(calls.length, 1);
            }
        });
    });

    test.describe("kill on Windows", test => {
        test("spawns taskkill /pid <pid> /t /f through the raw spawner with escaping", {
            ARRANGE() {
                const fake1 = makeFakeChild(7777);
                const fake2 = makeFakeChild(0);
                let n = 0;
                const { spawner, calls } = makeSpawner(() => (n++ === 0 ? fake1.child : fake2.child));
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, windowsPlatform());
                const proc = ctx.spawn("echo", [], {});
                return { proc, calls };
            },
            ACT({ proc }) {
                proc.kill("SIGTERM");
            },
            ASSERTS: {
                "the raw spawner was called twice (once for the command, once for taskkill)"(_result, { calls }) {
                    Assert.strictEqual(calls.length, 2);
                },
                "the second call's command is the assembled taskkill command line"(_result, { calls }) {
                    Assert.strictEqual(calls[1]!.command, `taskkill ^"/pid^" ^"7777^" ^"/t^" ^"/f^"`);
                },
                "the second call's raw args array is empty"(_result, { calls }) {
                    Assert.deepStrictEqual(calls[1]!.args, []);
                },
                "the taskkill invocation has shell enabled"(_result, { calls }) {
                    Assert.strictEqual(calls[1]!.options.shell, true);
                }
            }
        });

        test("does not call the injected kill primitive on Windows kill", {
            ARRANGE() {
                const fake1 = makeFakeChild(7777);
                const fake2 = makeFakeChild(0);
                let n = 0;
                const { spawner } = makeSpawner(() => (n++ === 0 ? fake1.child : fake2.child));
                const recorder = makeKillRecorder();
                const ctx = new ShellScriptContext(spawner, recorder.kill, windowsPlatform());
                const proc = ctx.spawn("echo", [], {});
                return { proc, killCalls: recorder.calls };
            },
            ACT({ proc }) {
                proc.kill("SIGINT");
            },
            ASSERT(_result, { killCalls }) {
                Assert.deepStrictEqual(killCalls, []);
            }
        });
    });
});
