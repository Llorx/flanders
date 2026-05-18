import * as Assert from "assert";

import test from "arrange-act-assert";

import * as path from "path";

import { isGitAvailable, isInsideWorkTree, countPendingChangesExcept, addAll, commit } from "./Git";
import type { OutputContext, ScriptContext, SpawnedProcess, TimeContext, TimeoutHandle } from "./contexts";

type FakeProcess = SpawnedProcess & {
    $emitStdout(chunk:string):void;
    $emitStderr(chunk:string):void;
    $emit(event:"exit", code:number|null):void;
    $emit(event:"error", e:unknown):void;
};

function fakeProcess():FakeProcess {
    const exitListeners:Array<(code:number|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stdoutListeners:Array<(chunk:Buffer|string) => void> = [];
    const stderrListeners:Array<(chunk:Buffer|string) => void> = [];
    return {
        kill() {},
        on(event:"exit"|"error", listener:((code:number|null) => void)|((e:unknown) => void)) {
            if (event === "exit") exitListeners.push(listener as (code:number|null) => void);
            else if (event === "error") errorListeners.push(listener as (e:unknown) => void);
        },
        stdout: { on(_event:"data", listener:(chunk:Buffer|string) => void) { stdoutListeners.push(listener); } },
        stderr: { on(_event:"data", listener:(chunk:Buffer|string) => void) { stderrListeners.push(listener); } },
        stdin: { write() {}, end() {} },
        $emitStdout(chunk:string) { for (const l of stdoutListeners) l(chunk); },
        $emitStderr(chunk:string) { for (const l of stderrListeners) l(chunk); },
        $emit(event:string, payload:unknown) {
            if (event === "exit") for (const l of exitListeners) l(payload as number|null);
            else if (event === "error") for (const l of errorListeners) l(payload);
        }
    };
}

function stubTime():TimeContext {
    return {
        now() { return 0; },
        setTimeout(handler:() => void, ms:number):TimeoutHandle {
            const id = globalThis.setTimeout(handler, ms);
            return { cancel() { globalThis.clearTimeout(id); } };
        }
    };
}

test.describe("isGitAvailable", test => {
    test("returns true when spawn exits with code 0", {
        ARRANGE() {
            let spawnedArgs:{ command:string; args:readonly string[] }|null = null;
            const script:ScriptContext = {
                spawn(command, args, _options) {
                    spawnedArgs = { command, args };
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("exit", 0));
                    return proc;
                }
            };
            return { script, time: stubTime(), spawnedArgs: () => spawnedArgs };
        },
        async ACT({ script, time }) {
            return await isGitAvailable(script, time);
        },
        ASSERT(result) {
            Assert.strictEqual(result, true);
        }
    });

    test("returns false when spawn exits with non-zero code", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("exit", 1));
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await isGitAvailable(script, time);
        },
        ASSERT(result) {
            Assert.strictEqual(result, false);
        }
    });

    test("returns false when spawn emits error (binary not found)", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("error", new Error("ENOENT")));
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await isGitAvailable(script, time);
        },
        ASSERT(result) {
            Assert.strictEqual(result, false);
        }
    });

    test("spawns git --version", {
        ARRANGE() {
            let captured:{ command:string; args:readonly string[] }|null = null;
            const script:ScriptContext = {
                spawn(command, args) {
                    captured = { command, args };
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("exit", 0));
                    return proc;
                }
            };
            return { script, time: stubTime(), captured: () => captured };
        },
        async ACT({ script, time }) {
            await isGitAvailable(script, time);
        },
        ASSERTS: {
            "command is git"(_result, { captured }) {
                Assert.strictEqual(captured()!.command, "git");
            },
            "args are --version"(_result, { captured }) {
                Assert.deepStrictEqual(captured()!.args, ["--version"]);
            }
        }
    });
});

