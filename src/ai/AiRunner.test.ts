import * as Assert from "assert";

import test, { monad } from "arrange-act-assert";

import { isFatalLoginError, run } from "./AiRunner";
import type { RunArgs, RunCallbacks } from "./AiRunner";
import type { ForceRetrySignal } from "./AiRunner";
import type { ToolAdapter, ToolAdapterInvokeArgs, ToolEvent, ToolEventOutput } from "./ToolAdapter";
import type { TimeContext, TimeoutHandle } from "../contexts";
import { manualTimeContext } from "../system/manualTimeContext.fixtures";
import { settleAsyncWork as flush } from "../system/settleAsyncWork.fixtures";

const THIRTY_MINUTES_MS = 30 * 60 * 1000;
const TEN_MINUTES_MS = 10 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60 * 1000;
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;

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

function recordWaitNotices() {
    const starts:Array<{ kind:string; endTimeMs:number; nextRetryAtMs:number }> = [];
    const updates:Array<{ endTimeMs:number; nextRetryAtMs:number }> = [];
    const order:string[] = [];
    let endCount = 0;
    const callbacks:RunCallbacks = {
        onOutput() {},
        onSessionId() {},
        onWaitStart(kind, endTimeMs, nextRetryAtMs) {
            starts.push({ kind, endTimeMs, nextRetryAtMs });
            order.push("start");
        },
        onWaitUpdate(endTimeMs, nextRetryAtMs) {
            updates.push({ endTimeMs, nextRetryAtMs });
            order.push("update");
        },
        onWaitEnd() {
            endCount++;
            order.push("end");
        }
    };
    return { callbacks, $starts: starts, $updates: updates, $order: order, $endCount() { return endCount; } };
}

