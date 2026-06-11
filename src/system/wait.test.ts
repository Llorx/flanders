import * as Assert from "assert";

import test from "arrange-act-assert";

import { wait } from "./wait";
import type { TimeContext, TimeoutHandle } from "../contexts";

function timeContext() {
    let now = 0;
    let created = 0;
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
        get $timersCreated() {
            return created;
        },
        ...({
            now() {
                return now;
            },
            setTimeout(handler:() => void, ms:number):TimeoutHandle {
                created++;
                const t = { at: now + ms, cb: handler, cancelled: false };
                timers.push(t);
                return {
                    cancel() {
                        t.cancelled = true;
                    }
                };
            }
        } satisfies TimeContext)
    };
}

test.describe("wait", test => {
    test("90 min wait with 1h chunks consumes two chunks", {
        ARRANGE() {
            const time = timeContext();
            const abort = new AbortController();
            const HOUR = 60 * 60 * 1000;
            const NINETY_MIN = 90 * 60 * 1000;
            return { time, abort, HOUR, NINETY_MIN };
        },
        async ACT({ time, abort, HOUR, NINETY_MIN }) {
            let resolved = false;
            const p = wait(NINETY_MIN, HOUR, time, abort.signal).then(() => { resolved = true; });
            await new Promise<void>(r => setImmediate(r));
            const afterStart = resolved;
            time.$advance(HOUR);
            await new Promise<void>(r => setImmediate(r));
            const afterFirstChunk = resolved;
            time.$advance(30 * 60 * 1000);
            await new Promise<void>(r => setImmediate(r));
            await p;
            return { afterStart, afterFirstChunk, resolved, timersCreated: time.$timersCreated };
        },
        ASSERTS: {
            "not resolved immediately after start"({ afterStart }) {
                Assert.strictEqual(afterStart, false);
            },
            "not resolved after first chunk"({ afterFirstChunk }) {
                Assert.strictEqual(afterFirstChunk, false);
            },
            "resolved after remaining time elapses"({ resolved }) {
                Assert.strictEqual(resolved, true);
            },
            "created exactly two timers"({ timersCreated }) {
                Assert.strictEqual(timersCreated, 2);
            }
        }
    });
    test("abort before duration resolves the promise without throwing", {
        ARRANGE() {
            const time = timeContext();
            const abort = new AbortController();
            const HOUR = 60 * 60 * 1000;
            return { time, abort, HOUR };
        },
        async ACT({ time, abort, HOUR }) {
            let resolved = false;
            let threw = false;
            const p = wait(HOUR * 2, HOUR, time, abort.signal).then(() => { resolved = true; }, () => { threw = true; });
            await new Promise<void>(r => setImmediate(r));
            abort.abort();
            await new Promise<void>(r => setImmediate(r));
            await p;
            return { resolved, threw };
        },
        ASSERTS: {
            "resolves the promise"({ resolved }) {
                Assert.strictEqual(resolved, true);
            },
            "does not throw"({ threw }) {
                Assert.strictEqual(threw, false);
            }
        }
    });
    test("pre-aborted signal resolves immediately without creating timers", {
        ARRANGE() {
            const time = timeContext();
            const abort = new AbortController();
            abort.abort();
            return { time, abort };
        },
        async ACT({ time, abort }) {
            const HOUR = 60 * 60 * 1000;
            await wait(HOUR, HOUR, time, abort.signal);
            return { timersCreated: time.$timersCreated };
        },
        ASSERT({ timersCreated }) {
            Assert.strictEqual(timersCreated, 0);
        }
    });
    test("signal aborted during tick resolves without error", {
        ARRANGE() {
            const time = timeContext();
            const abort = new AbortController();
            const HOUR = 60 * 60 * 1000;
            return { time, abort, HOUR };
        },
        async ACT({ time, abort, HOUR }) {
            let resolved = false;
            let threw = false;
            const p = wait(HOUR * 3, HOUR, time, abort.signal).then(() => { resolved = true; }, () => { threw = true; });
            await new Promise<void>(r => setImmediate(r));
            // Advance one chunk so the first tick fires, then abort before the next tick callback runs
            time.$advance(HOUR);
            abort.abort();
            await new Promise<void>(r => setImmediate(r));
            await p;
            return { resolved, threw };
        },
        ASSERTS: {
            "resolves the promise"({ resolved }) {
                Assert.strictEqual(resolved, true);
            },
            "does not throw"({ threw }) {
                Assert.strictEqual(threw, false);
            }
        }
    });
});