test.describe("isInsideWorkTree", test => {
    test("returns true when exit=0 and stdout is 'true\\n'", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("true\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await isInsideWorkTree(script, time, "/some/dir");
        },
        ASSERT(result) {
            Assert.strictEqual(result, true);
        }
    });

    test("returns false when exit=0 but stdout is not 'true'", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("false\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await isInsideWorkTree(script, time, "/some/dir");
        },
        ASSERT(result) {
            Assert.strictEqual(result, false);
        }
    });

    test("returns false when exit is non-zero", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emit("exit", 128);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await isInsideWorkTree(script, time, "/some/dir");
        },
        ASSERT(result) {
            Assert.strictEqual(result, false);
        }
    });

    test("returns false when spawn emits error", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("error", new Error("ENOENT")));
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await isInsideWorkTree(script, time, "/some/dir");
        },
        ASSERT(result) {
            Assert.strictEqual(result, false);
        }
    });

    test("returns false when stdout is empty", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await isInsideWorkTree(script, time, "/some/dir");
        },
        ASSERT(result) {
            Assert.strictEqual(result, false);
        }
    });

    test("passes cwd to spawn options", {
        ARRANGE() {
            let capturedCwd:string|undefined;
            const script:ScriptContext = {
                spawn(_cmd, _args, options) {
                    capturedCwd = options.cwd as string|undefined;
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("true\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime(), capturedCwd: () => capturedCwd };
        },
        async ACT({ script, time }) {
            await isInsideWorkTree(script, time, "/my/project");
        },
        ASSERT(_result, { capturedCwd }) {
            Assert.strictEqual(capturedCwd(), "/my/project");
        }
    });

    test("spawns git rev-parse --is-inside-work-tree", {
        ARRANGE() {
            let captured:{ command:string; args:readonly string[] }|null = null;
            const script:ScriptContext = {
                spawn(command, args) {
                    captured = { command, args };
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("true\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime(), captured: () => captured };
        },
        async ACT({ script, time }) {
            await isInsideWorkTree(script, time, "/dir");
        },
        ASSERTS: {
            "command is git"(_result, { captured }) {
                Assert.strictEqual(captured()!.command, "git");
            },
            "args are rev-parse --is-inside-work-tree"(_result, { captured }) {
                Assert.deepStrictEqual(captured()!.args, ["rev-parse", "--is-inside-work-tree"]);
            }
        }
    });
});

const CWD = path.resolve("/project");

test.describe("countPendingChangesExcept", test => {
    test("returns 0 with empty stdout", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("exit", 0));
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await countPendingChangesExcept(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result, 0);
        }
    });

    test("returns 0 when the only entry matches excludePath", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout(" M plans/plan.md\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await countPendingChangesExcept(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result, 0);
        }
    });

    test("returns N for entries not matching excludePath", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout(" M plans/plan.md\n M src/foo.ts\n?? src/bar.ts\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await countPendingChangesExcept(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result, 2);
        }
    });

    test("rename entry with newpath matching excludePath does not count", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("R  old/plan.md -> plans/plan.md\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await countPendingChangesExcept(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result, 0);
        }
    });

    test("untracked file entry matching excludePath does not count", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("?? plans/plan.md\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await countPendingChangesExcept(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result, 0);
        }
    });

    test("untracked files in a fresh dir count siblings but exclude the plan", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("?? plans/plan.md\n?? plans/other.md\n?? plans/sub/extra.md\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await countPendingChangesExcept(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result, 2);
        }
    });

    test("excludePath with leading ./ still matches forward-slash entry", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("?? plans/plan.md\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await countPendingChangesExcept(script, time, CWD, "./plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result, 0);
        }
    });

    test("absolute excludePath still matches forward-slash entry", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("?? plans/plan.md\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await countPendingChangesExcept(script, time, CWD, CWD + "/plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result, 0);
        }
    });

    test("excludePath with redundant segments still matches forward-slash entry", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("?? plans/plan.md\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await countPendingChangesExcept(script, time, CWD, "plans/sub/../plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result, 0);
        }
    });

    if (process.platform === "win32") {
        test("Windows: excludePath with backslashes matches forward-slash entry", {
            ARRANGE() {
                const script:ScriptContext = {
                    spawn() {
                        const proc = fakeProcess();
                        setImmediate(() => {
                            proc.$emitStdout("?? plans/plan.md\n");
                            proc.$emit("exit", 0);
                        });
                        return proc;
                    }
                };
                return { script, time: stubTime() };
            },
            async ACT({ script, time }) {
                return await countPendingChangesExcept(script, time, CWD, "plans\\plan.md");
            },
            ASSERT(result) {
                Assert.strictEqual(result, 0);
            }
        });

        test("Windows: excludePath with leading .\\ and backslashes matches forward-slash entry", {
            ARRANGE() {
                const script:ScriptContext = {
                    spawn() {
                        const proc = fakeProcess();
                        setImmediate(() => {
                            proc.$emitStdout("?? plans/plan.md\n");
                            proc.$emit("exit", 0);
                        });
                        return proc;
                    }
                };
                return { script, time: stubTime() };
            },
            async ACT({ script, time }) {
                return await countPendingChangesExcept(script, time, CWD, ".\\plans\\plan.md");
            },
            ASSERT(result) {
                Assert.strictEqual(result, 0);
            }
        });

        test("Windows: excludePath with mixed slashes matches forward-slash entry", {
            ARRANGE() {
                const script:ScriptContext = {
                    spawn() {
                        const proc = fakeProcess();
                        setImmediate(() => {
                            proc.$emitStdout("?? plans/plan.md\n");
                            proc.$emit("exit", 0);
                        });
                        return proc;
                    }
                };
                return { script, time: stubTime() };
            },
            async ACT({ script, time }) {
                return await countPendingChangesExcept(script, time, CWD, "plans/plan.md");
            },
            ASSERT(result) {
                Assert.strictEqual(result, 0);
            }
        });
    }

    test("rejects with Error containing stderr when git status fails", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStderr("fatal: not a git repository\n");
                        proc.$emit("exit", 128);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            let caught:Error|null = null;
            try {
                await countPendingChangesExcept(script, time, CWD, "plans/plan.md");
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERT(result) {
            Assert.ok(result instanceof Error);
            Assert.strictEqual(result.message, "fatal: not a git repository\n");
        }
    });

    test("spawns git status --porcelain=v1 --untracked-files=all with cwd", {
        ARRANGE() {
            let captured:{ command:string; args:readonly string[]; cwd?:string }|null = null;
            const script:ScriptContext = {
                spawn(command, args, options) {
                    captured = { command, args, cwd: options.cwd as string|undefined };
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("exit", 0));
                    return proc;
                }
            };
            return { script, time: stubTime(), captured: () => captured };
        },
        async ACT({ script, time }) {
            await countPendingChangesExcept(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "command is git"(_result, { captured }) {
                Assert.strictEqual(captured()!.command, "git");
            },
            "args are status --porcelain=v1 --untracked-files=all"(_result, { captured }) {
                Assert.deepStrictEqual(captured()!.args, ["status", "--porcelain=v1", "--untracked-files=all"]);
            },
            "cwd is the project directory"(_result, { captured }) {
                Assert.strictEqual(captured()!.cwd, CWD);
            }
        }
    });

    test("excludes by absolute path match, not substring", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout(" M plans/plan.md.bak\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await countPendingChangesExcept(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result, 1);
        }
    });
});

