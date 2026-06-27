import * as Assert from "assert";

import test from "arrange-act-assert";

import { run } from "./AiRunner";
import type { RunArgs } from "./AiRunner";
import type { ToolAdapter, ToolAdapterInvokeArgs, ToolEvent, ToolEventOutput } from "./ToolAdapter";
import type { TimeContext, TimeoutHandle } from "../contexts";

function stubAdapter(invocations:readonly (readonly ToolEvent[])[]):{
    adapter:ToolAdapter;
    $invokeArgs:ToolAdapterInvokeArgs[];
} {
    const invokeArgs:ToolAdapterInvokeArgs[] = [];
    let call = 0;
    return {
        adapter: {
            invoke(args:ToolAdapterInvokeArgs):AsyncIterable<ToolEvent> {
                invokeArgs.push(args);
                const events = invocations[call++] ?? [];
                return {
                    async *[Symbol.asyncIterator]() {
                        for (const e of events) yield e;
                    }
                };
            }
        },
        $invokeArgs: invokeArgs
    };
}

function autoTimeContext(initialNow = 0) {
    let now = initialNow;
    const durations:number[] = [];
    return {
        $durations: durations,
        ...({
            now() { return now; },
            setTimeout(handler:() => void, ms:number):TimeoutHandle {
                durations.push(ms);
                const target = now + ms;
                let cancelled = false;
                setImmediate(() => {
                    if (!cancelled) {
                        now = target;
                        handler();
                    }
                });
                return { cancel() { cancelled = true; } };
            }
        } satisfies TimeContext)
    };
}

function manualTimeContext(initialNow = 0) {
    let now = initialNow;
    const timers:Array<{ at:number; cb:() => void; cancelled:boolean }> = [];
    return {
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
            now() { return now; },
            setTimeout(handler:() => void, ms:number):TimeoutHandle {
                const t = { at: now + ms, cb: handler, cancelled: false };
                timers.push(t);
                return { cancel() { t.cancelled = true; } };
            }
        } satisfies TimeContext)
    };
}

function baseArgs(overrides:Partial<RunArgs> & Pick<RunArgs, "adapter"|"time">):RunArgs {
    return {
        prompt: "test",
        model: "",
        effort: "",
        fast: false,
        abortSignal: new AbortController().signal,
        callbacks: { onOutput() {}, onSessionId() {} },
        ...overrides
    };
}

