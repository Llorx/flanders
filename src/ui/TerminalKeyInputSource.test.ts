import * as Assert from "assert";

import test, { monad } from "arrange-act-assert";

import { TerminalKeyInputSource } from "./TerminalKeyInputSource";
import type { TerminalKeyInputPrimitives } from "./TerminalKeyInputSource";
import { unavailableTerminalKeyInputContext } from "./TerminalKeyInputSource.fixtures";

type FakeInputOptions = Readonly<{
    terminal?:boolean;
    rawMode?:boolean;
    subscribeError?:Error;
}>;

function fakeInput(options:FakeInputOptions = {}) {
    let rawMode = options.rawMode ?? false;
    let subscribeCount = 0;
    let unsubscribeCount = 0;
    const rawModeChanges:boolean[] = [];
    const listeners = new Set<(chunk:Buffer|string) => void>();
    const primitives:TerminalKeyInputPrimitives = {
        isTerminal() {
            return options.terminal ?? true;
        },
        isRawMode() {
            return rawMode;
        },
        setRawMode(enabled) {
            rawMode = enabled;
            rawModeChanges.push(enabled);
        },
        subscribeBytes(listener) {
            subscribeCount++;
            if (options.subscribeError) {
                throw options.subscribeError;
            }
            listeners.add(listener);
            return () => {
                if (listeners.delete(listener)) {
                    unsubscribeCount++;
                }
            };
        }
    };
    return {
        primitives,
        feed(chunk:Buffer|string) {
            for (const listener of [...listeners]) {
                listener(chunk);
            }
        },
        get rawMode() { return rawMode; },
        get rawModeChanges() { return rawModeChanges; },
        get subscribeCount() { return subscribeCount; },
        get unsubscribeCount() { return unsubscribeCount; },
        get consuming() { return listeners.size > 0; }
    };
}

function arrangeSubscribedSource(options:FakeInputOptions = {}) {
    const input = fakeInput(options);
    const retries:string[] = [];
    const interrupts:string[] = [];
    const source = new TerminalKeyInputSource(input.primitives, () => {
        interrupts.push("interrupt");
    });
    const unsubscribe = source.onRetryKey(() => {
        retries.push("retry");
    });
    return { input, retries, interrupts, source, unsubscribe };
}

const RETRY_SEQUENCE_CASES:readonly Readonly<{
    name:string;
    chunks:readonly (Buffer|string)[];
}>[] = [
    { name: "the standard F5 sequence", chunks: [Buffer.from("\x1b[15~", "latin1")] },
    { name: "the modified F5 sequence", chunks: ["\x1b[15;2~"] },
    { name: "the Linux-console F5 sequence", chunks: ["\x1b[[E"] },
    { name: "the standard F5 sequence split across chunks", chunks: ["\x1b[", "15~"] },
    { name: "the modified F5 sequence split across chunks", chunks: ["\x1b[15;", "2~"] },
    { name: "the Linux-console F5 sequence split across chunks", chunks: ["\x1b[", "[E"] },
    { name: "an F5 sequence with a multi-digit modifier", chunks: ["\x1b[15;123456~"] }
];