type FakeOutput = OutputContext & { written:string[]; errors:string[] };

function fakeOutput():FakeOutput {
    const written:string[] = [];
    const errors:string[] = [];
    return {
        written,
        errors,
        write(text:string) { written.push(text); },
        writeError(text:string) { errors.push(text); },
        columns() { return 80; },
        rows() { return 24; },
        onResize() { return () => {}; }
    };
}

test.describe("addAll", test => {
    test("resolves with code, stdout, stderr on success", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("staged\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput() };
        },
        async ACT({ script, time, output }) {
            return await addAll(script, time, output, CWD);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { code: 0, stdout: "staged\n", stderr: "" });
        }
    });

    test("streams stdout and stderr to OutputContext", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("chunk1");
                        proc.$emitStderr("warn1");
                        proc.$emitStdout("chunk2");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            const output = fakeOutput();
            return { script, time: stubTime(), output };
        },
        async ACT({ script, time, output }) {
            await addAll(script, time, output, CWD);
        },
        ASSERTS: {
            "forwards stdout chunks to output.write"(_result, { output }) {
                Assert.deepStrictEqual(output.written, ["chunk1", "chunk2"]);
            },
            "forwards stderr chunks to output.writeError"(_result, { output }) {
                Assert.deepStrictEqual(output.errors, ["warn1"]);
            }
        }
    });

    test("resolves with non-zero exit code without throwing", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStderr("error output\n");
                        proc.$emit("exit", 1);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput() };
        },
        async ACT({ script, time, output }) {
            return await addAll(script, time, output, CWD);
        },
        ASSERTS: {
            "exit code is 1"(result) {
                Assert.strictEqual(result.code, 1);
            },
            "stderr contains the error output"(result) {
                Assert.strictEqual(result.stderr, "error output\n");
            }
        }
    });

    test("resolves with code -1 on spawn error event", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("error", new Error("ENOENT")));
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput() };
        },
        async ACT({ script, time, output }) {
            return await addAll(script, time, output, CWD);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { code: -1, stdout: "", stderr: "ENOENT" });
        }
    });

    test("spawns git add -A with cwd", {
        ARRANGE() {
            let captured:{ command:string; args:readonly string[]; cwd?:string }|null = null;
            const script:ScriptContext = {
                spawn(command, args, options) {
                    captured = { command, args, cwd: options.cwd as string|undefined };
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("exit", 0));
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput(), captured: () => captured };
        },
        async ACT({ script, time, output }) {
            await addAll(script, time, output, CWD);
        },
        ASSERTS: {
            "command is git"(_result, { captured }) {
                Assert.strictEqual(captured()!.command, "git");
            },
            "args are add -A"(_result, { captured }) {
                Assert.deepStrictEqual(captured()!.args, ["add", "-A"]);
            },
            "cwd is the project directory"(_result, { captured }) {
                Assert.strictEqual(captured()!.cwd, CWD);
            }
        }
    });
});

