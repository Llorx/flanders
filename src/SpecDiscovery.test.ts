import * as Assert from "assert";

import test from "arrange-act-assert";

import { classifySpecPaths, discoverSpecs } from "./SpecDiscovery";
import type { ScriptContext, SpawnedProcess, TimeContext, TimeoutHandle } from "./contexts";

type FakeProcess = SpawnedProcess & {
    $emitStdout(chunk:string):void;
    $emit(event:"exit", code:number|null):void;
    $stdinWrites():readonly string[];
};

function fakeProcess():FakeProcess {
    const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const errorListeners:Array<(e:unknown) => void> = [];
    const stdoutListeners:Array<(chunk:Buffer|string) => void> = [];
    const stderrListeners:Array<(chunk:Buffer|string) => void> = [];
    const stdinWrites:string[] = [];
    return {
        kill() {},
        on(event:"exit"|"error", listener:((code:number|null, signal:string|null) => void)|((e:unknown) => void)) {
            if (event === "exit") exitListeners.push(listener as (code:number|null, signal:string|null) => void);
            else if (event === "error") errorListeners.push(listener as (e:unknown) => void);
        },
        stdout: { on(_event:"data", listener:(chunk:Buffer|string) => void) { stdoutListeners.push(listener); } },
        stderr: { on(_event:"data", listener:(chunk:Buffer|string) => void) { stderrListeners.push(listener); } },
        stdin: { write(chunk:string) { stdinWrites.push(chunk); }, end() {} },
        $emitStdout(chunk:string) { for (const l of stdoutListeners) l(chunk); },
        $emit(event:"exit", code:number|null) { if (event === "exit") for (const l of exitListeners) l(code, null); },
        $stdinWrites() { return stdinWrites; }
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

type CapturedSpawn = { command:string; args:readonly string[]; cwd:string|undefined; proc:FakeProcess };

function recordingScript(respond:(args:readonly string[], proc:FakeProcess) => void):{ script:ScriptContext; spawns:CapturedSpawn[] } {
    const spawns:CapturedSpawn[] = [];
    const script:ScriptContext = {
        spawn(command, args, options) {
            const proc = fakeProcess();
            spawns.push({ command, args, cwd: options.cwd as string|undefined, proc });
            respond(args, proc);
            return proc;
        }
    };
    return { script, spawns };
}

const ROOT = "/project";

test.describe("classifySpecPaths", test => {
    test("classifies the acceptance-criteria example into contracts and rules", {
        ARRANGE() {
            return { paths: ["README.md", ".docs/contracts/a.md", ".docs/rules/r.md", "src/x/.docs/contracts/a.md", ".docs/other/n.md", "docs/contracts/no.md"] };
        },
        ACT({ paths }) {
            return classifySpecPaths(paths);
        },
        ASSERTS: {
            "contracts holds both .docs/contracts files as distinct namespaces"(result) {
                Assert.deepStrictEqual(result.contracts, [".docs/contracts/a.md", "src/x/.docs/contracts/a.md"]);
            },
            "rules holds the single .docs/rules file"(result) {
                Assert.deepStrictEqual(result.rules, [".docs/rules/r.md"]);
            }
        }
    });

    test("drops .docs children that are not a file under a contracts/ or rules/ subfolder", {
        ARRANGE() {
            return { paths: [".docs/notes.md", ".docs/contracts", ".docs/rules", ".docs/other/n.md"] };
        },
        ACT({ paths }) {
            return classifySpecPaths(paths);
        },
        ASSERTS: {
            "no contracts are classified"(result) {
                Assert.deepStrictEqual(result.contracts, []);
            },
            "no rules are classified"(result) {
                Assert.deepStrictEqual(result.rules, []);
            }
        }
    });

    test("classifies .docs folders at any depth and files in subfolders below contracts/ and rules/", {
        ARRANGE() {
            return { paths: ["a/b/c/.docs/contracts/d/e.md", "src/ai/.docs/rules/r/x.md"] };
        },
        ACT({ paths }) {
            return classifySpecPaths(paths);
        },
        ASSERTS: {
            "the deeply nested contract is classified by its first .docs segment"(result) {
                Assert.deepStrictEqual(result.contracts, ["a/b/c/.docs/contracts/d/e.md"]);
            },
            "the nested rule in a subfolder below rules/ is classified"(result) {
                Assert.deepStrictEqual(result.rules, ["src/ai/.docs/rules/r/x.md"]);
            }
        }
    });

    test("keeps same-leaf-filename specs in different .docs folders as distinct entries", {
        ARRANGE() {
            return { paths: [".docs/contracts/a.md", "nested/.docs/contracts/a.md"] };
        },
        ACT({ paths }) {
            return classifySpecPaths(paths);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result.contracts, [".docs/contracts/a.md", "nested/.docs/contracts/a.md"]);
        }
    });
});

test.describe("discoverSpecs", test => {
    test("drops an ignored candidate and resolves both lists sorted ascending", {
        ARRANGE() {
            const { script, spawns } = recordingScript((args, proc) => {
                setImmediate(() => {
                    if (args[0] === "ls-files") {
                        proc.$emitStdout(".docs/contracts/c-c.md\0.docs/contracts/c-b.md\0.docs/contracts/c-a.md\0.docs/rules/r-b.md\0.docs/rules/r-a.md\0");
                        proc.$emit("exit", 0);
                    } else {
                        proc.$emitStdout(".docs/contracts/c-c.md\0");
                        proc.$emit("exit", 0);
                    }
                });
            });
            return { script, time: stubTime(), spawns };
        },
        async ACT({ script, time }) {
            return await discoverSpecs(script, time, ROOT);
        },
        ASSERTS: {
            "contracts drop the ignored candidate and come back sorted ascending"(result) {
                Assert.deepStrictEqual(result.contracts, [".docs/contracts/c-a.md", ".docs/contracts/c-b.md"]);
            },
            "rules come back sorted ascending"(result) {
                Assert.deepStrictEqual(result.rules, [".docs/rules/r-a.md", ".docs/rules/r-b.md"]);
            }
        }
    });

    test("issues git ls-files then git check-ignore over the classified candidates", {
        ARRANGE() {
            const { script, spawns } = recordingScript((args, proc) => {
                setImmediate(() => {
                    if (args[0] === "ls-files") {
                        proc.$emitStdout(".docs/contracts/c1.md\0src/x/.docs/rules/r1.md\0README.md\0");
                        proc.$emit("exit", 0);
                    } else {
                        proc.$emit("exit", 1);
                    }
                });
            });
            return { script, time: stubTime(), spawns };
        },
        async ACT({ script, time }) {
            await discoverSpecs(script, time, ROOT);
        },
        ASSERTS: {
            "records exactly two git spawns"(_result, { spawns }) {
                Assert.strictEqual(spawns.length, 2);
            },
            "first spawn enumerates non-ignored files"(_result, { spawns }) {
                Assert.deepStrictEqual({ command: spawns[0]!.command, args: spawns[0]!.args }, { command: "git", args: ["ls-files", "-z", "--cached", "--others", "--exclude-standard"] });
            },
            "second spawn checks the candidates against the ignore rules"(_result, { spawns }) {
                Assert.deepStrictEqual({ command: spawns[1]!.command, args: spawns[1]!.args }, { command: "git", args: ["check-ignore", "-z", "--stdin"] });
            },
            "check-ignore receives the classified candidates NUL-joined on stdin"(_result, { spawns }) {
                Assert.deepStrictEqual(spawns[1]!.proc.$stdinWrites(), [".docs/contracts/c1.md\0src/x/.docs/rules/r1.md\0"]);
            },
            "both spawns run in the project root"(_result, { spawns }) {
                Assert.deepStrictEqual([spawns[0]!.cwd, spawns[1]!.cwd], [ROOT, ROOT]);
            }
        }
    });

    test("with no .docs candidates, resolves two empty lists and records only the ls-files spawn", {
        ARRANGE() {
            const { script, spawns } = recordingScript((_args, proc) => {
                setImmediate(() => {
                    proc.$emitStdout("README.md\0src/foo.ts\0");
                    proc.$emit("exit", 0);
                });
            });
            return { script, time: stubTime(), spawns };
        },
        async ACT({ script, time }) {
            return await discoverSpecs(script, time, ROOT);
        },
        ASSERTS: {
            "contracts is empty"(result) {
                Assert.deepStrictEqual(result.contracts, []);
            },
            "rules is empty"(result) {
                Assert.deepStrictEqual(result.rules, []);
            },
            "only the ls-files spawn is recorded"(_result, { spawns }) {
                Assert.deepStrictEqual(spawns.map(s => s.args[0]), ["ls-files"]);
            }
        }
    });
});
