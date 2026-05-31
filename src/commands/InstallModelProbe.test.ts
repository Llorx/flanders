import * as Assert from "assert";

import test from "arrange-act-assert";

import type { ScriptContext, SpawnedProcess } from "../contexts";
import { probeModelList } from "./InstallModelProbe";

type ExitListener = (code:number|null, signal:string|null) => void;
type ErrorListener = (e:unknown) => void;
type DataListener = (chunk:Buffer|string) => void;

type SpawnCall = Readonly<{
    command:string;
    args:readonly string[];
    options:Readonly<Record<string, unknown>>;
}>;

function makeProbeStub(opts:{
    stdout?:string;
    exitCode?:number|null;
    exitSignal?:string|null;
    spawnError?:boolean;
    emitError?:boolean;
}):{ script:ScriptContext; calls:SpawnCall[] } {
    const calls:SpawnCall[] = [];
    const script:ScriptContext = {
        spawn(command:string, args:readonly string[], options:Record<string, unknown>):SpawnedProcess {
            calls.push({ command, args, options });
            if (opts.spawnError) {
                const err = new Error("spawn codex ENOENT") as Error & { code:string };
                err.code = "ENOENT";
                throw err;
            }
            let exitListener:ExitListener|null = null;
            let errorListener:ErrorListener|null = null;
            let dataListener:DataListener|null = null;
            const proc:SpawnedProcess = {
                on(event:"exit"|"error", listener:never) {
                    if (event === "exit") {
                        exitListener = listener;
                    } else if (event === "error") {
                        errorListener = listener;
                    }
                    if (exitListener && errorListener) {
                        Promise.resolve().then(() => {
                            if (opts.emitError && errorListener) {
                                errorListener(new Error("spawn failed"));
                            }
                        }).then(() => {
                            if (opts.stdout && dataListener) {
                                dataListener(opts.stdout);
                            }
                        }).then(() => {
                            if (exitListener) {
                                exitListener(opts.exitCode ?? 0, opts.exitSignal ?? null);
                            }
                        });
                    }
                },
                kill() {},
                stdout: {
                    on(_event:"data", listener:DataListener) {
                        dataListener = listener;
                    }
                },
                stderr: { on() {} }
            };
            return proc;
        }
    };
    return { script, calls };
}

test.describe("probeModelList", test => {
    test("claude tool resolves to null without spawning", {
        ARRANGE() {
            let spawned = false;
            const script:ScriptContext = {
                spawn():never { spawned = true; throw new Error("should not spawn"); }
            };
            return { script, wasSpawned: () => spawned };
        },
        async ACT({ script }) {
            return await probeModelList("claude", script);
        },
        ASSERTS: {
            "returns null"(result) {
                Assert.strictEqual(result, null);
            },
            "does not spawn"(_result, { wasSpawned }) {
                Assert.strictEqual(wasSpawned(), false);
            }
        }
    });

    test("codex spawns `codex debug models` with stdio pipe and no --bundled flag", {
        ARRANGE() {
            return makeProbeStub({ stdout: '{"models":[{"slug":"m","visibility":"list"}]}', exitCode: 0 });
        },
        async ACT({ script }) {
            await probeModelList("codex", script);
        },
        ASSERTS: {
            "spawns exactly once"(_result, { calls }) {
                Assert.strictEqual(calls.length, 1);
            },
            "uses the codex binary"(_result, { calls }) {
                Assert.strictEqual(calls[0]!.command, "codex");
            },
            "passes exactly the args [debug, models]"(_result, { calls }) {
                Assert.deepStrictEqual(calls[0]!.args, ["debug", "models"]);
            },
            "does not include --bundled"(_result, { calls }) {
                Assert.strictEqual(calls[0]!.args.includes("--bundled"), false);
            },
            "does not use the old `models list --json` form"(_result, { calls }) {
                Assert.strictEqual(calls[0]!.args.includes("list"), false);
                Assert.strictEqual(calls[0]!.args.includes("--json"), false);
            },
            "passes stdio: pipe"(_result, { calls }) {
                Assert.strictEqual(calls[0]!.options.stdio, "pipe");
            }
        }
    });

    test("codex returns slugs of only `list`-visibility entries in catalog order", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"gpt-5-codex","visibility":"list"},{"slug":"gpt-4.1","visibility":"list"},{"slug":"o3","visibility":"list"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["gpt-5-codex", "gpt-4.1", "o3"]);
        }
    });

    test("codex with mixed visibilities excludes everything that is not exactly `list`", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"hidden-a","visibility":"hide"},{"slug":"visible-a","visibility":"list"},{"slug":"internal","visibility":"internal"},{"slug":"visible-b","visibility":"list"},{"slug":"hidden-b","visibility":"hide"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["visible-a", "visible-b"]);
        }
    });

    test("codex with zero `list`-visibility entries resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"a","visibility":"hide"},{"slug":"b","visibility":"internal"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with empty models array resolves to null", {
        ARRANGE() {
            return makeProbeStub({ stdout: '{"models":[]}', exitCode: 0 });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with entry missing slug resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"visibility":"list"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with entry missing visibility resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"a"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with non-string slug resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":123,"visibility":"list"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with non-string visibility resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"a","visibility":true}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with entry that is not an object resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":["just-a-string"]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with entry that is null resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[null]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with entry that is an array resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[["slug","list"]]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with top-level JSON array resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '[{"slug":"a","visibility":"list"}]',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with top-level JSON scalar resolves to null", {
        ARRANGE() {
            return makeProbeStub({ stdout: '"hello"', exitCode: 0 });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with top-level JSON null resolves to null", {
        ARRANGE() {
            return makeProbeStub({ stdout: "null", exitCode: 0 });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with models field that is not an array resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":{"slug":"a","visibility":"list"}}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with no models field resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"other":"value"}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with invalid JSON resolves to null", {
        ARRANGE() {
            return makeProbeStub({ stdout: "not json", exitCode: 0 });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with empty stdout and exit 0 resolves to null", {
        ARRANGE() {
            return makeProbeStub({ stdout: undefined, exitCode: 0 });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with non-zero exit resolves to null", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"a","visibility":"list"}]}',
                exitCode: 1
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with signal termination (exit code null) resolves to null", {
        ARRANGE() {
            return makeProbeStub({ exitCode: null, exitSignal: "SIGTERM" });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with spawn failure resolves to null", {
        ARRANGE() {
            return makeProbeStub({ spawnError: true });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with error event followed by exit settles once as null", {
        ARRANGE() {
            return makeProbeStub({
                emitError: true,
                exitCode: 0,
                stdout: '{"models":[{"slug":"a","visibility":"list"}]}'
            });
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with Buffer stdout chunk is decoded and parsed", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn():SpawnedProcess {
                    let exitListener:ExitListener|null = null;
                    let dataListener:DataListener|null = null;
                    return {
                        on(event:"exit"|"error", listener:never) {
                            if (event === "exit") {
                                exitListener = listener;
                                Promise.resolve().then(() => {
                                    dataListener?.(Buffer.from('{"models":[{"slug":"buf-model","visibility":"list"}]}'));
                                }).then(() => {
                                    exitListener?.(0, null);
                                });
                            }
                        },
                        kill() {},
                        stdout: {
                            on(_event:"data", listener:DataListener) {
                                dataListener = listener;
                            }
                        },
                        stderr: { on() {} }
                    };
                }
            };
            return { script };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["buf-model"]);
        }
    });
});
