import * as Assert from "assert";

import test from "arrange-act-assert";

import { TerminalSizeSource } from "./TerminalSizeSource";
import type { TerminalSize } from "./TerminalSizeSource";
import type { TimeoutHandle } from "../contexts";

type FakeTimer = { handler:() => void; at:number };

function fakeTime() {
    const timers:FakeTimer[] = [];
    let now = 0;
    return {
        now() { return now; },
        setTimeout(handler:() => void, ms:number):TimeoutHandle {
            const timer:FakeTimer = { handler, at: now + ms };
            timers.push(timer);
            return {
                cancel() {
                    const idx = timers.indexOf(timer);
                    if (idx !== -1) timers.splice(idx, 1);
                }
            };
        },
        advance(ms:number) {
            const target = now + ms;
            for (;;) {
                let earliest = -1;
                for (let i = 0; i < timers.length; i++) {
                    if (timers[i]!.at <= target && (earliest === -1 || timers[i]!.at < timers[earliest]!.at)) {
                        earliest = i;
                    }
                }
                if (earliest === -1) break;
                const [timer] = timers.splice(earliest, 1);
                now = timer!.at;
                timer!.handler();
            }
            now = target;
        },
        get pendingCount() { return timers.length; }
    };
}

function stubRead(initial:TerminalSize | null) {
    let current = initial;
    return {
        read: ():TerminalSize | null => current,
        set(size:TerminalSize | null) { current = size; }
    };
}

function stubNative() {
    let listener:(() => void) | null = null;
    let unsubCount = 0;
    return {
        subscribe(l:() => void) { listener = l; return () => { unsubCount++; }; },
        fire() { if (listener) listener(); },
        get unsubCount() { return unsubCount; }
    };
}

const POLL_MS = 200;

