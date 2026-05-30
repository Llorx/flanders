import * as Assert from "assert";

import test from "arrange-act-assert";

import type { ScriptContext, SpawnedProcess } from "../contexts";
import { probeModelList } from "./InstallModelProbe";

type ExitListener = (code:number|null, signal:string|null) => void;
type ErrorListener = (e:unknown) => void;
type DataListener = (chunk:Buffer|string) => void;

function makeProbeStub(opts:{
    stdout?:string;
    exitCode?:number|null;
    exitSignal?:string|null;
    spawnError?:boolean;
    emitError?:boolean;
}):ScriptContext {
    return {
        spawn():SpawnedProcess {
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

    test("codex with exit 0 and JSON array of strings returns the array", {
        ARRANGE() {
            return { script: makeProbeStub({ stdout: '["gpt-5-codex","gpt-4.1"]', exitCode: 0 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["gpt-5-codex", "gpt-4.1"]);
        }
    });

    test("codex with exit 0 and JSON array of objects with id returns extracted ids", {
        ARRANGE() {
            return { script: makeProbeStub({ stdout: '[{"id":"model-a","name":"A"},{"id":"model-b","name":"B"}]', exitCode: 0 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["model-a", "model-b"]);
        }
    });

    test("codex with non-zero exit returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ exitCode: 1 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with spawn failure returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ spawnError: true }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with invalid JSON returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ stdout: "not json", exitCode: 0 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with empty JSON array returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ stdout: "[]", exitCode: 0 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with signal termination returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ exitCode: null, exitSignal: "SIGTERM" }) };
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
            return { script: makeProbeStub({ emitError: true, exitCode: 0, stdout: '["m1"]' }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with non-object non-string array returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ stdout: "[1,2,3]", exitCode: 0 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with object array missing id field returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ stdout: '[{"name":"A"},{"name":"B"}]', exitCode: 0 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with mixed array (string then object) returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ stdout: '["a",{"id":"b"}]', exitCode: 0 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with JSON non-array returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ stdout: '{"models":["a"]}', exitCode: 0 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with empty stdout and exit 0 returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ stdout: undefined, exitCode: 0 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("codex with Buffer chunk returns parsed models", {
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
                                    dataListener?.(Buffer.from('["buf-model"]'));
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

    test("codex with object where id is non-string returns null", {
        ARRANGE() {
            return { script: makeProbeStub({ stdout: '[{"id":123}]', exitCode: 0 }) };
        },
        async ACT({ script }) {
            return await probeModelList("codex", script);
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });
});
