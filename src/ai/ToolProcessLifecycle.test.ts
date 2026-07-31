import * as Assert from "assert";

import test from "arrange-act-assert";

import type { ScriptContext, SpawnedProcess } from "../contexts";
import { manualTimeContext } from "../system/manualTimeContext.fixtures";
import { removeSpawnedProcessListener } from "../system/spawnedProcessListeners.fixtures";
import { ToolProcessLifecycle } from "./ToolProcessLifecycle";

function lifecycleSubject(pid:number|null = 1) {
    const exitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const registeredExitListeners:Array<(code:number|null, signal:string|null) => void> = [];
    const errorListeners:Array<(error:unknown) => void> = [];
    const registeredErrorListeners:Array<(error:unknown) => void> = [];
    const kills:Array<"SIGINT"|"SIGTERM"> = [];
    const process:SpawnedProcess = {
        pid: pid ?? undefined,
        on(event, listener) {
            if (event === "exit") {
                const exitListener = listener as (code:number|null, signal:string|null) => void;
                exitListeners.push(exitListener);
                registeredExitListeners.push(exitListener);
            } else {
                const errorListener = listener as (error:unknown) => void;
                errorListeners.push(errorListener);
                registeredErrorListeners.push(errorListener);
            }
        },
        off(event, listener) {
            removeSpawnedProcessListener(event, listener, exitListeners, errorListeners);
        },
        kill(signal) {
            kills.push(signal);
        }
    };
    const script:ScriptContext = {
        spawn() {
            return process;
        }
    };
    const time = manualTimeContext();
    let exitNotifications = 0;
    let errorNotifications = 0;
    const lifecycle = new ToolProcessLifecycle(script, "tool", [], {}, time, {
        onExit() { exitNotifications++; },
        onError() { errorNotifications++; }
    });
    return {
        lifecycle,
        time,
        kills,
        emitExit(code:number|null, signal:string|null) {
            for (const listener of exitListeners) listener(code, signal);
        },
        emitStaleExit(code:number|null, signal:string|null) {
            for (const listener of registeredExitListeners) listener(code, signal);
        },
        emitError(error:unknown) {
            for (const listener of errorListeners) listener(error);
        },
        emitStaleError(error:unknown) {
            for (const listener of registeredErrorListeners) listener(error);
        },
        exitNotifications() { return exitNotifications; },
        errorNotifications() { return errorNotifications; },
        listenerCounts() { return { exit: exitListeners.length, error: errorListeners.length }; }
    };
}

test.describe("ToolProcessLifecycle", test => {
    test("dispose is idempotent and refuses a later terminal grace", {
        ARRANGE() {
            return lifecycleSubject(null);
        },
        async ACT(subject) {
            const firstDispose = subject.lifecycle.dispose();
            const secondDispose = subject.lifecycle.dispose();
            let terminalReady = false;
            subject.lifecycle.finishAfterExit(() => { terminalReady = true; });
            subject.time.$advance(10_000);
            subject.emitError(new Error("spawn failed"));
            subject.emitExit(null, "SIGINT");
            subject.emitStaleError(new Error("late error"));
            subject.emitStaleExit(null, "SIGINT");
            await firstDispose;
            await secondDispose;
            return {
                samePromise: firstDispose === secondDispose,
                terminalReady,
                durations: [...subject.time.$durations],
                kills: [...subject.kills],
                exitNotifications: subject.exitNotifications(),
                listenerCounts: subject.listenerCounts()
            };
        },
        ASSERTS: {
            "returns the same disposal promise"(result) {
                Assert.strictEqual(result.samePromise, true);
            },
            "does not install the terminal callback after disposal"(result) {
                Assert.strictEqual(result.terminalReady, false);
            },
            "does not create a grace timer after disposal"(result) {
                Assert.deepStrictEqual(result.durations, []);
            },
            "requests child termination once"(result) {
                Assert.deepStrictEqual(result.kills, ["SIGINT"]);
            },
            "does not notify adapter exit handlers after disposal"(result) {
                Assert.strictEqual(result.exitNotifications, 0);
            },
            "removes the process listeners it created"(result) {
                Assert.deepStrictEqual(result.listenerCounts, { exit: 0, error: 0 });
            }
        }
    });

    test("error from a failed spawn with no pid settles without termination", {
        ARRANGE() {
            return lifecycleSubject(null);
        },
        async ACT(subject) {
            let terminalReady = false;
            subject.lifecycle.finishAfterExit(() => { terminalReady = true; });
            subject.emitError(new Error("spawn failed"));
            await subject.lifecycle.dispose();
            return {
                terminalReady,
                pendingTimers: subject.time.$pendingTimerCount(),
                errorNotifications: subject.errorNotifications(),
                kills: [...subject.kills]
            };
        },
        ASSERTS: {
            "releases an already determined terminal"(result) {
                Assert.strictEqual(result.terminalReady, true);
            },
            "cancels the grace timer"(result) {
                Assert.strictEqual(result.pendingTimers, 0);
            },
            "reports the spawn error"(result) {
                Assert.strictEqual(result.errorNotifications, 1);
            },
            "does not terminate a nonexistent child"(result) {
                Assert.deepStrictEqual(result.kills, []);
            }
        }
    });

    test("ENOENT from a process with a pid does not count as exit", {
        ARRANGE() {
            return lifecycleSubject();
        },
        ACT(subject) {
            let terminalReady = false;
            subject.emitError(Object.assign(new Error("live error"), { code: "ENOENT" }));
            subject.lifecycle.finishAfterExit(() => { terminalReady = true; });
            subject.time.$advance(10_000);
            const beforeExit = {
                terminalReady,
                kills: [...subject.kills],
                errorNotifications: subject.errorNotifications()
            };
            subject.emitExit(null, "SIGINT");
            return { beforeExit, terminalReady };
        },
        ASSERTS: {
            "keeps the terminal pending before actual exit"(result) {
                Assert.strictEqual(result.beforeExit.terminalReady, false);
            },
            "releases the terminal on actual exit"(result) {
                Assert.strictEqual(result.terminalReady, true);
            },
            "requests termination after the grace"(result) {
                Assert.deepStrictEqual(result.beforeExit.kills, ["SIGINT"]);
            },
            "reports the live process error"(result) {
                Assert.strictEqual(result.beforeExit.errorNotifications, 1);
            }
        }
    });
});
