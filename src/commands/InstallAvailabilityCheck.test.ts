import * as Assert from "assert";

import test from "arrange-act-assert";

import { verifyToolAvailability } from "./InstallAvailabilityCheck";
import type { ToolAvailabilityReport } from "./InstallAvailabilityCheck";
import type { ScriptContext, SpawnedProcess } from "../contexts";

type ExitListener = (code:number|null, signal:string|null) => void;
type ErrorListener = (e:unknown) => void;

function stubScript(behaviors:Record<string, { event:"exit"; code:number|null; signal:string|null }|{ event:"error"; error:Error }>):ScriptContext {
    return {
        spawn(command:string):SpawnedProcess {
            const behavior = behaviors[command];
            let exitListener:ExitListener|null = null;
            let errorListener:ErrorListener|null = null;
            const proc:SpawnedProcess = {
                on(event:"exit"|"error", listener:never) {
                    if (event === "exit") {
                        exitListener = listener;
                    } else if (event === "error") {
                        errorListener = listener;
                    }
                    if (behavior) {
                        Promise.resolve().then(() => {
                            if (behavior.event === "exit" && exitListener) {
                                exitListener(behavior.code, behavior.signal);
                            } else if (behavior.event === "error" && errorListener) {
                                errorListener(behavior.error);
                            }
                        });
                    }
                },
                kill() {},
                stdout: { on() {} },
                stderr: { on() {} }
            };
            return proc;
        }
    };
}

function throwingScript():ScriptContext {
    return {
        spawn(command:string):never {
            const err = new Error(`spawn ${command} ENOENT`) as Error & { code:string };
            err.code = "ENOENT";
            throw err;
        }
    };
}

function sortReport(report:ToolAvailabilityReport):ToolAvailabilityReport {
    return [...report].sort((a, b) => a.tool.localeCompare(b.tool));
}

