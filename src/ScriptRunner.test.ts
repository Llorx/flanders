import * as Assert from "assert";

import test from "arrange-act-assert";

import { ScriptRunner } from "./ScriptRunner";
import type { ScriptContext, SpawnedProcess, TimeContext, TimeoutHandle } from "./contexts";

type SpawnedProcessSpy = SpawnedProcess & {
    $emit(event:"exit", code:number|null, signal?:string|null):void;
    $emit(event:"error", e:unknown):void;
    $emitStdout(chunk:string):void;
    $emitStderr(chunk:string):void;
    $kills:Array<"SIGINT"|"SIGTERM">;
};

function scriptContext() {
    const spawned:Parameters<ScriptContext["spawn"]>[] = [];
    const processes:SpawnedProcessSpy[] = [];
    return {
        $spawned: spawned,
        $processes: processes,
        ...({
            spawn(command, args, options) {
                spawned.push([command, args, options]);
                const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
                const errorListeners:Array<(e:unknown) => void> = [];
                const stdoutListeners:Array<(chunk:Buffer|string) => void> = [];
                const stderrListeners:Array<(chunk:Buffer|string) => void> = [];
                const kills:Array<"SIGINT"|"SIGTERM"> = [];
                const proc:SpawnedProcessSpy = {
                    kill(signal) {
                        kills.push(signal);
                    },
                    on(event, listener) {
                        if (event === "exit") {
                            exitListeners.push(listener as (code:number|null, signal:string|null) => void);
                        } else if (event === "error") {
                            errorListeners.push(listener as (e:unknown) => void);
                        }
                    },
                    stdout: {
                        on(_event, listener) {
                            stdoutListeners.push(listener);
                        }
                    },
                    stderr: {
                        on(_event, listener) {
                            stderrListeners.push(listener);
                        }
                    },
                    $emit(event:string, codeOrError:unknown, signal?:unknown) {
                        if (event === "exit") {
                            for (const l of exitListeners) {
                                l(codeOrError as number|null, (signal ?? null) as string|null);
                            }
                        } else if (event === "error") {
                            for (const l of errorListeners) {
                                l(codeOrError);
                            }
                        }
                    },
                    $emitStdout(chunk) {
                        for (const l of stdoutListeners) {
                            l(chunk);
                        }
                    },
                    $emitStderr(chunk) {
                        for (const l of stderrListeners) {
                            l(chunk);
                        }
                    },
                    $kills: kills
                };
                processes.push(proc);
                return proc;
            }
        } satisfies ScriptContext)
    };
}

function timeContext() {
    let now = 0;
    const timers:Array<{ at:number; cb:() => void; cancelled:boolean }> = [];
    const timerDurations:number[] = [];
    return {
        $timerDurations: timerDurations,
        $advance(ms:number) {
            now += ms;
            for (const t of timers.slice()) {
                if (!t.cancelled && t.at <= now) {
                    t.cancelled = true;
                    t.cb();
                }
            }
        },
        ...({
            now() {
                return now;
            },
            setTimeout(handler, ms):TimeoutHandle {
                timerDurations.push(ms);
                const t = { at: now + ms, cb: handler, cancelled: false };
                timers.push(t);
                return {
                    cancel() {
                        t.cancelled = true;
                    }
                };
            }
        } satisfies TimeContext)
    };
}