test.describe("TerminalSizeSource", test => {
    test("columns returns the freshly read terminal width", {
        ARRANGE() {
            const read = stubRead({ columns: 120, rows: 30 });
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, fakeTime(), POLL_MS);
            return { src };
        },
        ACT({ src }) {
            return src.columns();
        },
        ASSERT(result) {
            Assert.strictEqual(result, 120);
        }
    });

    test("columns falls back to 80 when the size cannot be read", {
        ARRANGE() {
            const read = stubRead(null);
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, fakeTime(), POLL_MS);
            return { src };
        },
        ACT({ src }) {
            return src.columns();
        },
        ASSERT(result) {
            Assert.strictEqual(result, 80);
        }
    });

    test("columns falls back to 80 when the read reports a non-positive width", {
        ARRANGE() {
            const read = stubRead({ columns: 0, rows: 30 });
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, fakeTime(), POLL_MS);
            return { src };
        },
        ACT({ src }) {
            return src.columns();
        },
        ASSERT(result) {
            Assert.strictEqual(result, 80);
        }
    });

    test("rows returns the freshly read terminal height", {
        ARRANGE() {
            const read = stubRead({ columns: 120, rows: 30 });
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, fakeTime(), POLL_MS);
            return { src };
        },
        ACT({ src }) {
            return src.rows();
        },
        ASSERT(result) {
            Assert.strictEqual(result, 30);
        }
    });

    test("rows falls back to 24 when the size cannot be read", {
        ARRANGE() {
            const read = stubRead(null);
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, fakeTime(), POLL_MS);
            return { src };
        },
        ACT({ src }) {
            return src.rows();
        },
        ASSERT(result) {
            Assert.strictEqual(result, 24);
        }
    });

    test("rows falls back to 24 when the read reports a non-positive height", {
        ARRANGE() {
            const read = stubRead({ columns: 120, rows: 0 });
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, fakeTime(), POLL_MS);
            return { src };
        },
        ACT({ src }) {
            return src.rows();
        },
        ASSERT(result) {
            Assert.strictEqual(result, 24);
        }
    });

    test("a poll that observes a width change fires the listener and reports the new width", {
        ARRANGE() {
            const read = stubRead({ columns: 80, rows: 24 });
            const time = fakeTime();
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, time, POLL_MS);
            const fires:number[] = [];
            src.onResize(() => fires.push(src.columns()));
            return { read, time, fires, src };
        },
        ACT({ read, time }) {
            read.set({ columns: 120, rows: 24 });
            time.advance(POLL_MS);
        },
        ASSERTS: {
            "the listener fired exactly once"(_result, { fires }) {
                Assert.strictEqual(fires.length, 1);
            },
            "columns reports the new width"(_result, { src }) {
                Assert.strictEqual(src.columns(), 120);
            }
        }
    });

    test("a poll that observes no size change does not fire the listener", {
        ARRANGE() {
            const read = stubRead({ columns: 80, rows: 24 });
            const time = fakeTime();
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, time, POLL_MS);
            const fires:number[] = [];
            src.onResize(() => fires.push(1));
            return { time, fires };
        },
        ACT({ time }) {
            time.advance(POLL_MS);
        },
        ASSERT(_result, { fires }) {
            Assert.strictEqual(fires.length, 0);
        }
    });

    test("a poll with an unreadable size does not fire the listener", {
        ARRANGE() {
            const read = stubRead({ columns: 80, rows: 24 });
            const time = fakeTime();
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, time, POLL_MS);
            const fires:number[] = [];
            src.onResize(() => fires.push(1));
            return { read, time, fires };
        },
        ACT({ read, time }) {
            read.set(null);
            time.advance(POLL_MS);
        },
        ASSERT(_result, { fires }) {
            Assert.strictEqual(fires.length, 0);
        }
    });

    test("a delivered native resize event redraws immediately, without waiting for a poll tick", {
        ARRANGE() {
            const read = stubRead({ columns: 80, rows: 24 });
            const native = stubNative();
            const time = fakeTime();
            const src = new TerminalSizeSource(read.read, native.subscribe, time, POLL_MS);
            const fires:number[] = [];
            src.onResize(() => fires.push(1));
            return { read, native, time, fires };
        },
        ACT({ read, native }) {
            read.set({ columns: 120, rows: 24 });
            native.fire();
        },
        ASSERTS: {
            "the listener fired exactly once on the native event"(_result, { fires }) {
                Assert.strictEqual(fires.length, 1);
            },
            "the redraw came from the event, not a poll tick — the poll is still pending and no poll time elapsed"(_result, { time }) {
                Assert.strictEqual(time.pendingCount, 1);
            }
        }
    });

    test("the native notification and the poll do not fire twice for one size change", {
        ARRANGE() {
            const read = stubRead({ columns: 80, rows: 24 });
            const native = stubNative();
            const time = fakeTime();
            const src = new TerminalSizeSource(read.read, native.subscribe, time, POLL_MS);
            const fires:number[] = [];
            src.onResize(() => fires.push(1));
            return { read, native, time, fires };
        },
        ACT({ read, native, time }) {
            read.set({ columns: 120, rows: 24 });
            native.fire();
            time.advance(POLL_MS);
        },
        ASSERT(_result, { fires }) {
            Assert.strictEqual(fires.length, 1);
        }
    });

    test("a subscription started while the size is unreadable still detects a later change", {
        ARRANGE() {
            const read = stubRead(null);
            const time = fakeTime();
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, time, POLL_MS);
            const fires:number[] = [];
            src.onResize(() => fires.push(1));
            return { read, time, fires };
        },
        ACT({ read, time }) {
            read.set({ columns: 120, rows: 24 });
            time.advance(POLL_MS);
        },
        ASSERT(_result, { fires }) {
            Assert.strictEqual(fires.length, 1);
        }
    });

    test("unsubscribing stops the poll and releases the native subscription", {
        ARRANGE() {
            const read = stubRead({ columns: 80, rows: 24 });
            const native = stubNative();
            const time = fakeTime();
            const src = new TerminalSizeSource(read.read, native.subscribe, time, POLL_MS);
            const fires:number[] = [];
            const unsub = src.onResize(() => fires.push(1));
            return { read, native, time, fires, unsub };
        },
        ACT({ read, time, unsub }) {
            unsub();
            read.set({ columns: 120, rows: 24 });
            time.advance(POLL_MS * 2);
        },
        ASSERTS: {
            "the listener does not fire after unsubscribe"(_result, { fires }) {
                Assert.strictEqual(fires.length, 0);
            },
            "no poll timer remains pending"(_result, { time }) {
                Assert.strictEqual(time.pendingCount, 0);
            },
            "the native subscription is released exactly once"(_result, { native }) {
                Assert.strictEqual(native.unsubCount, 1);
            }
        }
    });

    test("unsubscribing twice releases the native subscription only once", {
        ARRANGE() {
            const native = stubNative();
            const src = new TerminalSizeSource(stubRead({ columns: 80, rows: 24 }).read, native.subscribe, fakeTime(), POLL_MS);
            const unsub = src.onResize(() => {});
            return { native, unsub };
        },
        ACT({ unsub }) {
            unsub();
            unsub();
        },
        ASSERT(_result, { native }) {
            Assert.strictEqual(native.unsubCount, 1);
        }
    });

    test("a listener that unsubscribes itself during a fire stops the poll", {
        ARRANGE() {
            const read = stubRead({ columns: 80, rows: 24 });
            const time = fakeTime();
            const src = new TerminalSizeSource(read.read, stubNative().subscribe, time, POLL_MS);
            const fires:number[] = [];
            let unsub:() => void = () => {};
            unsub = src.onResize(() => { fires.push(1); unsub(); });
            return { read, time, fires };
        },
        ACT({ read, time }) {
            read.set({ columns: 120, rows: 24 });
            time.advance(POLL_MS * 3);
        },
        ASSERTS: {
            "the listener fired exactly once"(_result, { fires }) {
                Assert.strictEqual(fires.length, 1);
            },
            "no poll timer remains pending after the self-unsubscribe"(_result, { time }) {
                Assert.strictEqual(time.pendingCount, 0);
            }
        }
    });

    test("dispose stops every active subscription", {
        ARRANGE() {
            const read = stubRead({ columns: 80, rows: 24 });
            const native = stubNative();
            const time = fakeTime();
            const src = new TerminalSizeSource(read.read, native.subscribe, time, POLL_MS);
            const firesA:number[] = [];
            const firesB:number[] = [];
            src.onResize(() => firesA.push(1));
            src.onResize(() => firesB.push(1));
            return { read, native, time, firesA, firesB, src };
        },
        ACT({ read, time, src }) {
            src.dispose();
            read.set({ columns: 120, rows: 24 });
            time.advance(POLL_MS * 2);
        },
        ASSERTS: {
            "the first subscription does not fire"(_result, { firesA }) {
                Assert.strictEqual(firesA.length, 0);
            },
            "the second subscription does not fire"(_result, { firesB }) {
                Assert.strictEqual(firesB.length, 0);
            },
            "no poll timer remains pending"(_result, { time }) {
                Assert.strictEqual(time.pendingCount, 0);
            },
            "both native subscriptions are released"(_result, { native }) {
                Assert.strictEqual(native.unsubCount, 2);
            }
        }
    });

    test("after dispose, calling a returned unsubscribe is a no-op", {
        ARRANGE() {
            const native = stubNative();
            const src = new TerminalSizeSource(stubRead({ columns: 80, rows: 24 }).read, native.subscribe, fakeTime(), POLL_MS);
            const unsub = src.onResize(() => {});
            return { native, src, unsub };
        },
        ACT({ src, unsub }) {
            src.dispose();
            unsub();
        },
        ASSERT(_result, { native }) {
            Assert.strictEqual(native.unsubCount, 1);
        }
    });
});