function forceRetrySource():{
    signal:ForceRetrySignal;
    forceRetry():void;
} {
    const listeners = new Set<() => void>();
    return {
        signal: {
            onForceRetry(listener) {
                listeners.add(listener);
                return () => {
                    listeners.delete(listener);
                };
            }
        },
        forceRetry() {
            for (const listener of [...listeners]) {
                listener();
            }
        }
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
            const notices = recordWaitNotices();
            return { stub, time, abort, notices, callbacks: notices.callbacks };
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
            "onWaitStart called with rate-limit kind, end time and the next retry instant"(_, { notices }) {
                Assert.deepStrictEqual(notices.$starts, [{ kind: "rate-limit", endTimeMs: 120000, nextRetryAtMs: 120000 }]);
            },
            "onWaitEnd called exactly once"(_, { notices }) {
                Assert.strictEqual(notices.$endCount(), 1);
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

    test("unmarked non-retryable error rejects as an ordinary error even when its message reads like a login failure", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "error" as const, retryable: false, message: "not logged in · run /login" }]
            ]);
            const time = autoTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            return await monad(async () => await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal })));
        },
        ASSERTS: {
            "rejects with the adapter's exact message"(res) {
                res.should.error({ message: "not logged in · run /login" });
            },
            "the rejection is not identifiable as a fatal login failure"(res) {
                res.should.error(e => isFatalLoginError(e) === false);
            },
            "the rejection is an Error instance"(res) {
                res.should.error(Error);
            },
            "the rejection is a plain Error, not a tagged error kind"(res) {
                res.should.error({ name: "Error" });
            },
            "no backoff wait precedes the ordinary rejection"(_, { time }) {
                Assert.deepStrictEqual(time.$durations, []);
            }
        }
    });

    test("non-retryable error carrying an explicit fatal false rejects as an ordinary error", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "error" as const, retryable: false, fatal: false, message: "max turns" }],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            return await monad(async () => await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal })));
        },
        ASSERTS: {
            "rejects with the adapter's exact message"(res) {
                res.should.error({ message: "max turns" });
            },
            "the rejection is not identifiable as a fatal login failure"(res) {
                res.should.error(e => isFatalLoginError(e) === false);
            },
            "the rejection is an Error instance"(res) {
                res.should.error(Error);
            },
            "the rejection is a plain Error, not a tagged error kind"(res) {
                res.should.error({ name: "Error" });
            },
            "the adapter is invoked exactly once"(_, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 1);
            },
            "no backoff wait is scheduled"(_, { time }) {
                Assert.deepStrictEqual(time.$durations, []);
            }
        }
    });

    test("fatal non-retryable error rejects as a login failure without re-invoking", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "error" as const, retryable: false, fatal: true, message: "widget factory jammed" }],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            return await monad(async () => await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal })));
        },
        ASSERTS: {
            "rejects with an error identifiable as a fatal login failure"(res) {
                res.should.error(e => isFatalLoginError(e) === true);
            },
            "the rejection carries the stable FatalLoginError name"(res) {
                res.should.error({ name: "FatalLoginError" });
            },
            "the rejection is an Error instance"(res) {
                res.should.error(Error);
            },
            "the rejection carries the adapter's message"(res) {
                res.should.error({ message: "widget factory jammed" });
            },
            "the adapter is invoked exactly once"(_, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 1);
            },
            "no backoff wait is scheduled"(_, { time }) {
                Assert.deepStrictEqual(time.$durations, []);
            }
        }
    });

    test("a fatal error on a later invocation rejects as a login failure without re-invoking", {
        ARRANGE() {
            const stub = stubAdapter([
                [
                    { type: "session" as const, id: "sess-1" },
                    { type: "error" as const, retryable: true, fatal: false, message: "transient" }
                ],
                [{ type: "error" as const, retryable: false, fatal: true, message: "session credentials expired" }],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            return await monad(async () => await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal })));
        },
        ASSERTS: {
            "rejects with an error identifiable as a fatal login failure"(res) {
                res.should.error(e => isFatalLoginError(e) === true);
            },
            "the rejection carries the stable FatalLoginError name"(res) {
                res.should.error({ name: "FatalLoginError" });
            },
            "the rejection carries the message of the later invocation"(res) {
                res.should.error({ message: "session credentials expired" });
            },
            "the adapter is not invoked again after the fatal error"(_, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 2);
            },
            "only the transient backoff preceding the fatal error was waited"(_, { time }) {
                Assert.deepStrictEqual(time.$durations, [1000]);
            }
        }
    });

    test("a retryable error followed by success still retries and resolves", {
        ARRANGE() {
            const stub = stubAdapter([
                [
                    { type: "session" as const, id: "sess-1" },
                    { type: "error" as const, retryable: true, message: "transient" }
                ],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext();
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            return await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal }));
        },
        ASSERTS: {
            "resolves with the captured session id"(result) {
                Assert.strictEqual(result.sessionId, "sess-1");
            },
            "the adapter is invoked exactly twice"(_, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 2);
            },
            "the retry waits the initial transient backoff"(_, { time }) {
                Assert.deepStrictEqual(time.$durations, [1000]);
            }
        }
    });

    test("a rate_limit beyond 30 minutes sleeps in intervals of at most 30 minutes, attempting the call at the end of each", {
        ARRANGE() {
            const SEVENTY_MIN_MS = 70 * 60 * 1000;
            const stillLimited = { type: "rate_limit" as const, waitUntilMs: SEVENTY_MIN_MS };
            const stub = stubAdapter([
                [{ type: "session" as const, id: "s1" }, stillLimited],
                [stillLimited],
                [stillLimited],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext(0);
            const abort = new AbortController();
            return { stub, time, abort };
        },
        async ACT({ stub, time, abort }) {
            await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal }));
            return { durations: time.$durations.slice(), invocations: stub.$invokeArgs.length };
        },
        ASSERTS: {
            "each interval is capped at 30 minutes and the last one stops at the expected end"(result) {
                Assert.deepStrictEqual(result.durations, [THIRTY_MINUTES_MS, THIRTY_MINUTES_MS, TEN_MINUTES_MS]);
            },
            "one attempt runs at the end of every interval"(result) {
                Assert.strictEqual(result.invocations, 4);
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
            const res = monad(async () => await run(baseArgs({
                adapter: stub.adapter,
                time,
                abortSignal: abort.signal
            })));
            await new Promise<void>(r => setImmediate(r));
            abort.abort();
            return await res;
        },
        ASSERTS: {
            "rejects with an abort-shaped error"(res) {
                res.should.error({ name: "AbortError" });
            },
            "adapter invoked exactly once"(_, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 1);
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
            return await monad(async () => await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal })));
        },
        ASSERTS: {
            "rejects with the error message unchanged"(res) {
                res.should.error({ message: "rate limit hit" });
            },
            "does not re-invoke the adapter"(_, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 1);
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
            return await monad(async () => await run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal })));
        },
        ASSERTS: {
            "rejects with an abort error"(res) {
                res.should.error({ name: "AbortError" });
            },
            "adapter never invoked"(_, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 0);
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
            const res = monad(async () => await run({
                adapter: stub.adapter,
                prompt: "test",
                model: "",
                effort: "",
                fast: false,
                abortSignal: abort.signal,
                callbacks,
                time
            }));
            await new Promise<void>(r => setImmediate(r));
            abort.abort();
            return await res;
        },
        ASSERTS: {
            "rejects with an abort error"(res) {
                res.should.error({ name: "AbortError" });
            },
            "adapter not re-invoked"(_, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 1);
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

    test("a four-day rate_limit re-invokes the adapter when the clock reaches 30 minutes and not before", {
        ARRANGE() {
            const stub = stubAdapter([
                [
                    { type: "session" as const, id: "s1" },
                    { type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }
                ],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            return { stub, time };
        },
        async ACT({ stub, time }) {
            const runPromise = run(baseArgs({ adapter: stub.adapter, time }));
            await flush();
            const atWaitStart = stub.$invokeArgs.length;
            time.$advance(THIRTY_MINUTES_MS - 1);
            await flush();
            const justBeforeInterval = stub.$invokeArgs.length;
            time.$advance(1);
            await flush();
            const atInterval = stub.$invokeArgs.length;
            await runPromise;
            return { atWaitStart, justBeforeInterval, atInterval };
        },
        ASSERTS: {
            "only the original invocation has run once the wait begins"(result) {
                Assert.strictEqual(result.atWaitStart, 1);
            },
            "no second invocation one millisecond before the 30-minute interval elapses"(result) {
                Assert.strictEqual(result.justBeforeInterval, 1);
            },
            "the second invocation happens as the clock reaches 30 minutes"(result) {
                Assert.strictEqual(result.atInterval, 2);
            }
        }
    });

    test("consecutive rate_limit attempts stay inside one wait, adopting each new end and a next retry measured from that attempt", {
        ARRANGE() {
            const SECOND_END_MS = THIRTY_MINUTES_MS + 45 * 60 * 1000;
            const THIRD_END_MS = 2 * THIRTY_MINUTES_MS + TEN_MINUTES_MS;
            const stub = stubAdapter([
                [
                    { type: "session" as const, id: "s1" },
                    { type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }
                ],
                [{ type: "rate_limit" as const, waitUntilMs: SECOND_END_MS }],
                [{ type: "rate_limit" as const, waitUntilMs: THIRD_END_MS }],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            const notices = recordWaitNotices();
            return { stub, time, notices, SECOND_END_MS, THIRD_END_MS };
        },
        async ACT({ stub, time, notices }) {
            const runPromise = run(baseArgs({ adapter: stub.adapter, time, callbacks: notices.callbacks }));
            await flush();
            time.$advance(THIRTY_MINUTES_MS);
            await flush();
            time.$advance(THIRTY_MINUTES_MS);
            await flush();
            const endsWhileLimited = notices.$endCount();
            time.$advance(TEN_MINUTES_MS);
            await flush();
            await runPromise;
            return { endsWhileLimited, invocations: stub.$invokeArgs.length };
        },
        ASSERTS: {
            "the caller is told it entered a wait exactly once"(_result, { notices }) {
                Assert.strictEqual(notices.$starts.length, 1);
            },
            "that single entry notice carries the first event's end and a next retry 30 minutes out"(_result, { notices }) {
                Assert.deepStrictEqual(notices.$starts[0], { kind: "rate-limit", endTimeMs: FOUR_DAYS_MS, nextRetryAtMs: THIRTY_MINUTES_MS });
            },
            "no end-of-wait notice arrives while the attempts stay limited"(result) {
                Assert.strictEqual(result.endsWhileLimited, 0);
            },
            "each later notice carries the newest end and the earlier of that end and 30 minutes from the attempt"(_result, { notices, SECOND_END_MS, THIRD_END_MS }) {
                Assert.deepStrictEqual(notices.$updates, [
                    { endTimeMs: SECOND_END_MS, nextRetryAtMs: 2 * THIRTY_MINUTES_MS },
                    { endTimeMs: THIRD_END_MS, nextRetryAtMs: THIRD_END_MS }
                ]);
            },
            "one end-of-wait notice arrives once an attempt gets past the limit"(_result, { notices }) {
                Assert.strictEqual(notices.$endCount(), 1);
            },
            "every interval ends in its own attempt"(result) {
                Assert.strictEqual(result.invocations, 4);
            }
        }
    });

    test("a still-limited attempt anchors the next interval on its own launch, not on the event it ended with", {
        ARRANGE() {
            const time = manualTimeContext();
            const attemptStarts:number[] = [];
            const adapter:ToolAdapter = {
                invoke():AsyncIterable<ToolEvent> {
                    const attempt = attemptStarts.push(time.now());
                    return {
                        async *[Symbol.asyncIterator]() {
                            if (attempt === 2) {
                                time.$advance(FIVE_MINUTES_MS);
                                yield { type: "rate_limit", waitUntilMs: FOUR_DAYS_MS };
                                return;
                            }
                            if (attempt === 3) {
                                yield { type: "done" };
                                return;
                            }
                            yield { type: "rate_limit", waitUntilMs: FOUR_DAYS_MS };
                        }
                    };
                }
            };
            const notices = recordWaitNotices();
            return { adapter, time, notices, attemptStarts };
        },
        async ACT({ adapter, time, notices, attemptStarts }) {
            const runPromise = run(baseArgs({ adapter, time, callbacks: notices.callbacks }));
            await flush();
            time.$advance(THIRTY_MINUTES_MS);
            await flush();
            time.$advance(THIRTY_MINUTES_MS - FIVE_MINUTES_MS - 1);
            await flush();
            const attemptsJustBefore = attemptStarts.length;
            time.$advance(1);
            await flush();
            await runPromise;
            return { attemptsJustBefore, attemptStarts: attemptStarts.slice() };
        },
        ASSERTS: {
            "the update reports a next retry 30 minutes after that attempt was launched"(_result, { notices }) {
                Assert.deepStrictEqual(notices.$updates, [{ endTimeMs: FOUR_DAYS_MS, nextRetryAtMs: 2 * THIRTY_MINUTES_MS }]);
            },
            "no further attempt one millisecond before that instant"(result) {
                Assert.strictEqual(result.attemptsJustBefore, 2);
            },
            "the following attempt is launched exactly at the reported instant"(result) {
                Assert.deepStrictEqual(result.attemptStarts, [0, THIRTY_MINUTES_MS, 2 * THIRTY_MINUTES_MS]);
            }
        }
    });

    test("a wait notification that consumes clock time does not push the attempt past the reported instant", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            const waitStarts:Array<{ endTimeMs:number; nextRetryAtMs:number }> = [];
            const callbacks:RunCallbacks = {
                onOutput() {},
                onSessionId() {},
                onWaitStart(_kind, endTimeMs, nextRetryAtMs) {
                    waitStarts.push({ endTimeMs, nextRetryAtMs });
                    time.$advance(TEN_MINUTES_MS);
                }
            };
            return { stub, time, callbacks, waitStarts };
        },
        async ACT({ stub, time, callbacks }) {
            const runPromise = run(baseArgs({ adapter: stub.adapter, time, callbacks }));
            await flush();
            time.$advance(THIRTY_MINUTES_MS - TEN_MINUTES_MS - 1);
            await flush();
            const attemptsJustBefore = stub.$invokeArgs.length;
            time.$advance(1);
            await flush();
            await runPromise;
            return { attemptsJustBefore, attemptsAtInstant: stub.$invokeArgs.length, clockAtEnd: time.now() };
        },
        ASSERTS: {
            "the notification's own clock cost stays inside the interval"(result) {
                Assert.strictEqual(result.attemptsJustBefore, 1);
            },
            "the attempt lands at the reported next-retry instant"(result) {
                Assert.strictEqual(result.attemptsAtInstant, 2);
            },
            "the interval never runs past the instant it reported"(result, { waitStarts }) {
                Assert.strictEqual(result.clockAtEnd, waitStarts[0]!.nextRetryAtMs);
            }
        }
    });

    test("an attempt whose event stream starts before its own rate_limit ends the wait and enters a new one", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "rate_limit" as const, waitUntilMs: TEN_MINUTES_MS }],
                [
                    { type: "output" as const, title: "Assistant", subtitle: "", details: "resuming" },
                    { type: "rate_limit" as const, waitUntilMs: 2 * TEN_MINUTES_MS }
                ],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext(0);
            const notices = recordWaitNotices();
            return { stub, time, notices };
        },
        async ACT({ stub, time, notices }) {
            await run(baseArgs({ adapter: stub.adapter, time, callbacks: notices.callbacks }));
            return notices.$order.slice();
        },
        ASSERTS: {
            "each wait is reported on entry and on exit in turn"(order) {
                Assert.deepStrictEqual(order, ["start", "end", "start", "end"]);
            },
            "the second wait is a new wait, not an update of the first"(_order, { notices }) {
                Assert.deepStrictEqual(notices.$updates, []);
            }
        }
    });

    test("a session event before a rate_limit ends the current wait and starts a distinct wait", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "rate_limit" as const, waitUntilMs: TEN_MINUTES_MS }],
                [
                    { type: "session" as const, id: "resumed-session" },
                    { type: "rate_limit" as const, waitUntilMs: 2 * TEN_MINUTES_MS }
                ],
                [{ type: "done" as const }]
            ]);
            const time = autoTimeContext(0);
            const notices = recordWaitNotices();
            const sessionIds:string[] = [];
            const callbacks:RunCallbacks = {
                ...notices.callbacks,
                onSessionId(id) {
                    sessionIds.push(id);
                }
            };
            return { stub, time, notices, callbacks, sessionIds };
        },
        async ACT({ stub, time, notices, callbacks }) {
            await run(baseArgs({ adapter: stub.adapter, time, callbacks }));
            return notices.$order.slice();
        },
        ASSERTS: {
            "the session event closes the first wait before the second begins"(order) {
                Assert.deepStrictEqual(order, ["start", "end", "start", "end"]);
            },
            "the second rate limit is reported as a new wait"(_order, { notices }) {
                Assert.deepStrictEqual(notices.$updates, []);
            },
            "the session event still reaches the caller"(_order, { sessionIds }) {
                Assert.deepStrictEqual(sessionIds, ["resumed-session"]);
            }
        }
    });

    test("an attempt that reaches done ends the wait once and returns the session id it captured", {
        ARRANGE() {
            const stub = stubAdapter([
                [
                    { type: "session" as const, id: "s1" },
                    { type: "rate_limit" as const, waitUntilMs: TEN_MINUTES_MS }
                ],
                [{ type: "session" as const, id: "s2" }, { type: "done" as const }]
            ]);
            const time = autoTimeContext(0);
            const notices = recordWaitNotices();
            return { stub, time, notices };
        },
        async ACT({ stub, time, notices }) {
            return await run(baseArgs({ adapter: stub.adapter, time, callbacks: notices.callbacks }));
        },
        ASSERTS: {
            "the successful attempt's session id is returned"(result) {
                Assert.strictEqual(result.sessionId, "s2");
            },
            "the caller is told the wait ended exactly once"(_result, { notices }) {
                Assert.strictEqual(notices.$endCount(), 1);
            },
            "the wait was entered only once"(_result, { notices }) {
                Assert.strictEqual(notices.$starts.length, 1);
            }
        }
    });

    test("an attempt that ends in a non-retryable error ends the wait once and propagates the message", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "rate_limit" as const, waitUntilMs: TEN_MINUTES_MS }],
                [{ type: "error" as const, retryable: false, message: "bad" }]
            ]);
            const time = autoTimeContext(0);
            const notices = recordWaitNotices();
            return { stub, time, notices };
        },
        async ACT({ stub, time, notices }) {
            return await monad(() => run(baseArgs({ adapter: stub.adapter, time, callbacks: notices.callbacks })));
        },
        ASSERTS: {
            "rejects with the adapter's exact message"(result) {
                result.should.error({ message: "bad" });
            },
            "the rejection is not marked as a fatal login failure"(result) {
                result.should.error(error => !isFatalLoginError(error));
            },
            "the caller is told the wait ended exactly once"(_result, { notices }) {
                Assert.strictEqual(notices.$endCount(), 1);
            }
        }
    });

    test("an attempt that ends in a fatal login error ends the wait once and stays marked fatal", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "rate_limit" as const, waitUntilMs: TEN_MINUTES_MS }],
                [{ type: "error" as const, retryable: false, fatal: true, message: "not logged in" }]
            ]);
            const time = autoTimeContext(0);
            const notices = recordWaitNotices();
            return { stub, time, notices };
        },
        async ACT({ stub, time, notices }) {
            return await monad(() => run(baseArgs({ adapter: stub.adapter, time, callbacks: notices.callbacks })));
        },
        ASSERTS: {
            "rejects with an error identifiable as a fatal login failure"(result) {
                result.should.error(isFatalLoginError);
            },
            "the caller is told the wait ended exactly once"(_result, { notices }) {
                Assert.strictEqual(notices.$endCount(), 1);
            }
        }
    });

    test("a rate_limit closer than 30 minutes sleeps once to that instant and attempts the call there", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "rate_limit" as const, waitUntilMs: TEN_MINUTES_MS }],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            const notices = recordWaitNotices();
            return { stub, time, notices };
        },
        async ACT({ stub, time, notices }) {
            const runPromise = run(baseArgs({ adapter: stub.adapter, time, callbacks: notices.callbacks }));
            await flush();
            time.$advance(TEN_MINUTES_MS - 1);
            await flush();
            const justBeforeEnd = stub.$invokeArgs.length;
            time.$advance(1);
            await flush();
            const atEnd = stub.$invokeArgs.length;
            await runPromise;
            return { justBeforeEnd, atEnd, durations: time.$durations.slice() };
        },
        ASSERTS: {
            "the wait sleeps exactly once, for the whole remaining time"(result) {
                Assert.deepStrictEqual(result.durations, [TEN_MINUTES_MS]);
            },
            "no attempt runs before the expected end"(result) {
                Assert.strictEqual(result.justBeforeEnd, 1);
            },
            "the attempt runs as the expected end arrives"(result) {
                Assert.strictEqual(result.atEnd, 2);
            },
            "the reported next retry coincides with the expected end"(_result, { notices }) {
                Assert.deepStrictEqual(notices.$starts, [{ kind: "rate-limit", endTimeMs: TEN_MINUTES_MS, nextRetryAtMs: TEN_MINUTES_MS }]);
            }
        }
    });

    test("every attempt of a rate-limit wait re-issues the original arguments with the captured session id", {
        ARRANGE() {
            const stub = stubAdapter([
                [
                    { type: "session" as const, id: "s1" },
                    { type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }
                ],
                [{ type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            return { stub, time };
        },
        async ACT({ stub, time }) {
            const runPromise = run(baseArgs({
                adapter: stub.adapter,
                time,
                prompt: "the prompt",
                model: "m1",
                effort: "high",
                fast: true,
                priorSessionUsage: { inputTokens: 40, outputTokens: 12 },
                resumeSessionId: "caller-session"
            }));
            await flush();
            time.$advance(THIRTY_MINUTES_MS);
            await flush();
            time.$advance(THIRTY_MINUTES_MS);
            await flush();
            await runPromise;
            return stub.$invokeArgs.slice(1);
        },
        ASSERTS: {
            "every attempt re-issues the original prompt"(attempts) {
                Assert.deepStrictEqual(attempts.map(args => args.prompt), ["the prompt", "the prompt"]);
            },
            "every attempt re-issues the original model"(attempts) {
                Assert.deepStrictEqual(attempts.map(args => args.model), ["m1", "m1"]);
            },
            "every attempt re-issues the original effort"(attempts) {
                Assert.deepStrictEqual(attempts.map(args => args.effort), ["high", "high"]);
            },
            "every attempt re-issues the original fast value"(attempts) {
                Assert.deepStrictEqual(attempts.map(args => args.fast), [true, true]);
            },
            "every attempt re-issues the original usage baseline"(attempts) {
                Assert.deepStrictEqual(attempts.map(args => args.priorSessionUsage), [
                    { inputTokens: 40, outputTokens: 12 },
                    { inputTokens: 40, outputTokens: 12 }
                ]);
            },
            "every attempt resumes the captured session id"(attempts) {
                Assert.deepStrictEqual(attempts.map(args => args.resumeSessionId), ["s1", "s1"]);
            }
        }
    });

    test("an attempt resumes the caller's session id when the invocation exposed none", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            return { stub, time };
        },
        async ACT({ stub, time }) {
            const runPromise = run(baseArgs({ adapter: stub.adapter, time, resumeSessionId: "caller-session" }));
            await flush();
            time.$advance(THIRTY_MINUTES_MS);
            await flush();
            await runPromise;
            return stub.$invokeArgs[1]!.resumeSessionId;
        },
        ASSERT(result) {
            Assert.strictEqual(result, "caller-session");
        }
    });

    test("abort during a later interval of the same wait rejects without attempting the call again", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }],
                [{ type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            const abort = new AbortController();
            const notices = recordWaitNotices();
            return { stub, time, abort, notices };
        },
        async ACT({ stub, time, abort, notices }) {
            const runResult = monad(() => run(baseArgs({ adapter: stub.adapter, time, abortSignal: abort.signal, callbacks: notices.callbacks })));
            await flush();
            time.$advance(THIRTY_MINUTES_MS);
            await flush();
            abort.abort();
            return await runResult;
        },
        ASSERTS: {
            "rejects with an abort-shaped error"(result) {
                result.should.error({ name: "AbortError" });
            },
            "the adapter is not invoked again"(_result, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 2);
            },
            "the caller is told the wait ended exactly once"(_result, { notices }) {
                Assert.strictEqual(notices.$endCount(), 1);
            },
            "the rejection arrives without the interval elapsing"(_result, { time }) {
                Assert.strictEqual(time.now(), THIRTY_MINUTES_MS);
            }
        }
    });

    test("forcing a four-day wait retries immediately and re-anchors a still-limited interval", {
        ARRANGE() {
            const stub = stubAdapter([
                [
                    { type: "session" as const, id: "s1" },
                    { type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }
                ],
                [{ type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            const notices = recordWaitNotices();
            const retry = forceRetrySource();
            return { stub, time, notices, retry };
        },
        async ACT({ stub, time, notices, retry }) {
            const runPromise = run(baseArgs({
                adapter: stub.adapter,
                time,
                prompt: "the prompt",
                model: "m1",
                effort: "high",
                fast: true,
                priorSessionUsage: { inputTokens: 40, outputTokens: 12 },
                forceRetrySignal: retry.signal,
                callbacks: notices.callbacks
            }));
            await flush();
            retry.forceRetry();
            await flush();
            const afterForce = {
                now: time.now(),
                invocationCount: stub.$invokeArgs.length,
                forcedArgs: stub.$invokeArgs[1]!,
                waitEndCount: notices.$endCount()
            };
            time.$advance(THIRTY_MINUTES_MS - 1);
            await flush();
            const justBeforeNextInterval = stub.$invokeArgs.length;
            time.$advance(1);
            await flush();
            const atNextInterval = stub.$invokeArgs.length;
            await runPromise;
            return { afterForce, justBeforeNextInterval, atNextInterval };
        },
        ASSERTS: {
            "the forced attempt happens without advancing the fake clock"(result) {
                Assert.strictEqual(result.afterForce.now, 0);
            },
            "the forced attempt invokes the adapter immediately"(result) {
                Assert.strictEqual(result.afterForce.invocationCount, 2);
            },
            "the forced attempt re-issues the original prompt"(result) {
                Assert.strictEqual(result.afterForce.forcedArgs.prompt, "the prompt");
            },
            "the forced attempt re-issues the original model"(result) {
                Assert.strictEqual(result.afterForce.forcedArgs.model, "m1");
            },
            "the forced attempt re-issues the original effort"(result) {
                Assert.strictEqual(result.afterForce.forcedArgs.effort, "high");
            },
            "the forced attempt re-issues the original fast value"(result) {
                Assert.strictEqual(result.afterForce.forcedArgs.fast, true);
            },
            "the forced attempt re-issues the original usage baseline"(result) {
                Assert.deepStrictEqual(result.afterForce.forcedArgs.priorSessionUsage, { inputTokens: 40, outputTokens: 12 });
            },
            "the forced attempt resumes the captured session id"(result) {
                Assert.strictEqual(result.afterForce.forcedArgs.resumeSessionId, "s1");
            },
            "the continuous wait has one entry notice"(_result, { notices }) {
                Assert.deepStrictEqual(notices.$starts, [
                    { kind: "rate-limit", endTimeMs: FOUR_DAYS_MS, nextRetryAtMs: THIRTY_MINUTES_MS }
                ]);
            },
            "the still-limited forced attempt updates the next retry from its own instant"(_result, { notices }) {
                Assert.deepStrictEqual(notices.$updates, [
                    { endTimeMs: FOUR_DAYS_MS, nextRetryAtMs: THIRTY_MINUTES_MS }
                ]);
            },
            "the forced attempt does not end the continuous wait"(result) {
                Assert.strictEqual(result.afterForce.waitEndCount, 0);
            },
            "no automatic attempt occurs before 30 minutes from the forced attempt"(result) {
                Assert.strictEqual(result.justBeforeNextInterval, 2);
            },
            "the next automatic attempt occurs at 30 minutes from the forced attempt"(result) {
                Assert.strictEqual(result.atNextInterval, 3);
            },
            "the wait ends exactly once when the later attempt succeeds"(_result, { notices }) {
                Assert.strictEqual(notices.$endCount(), 1);
            }
        }
    });

    test("a forced attempt that succeeds ends the existing wait", {
        ARRANGE() {
            const stub = stubAdapter([
                [{ type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }],
                [{ type: "done" as const }]
            ]);
            const time = manualTimeContext();
            const notices = recordWaitNotices();
            const retry = forceRetrySource();
            return { stub, time, notices, retry };
        },
        async ACT({ stub, time, notices, retry }) {
            const runPromise = run(baseArgs({
                adapter: stub.adapter,
                time,
                forceRetrySignal: retry.signal,
                callbacks: notices.callbacks
            }));
            await flush();
            retry.forceRetry();
            await flush();
            await runPromise;
            return { invocationCount: stub.$invokeArgs.length, now: time.now() };
        },
        ASSERTS: {
            "the forced successful attempt is the second invocation"(result) {
                Assert.strictEqual(result.invocationCount, 2);
            },
            "success does not require fake-clock advancement"(result) {
                Assert.strictEqual(result.now, 0);
            },
            "the caller sees one wait entry followed by one wait end"(_result, { notices }) {
                Assert.deepStrictEqual(notices.$order, ["start", "end"]);
            },
            "success does not report a still-waiting update"(_result, { notices }) {
                Assert.deepStrictEqual(notices.$updates, []);
            }
        }
    });

    test("forcing while the adapter invocation is still running leaves it uninterrupted", {
        ARRANGE() {
            let release:() => void = () => {};
            const invokeArgs:ToolAdapterInvokeArgs[] = [];
            const adapter:ToolAdapter = {
                invoke(args):AsyncIterable<ToolEvent> {
                    invokeArgs.push(args);
                    return {
                        async *[Symbol.asyncIterator]() {
                            await new Promise<void>(resolve => {
                                release = resolve;
                            });
                            yield { type: "done" };
                        }
                    };
                }
            };
            const time = manualTimeContext();
            const retry = forceRetrySource();
            return { adapter, time, retry, invokeArgs, release: () => release() };
        },
        async ACT({ adapter, time, retry, invokeArgs, release }) {
            const runPromise = run(baseArgs({ adapter, time, forceRetrySignal: retry.signal }));
            await flush();
            retry.forceRetry();
            await flush();
            const whileRunning = {
                invocationCount: invokeArgs.length,
                adapterSignalAborted: invokeArgs[0]!.abortSignal.aborted
            };
            release();
            await runPromise;
            return whileRunning;
        },
        ASSERTS: {
            "no extra invocation is launched while the adapter is running"(result) {
                Assert.strictEqual(result.invocationCount, 1);
            },
            "the adapter invocation is not interrupted"(result) {
                Assert.strictEqual(result.adapterSignalAborted, false);
            }
        }
    });

    test("forcing after a successful invocation does not invoke the adapter again", {
        ARRANGE() {
            const stub = stubAdapter([[{ type: "done" as const }]]);
            const time = manualTimeContext();
            const retry = forceRetrySource();
            return { stub, time, retry };
        },
        async ACT({ stub, time, retry }) {
            await run(baseArgs({ adapter: stub.adapter, time, forceRetrySignal: retry.signal }));
            retry.forceRetry();
            await flush();
            return stub.$invokeArgs.length;
        },
        ASSERT(invocationCount) {
            Assert.strictEqual(invocationCount, 1);
        }
    });

    test("forcing after a failed invocation does not invoke the adapter again", {
        ARRANGE() {
            const stub = stubAdapter([[
                { type: "error" as const, retryable: false, message: "failed" }
            ]]);
            const time = manualTimeContext();
            const retry = forceRetrySource();
            return { stub, time, retry };
        },
        async ACT({ stub, time, retry }) {
            const result = await monad(() => run(baseArgs({ adapter: stub.adapter, time, forceRetrySignal: retry.signal })));
            retry.forceRetry();
            await flush();
            return result;
        },
        ASSERTS: {
            "the completed invocation rejects with its error"(result) {
                result.should.error({ message: "failed" });
            },
            "forcing after the rejection does not invoke the adapter again"(_result, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 1);
            }
        }
    });

    test("forcing after an aborted invocation does not invoke the adapter again", {
        ARRANGE() {
            const stub = stubAdapter([[
                { type: "rate_limit" as const, waitUntilMs: FOUR_DAYS_MS }
            ]]);
            const time = manualTimeContext();
            const abort = new AbortController();
            const retry = forceRetrySource();
            return { stub, time, abort, retry };
        },
        async ACT({ stub, time, abort, retry }) {
            const runResult = monad(() => run(baseArgs({
                adapter: stub.adapter,
                time,
                abortSignal: abort.signal,
                forceRetrySignal: retry.signal
            })));
            await flush();
            abort.abort();
            const result = await runResult;
            retry.forceRetry();
            await flush();
            return result;
        },
        ASSERTS: {
            "the completed invocation rejects as aborted"(result) {
                result.should.error({ name: "AbortError" });
            },
            "forcing after the abort does not invoke the adapter again"(_result, { stub }) {
                Assert.strictEqual(stub.$invokeArgs.length, 1);
            }
        }
    });

    test("an abort delivered with a rate-limit terminal event does not start a retry interval", {
        ARRANGE() {
            const abort = new AbortController();
            let invocationCount = 0;
            const adapter:ToolAdapter = {
                invoke():AsyncIterable<ToolEvent> {
                    invocationCount++;
                    return {
                        async *[Symbol.asyncIterator]() {
                            abort.abort();
                            yield { type: "rate_limit", waitUntilMs: FOUR_DAYS_MS };
                        }
                    };
                }
            };
            const time = manualTimeContext();
            return { adapter, time, abort, invocationCount: () => invocationCount };
        },
        async ACT({ adapter, time, abort, invocationCount }) {
            const result = await monad(() => run(baseArgs({
                adapter,
                time,
                abortSignal: abort.signal
            })));
            return { result, invocationCount: invocationCount(), durations: time.$durations.slice() };
        },
        ASSERTS: {
            "the invocation rejects as aborted"(result) {
                result.result.should.error({ name: "AbortError" });
            },
            "the adapter is invoked only once"(result) {
                Assert.strictEqual(result.invocationCount, 1);
            },
            "no retry timer is scheduled"(result) {
                Assert.deepStrictEqual(result.durations, []);
            }
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
            return await monad(async () => await run(baseArgs({ adapter, time, abortSignal: abort.signal })));
        },
        ASSERT(res) {
            res.should.error({ name: "AbortError" });
        }
    });
});
