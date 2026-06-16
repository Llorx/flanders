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
    stderr?:string;
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
            let stdoutListener:DataListener|null = null;
            let stderrListener:DataListener|null = null;
            const start = () => {
                if (!exitListener || !errorListener) return;
                Promise.resolve().then(() => {
                    if (opts.emitError && errorListener) {
                        errorListener(new Error("spawn failed"));
                    }
                }).then(() => {
                    if (opts.stdout !== undefined && stdoutListener) {
                        stdoutListener(opts.stdout);
                    }
                }).then(() => {
                    if (opts.stderr !== undefined && stderrListener) {
                        stderrListener(opts.stderr);
                    }
                }).then(() => {
                    if (exitListener) {
                        exitListener(opts.exitCode ?? 0, opts.exitSignal ?? null);
                    }
                });
            };
            return {
                on(event:"exit"|"error", listener:never) {
                    if (event === "exit") {
                        exitListener = listener;
                    } else {
                        errorListener = listener;
                    }
                    start();
                },
                kill() {},
                stdout: {
                    on(_event:"data", listener:DataListener) {
                        stdoutListener = listener;
                    }
                },
                stderr: {
                    on(_event:"data", listener:DataListener) {
                        stderrListener = listener;
                    }
                }
            };
        }
    };
    return { script, calls };
}

test.describe("probeModelList", test => {
    test("codex spawns `codex debug models` with stdio pipe and no --bundled flag", {
        ARRANGE() {
            return makeProbeStub({ stdout: '{"models":[{"slug":"m","visibility":"list"}]}', exitCode: 0 });
        },
        async ACT({ script }) {
            await probeModelList(script);
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

    test("codex returns a list of the slugs of only `list`-visibility entries in catalog order", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"gpt-5-codex","visibility":"list"},{"slug":"gpt-4.1","visibility":"list"},{"slug":"o3","visibility":"list"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "list", models: ["gpt-5-codex", "gpt-4.1", "o3"] });
        }
    });

    test("codex with mixed visibilities lists only the entries that are exactly `list`", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"hidden-a","visibility":"hide"},{"slug":"visible-a","visibility":"list"},{"slug":"internal","visibility":"internal"},{"slug":"visible-b","visibility":"list"},{"slug":"hidden-b","visibility":"hide"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "list", models: ["visible-a", "visible-b"] });
        }
    });

    test("codex with zero `list`-visibility entries resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"a","visibility":"hide"},{"slug":"b","visibility":"internal"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with empty models array resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({ stdout: '{"models":[]}', exitCode: 0 });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with entry missing slug resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"visibility":"list"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with entry missing visibility resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"a"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with non-string slug resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":123,"visibility":"list"}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with non-string visibility resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"a","visibility":true}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with entry that is not an object resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":["just-a-string"]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with entry that is null resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[null]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with entry that is an array resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[["slug","list"]]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with top-level JSON array resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '[{"slug":"a","visibility":"list"}]',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with top-level JSON scalar resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({ stdout: '"hello"', exitCode: 0 });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with top-level JSON null resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({ stdout: "null", exitCode: 0 });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with models field that is not an array resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":{"slug":"a","visibility":"list"}}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with no models field resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"other":"value"}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with invalid JSON resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({ stdout: "not json", exitCode: 0 });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with empty stdout and exit 0 resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({ stdout: undefined, exitCode: 0 });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with a non-zero exit, no usable catalog, and no command-not-found signal resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: "codex: unexpected internal failure",
                exitCode: 1
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex returning a usable catalog is accepted regardless of a non-zero exit code", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"a","visibility":"list"}]}',
                exitCode: 1
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "list", models: ["a"] });
        }
    });

    test("codex catalog carrying a command-not-found phrase inside its payload is still parsed into a list", {
        ARRANGE() {
            return makeProbeStub({
                stdout: '{"models":[{"slug":"gpt-x","visibility":"list","base_instructions":"If the rg command is not found, use grep instead."}]}',
                exitCode: 0
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "list", models: ["gpt-x"] });
        }
    });

    test("a future codex reporting an unknown `debug models` subcommand resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({
                stderr: "error: unrecognized subcommand 'models'",
                exitCode: 2
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex with signal termination (exit code null) resolves to no-list", {
        ARRANGE() {
            return makeProbeStub({ exitCode: null, exitSignal: "SIGTERM" });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "no-list" });
        }
    });

    test("codex spawn primitive throwing yields not-started with the error message as the reason", {
        ARRANGE() {
            return makeProbeStub({ spawnError: true });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "not-started", reason: "spawn codex ENOENT" });
        }
    });

    test("codex spawn primitive throwing a non-Error value uses the stringified value as the reason", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn():SpawnedProcess {
                    throw "codex missing";
                }
            };
            return { script };
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "not-started", reason: "codex missing" });
        }
    });

    test("codex spawn `error` event yields not-started with the error message, settling once even if a valid exit follows", {
        ARRANGE() {
            return makeProbeStub({
                emitError: true,
                exitCode: 0,
                stdout: '{"models":[{"slug":"a","visibility":"list"}]}'
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "not-started", reason: "spawn failed" });
        }
    });

    test("codex exiting 127 yields not-started with stderr as the reason, taking precedence over stdout", {
        ARRANGE() {
            return makeProbeStub({
                stdout: "stdout-diagnostic",
                stderr: "stderr-diagnostic",
                exitCode: 127
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "not-started", reason: "stderr-diagnostic" });
        }
    });

    test("codex exiting 127 with empty stderr falls back to stdout for the reason", {
        ARRANGE() {
            return makeProbeStub({
                stdout: "stdout-diagnostic",
                stderr: "",
                exitCode: 127
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "not-started", reason: "stdout-diagnostic" });
        }
    });

    test("codex exiting 127 with no captured output yields not-started with an empty reason (never the bare code)", {
        ARRANGE() {
            return makeProbeStub({ exitCode: 127 });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "not-started", reason: "" });
        }
    });

    test("codex stderr matching `not recognized` yields not-started with stderr as the reason", {
        ARRANGE() {
            return makeProbeStub({
                stderr: "'codex' is not recognized as an internal or external command, operable program or batch file.",
                exitCode: 1
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                kind: "not-started",
                reason: "'codex' is not recognized as an internal or external command, operable program or batch file."
            });
        }
    });

    test("codex stderr matching `no such file` yields not-started with stderr as the reason", {
        ARRANGE() {
            return makeProbeStub({
                stderr: "/bin/sh: codex: no such file or directory",
                exitCode: 1
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "not-started", reason: "/bin/sh: codex: no such file or directory" });
        }
    });

    test("codex command-not-found marker matching is case-insensitive (`NOT FOUND`)", {
        ARRANGE() {
            return makeProbeStub({
                stderr: "bash: codex: NOT FOUND",
                exitCode: 1
            });
        },
        async ACT({ script }) {
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "not-started", reason: "bash: codex: NOT FOUND" });
        }
    });

    test("codex with a Buffer stdout chunk is decoded and parsed into a list", {
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
            return await probeModelList(script);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { kind: "list", models: ["buf-model"] });
        }
    });
});