test.describe("TerminalKeyInputSource", test => {
    test("subscribing enables raw mode once and starts consuming bytes", {
        ARRANGE() {
            const input = fakeInput();
            const source = new TerminalKeyInputSource(input.primitives, () => {});
            return { input, source };
        },
        ACT({ source }) {
            source.onRetryKey(() => {});
        },
        ASSERTS: {
            "raw mode is enabled exactly once"(_result, { input }) {
                Assert.deepStrictEqual(input.rawModeChanges, [true]);
            },
            "the byte channel receives exactly one subscription"(_result, { input }) {
                Assert.strictEqual(input.subscribeCount, 1);
            },
            "the byte channel is being consumed"(_result, { input }) {
                Assert.strictEqual(input.consuming, true);
            }
        }
    });

    for (const sequenceCase of RETRY_SEQUENCE_CASES) {
        test(`${sequenceCase.name} notifies exactly one retry`, {
            ARRANGE() {
                return arrangeSubscribedSource();
            },
            ACT({ input }) {
                for (const chunk of sequenceCase.chunks) {
                    input.feed(chunk);
                }
            },
            ASSERT(_result, { retries }) {
                Assert.strictEqual(retries.length, 1);
            }
        });
    }

    test("printable text, a bare escape, and other function keys are discarded", {
        ARRANGE() {
            return arrangeSubscribedSource();
        },
        ACT({ input }) {
            input.feed("printable text");
            input.feed("\x1b");
            input.feed("\x1b[14~");
            input.feed("\x1b[17~");
        },
        ASSERTS: {
            "no retry is notified"(_result, { retries }) {
                Assert.strictEqual(retries.length, 0);
            },
            "no interrupt is notified"(_result, { interrupts }) {
                Assert.strictEqual(interrupts.length, 0);
            }
        }
    });

    test("the interrupt byte notifies interruption but not retry", {
        ARRANGE() {
            return arrangeSubscribedSource();
        },
        ACT({ input }) {
            input.feed("\x03");
        },
        ASSERTS: {
            "interruption is notified exactly once"(_result, { interrupts }) {
                Assert.strictEqual(interrupts.length, 1);
            },
            "retry is not notified"(_result, { retries }) {
                Assert.strictEqual(retries.length, 0);
            }
        }
    });

    test("unsubscribing stops consumption, restores raw mode, and prevents later notifications", {
        ARRANGE() {
            return arrangeSubscribedSource();
        },
        ACT({ input, unsubscribe }) {
            unsubscribe();
            input.feed("\x1b[15~\x03");
        },
        ASSERTS: {
            "raw mode is restored"(_result, { input }) {
                Assert.deepStrictEqual(input.rawModeChanges, [true, false]);
            },
            "the byte subscription is released exactly once"(_result, { input }) {
                Assert.strictEqual(input.unsubscribeCount, 1);
            },
            "the channel is no longer consumed"(_result, { input }) {
                Assert.strictEqual(input.consuming, false);
            },
            "later input produces no retry"(_result, { retries }) {
                Assert.strictEqual(retries.length, 0);
            },
            "later input produces no interrupt"(_result, { interrupts }) {
                Assert.strictEqual(interrupts.length, 0);
            }
        }
    });

    test("disposing the source is idempotent and prevents later notifications", {
        ARRANGE() {
            return arrangeSubscribedSource();
        },
        ACT({ input, source, unsubscribe }) {
            source.dispose();
            source.dispose();
            unsubscribe();
            input.feed("\x1b[15~\x03");
        },
        ASSERTS: {
            "raw mode is restored once"(_result, { input }) {
                Assert.deepStrictEqual(input.rawModeChanges, [true, false]);
            },
            "the byte subscription is released once"(_result, { input }) {
                Assert.strictEqual(input.unsubscribeCount, 1);
            },
            "the channel is no longer consumed"(_result, { input }) {
                Assert.strictEqual(input.consuming, false);
            },
            "later input produces no retry"(_result, { retries }) {
                Assert.strictEqual(retries.length, 0);
            },
            "later input produces no interrupt"(_result, { interrupts }) {
                Assert.strictEqual(interrupts.length, 0);
            }
        }
    });

    test("restoring an already-raw channel preserves its prior mode", {
        ARRANGE() {
            return arrangeSubscribedSource({ rawMode: true });
        },
        ACT({ unsubscribe }) {
            unsubscribe();
        },
        ASSERTS: {
            "the channel remains raw"(_result, { input }) {
                Assert.strictEqual(input.rawMode, true);
            },
            "restoration uses the original raw state"(_result, { input }) {
                Assert.deepStrictEqual(input.rawModeChanges, [true, true]);
            }
        }
    });

    test("multiple retry subscribers share one byte reader until the last unsubscribes", {
        ARRANGE() {
            const input = fakeInput();
            const source = new TerminalKeyInputSource(input.primitives, () => {});
            const retriesA:string[] = [];
            const retriesB:string[] = [];
            const unsubscribeA = source.onRetryKey(() => retriesA.push("retry"));
            const unsubscribeB = source.onRetryKey(() => retriesB.push("retry"));
            return { input, retriesA, retriesB, unsubscribeA, unsubscribeB };
        },
        ACT({ input, unsubscribeA, unsubscribeB }) {
            unsubscribeA();
            input.feed("\x1b[15~");
            unsubscribeB();
        },
        ASSERTS: {
            "the channel is subscribed once"(_result, { input }) {
                Assert.strictEqual(input.subscribeCount, 1);
            },
            "the removed listener is not notified"(_result, { retriesA }) {
                Assert.strictEqual(retriesA.length, 0);
            },
            "the remaining listener is notified"(_result, { retriesB }) {
                Assert.strictEqual(retriesB.length, 1);
            },
            "the shared channel is released once"(_result, { input }) {
                Assert.strictEqual(input.unsubscribeCount, 1);
            },
            "raw mode spans the shared subscription lifetime"(_result, { input }) {
                Assert.deepStrictEqual(input.rawModeChanges, [true, false]);
            }
        }
    });

    test("a byte-subscription failure restores the original raw mode", {
        ARRANGE() {
            const error = new Error("subscribe failed");
            const input = fakeInput({ subscribeError: error });
            const source = new TerminalKeyInputSource(input.primitives, () => {});
            return { error, input, source };
        },
        ACT({ source }) {
            return monad(() => source.onRetryKey(() => {}));
        },
        ASSERTS: {
            "the subscription error is propagated"(result, { error }) {
                result.should.error(error);
            },
            "raw mode is restored after the failure"(_result, { input }) {
                Assert.deepStrictEqual(input.rawModeChanges, [true, false]);
            },
            "no byte listener remains"(_result, { input }) {
                Assert.strictEqual(input.consuming, false);
            }
        }
    });

    test("a non-terminal channel is unavailable and remains untouched", {
        ARRANGE() {
            const input = fakeInput({ terminal: false });
            const source = new TerminalKeyInputSource(input.primitives, () => {});
            const retries:string[] = [];
            return { input, retries, source };
        },
        ACT({ input, retries, source }) {
            const available = source.available();
            const unsubscribe = source.onRetryKey(() => retries.push("retry"));
            unsubscribe();
            input.feed("\x1b[15~");
            source.dispose();
            return available;
        },
        ASSERTS: {
            "the context reports unavailable"(available) {
                Assert.strictEqual(available, false);
            },
            "raw mode is not changed"(_available, { input }) {
                Assert.deepStrictEqual(input.rawModeChanges, []);
            },
            "the byte channel is not consumed"(_available, { input }) {
                Assert.strictEqual(input.subscribeCount, 0);
            },
            "no retry is notified"(_available, { retries }) {
                Assert.strictEqual(retries.length, 0);
            }
        }
    });

    test("a disposed source remains unavailable and starts no new subscription", {
        ARRANGE() {
            const input = fakeInput();
            const source = new TerminalKeyInputSource(input.primitives, () => {});
            return { input, source };
        },
        ACT({ source }) {
            source.dispose();
            const unsubscribe = source.onRetryKey(() => {});
            unsubscribe();
            return source.available();
        },
        ASSERTS: {
            "the source reports unavailable"(available) {
                Assert.strictEqual(available, false);
            },
            "the source did not enable raw mode"(_available, { input }) {
                Assert.deepStrictEqual(input.rawModeChanges, []);
            },
            "the source did not consume bytes"(_available, { input }) {
                Assert.strictEqual(input.subscribeCount, 0);
            }
        }
    });

    test("the shared unavailable test context exposes a no-op subscription", {
        ARRANGE() {
            const retries:string[] = [];
            return { retries };
        },
        ACT({ retries }) {
            const unsubscribe = unavailableTerminalKeyInputContext.onRetryKey(() => retries.push("retry"));
            unsubscribe();
            return unavailableTerminalKeyInputContext.available();
        },
        ASSERTS: {
            "the context reports unavailable"(available) {
                Assert.strictEqual(available, false);
            },
            "the subscription never notifies"(_available, { retries }) {
                Assert.strictEqual(retries.length, 0);
            }
        }
    });
});