test.describe("commit", test => {
    test("resolves with code, stdout, stderr on success", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("[main abc1234] task done\n");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput() };
        },
        async ACT({ script, time, output }) {
            return await commit(script, time, output, CWD, "1.1 My task title");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { code: 0, stdout: "[main abc1234] task done\n", stderr: "" });
        }
    });

    test("streams stdout and stderr to OutputContext", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("line1");
                        proc.$emitStderr("warning");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            const output = fakeOutput();
            return { script, time: stubTime(), output };
        },
        async ACT({ script, time, output }) {
            await commit(script, time, output, CWD, "msg");
        },
        ASSERTS: {
            "forwards stdout chunks to output.write"(_result, { output }) {
                Assert.deepStrictEqual(output.written, ["line1"]);
            },
            "forwards stderr chunks to output.writeError"(_result, { output }) {
                Assert.deepStrictEqual(output.errors, ["warning"]);
            }
        }
    });

    test("resolves with non-zero exit code without throwing", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStderr("pre-commit hook failed\n");
                        proc.$emit("exit", 1);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput() };
        },
        async ACT({ script, time, output }) {
            return await commit(script, time, output, CWD, "msg");
        },
        ASSERTS: {
            "exit code is 1"(result) {
                Assert.strictEqual(result.code, 1);
            },
            "stderr contains the hook failure message"(result) {
                Assert.strictEqual(result.stderr, "pre-commit hook failed\n");
            }
        }
    });

    test("resolves with code -1 on spawn error event", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("error", new Error("spawn failed")));
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput() };
        },
        async ACT({ script, time, output }) {
            return await commit(script, time, output, CWD, "msg");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { code: -1, stdout: "", stderr: "spawn failed" });
        }
    });

    test("passes message as single argument (no shell interpolation)", {
        ARRANGE() {
            let captured:{ command:string; args:readonly string[] }|null = null;
            const script:ScriptContext = {
                spawn(command, args) {
                    captured = { command, args };
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("exit", 0));
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput(), captured: () => captured };
        },
        async ACT({ script, time, output }) {
            await commit(script, time, output, CWD, "7.3 Validate plan file at startup");
        },
        ASSERTS: {
            "command is git"(_result, { captured }) {
                Assert.strictEqual(captured()!.command, "git");
            },
            "args include commit --allow-empty -m with the message as a single argument"(_result, { captured }) {
                Assert.deepStrictEqual(captured()!.args, ["commit", "--allow-empty", "-m", "7.3 Validate plan file at startup"]);
            }
        }
    });

    test("passes cwd to spawn options", {
        ARRANGE() {
            let capturedCwd:string|undefined;
            const script:ScriptContext = {
                spawn(_cmd, _args, options) {
                    capturedCwd = options.cwd as string|undefined;
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("exit", 0));
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput(), capturedCwd: () => capturedCwd };
        },
        async ACT({ script, time, output }) {
            await commit(script, time, output, CWD, "msg");
        },
        ASSERT(_result, { capturedCwd }) {
            Assert.strictEqual(capturedCwd(), CWD);
        }
    });
});
