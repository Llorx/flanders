import * as Assert from "assert";

import test from "arrange-act-assert";

import type { ScriptContext, SpawnedReadable } from "../contexts";
import { ShellScriptContext } from "./ShellScriptContext";
import type { KillPrimitive, RawSpawnedChild, RawSpawnedReadable, RawSpawner } from "./ShellScriptContext";
import { removeSpawnedProcessListener } from "./spawnedProcessListeners.fixtures";
import type { PlatformContext } from "../workspace/Workspace";

type SpawnOpts = Parameters<ScriptContext["spawn"]>[2];
type DataListener = Parameters<SpawnedReadable["on"]>[1];

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
    closeOutputStreams():void;
    stdoutReaderCount():number;
    stderrReaderCount():number;
    stdinWrites:readonly string[];
    stdinEnded():boolean;
    rawKillSignals:ReadonlyArray<"SIGINT"|"SIGTERM">;
}>;

type FakeChildOpts = Readonly<{
    noStdout?:boolean;
    noStderr?:boolean;
    noStdin?:boolean;
}>;

class FakeReadable implements RawSpawnedReadable {
    private _dataListeners:DataListener[] = [];
    private _closeListeners:Array<() => void> = [];

    on(_event:"data", listener:DataListener):void {
        this._dataListeners.push(listener);
    }

    once(_event:"close", listener:() => void):void {
        this._closeListeners.push(listener);
    }

    off(event:"data"|"close", listener:DataListener|(() => void)):void {
        if (event === "data") {
            this._remove(this._dataListeners, listener as DataListener);
        } else {
            this._remove(this._closeListeners, listener as () => void);
        }
    }

    emit(chunk:string):void {
        for (const listener of this._dataListeners.slice()) listener(chunk);
    }

    close():void {
        for (const listener of this._closeListeners.slice()) listener();
    }

    readerCount():number {
        return this._dataListeners.length;
    }

    private _remove<T>(listeners:T[], listener:T):void {
        const index = listeners.indexOf(listener);
        if (index !== -1) listeners.splice(index, 1);
    }
}

function makeFakeChild(pid:number|undefined, opts?:FakeChildOpts):FakeChild {
    const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stdout = new FakeReadable();
    const stderr = new FakeReadable();
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
        off(event, listener) {
            removeSpawnedProcessListener(event, listener, exitListeners, errorListeners);
        },
        stdout: opts?.noStdout ? undefined : stdout,
        stderr: opts?.noStderr ? undefined : stderr,
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
            stdout.emit(chunk);
        },
        emitStderr(chunk) {
            stderr.emit(chunk);
        },
        closeOutputStreams() {
            stdout.close();
            stderr.close();
        },
        stdoutReaderCount: () => stdout.readerCount(),
        stderrReaderCount: () => stderr.readerCount(),
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
        test("attaches readers to both raw output streams before returning", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                return { ctx, fake };
            },
            ACT({ ctx }) {
                return ctx.spawn("cat", [], {});
            },
            ASSERTS: {
                "stdout has a reader without a handle subscriber"(_proc, { fake }) {
                    Assert.strictEqual(fake.stdoutReaderCount(), 1);
                },
                "stderr has a reader without a handle subscriber"(_proc, { fake }) {
                    Assert.strictEqual(fake.stderrReaderCount(), 1);
                }
            }
        });

        test("releases both raw output readers when their streams close", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                ctx.spawn("cat", [], {});
                return { fake };
            },
            ACT({ fake }) {
                fake.closeOutputStreams();
            },
            ASSERTS: {
                "stdout reader is released"(_result, { fake }) {
                    Assert.strictEqual(fake.stdoutReaderCount(), 0);
                },
                "stderr reader is released"(_result, { fake }) {
                    Assert.strictEqual(fake.stderrReaderCount(), 0);
                }
            }
        });

        test("forwards stdout data in order to every listener on the returned object", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const firstReceived:string[] = [];
                const secondReceived:string[] = [];
                const proc = ctx.spawn("cat", [], {});
                proc.stdout!.on("data", chunk => firstReceived.push(String(chunk)));
                proc.stdout!.on("data", chunk => secondReceived.push(String(chunk)));
                return { fake, firstReceived, secondReceived };
            },
            ACT({ fake }) {
                fake.emitStdout("chunk1");
                fake.emitStdout("chunk2");
            },
            ASSERTS: {
                "first listener receives every chunk in order"(_result, { firstReceived }) {
                    Assert.deepStrictEqual(firstReceived, ["chunk1", "chunk2"]);
                },
                "second listener receives every chunk in order"(_result, { secondReceived }) {
                    Assert.deepStrictEqual(secondReceived, ["chunk1", "chunk2"]);
                }
            }
        });

        test("does not replay stdout data emitted before subscription", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const proc = ctx.spawn("cat", [], {});
                fake.emitStdout("discarded");
                const received:string[] = [];
                return { proc, received };
            },
            ACT({ proc, received }) {
                proc.stdout!.on("data", chunk => received.push(String(chunk)));
            },
            ASSERT(_result, { received }) {
                Assert.deepStrictEqual(received, []);
            }
        });

        test("ignores stdout subscriptions after the raw stream closes", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const proc = ctx.spawn("cat", [], {});
                fake.closeOutputStreams();
                const received:string[] = [];
                return { fake, proc, received };
            },
            ACT({ fake, proc, received }) {
                proc.stdout!.on("data", chunk => received.push(String(chunk)));
                fake.emitStdout("after-close");
            },
            ASSERT(_result, { received }) {
                Assert.deepStrictEqual(received, []);
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

        test("removes an event listener from the raw child", {
            ARRANGE() {
                const fake = makeFakeChild(1000);
                const { spawner } = makeSpawner(() => fake.child);
                const ctx = new ShellScriptContext(spawner, makeKillRecorder().kill, posixPlatform());
                const received:Array<{ code:number|null; signal:string|null }> = [];
                const listener = (code:number|null, signal:string|null) => received.push({ code, signal });
                const proc = ctx.spawn("echo", [], {});
                proc.on("exit", listener);
                return { fake, proc, received, listener };
            },
            ACT({ fake, proc, listener }) {
                proc.off!("exit", listener);
                fake.emitExit(0, null);
            },
            ASSERT(_result, { received }) {
                Assert.deepStrictEqual(received, []);
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
        test("does nothing when a failed spawn has no pid", {
            ARRANGE() {
                const fake = makeFakeChild(undefined);
                const { spawner, calls } = makeSpawner(() => fake.child);
                const recorder = makeKillRecorder();
                const ctx = new ShellScriptContext(spawner, recorder.kill, posixPlatform());
                const proc = ctx.spawn("missing", [], {});
                return { proc, spawnCalls: calls, killCalls: recorder.calls };
            },
            ACT({ proc }) {
                proc.kill("SIGINT");
            },
            ASSERTS: {
                "does not call the kill primitive"(_result, { killCalls }) {
                    Assert.deepStrictEqual(killCalls, []);
                },
                "does not spawn a termination command"(_result, { spawnCalls }) {
                    Assert.strictEqual(spawnCalls.length, 1);
                }
            }
        });

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