test.describe("verifyToolAvailability", test => {
    test("all tools available when exit code is 0", {
        ARRANGE() {
            const script = stubScript({
                claude: { event: "exit", code: 0, signal: null },
                codex: { event: "exit", code: 0, signal: null }
            });
            return { script };
        },
        async ACT({ script }) {
            return sortReport(await verifyToolAvailability(new Set(["claude", "codex"]), script));
        },
        ASSERTS: {
            "claude is available"(report) {
                Assert.deepStrictEqual(report[0], { tool: "claude", available: true, reason: null });
            },
            "codex is available"(report) {
                Assert.deepStrictEqual(report[1], { tool: "codex", available: true, reason: null });
            }
        }
    });

    test("single tool available when exit code is 0", {
        ARRANGE() {
            const script = stubScript({
                claude: { event: "exit", code: 0, signal: null }
            });
            return { script };
        },
        async ACT({ script }) {
            return await verifyToolAvailability(new Set(["claude"]), script);
        },
        ASSERT(report) {
            Assert.deepStrictEqual(report, [{ tool: "claude", available: true, reason: null }]);
        }
    });

    test("ENOENT spawn failure marks tool as unavailable", {
        ARRANGE() {
            const script = throwingScript();
            return { script };
        },
        async ACT({ script }) {
            return await verifyToolAvailability(new Set(["codex"]), script);
        },
        ASSERT(report) {
            Assert.deepStrictEqual(report, [{ tool: "codex", available: false, reason: "codex: spawn failed (spawn codex ENOENT)" }]);
        }
    });

    test("non-zero exit code marks tool as unavailable", {
        ARRANGE() {
            const script = stubScript({
                claude: { event: "exit", code: 1, signal: null }
            });
            return { script };
        },
        async ACT({ script }) {
            return await verifyToolAvailability(new Set(["claude"]), script);
        },
        ASSERT(report) {
            Assert.deepStrictEqual(report, [{ tool: "claude", available: false, reason: "claude: exited with code 1" }]);
        }
    });

    test("signal termination marks tool as unavailable", {
        ARRANGE() {
            const script = stubScript({
                codex: { event: "exit", code: null, signal: "SIGTERM" }
            });
            return { script };
        },
        async ACT({ script }) {
            return await verifyToolAvailability(new Set(["codex"]), script);
        },
        ASSERT(report) {
            Assert.deepStrictEqual(report, [{ tool: "codex", available: false, reason: "codex: terminated by signal SIGTERM" }]);
        }
    });

    test("two tools missing reports both", {
        ARRANGE() {
            const script = stubScript({
                claude: { event: "exit", code: 1, signal: null },
                codex: { event: "error", error: new Error("spawn codex ENOENT") }
            });
            return { script };
        },
        async ACT({ script }) {
            return sortReport(await verifyToolAvailability(new Set(["claude", "codex"]), script));
        },
        ASSERTS: {
            "claude is unavailable"(report) {
                Assert.deepStrictEqual(report[0], { tool: "claude", available: false, reason: "claude: exited with code 1" });
            },
            "codex is unavailable"(report) {
                Assert.deepStrictEqual(report[1], { tool: "codex", available: false, reason: "codex: spawn failed (spawn codex ENOENT)" });
            }
        }
    });

    test("error event from spawn marks tool as unavailable", {
        ARRANGE() {
            const script = stubScript({
                claude: { event: "error", error: new Error("spawn claude ENOENT") }
            });
            return { script };
        },
        async ACT({ script }) {
            return await verifyToolAvailability(new Set(["claude"]), script);
        },
        ASSERT(report) {
            Assert.deepStrictEqual(report, [{ tool: "claude", available: false, reason: "claude: spawn failed (spawn claude ENOENT)" }]);
        }
    });

    test("non-Error throw from spawn is handled", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn():never {
                    throw "string error";
                }
            };
            return { script };
        },
        async ACT({ script }) {
            return await verifyToolAvailability(new Set(["claude"]), script);
        },
        ASSERT(report) {
            Assert.deepStrictEqual(report, [{ tool: "claude", available: false, reason: "claude: spawn failed (string error)" }]);
        }
    });

    test("non-Error emitted on error event is handled", {
        ARRANGE() {
            const script:ScriptContext = {
                spawn():SpawnedProcess {
                    let errorListener:ErrorListener|null = null;
                    return {
                        on(event:"exit"|"error", listener:never) {
                            if (event === "error") {
                                errorListener = listener;
                                Promise.resolve().then(() => errorListener?.("string error event"));
                            }
                        },
                        kill() {},
                        stdout: { on() {} },
                        stderr: { on() {} }
                    };
                }
            };
            return { script };
        },
        async ACT({ script }) {
            return await verifyToolAvailability(new Set(["claude"]), script);
        },
        ASSERT(report) {
            Assert.deepStrictEqual(report, [{ tool: "claude", available: false, reason: "claude: spawn failed (string error event)" }]);
        }
    });

    test("probes every tool before returning — does not short-circuit", {
        ARRANGE() {
            const script = stubScript({
                claude: { event: "exit", code: 1, signal: null },
                codex: { event: "exit", code: 0, signal: null }
            });
            return { script };
        },
        async ACT({ script }) {
            return sortReport(await verifyToolAvailability(new Set(["claude", "codex"]), script));
        },
        ASSERTS: {
            "report has exactly 2 entries"(report) {
                Assert.strictEqual(report.length, 2);
            },
            "claude is unavailable"(report) {
                Assert.strictEqual(report[0]!.available, false);
            },
            "codex is available"(report) {
                Assert.strictEqual(report[1]!.available, true);
            }
        }
    });

    test("spawn uses exactly the binary name as the command", {
        ARRANGE() {
            const commands:string[] = [];
            const script:ScriptContext = {
                spawn(command:string):SpawnedProcess {
                    commands.push(command);
                    let exitListener:ExitListener|null = null;
                    return {
                        on(event:"exit"|"error", listener:never) {
                            if (event === "exit") {
                                exitListener = listener;
                                Promise.resolve().then(() => exitListener?.(0, null));
                            }
                        },
                        kill() {},
                        stdout: { on() {} },
                        stderr: { on() {} }
                    };
                }
            };
            return { script, commands };
        },
        async ACT({ script }) {
            await verifyToolAvailability(new Set(["claude", "codex"]), script);
        },
        ASSERTS: {
            "claude binary is 'claude'"(_, { commands }) {
                Assert.ok(commands.includes("claude"));
            },
            "codex binary is 'codex'"(_, { commands }) {
                Assert.ok(commands.includes("codex"));
            }
        }
    });

    test("spawn passes exactly ['--version'] as args", {
        ARRANGE() {
            const capturedArgs:(readonly string[])[] = [];
            const script:ScriptContext = {
                spawn(_command:string, args:readonly string[]):SpawnedProcess {
                    capturedArgs.push(args);
                    let exitListener:ExitListener|null = null;
                    return {
                        on(event:"exit"|"error", listener:never) {
                            if (event === "exit") {
                                exitListener = listener;
                                Promise.resolve().then(() => exitListener?.(0, null));
                            }
                        },
                        kill() {},
                        stdout: { on() {} },
                        stderr: { on() {} }
                    };
                }
            };
            return { script, capturedArgs };
        },
        async ACT({ script }) {
            await verifyToolAvailability(new Set(["claude"]), script);
        },
        ASSERT(_, { capturedArgs }) {
            Assert.deepStrictEqual(capturedArgs[0], ["--version"]);
        }
    });

    test("spawn uses stdio pipe to silence output", {
        ARRANGE() {
            const capturedOptions:Record<string, unknown>[] = [];
            const script:ScriptContext = {
                spawn(_command:string, _args:readonly string[], options:Record<string, unknown>):SpawnedProcess {
                    capturedOptions.push(options);
                    let exitListener:ExitListener|null = null;
                    return {
                        on(event:"exit"|"error", listener:never) {
                            if (event === "exit") {
                                exitListener = listener;
                                Promise.resolve().then(() => exitListener?.(0, null));
                            }
                        },
                        kill() {},
                        stdout: { on() {} },
                        stderr: { on() {} }
                    };
                }
            };
            return { script, capturedOptions };
        },
        async ACT({ script }) {
            await verifyToolAvailability(new Set(["claude"]), script);
        },
        ASSERT(_, { capturedOptions }) {
            Assert.strictEqual(capturedOptions[0]!.stdio, "pipe");
        }
    });
});
