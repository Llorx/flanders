import * as Assert from "assert";

import test, { monad } from "arrange-act-assert";

import * as path from "path";

import { isGitAvailable, isInsideWorkTree, inspectPreflightChanges, readStagedDiff, addAll, commit, listNonIgnoredFiles, listIgnoredPaths } from "./Git";
import type { OutputContext, ScriptContext, SpawnedProcess, TimeContext, TimeoutHandle } from "../contexts";
import { removeSpawnedProcessListener } from "./spawnedProcessListeners.fixtures";

type FakeProcess = SpawnedProcess & {
    $emitStdout(chunk:string):void;
    $emitStderr(chunk:string):void;
    $emit(event:"exit", code:number|null, signal?:string|null):void;
    $emit(event:"error", e:unknown):void;
    $stdinWrites():readonly string[];
    $stdinEnded():boolean;
};

function fakeProcess():FakeProcess {
    const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stdoutListeners:Array<(chunk:Buffer|string) => void> = [];
    const stderrListeners:Array<(chunk:Buffer|string) => void> = [];
    const stdinWrites:string[] = [];
    let stdinEnded = false;
    return {
        kill() {},
        on(event:"exit"|"error", listener:((code:number|null, signal:string|null) => void)|((e:unknown) => void)) {
            if (event === "exit") exitListeners.push(listener as (code:number|null, signal:string|null) => void);
            else if (event === "error") errorListeners.push(listener as (e:unknown) => void);
        },
        off(event, listener) {
            removeSpawnedProcessListener(event, listener, exitListeners, errorListeners);
        },
        stdout: { on(_event:"data", listener:(chunk:Buffer|string) => void) { stdoutListeners.push(listener); } },
        stderr: { on(_event:"data", listener:(chunk:Buffer|string) => void) { stderrListeners.push(listener); } },
        stdin: { write(chunk:string) { stdinWrites.push(chunk); }, end() { stdinEnded = true; } },
        $emitStdout(chunk:string) { for (const l of stdoutListeners) l(chunk); },
        $emitStderr(chunk:string) { for (const l of stderrListeners) l(chunk); },
        $emit(event:string, codeOrError:unknown, signal?:unknown) {
            if (event === "exit") for (const l of exitListeners) l(codeOrError as number|null, (signal ?? null) as string|null);
            else if (event === "error") for (const l of errorListeners) l(codeOrError);
        },
        $stdinWrites() { return stdinWrites; },
        $stdinEnded() { return stdinEnded; }
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

// Renders readable porcelain lines as the NUL-separated records `git status -z` emits: no trailing
// newlines, and a rename or copy in either status column spelled as its destination record followed
// by its origin record.
function zRecords(...lines:string[]):string {
    let out = "";
    for (const line of lines) {
        const carriesOrigin = [line[0], line[1]].some(status => status === "R" || status === "C");
        const arrowIdx = carriesOrigin ? line.indexOf(" -> ") : -1;
        if (arrowIdx === -1) {
            out += `${line}\0`;
        } else {
            out += `${line.slice(0, 3)}${line.slice(arrowIdx + 4)}\0${line.slice(3, arrowIdx)}\0`;
        }
    }
    return out;
}

// Builds a ScriptContext whose `git status` spawn emits the given stdout verbatim and exits 0.
function rawStatusScript(stdout:string):ScriptContext {
    return {
        spawn() {
            const proc = fakeProcess();
            setImmediate(() => {
                if (stdout) proc.$emitStdout(stdout);
                proc.$emit("exit", 0);
            });
            return proc;
        }
    };
}

// Builds a ScriptContext whose `git status` spawn emits the given porcelain lines as `-z` records.
function statusScript(...lines:string[]):ScriptContext {
    return rawStatusScript(zRecords(...lines));
}

test.describe("inspectPreflightChanges", test => {
    test("returns 0 with empty stdout", {
        ARRANGE() {
            return { script: statusScript(), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    test("returns 0 when the only entry matches excludePath", {
        ARRANGE() {
            return { script: statusScript(" M plans/plan.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    test("returns N for entries not matching excludePath", {
        ARRANGE() {
            return { script: statusScript(" M plans/plan.md", " M src/foo.ts", "?? src/bar.ts"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 2);
        }
    });

    test("rename entry with newpath matching excludePath does not count", {
        ARRANGE() {
            return { script: statusScript("RM old/plan.md -> plans/plan.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    test("untracked file entry matching excludePath does not count", {
        ARRANGE() {
            return { script: statusScript("?? plans/plan.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    test("untracked files in a fresh dir count siblings but exclude the plan", {
        ARRANGE() {
            return { script: statusScript("?? plans/plan.md", "?? plans/other.md", "?? plans/sub/extra.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 2);
        }
    });

    test("excludePath with leading ./ still matches forward-slash entry", {
        ARRANGE() {
            return { script: statusScript("?? plans/plan.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "./plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    test("absolute excludePath still matches forward-slash entry", {
        ARRANGE() {
            return { script: statusScript("?? plans/plan.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, CWD + "/plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    test("excludePath with redundant segments still matches forward-slash entry", {
        ARRANGE() {
            return { script: statusScript("?? plans/plan.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/sub/../plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    if (process.platform === "win32") {
        test("Windows: excludePath with backslashes matches forward-slash entry", {
            ARRANGE() {
                return { script: statusScript("?? plans/plan.md"), time: stubTime() };
            },
            async ACT({ script, time }) {
                return await inspectPreflightChanges(script, time, CWD, "plans\\plan.md");
            },
            ASSERT(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 0);
            }
        });

        test("Windows: excludePath with leading .\\ and backslashes matches forward-slash entry", {
            ARRANGE() {
                return { script: statusScript("?? plans/plan.md"), time: stubTime() };
            },
            async ACT({ script, time }) {
                return await inspectPreflightChanges(script, time, CWD, ".\\plans\\plan.md");
            },
            ASSERT(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 0);
            }
        });

        test("Windows: excludePath with mixed slashes matches forward-slash entry", {
            ARRANGE() {
                return { script: statusScript("?? plans/plan.md"), time: stubTime() };
            },
            async ACT({ script, time }) {
                return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
            },
            ASSERT(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 0);
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
                await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
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

    test("spawns git status --porcelain=v1 -z --untracked-files=all with cwd", {
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
            await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "command is git"(_result, { captured }) {
                Assert.strictEqual(captured()!.command, "git");
            },
            "args are status --porcelain=v1 -z --untracked-files=all"(_result, { captured }) {
                Assert.deepStrictEqual(captured()!.args, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
            },
            "cwd is the project directory"(_result, { captured }) {
                Assert.strictEqual(captured()!.cwd, CWD);
            }
        }
    });

    test("rejects with wrapped Error when spawn emits a non-Error value", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("error", "raw string error"));
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            let caught:Error|null = null;
            try {
                await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERTS: {
            "rejects with an Error instance"(result) {
                Assert.ok(result instanceof Error);
            },
            "message is the stringified value"(result) {
                Assert.strictEqual(result!.message, "raw string error");
            }
        }
    });

    test("rejects with the original Error when spawn emits an Error instance", {
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
            let caught:Error|null = null;
            try {
                await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERTS: {
            "rejects with an Error instance"(result) {
                Assert.ok(result instanceof Error);
            },
            "message is the original error message"(result) {
                Assert.strictEqual(result!.message, "ENOENT");
            }
        }
    });

    test("a rename record truncated before its origin record counts only its own path", {
        ARRANGE() {
            // Truncated stdout: the rename record arrives with no trailing NUL and therefore no
            // origin record behind it.
            return { script: rawStatusScript("RM some-renamed-file.ts"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "the surviving path still counts as an unstaged change"(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 1);
            },
            "no spec path is reported"(result) {
                Assert.deepStrictEqual(result.uncommittedSpecPaths, []);
            }
        }
    });

    test("excludes by absolute path match, not substring", {
        ARRANGE() {
            return { script: statusScript(" M plans/plan.md.bak"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 1);
        }
    });

    test("staged-only modification (\"M \") is not counted", {
        ARRANGE() {
            return { script: statusScript("M  src/foo.ts"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    test("staged-only addition (\"A \") is not counted", {
        ARRANGE() {
            return { script: statusScript("A  src/foo.ts"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    test("staged-only deletion (\"D \") is not counted", {
        ARRANGE() {
            return { script: statusScript("D  src/foo.ts"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    test("staged-only rename (\"R \") is not counted", {
        ARRANGE() {
            return { script: statusScript("R  old.ts -> new.ts"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 0);
        }
    });

    test("partially-staged modification (\"MM\") is counted", {
        ARRANGE() {
            return { script: statusScript("MM src/foo.ts"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 1);
        }
    });

    test("partially-staged rename (\"RM\") is counted", {
        ARRANGE() {
            return { script: statusScript("RM old.ts -> new.ts"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 1);
        }
    });

    test("counts only the unstaged entries in a mixed list, excluding the plan path", {
        ARRANGE() {
            // ` M` unstaged (counted), `M ` staged-only (not counted), `??` untracked (counted),
            // `MM` partially-staged on the plan path (excluded), `A ` staged-only (not counted).
            const script = statusScript(" M src/a.ts", "M  src/b.ts", "?? src/c.ts", "MM plans/plan.md", "A  src/d.ts");
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 2);
        }
    });

    test("reports no spec path when nothing under a .spec folder changed", {
        ARRANGE() {
            return { script: statusScript(" M src/a.ts", "M  src/b.ts", "?? src/c.ts"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result.uncommittedSpecPaths, []);
        }
    });

    test("staged-only spec modification (\"M \") is reported as an uncommitted spec path", {
        ARRANGE() {
            return { script: statusScript("M  .spec/contracts/overview.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "the spec path is reported"(result) {
                Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/contracts/overview.md"]);
            },
            "it is not counted as an unstaged change"(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 0);
            }
        }
    });

    test("unstaged spec modification (\" M\") is reported as a spec path instead of an unstaged change", {
        ARRANGE() {
            return { script: statusScript(" M .spec/rules/testing.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "the spec path is reported"(result) {
                Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/rules/testing.md"]);
            },
            "it does not also count toward the unstaged total"(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 0);
            }
        }
    });

    test("untracked spec file (\"??\") is reported as an uncommitted spec path", {
        ARRANGE() {
            return { script: statusScript("?? .spec/flanders/behavior.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/flanders/behavior.md"]);
        }
    });

    test("staged spec addition (\"A \") is reported as an uncommitted spec path", {
        ARRANGE() {
            return { script: statusScript("A  .spec/rules/added.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/rules/added.md"]);
        }
    });

    test("unstaged spec deletion (\" D\") is reported as a spec path instead of an unstaged change", {
        ARRANGE() {
            return { script: statusScript(" D .spec/contracts/removed.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "the spec path is reported"(result) {
                Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/contracts/removed.md"]);
            },
            "it does not also count toward the unstaged total"(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 0);
            }
        }
    });

    test("staged spec deletion (\"D \") is reported as an uncommitted spec path", {
        ARRANGE() {
            return { script: statusScript("D  .spec/rules/gone.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/rules/gone.md"]);
        }
    });

    test("a spec path carrying non-ASCII characters is reported", {
        ARRANGE() {
            // `-z` is what makes this reachable: the default porcelain output would C-quote this
            // path, gluing a quote to the leading `.spec` segment.
            return { script: statusScript("M  .spec/rules/validación.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "the spec path is reported"(result) {
                Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/rules/validación.md"]);
            },
            "it is not counted as an unstaged change"(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 0);
            }
        }
    });

    test("a .spec folder nested under source directories is reported", {
        ARRANGE() {
            return { script: statusScript("M  src/ai/.spec/rules/retry.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result.uncommittedSpecPaths, ["src/ai/.spec/rules/retry.md"]);
        }
    });

    test("a file merely named .spec is not a spec path", {
        ARRANGE() {
            return { script: statusScript(" M src/.spec"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "no spec path is reported"(result) {
                Assert.deepStrictEqual(result.uncommittedSpecPaths, []);
            },
            "it counts as an ordinary unstaged change"(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 1);
            }
        }
    });

    test("a rename out of a .spec folder reports the path the move takes away", {
        ARRANGE() {
            return { script: statusScript("R  .spec/rules/moved.md -> docs/moved.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/rules/moved.md"]);
        }
    });

    test("a rename into a .spec folder reports the destination path", {
        ARRANGE() {
            return { script: statusScript("R  docs/moved.md -> .spec/rules/moved.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/rules/moved.md"]);
        }
    });

    test("a staged-only copy consumes its origin record instead of reading it as a status record", {
        ARRANGE() {
            return { script: statusScript("C  orig.md -> dest.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "the staged-only copy counts no unstaged change"(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 0);
            },
            "no spec path is reported"(result) {
                Assert.deepStrictEqual(result.uncommittedSpecPaths, []);
            }
        }
    });

    test("a copy inside a .spec folder reports only its destination, never its untouched origin", {
        ARRANGE() {
            return { script: statusScript("C  .spec/rules/orig.md -> .spec/rules/dest.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/rules/dest.md"]);
        }
    });

    test("a work-tree copy consumes its origin record instead of reading it as a status record", {
        ARRANGE() {
            return { script: statusScript(" C orig.md -> dest.md", " M src/after.ts"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.strictEqual(result.unstagedOutsideSpec, 2);
        }
    });

    test("a work-tree rename out of a .spec folder reports the path the move takes away", {
        ARRANGE() {
            return { script: statusScript(" R .spec/rules/moved.md -> docs/moved.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "the origin spec path is reported"(result) {
                Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/rules/moved.md"]);
            },
            "the non-spec destination counts as an unstaged change"(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 1);
            }
        }
    });

    test("a rename between two .spec folders reports both ends, destination first", {
        ARRANGE() {
            return { script: statusScript("R  .spec/rules/moved.md -> src/.spec/rules/moved.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result.uncommittedSpecPaths, ["src/.spec/rules/moved.md", ".spec/rules/moved.md"]);
        }
    });

    test("the excluded path is never reported as a spec path even when it sits inside a .spec folder", {
        ARRANGE() {
            return { script: statusScript(" M .spec/plans/plan.md"), time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, ".spec/plans/plan.md");
        },
        ASSERTS: {
            "no spec path is reported"(result) {
                Assert.deepStrictEqual(result.uncommittedSpecPaths, []);
            },
            "no unstaged change is counted either"(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 0);
            }
        }
    });

    test("a mixed list reports every spec path in porcelain order alongside the unstaged total", {
        ARRANGE() {
            // `M ` staged spec (reported), ` M` unstaged non-spec (counted), `??` untracked spec
            // (reported), `M ` staged non-spec (neither), ` M` unstaged spec (reported, not counted).
            const script = statusScript("M  .spec/contracts/a.md", " M src/b.ts", "?? src/c/.spec/rules/c.md", "M  src/d.ts", " M .spec/rules/e.md");
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await inspectPreflightChanges(script, time, CWD, "plans/plan.md");
        },
        ASSERTS: {
            "every spec path is reported in porcelain order"(result) {
                Assert.deepStrictEqual(result.uncommittedSpecPaths, [".spec/contracts/a.md", "src/c/.spec/rules/c.md", ".spec/rules/e.md"]);
            },
            "only the non-spec unstaged entry counts toward the unstaged total"(result) {
                Assert.strictEqual(result.unstagedOutsideSpec, 1);
            }
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

test.describe("readStagedDiff", test => {
    test("returns the staged binary diff through the injected script context after the child exits", {
        ARRANGE() {
            let captured:{ command:string; args:readonly string[]; cwd:string|undefined }|null = null;
            const child = { live: false };
            const script:ScriptContext = {
                spawn(command, args, options) {
                    captured = { command, args, cwd: options.cwd as string|undefined };
                    child.live = true;
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("diff --git a/src/a.ts b/src/a.ts\n");
                        child.live = false;
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime(), child, captured: () => captured };
        },
        async ACT({ script, time, child }) {
            const diff = await readStagedDiff(script, time, CWD);
            return { diff, childLiveWhenResolved: child.live };
        },
        ASSERTS: {
            "returns the complete staged diff"({ diff }) {
                Assert.strictEqual(diff, "diff --git a/src/a.ts b/src/a.ts\n");
            },
            "uses the injected script context with a read-only binary-safe git command"(_result, { captured }) {
                Assert.deepStrictEqual(captured(), {
                    command: "git",
                    args: ["diff", "--cached", "--binary", "--no-ext-diff", "--"],
                    cwd: CWD
                });
            },
            "has observed child exit before resolving"({ childLiveWhenResolved }) {
                Assert.strictEqual(childLiveWhenResolved, false);
            }
        }
    });

    test("rejects with stderr when git diff exits non-zero", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStderr("diff failed");
                        proc.$emit("exit", 1);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await monad(() => readStagedDiff(script, time, CWD));
        },
        ASSERT(result) {
            result.should.error({ name: "Error", message: "diff failed" });
        }
    });
});

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

    test("resolves with code -1 and stringified error on non-Error spawn error", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("error", "raw string error"));
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput() };
        },
        async ACT({ script, time, output }) {
            return await addAll(script, time, output, CWD);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { code: -1, stdout: "", stderr: "raw string error" });
        }
    });

    test("resolves with code -1 when exit code is null", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("exit", null));
                    return proc;
                }
            };
            return { script, time: stubTime(), output: fakeOutput() };
        },
        async ACT({ script, time, output }) {
            return await addAll(script, time, output, CWD);
        },
        ASSERT(result) {
            Assert.strictEqual(result.code, -1);
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

test.describe("listNonIgnoredFiles", test => {
    test("resolves the split, empty-dropped, deduplicated path list", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("a.md\0.spec/contracts/b.md\0.spec/contracts/b.md\0");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await listNonIgnoredFiles(script, time, CWD);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["a.md", ".spec/contracts/b.md"]);
        }
    });

    test("resolves an empty array for empty stdout", {
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
            return await listNonIgnoredFiles(script, time, CWD);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, []);
        }
    });

    test("rejects with Error containing stderr when git ls-files exits non-zero", {
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
                await listNonIgnoredFiles(script, time, CWD);
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERTS: {
            "rejects with an Error instance"(result) {
                Assert.ok(result instanceof Error);
            },
            "message is the captured stderr"(result) {
                Assert.strictEqual(result!.message, "fatal: not a git repository\n");
            }
        }
    });

    test("rejects with the original Error when spawn emits an Error instance", {
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
            let caught:Error|null = null;
            try {
                await listNonIgnoredFiles(script, time, CWD);
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERTS: {
            "rejects with an Error instance"(result) {
                Assert.ok(result instanceof Error);
            },
            "message is the original error message"(result) {
                Assert.strictEqual(result!.message, "ENOENT");
            }
        }
    });

    test("rejects with wrapped Error when spawn emits a non-Error value", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("error", "raw string error"));
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            let caught:Error|null = null;
            try {
                await listNonIgnoredFiles(script, time, CWD);
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERTS: {
            "rejects with an Error instance"(result) {
                Assert.ok(result instanceof Error);
            },
            "message is the stringified value"(result) {
                Assert.strictEqual(result!.message, "raw string error");
            }
        }
    });

    test("spawns git ls-files -z --cached --others --exclude-standard with cwd", {
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
            await listNonIgnoredFiles(script, time, CWD);
        },
        ASSERTS: {
            "command is git"(_result, { captured }) {
                Assert.strictEqual(captured()!.command, "git");
            },
            "args are ls-files -z --cached --others --exclude-standard"(_result, { captured }) {
                Assert.deepStrictEqual(captured()!.args, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
            },
            "cwd is the project directory"(_result, { captured }) {
                Assert.strictEqual(captured()!.cwd, CWD);
            }
        }
    });
});

test.describe("listIgnoredPaths", test => {
    test("resolves an empty Set and records zero spawns for an empty candidate array", {
        ARRANGE() {
            let spawnCount = 0;
            const script:ScriptContext = {
                spawn() {
                    spawnCount++;
                    return fakeProcess();
                }
            };
            return { script, time: stubTime(), spawnCount: () => spawnCount };
        },
        async ACT({ script, time }) {
            return await listIgnoredPaths(script, time, CWD, []);
        },
        ASSERTS: {
            "resolves an empty Set"(result) {
                Assert.deepStrictEqual(result, new Set());
            },
            "records zero spawns"(_result, { spawnCount }) {
                Assert.strictEqual(spawnCount(), 0);
            }
        }
    });

    test("writes the candidates NUL-joined with a trailing NUL to stdin and ends the stream", {
        ARRANGE() {
            let captured:FakeProcess|null = null;
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    captured = proc;
                    setImmediate(() => proc.$emit("exit", 1));
                    return proc;
                }
            };
            return { script, time: stubTime(), captured: () => captured };
        },
        async ACT({ script, time }) {
            await listIgnoredPaths(script, time, CWD, ["a.md", ".spec/contracts/b.md"]);
        },
        ASSERTS: {
            "writes the candidate paths NUL-joined with a trailing NUL"(_result, { captured }) {
                Assert.deepStrictEqual(captured()!.$stdinWrites(), ["a.md\0.spec/contracts/b.md\0"]);
            },
            "ends the stdin stream"(_result, { captured }) {
                Assert.strictEqual(captured()!.$stdinEnded(), true);
            }
        }
    });

    test("exit 0 resolves a Set containing exactly the ignored path", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStdout("x/.spec/rules/r.md\0");
                        proc.$emit("exit", 0);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            return await listIgnoredPaths(script, time, CWD, ["x/.spec/rules/r.md"]);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, new Set(["x/.spec/rules/r.md"]));
        }
    });

    test("exit 1 with empty stdout resolves an empty Set", {
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
            return await listIgnoredPaths(script, time, CWD, ["x/.spec/rules/r.md"]);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, new Set());
        }
    });

    test("rejects with Error containing stderr when git check-ignore exits with code 2", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => {
                        proc.$emitStderr("fatal: bad config\n");
                        proc.$emit("exit", 2);
                    });
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            let caught:Error|null = null;
            try {
                await listIgnoredPaths(script, time, CWD, ["x/.spec/rules/r.md"]);
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERTS: {
            "rejects with an Error instance"(result) {
                Assert.ok(result instanceof Error);
            },
            "message is the captured stderr"(result) {
                Assert.strictEqual(result!.message, "fatal: bad config\n");
            }
        }
    });

    test("rejects with the original Error when spawn emits an Error instance", {
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
            let caught:Error|null = null;
            try {
                await listIgnoredPaths(script, time, CWD, ["x/.spec/rules/r.md"]);
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERTS: {
            "rejects with an Error instance"(result) {
                Assert.ok(result instanceof Error);
            },
            "message is the original error message"(result) {
                Assert.strictEqual(result!.message, "ENOENT");
            }
        }
    });

    test("rejects with wrapped Error when spawn emits a non-Error value", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn() {
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("error", "raw string error"));
                    return proc;
                }
            };
            return { script, time: stubTime() };
        },
        async ACT({ script, time }) {
            let caught:Error|null = null;
            try {
                await listIgnoredPaths(script, time, CWD, ["x/.spec/rules/r.md"]);
            } catch (e) {
                caught = e as Error;
            }
            return caught;
        },
        ASSERTS: {
            "rejects with an Error instance"(result) {
                Assert.ok(result instanceof Error);
            },
            "message is the stringified value"(result) {
                Assert.strictEqual(result!.message, "raw string error");
            }
        }
    });

    test("spawns git check-ignore -z --stdin with cwd", {
        ARRANGE() {
            let captured:{ command:string; args:readonly string[]; cwd?:string }|null = null;
            const script:ScriptContext = {
                spawn(command, args, options) {
                    captured = { command, args, cwd: options.cwd as string|undefined };
                    const proc = fakeProcess();
                    setImmediate(() => proc.$emit("exit", 1));
                    return proc;
                }
            };
            return { script, time: stubTime(), captured: () => captured };
        },
        async ACT({ script, time }) {
            await listIgnoredPaths(script, time, CWD, ["x/.spec/rules/r.md"]);
        },
        ASSERTS: {
            "command is git"(_result, { captured }) {
                Assert.strictEqual(captured()!.command, "git");
            },
            "args are check-ignore -z --stdin"(_result, { captured }) {
                Assert.deepStrictEqual(captured()!.args, ["check-ignore", "-z", "--stdin"]);
            },
            "cwd is the project directory"(_result, { captured }) {
                Assert.strictEqual(captured()!.cwd, CWD);
            }
        }
    });
});