test.describe("AiRunner", test => {
    test("forwards output events and captures session id on done", {
        ARRANGE() {
            const stub = stubAdapter([
                [
                    { type: "output" as const, title: "Read", subtitle: "/foo.ts", details: "file content" },
                    { type: "session" as const, id: "sess-1" },
                    { type: "done" as const }
                ]
            ]);
            const time = autoTimeContext();
            const outputs:ToolEventOutput[] = [];
            const sessionIds:string[] = [];
            return { stub, time, outputs, sessionIds };
        },
        async ACT({ stub, time, outputs, sessionIds }) {
            const result = await run(baseArgs({
                adapter: stub.adapter,
                time,
                callbacks: {
                    onOutput(event) { outputs.push(event); },
                    onSessionId(id) { sessionIds.push(id); }
                }
            }));
            return result;
        },
        ASSERTS: {
            "result sessionId matches the emitted session event"(result) {
                Assert.strictEqual(result.sessionId, "sess-1");
            },
            "onOutput received exactly one event with correct title"(_, { outputs }) {
                Assert.strictEqual(outputs[0]!.title, "Read");
            },
            "onOutput event subtitle matches"(_, { outputs }) {
                Assert.strictEqual(outputs[0]!.subtitle, "/foo.ts");
            },
            "onOutput event details matches"(_, { outputs }) {
                Assert.strictEqual(outputs[0]!.details, "file content");
            },
            "onSessionId callback received the session id"(_, { sessionIds }) {
                Assert.deepStrictEqual(sessionIds, ["sess-1"]);
            }
        }
    });

    test("priorSessionUsage is forwarded to the adapter and held constant across a retry", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "session" as const, id: "sess-1" }, { type: "error" as const, retryable: true, message: "boom" }],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext();
            return { stub, time };
        },
        async ACT({ stub, time }) {
            await run(baseArgs({
                adapter: stub.adapter,
                time,
                priorSessionUsage: { inputTokens: 40, outputTokens: 12 }
            }));
            return {
                first: (stub.$invokeArgs[0] as { priorSessionUsage?:{ inputTokens:number; outputTokens:number } }).priorSessionUsage,
                second: (stub.$invokeArgs[1] as { priorSessionUsage?:{ inputTokens:number; outputTokens:number } }).priorSessionUsage
            };
        },
        ASSERTS: {
            "first invocation receives the baseline"(result) {
                Assert.deepStrictEqual(result.first, { inputTokens: 40, outputTokens: 12 });
            },
            "the retry receives the same baseline unchanged"(result) {
                Assert.deepStrictEqual(result.second, { inputTokens: 40, outputTokens: 12 });
            }
        }
    });

    test("fast is forwarded to the adapter on the first invocation and on the post-retry re-invocation", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "error" as const, retryable: true, message: "boom" }],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext();
            return { stub, time };
        },
        async ACT({ stub, time }) {
            await run(baseArgs({ adapter: stub.adapter, time, fast: true }));
            return {
                first: stub.$invokeArgs[0]!.fast,
                second: stub.$invokeArgs[1]!.fast
            };
        },
        ASSERTS: {
            "first invocation receives the supplied fast value"(result) {
                Assert.strictEqual(result.first, true);
            },
            "the post-retry re-invocation receives the same fast value"(result) {
                Assert.strictEqual(result.second, true);
            }
        }
    });

    test("fast is forwarded to the adapter on a resumed first invocation", {
        ARRANGE() {
            const stub = stubAdapter([[{ type: "done" as const }]]);
            const time = autoTimeContext();
            return { stub, time };
        },
        async ACT({ stub, time }) {
            await run(baseArgs({ adapter: stub.adapter, time, fast: true, resumeSessionId: "resume-1" }));
            return stub.$invokeArgs[0]!.fast;
        },
        ASSERT(result) {
            Assert.strictEqual(result, true);
        }
    });

    test("fast is forwarded to the adapter on the post-rate-limit re-invocation", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "rate_limit" as const, waitUntilMs: 1000 }],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext();
            return { stub, time };
        },
        async ACT({ stub, time }) {
            await run(baseArgs({ adapter: stub.adapter, time, fast: true }));
            return stub.$invokeArgs[1]!.fast;
        },
        ASSERT(result) {
            Assert.strictEqual(result, true);
        }
    });

    test("rate_limit waits then retries with captured session id", {
        ARRANGE() {
            const stub = stubAdapter([
                [
                    { type: "session" as const, id: "sess-1" },
                    { type: "rate_limit" as const, waitUntilMs: 120000 }
                ],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext(60000);
            const abort = new AbortController();
            const waitStarts:Array<{ kind:string; endTimeMs:number }> = [];
            let waitEndCount = 0;
            return { stub, time, abort, waitStarts, getWaitEndCount() { return waitEndCount; }, callbacks: {
                onOutput() {},
                onSessionId() {},
                onWaitStart(kind:"rate-limit", endTimeMs:number) { waitStarts.push({ kind, endTimeMs }); },
                onWaitEnd() { waitEndCount++; }
            } };
        },
        async ACT({ stub, time, abort, callbacks }) {
            await run({
                adapter: stub.adapter,
                prompt: "test",
                model: "",
                effort: "",
                fast: false,
                abortSignal: abort.signal,
                callbacks,
                time
            });
            return {
                waitMs: time.$durations[0],
                resumeSessionId: (stub.$invokeArgs[1] as { resumeSessionId?:string }).resumeSessionId
            };
        },
        ASSERTS: {
            "wait duration equals waitUntilMs minus current time"(result) {
                Assert.strictEqual(result.waitMs, 60000);
            },
            "second invocation uses resumeSessionId from captured session"(result) {
                Assert.strictEqual(result.resumeSessionId, "sess-1");
            },
            "onWaitStart called with rate-limit kind and correct end time"(_, { waitStarts }) {
                Assert.deepStrictEqual(waitStarts, [{ kind: "rate-limit", endTimeMs: 120000 }]);
            },
            "onWaitEnd called exactly once"(_, { getWaitEndCount }) {
                Assert.strictEqual(getWaitEndCount(), 1);
            }
        }
    });

    test("transient backoff sequence matches expected exponential progression", {
        ARRANGE() {
            const errorEvent:ToolEvent = { type: "error", retryable: true, message: "transient" };
            const invocations:ToolEvent[][] = [];
            for (let i = 0; i < 8; i++) {
                invocations.push([errorEvent]);
            }
            invocations.push([{ type: "done" }]);
            const stub = stubAdapter(invocations);
            const time = autoTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal }));
            return time.$durations.slice();
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, [1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000]);
        }
    });

    test("transient counter resets to 1000 after done", {
        ARRANGE() {
            const time = autoTimeContext();
            const abort = new AbortController();
            const adapter1 = stubAdapter([
                [{ type: "error" as const, retryable: true, message: "t" }],
                [{ type: "error" as const, retryable: true, message: "t" }],
                [{ type: "done" as const }]
            ]);
            const adapter2 = stubAdapter([
                [{ type: "error" as const, retryable: true, message: "t" }],
                [{ type: "done" as const }]
            ]);
            return { time, abort, adapter1, adapter2 };
        },
        async ACT({ time, abort, adapter1, adapter2 }) {
            const base = { prompt: "test", model: "", effort: "", fast: false, abortSignal: abort.signal, callbacks: { onOutput() {}, onSessionId() {} }, time };
            await run({ ...base, adapter: adapter1.adapter });
            const durationsAfterFirstRun = time.$durations.length;
            await run({ ...base, adapter: adapter2.adapter });
            return {
                firstRunDurations: time.$durations.slice(0, durationsAfterFirstRun),
                secondRunFirstWait: time.$durations[durationsAfterFirstRun]
            };
        },
        ASSERTS: {
            "first run produces escalating backoff"(result) {
                Assert.deepStrictEqual(result.firstRunDurations, [1000, 2000]);
            },
            "second run first wait resets to 1000"(result) {
                Assert.strictEqual(result.secondRunFirstWait, 1000);
            }
        }
    });

    test("non-retryable error rejects with exact message", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "error" as const, retryable: false, message: "bad" }]
            ]);
            const time = autoTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            try {
                await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal }));
                return { error: null as Error|null };
            } catch (e) {
                return { error: e as Error };
            }
        },
        ASSERT(result) {
            Assert.strictEqual(result.error!.message, "bad");
        }
    });

    test("rate_limit over one hour produces bounded chunks", {
        ARRANGE() {
            const NINETY_MIN_MS = 90 * 60 * 1000;
            const stub = stubAdapter([
                [
                    { type: "session" as const, id: "s1" },
                    { type: "rate_limit" as const, waitUntilMs: NINETY_MIN_MS }
                ],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext(0);
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal }));
            return time.$durations.slice();
        },
        ASSERTS: {
            "chunk count is two for a 90-minute wait"(result) {
                Assert.strictEqual(result.length, 2);
            },
            "no chunk exceeds 60 minutes"(result) {
                Assert.ok(result.every(d => d <= 60 * 60 * 1000));
            }
        }
    });

    test("abort during transient wait does not re-invoke adapter", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "error" as const, retryable: true, message: "transient" }],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            const runPromise = run(baseArgs({
                adapter: stub.adapter,
                time,
                abortSignal: abort.signal
            }));
            await new Promise<void>(r => setImmediate(r));
            abort.abort();
            try {
                await runPromise;
                return { error: null as Error|null, invocationCount: stub.$invokeArgs.length };
            } catch (e) {
                return { error: e as Error, invocationCount: stub.$invokeArgs.length };
            }
        },
        ASSERTS: {
            "rejects with an abort-shaped error"(result) {
                Assert.strictEqual(result.error!.name, "AbortError");
            },
            "adapter invoked exactly once"(result) {
                Assert.strictEqual(result.invocationCount, 1);
            }
        }
    });

    test("invokes adapter exactly once when first call yields done", {
        ARRANGE() {
            const stub = stubAdapter([[{ type: "done" as const }]]);
            const time = autoTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal }));
            return stub.$invokeArgs.length;
        },
        ASSERT(result) {
            Assert.strictEqual(result, 1);
        }
    });

    test("non-retryable error with message 'rate limit hit' is not treated as rate limit", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "error" as const, retryable: false, message: "rate limit hit" }]
            ]);
            const time = autoTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            try {
                await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal }));
                return { error: null as Error|null, invocationCount: stub.$invokeArgs.length };
            } catch (e) {
                return { error: e as Error, invocationCount: stub.$invokeArgs.length };
            }
        },
        ASSERTS: {
            "rejects with the error message unchanged"(result) {
                Assert.strictEqual(result.error!.message, "rate limit hit");
            },
            "does not re-invoke the adapter"(result) {
                Assert.strictEqual(result.invocationCount, 1);
            }
        }
    });

    test("pre-aborted signal rejects immediately without invoking adapter", {
        ARRANGE() {
            const stub = stubAdapter([[{ type: "done" as const }]]);
            const time = autoTimeContext();
            const abort = new AbortController();
            abort.abort();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            try {
                await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal }));
                return { error: null as Error|null, invocationCount: stub.$invokeArgs.length };
            } catch (e) {
                return { error: e as Error, invocationCount: stub.$invokeArgs.length };
            }
        },
        ASSERTS: {
            "rejects with an abort error"(result) {
                Assert.strictEqual(result.error!.name, "AbortError");
            },
            "adapter never invoked"(result) {
                Assert.strictEqual(result.invocationCount, 0);
            }
        }
    });

    test("abort during rate_limit wait rejects and does not re-invoke", {
        ARRANGE() {
            const stub = stubAdapter([
                [
                    { type: "session" as const, id: "s1" },
                    { type: "rate_limit" as const, waitUntilMs: 999999 }
                ],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            const abort = new AbortController();
            let waitEndCalled = false;
            return { stub, time, abort, getWaitEndCalled() { return waitEndCalled; }, callbacks: {
                onOutput() {},
                onSessionId() {},
                onWaitStart() {},
                onWaitEnd() { waitEndCalled = true; }
            } };
        },
        async ACT({ stub, time, abort, callbacks }) {
            const runPromise = run({
                adapter: stub.adapter,
                prompt: "test",
                model: "",
                effort: "",
                fast: false,
                abortSignal: abort.signal,
                callbacks,
                time
            });
            await new Promise<void>(r => setImmediate(r));
            abort.abort();
            try {
                await runPromise;
                return { error: null as Error|null, invocationCount: stub.$invokeArgs.length };
            } catch (e) {
                return { error: e as Error, invocationCount: stub.$invokeArgs.length };
            }
        },
        ASSERTS: {
            "rejects with an abort error"(result) {
                Assert.strictEqual(result.error!.name, "AbortError");
            },
            "adapter not re-invoked"(result) {
                Assert.strictEqual(result.invocationCount, 1);
            },
            "onWaitEnd still called"(_, { getWaitEndCalled }) {
                Assert.strictEqual(getWaitEndCalled(), true);
            }
        }
    });

    test("first invocation with resumeSessionId passes resume args", {
        ARRANGE() {
            const stub = stubAdapter([[{ type: "done" as const }]]);
            const time = autoTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            await run({
                adapter: stub.adapter,
                prompt: "test",
                model: "",
                effort: "",
                fast: false,
                resumeSessionId: "resume-1",
                abortSignal: abort.signal,
                callbacks: { onOutput() {}, onSessionId() {} },
                time
            });
            return (stub.$invokeArgs[0] as { resumeSessionId?:string }).resumeSessionId;
        },
        ASSERT(result) {
            Assert.strictEqual(result, "resume-1");
        }
    });

    test("adapter closes without terminal event during abort rejects with abort error", {
        ARRANGE() {
            const abort = new AbortController();
            const adapter:ToolAdapter = {
                invoke():AsyncIterable<ToolEvent> {
                    return {
                        async *[Symbol.asyncIterator]() {
                            abort.abort();
                        }
                    };
                }
            };
            const time = autoTimeContext();
            return { adapter, time, abort };
        },
        async ACT({ adapter, time, abort }) {
            try {
                await run(baseArgs({ adapter, time, abortSignal: abort.signal }));
                return { error: null as Error|null };
            } catch (e) {
                return { error: e as Error };
            }
        },
        ASSERT(result) {
            Assert.strictEqual(result.error!.name, "AbortError");
        }
    });
});