test.describe("ScriptRunner", test => {
    test("should spawn process with correct command, args and options", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            return { context, time };
        },
        ACT({ context, time }) {
            new ScriptRunner({
                command: "echo",
                args: ["hello", "world"],
                cwd: "/tmp"
            }, context, time);
        },
        ASSERTS: {
            "spawns exactly one process"(_, { context }) {
                Assert.strictEqual(context.$spawned.length, 1);
            },
            "passes the command"(_, { context }) {
                Assert.strictEqual(context.$spawned[0]![0], "echo");
            },
            "passes the args"(_, { context }) {
                Assert.deepStrictEqual(context.$spawned[0]![1], ["hello", "world"]);
            },
            "passes stdio pipe and cwd"(_, { context }) {
                Assert.deepStrictEqual(context.$spawned[0]![2], { stdio: "pipe", cwd: "/tmp" });
            }
        }
    });
    test("should use empty args array when args not provided", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            return { context, time };
        },
        ACT({ context, time }) {
            new ScriptRunner({ command: "ls" }, context, time);
        },
        ASSERT(_, { context }) {
            Assert.deepStrictEqual(context.$spawned[0]![1], []);
        }
    });
    test("should not include cwd in options when not provided", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            return { context, time };
        },
        ACT({ context, time }) {
            new ScriptRunner({ command: "ls" }, context, time);
        },
        ASSERT(_, { context }) {
            Assert.deepStrictEqual(context.$spawned[0]![2], { stdio: "pipe" });
        }
    });
    test("should resolve with exit code 0 and collected stdout/stderr", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            const runner = new ScriptRunner({ command: "echo" }, context, time);
            return { context, runner };
        },
        async ACT({ context, runner }) {
            const proc = context.$processes[0]!;
            proc.$emitStdout("hello ");
            proc.$emitStdout("world");
            proc.$emitStderr("warn1");
            proc.$emitStderr(" warn2");
            proc.$emit("exit", 0);
            return await runner.result();
        },
        ASSERTS: {
            "exit code is 0"(result) {
                Assert.strictEqual(result.code, 0);
            },
            "stdout is concatenated"(result) {
                Assert.strictEqual(result.stdout, "hello world");
            },
            "stderr is concatenated"(result) {
                Assert.strictEqual(result.stderr, "warn1 warn2");
            }
        }
    });
    test("should resolve with non-zero exit code", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            const runner = new ScriptRunner({ command: "false" }, context, time);
            return { context, runner };
        },
        async ACT({ context, runner }) {
            const proc = context.$processes[0]!;
            proc.$emit("exit", 42);
            return await runner.result();
        },
        ASSERTS: {
            "exit code is 42"(result) {
                Assert.strictEqual(result.code, 42);
            },
            "stdout is empty"(result) {
                Assert.strictEqual(result.stdout, "");
            },
            "stderr is empty"(result) {
                Assert.strictEqual(result.stderr, "");
            }
        }
    });
    test("should resolve with null exit code", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            const runner = new ScriptRunner({ command: "test" }, context, time);
            return { context, runner };
        },
        async ACT({ context, runner }) {
            const proc = context.$processes[0]!;
            proc.$emit("exit", null);
            return await runner.result();
        },
        ASSERT(result) {
            Assert.strictEqual(result.code, null);
        }
    });
    test("should call onStdout and onStderr callbacks", {
        ARRANGE() {
            const stdoutChunks:string[] = [];
            const stderrChunks:string[] = [];
            const context = scriptContext();
            const time = timeContext();
            const runner = new ScriptRunner({
                command: "echo",
                onStdout(chunk) { stdoutChunks.push(chunk); },
                onStderr(chunk) { stderrChunks.push(chunk); }
            }, context, time);
            return { context, runner, stdoutChunks, stderrChunks };
        },
        async ACT({ context, runner }) {
            const proc = context.$processes[0]!;
            proc.$emitStdout("line1");
            proc.$emitStdout("line2");
            proc.$emitStderr("err1");
            proc.$emit("exit", 0);
            return await runner.result();
        },
        ASSERTS: {
            "onStdout receives each chunk"(_, { stdoutChunks }) {
                Assert.deepStrictEqual(stdoutChunks, ["line1", "line2"]);
            },
            "onStderr receives each chunk"(_, { stderrChunks }) {
                Assert.deepStrictEqual(stderrChunks, ["err1"]);
            }
        }
    });
    test("should reject when process emits error event", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            const runner = new ScriptRunner({ command: "bad" }, context, time);
            return { context, runner };
        },
        async ACT({ context, runner }) {
            const proc = context.$processes[0]!;
            proc.$emit("error", new Error("spawn failed"));
            try {
                await runner.result();
                return { error: null as Error|null };
            } catch (e) {
                return { error: e as Error };
            }
        },
        ASSERTS: {
            "rejects with an error"({ error }) {
                Assert.ok(error instanceof Error);
            },
            "error message matches"({ error }) {
                Assert.strictEqual(error!.message, "spawn failed");
            }
        }
    });
    test("should wrap non-Error values in the error event", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            const runner = new ScriptRunner({ command: "bad" }, context, time);
            return { context, runner };
        },
        async ACT({ context, runner }) {
            const proc = context.$processes[0]!;
            proc.$emit("error", "string error");
            try {
                await runner.result();
                return { error: null as Error|null };
            } catch (e) {
                return { error: e as Error };
            }
        },
        ASSERT({ error }) {
            Assert.strictEqual(error!.message, "string error");
        }
    });
    test("should ignore second settlement when both error and exit fire", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            const runner = new ScriptRunner({ command: "bad" }, context, time);
            return { context, runner };
        },
        async ACT({ context, runner }) {
            const proc = context.$processes[0]!;
            proc.$emit("error", new Error("spawn error"));
            proc.$emit("exit", 0);
            try {
                await runner.result();
                return { error: null as Error|null };
            } catch (e) {
                return { error: e as Error };
            }
        },
        ASSERT({ error }) {
            Assert.strictEqual(error!.message, "spawn error");
        }
    });
    test("should ignore second settlement when exit fires then error fires", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            const runner = new ScriptRunner({ command: "test" }, context, time);
            return { context, runner };
        },
        async ACT({ context, runner }) {
            const proc = context.$processes[0]!;
            proc.$emit("exit", 0);
            proc.$emit("error", new Error("late error"));
            return await runner.result();
        },
        ASSERT(result) {
            Assert.strictEqual(result.code, 0);
        }
    });
    test("should reject with disposed error when exit fires after dispose", {
        ARRANGE() {
            const context = scriptContext();
            const time = timeContext();
            const runner = new ScriptRunner({ command: "test" }, context, time);
            return { context, time, runner };
        },
        async ACT({ context, runner }) {
            const proc = context.$processes[0]!;
            const disposePromise = runner.dispose();
            proc.$emit("exit", 0);
            await disposePromise;
            try {
                await runner.result();
                return { error: null as Error|null };
            } catch (e) {
                return { error: e as Error };
            }
        },
        ASSERT({ error }) {
            Assert.ok(error instanceof Error);
            Assert.strictEqual(error!.message, "ScriptRunner disposed");
        }
    });
    test.describe("dispose", test => {
        test("should send SIGINT and then SIGTERM after 5000ms if process does not exit", {
            ARRANGE() {
                const context = scriptContext();
                const time = timeContext();
                const runner = new ScriptRunner({ command: "long" }, context, time);
                return { context, time, runner };
            },
            async ACT({ context, time, runner }) {
                const proc = context.$processes[0]!;
                let disposeResolved = false;
                const disposePromise = runner.dispose().then(() => { disposeResolved = true; });
                const killsAfterSigint = [...proc.$kills];
                time.$advance(4999);
                const killsAt4999 = [...proc.$kills];
                time.$advance(1);
                const killsAt5000 = [...proc.$kills];
                proc.$emit("exit", null);
                await disposePromise;
                return { killsAfterSigint, killsAt4999, killsAt5000, disposeResolved };
            },
            ASSERTS: {
                "sends SIGINT immediately"({ killsAfterSigint }) {
                    Assert.deepStrictEqual(killsAfterSigint, ["SIGINT"]);
                },
                "does not send SIGTERM before 5000ms"({ killsAt4999 }) {
                    Assert.deepStrictEqual(killsAt4999, ["SIGINT"]);
                },
                "sends SIGTERM at exactly 5000ms"({ killsAt5000 }) {
                    Assert.deepStrictEqual(killsAt5000, ["SIGINT", "SIGTERM"]);
                },
                "dispose resolves after process exits"({ disposeResolved }) {
                    Assert.strictEqual(disposeResolved, true);
                },
                "kill timer duration is 5000ms"(_, { time }) {
                    Assert.strictEqual(time.$timerDurations[0], 5000);
                }
            }
        });
        test("should cancel kill timer if process exits before 5000ms", {
            ARRANGE() {
                const context = scriptContext();
                const time = timeContext();
                const runner = new ScriptRunner({ command: "fast" }, context, time);
                return { context, time, runner };
            },
            async ACT({ context, time, runner }) {
                const proc = context.$processes[0]!;
                const disposePromise = runner.dispose();
                proc.$emit("exit", 0);
                await disposePromise;
                time.$advance(5000);
                return [...proc.$kills];
            },
            ASSERT(kills) {
                Assert.deepStrictEqual(kills, ["SIGINT"]);
            }
        });
        test("should be idempotent when called twice", {
            ARRANGE() {
                const context = scriptContext();
                const time = timeContext();
                const runner = new ScriptRunner({ command: "test" }, context, time);
                return { context, runner };
            },
            async ACT({ context, runner }) {
                const proc = context.$processes[0]!;
                const firstDispose = runner.dispose();
                proc.$emit("exit", 0);
                await firstDispose;
                await runner.dispose();
                return [...proc.$kills];
            },
            ASSERT(kills) {
                Assert.deepStrictEqual(kills, ["SIGINT"]);
            }
        });
        test("should handle dispose when process already exited normally", {
            ARRANGE() {
                const context = scriptContext();
                const time = timeContext();
                const runner = new ScriptRunner({ command: "test" }, context, time);
                return { context, runner };
            },
            async ACT({ context, runner }) {
                const proc = context.$processes[0]!;
                proc.$emit("exit", 0);
                await runner.result();
                await runner.dispose();
                return [...proc.$kills];
            },
            ASSERT(kills) {
                Assert.deepStrictEqual(kills, []);
            }
        });
        test("second dispose awaits and swallows rejection from run promise", {
            ARRANGE() {
                const context = scriptContext();
                const time = timeContext();
                const runner = new ScriptRunner({ command: "test" }, context, time);
                return { context, runner };
            },
            async ACT({ context, runner }) {
                const proc = context.$processes[0]!;
                const firstDispose = runner.dispose();
                proc.$emit("exit", 0);
                await firstDispose;
                let threw = false;
                try {
                    await runner.dispose();
                } catch {
                    threw = true;
                }
                return { threw };
            },
            ASSERT({ threw }) {
                Assert.strictEqual(threw, false);
            }
        });
        test("second dispose on error-rejected run promise does not throw", {
            ARRANGE() {
                const context = scriptContext();
                const time = timeContext();
                const runner = new ScriptRunner({ command: "bad" }, context, time);
                return { context, runner };
            },
            async ACT({ context, runner }) {
                const proc = context.$processes[0]!;
                proc.$emit("error", new Error("boom"));
                let threw = false;
                try {
                    await runner.dispose();
                } catch {
                    threw = true;
                }
                let secondThrew = false;
                try {
                    await runner.dispose();
                } catch {
                    secondThrew = true;
                }
                return { threw, secondThrew };
            },
            ASSERTS: {
                "first dispose does not throw"({ threw }) {
                    Assert.strictEqual(threw, false);
                },
                "second dispose does not throw"({ secondThrew }) {
                    Assert.strictEqual(secondThrew, false);
                }
            }
        });
    });
});
