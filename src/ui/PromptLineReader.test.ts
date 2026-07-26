import * as Assert from "assert";

import test, { monad } from "arrange-act-assert";

import type { OutputContext } from "../contexts";
import { isAbortError } from "../abortError";
import { PromptLineReader } from "./PromptLineReader";
import type { RawLineSource } from "./PromptLineReader";
import { recordingOutput } from "./recordingOutput.fixtures";

function stubLineSource(echoesInput = false) {
    const state = { opens: 0, closes: 0, order: [] as string[], pending: null as ((line:string) => void)|null };
    const open = () => {
        state.opens++;
        const source:RawLineSource = {
            echoesInput,
            ask(onLine) { state.pending = onLine; },
            close() { state.closes++; state.order.push("close"); }
        };
        return source;
    };
    return { open, state };
}

test.describe("PromptLineReader", test => {
    test("prints the prompt through the supplied output channel", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, written, state };
        },
        async ACT({ reader, output, state }) {
            const answer = reader.read("Pick one: ", output);
            state.pending!("1");
            const line = await answer;
            await reader.dispose();
            return line;
        },
        ASSERT(_answer, { written }) {
            Assert.strictEqual(written[0], "Pick one: ");
        }
    });

    test("resolves with the line the user submits", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, state };
        },
        async ACT({ reader, output, state }) {
            const answer = reader.read("Pick one: ", output);
            state.pending!("2");
            const line = await answer;
            await reader.dispose();
            return line;
        },
        ASSERT(answer) {
            Assert.strictEqual(answer, "2");
        }
    });

    test("closes the prompt line itself when the input does not echo the answer", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { open, state } = stubLineSource(false);
            const reader = new PromptLineReader(open);
            return { reader, output, written, state };
        },
        async ACT({ reader, output, state }) {
            const answer = reader.read("Pick one: ", output);
            state.pending!("1");
            const line = await answer;
            await reader.dispose();
            return line;
        },
        ASSERT(_answer, { written }) {
            Assert.deepStrictEqual(written, ["Pick one: ", "\n"]);
        }
    });

    test("keeps the owner at line start without duplicating an echoed line break", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { open, state } = stubLineSource(true);
            const reader = new PromptLineReader(open);
            return { reader, output, written, state };
        },
        async ACT({ reader, output, state }) {
            const answer = reader.read("Pick one: ", output);
            state.pending!("1");
            const line = await answer;
            await reader.dispose();
            return line;
        },
        ASSERT(_answer, { written }) {
            Assert.deepStrictEqual(written, ["Pick one: ", "\r"]);
        }
    });

    test("opens the line source once across consecutive reads", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, state };
        },
        async ACT({ reader, output, state }) {
            const first = reader.read("first: ", output);
            state.pending!("a");
            await first;
            const second = reader.read("second: ", output);
            state.pending!("b");
            await second;
            await reader.dispose();
            return state.opens;
        },
        ASSERT(opens) {
            Assert.strictEqual(opens, 1);
        }
    });

    test("cancel rejects the read in flight as an abort", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output };
        },
        async ACT({ reader, output }) {
            const outcome = await monad(() => {
                const answer = reader.read("Pick one: ", output);
                reader.cancel();
                return answer;
            });
            await reader.dispose();
            return outcome;
        },
        ASSERT(result) {
            result.should.error(isAbortError);
        }
    });

    test("a line delivered after cancellation is dropped", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, state };
        },
        async ACT({ reader, output, state }) {
            const outcome = await monad(() => {
                const answer = reader.read("Pick one: ", output);
                reader.cancel();
                state.pending!("late answer");
                return answer;
            });
            await reader.dispose();
            return outcome;
        },
        ASSERT(result) {
            result.should.error(isAbortError);
        }
    });

    test("cancel after a read settled leaves the answer standing", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, state };
        },
        async ACT({ reader, output, state }) {
            const answer = reader.read("Pick one: ", output);
            state.pending!("3");
            reader.cancel();
            const line = await answer;
            await reader.dispose();
            return line;
        },
        ASSERT(answer) {
            Assert.strictEqual(answer, "3");
        }
    });

    test("dispose closes the opened line source", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, state };
        },
        async ACT({ reader, output, state }) {
            const answer = reader.read("Pick one: ", output);
            state.pending!("1");
            await answer;
            await reader.dispose();
            return state.closes;
        },
        ASSERT(closes) {
            Assert.strictEqual(closes, 1);
        }
    });

    test("dispose without any read closes nothing", {
        ARRANGE() {
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, state };
        },
        async ACT({ reader }) {
            await reader.dispose();
        },
        ASSERTS: {
            "no line source was opened"(_result, { state }) {
                Assert.strictEqual(state.opens, 0);
            },
            "no line source was closed"(_result, { state }) {
                Assert.strictEqual(state.closes, 0);
            }
        }
    });

    test("dispose releases the read in flight", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output };
        },
        async ACT({ reader, output }) {
            return await monad(async () => {
                const answer = reader.read("Pick one: ", output);
                await reader.dispose();
                return await answer;
            });
        },
        ASSERT(result) {
            result.should.error(isAbortError);
        }
    });

    test("dispose closes the line source only after the reads in flight have settled", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, state };
        },
        async ACT({ reader, output, state }) {
            const answer = reader.read("Pick one: ", output);
            answer.catch(() => { state.order.push("read settled"); });
            await reader.dispose();
            return state.order;
        },
        ASSERT(order) {
            Assert.deepStrictEqual(order, ["read settled", "close"]);
        }
    });

    test("a read requested after dispose is refused without reopening a source", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, written, state };
        },
        async ACT({ reader, output }) {
            await reader.dispose();
            return await monad(() => reader.read("Pick one: ", output));
        },
        ASSERTS: {
            "the read is refused as an abort"(result) {
                result.should.error(isAbortError);
            },
            "no line source is opened"(_result, { state }) {
                Assert.strictEqual(state.opens, 0);
            },
            "no prompt reaches the output channel"(_result, { written }) {
                Assert.deepStrictEqual(written, []);
            }
        }
    });

    test("dispose is idempotent", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, state };
        },
        async ACT({ reader, output, state }) {
            const answer = reader.read("Pick one: ", output);
            state.pending!("1");
            await answer;
            await reader.dispose();
            await reader.dispose();
            return state.closes;
        },
        ASSERT(closes) {
            Assert.strictEqual(closes, 1);
        }
    });

    test("cancel with no read in flight is a no-op", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, state };
        },
        async ACT({ reader, output, state }) {
            const first = reader.read("Pick one: ", output);
            state.pending!("1");
            await first;
            reader.cancel();
            const second = reader.read("Again: ", output);
            state.pending!("2");
            const line = await second;
            await reader.dispose();
            return line;
        },
        ASSERT(answer) {
            Assert.strictEqual(answer, "2");
        }
    });

    test("a cancelled read's late line cannot settle the read that followed it", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, state };
        },
        async ACT({ reader, output, state }) {
            const cancelled = reader.read("first: ", output);
            const lateLine = state.pending!;
            reader.cancel();
            const cancelledOutcome = await monad(() => cancelled);
            const second = reader.read("second: ", output);
            lateLine("answer meant for the cancelled read");
            state.pending!("answer for the second read");
            const outcome = { cancelledOutcome, second: await second };
            await reader.dispose();
            return outcome;
        },
        ASSERTS: {
            "the cancelled read stays aborted"({ cancelledOutcome }) {
                cancelledOutcome.should.error(isAbortError);
            },
            "the following read resolves with its own answer"({ second }) {
                Assert.strictEqual(second, "answer for the second read");
            }
        }
    });

    test("a prompt the output channel refuses fails the read and still lets disposal finish", {
        ARRANGE() {
            const failure = new Error("output channel failed");
            const output:OutputContext = {
                write() { throw failure; },
                writeError() {},
                columns() { return 80; },
                rows() { return 24; },
                onResize() { return () => {}; }
            };
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, failure, state };
        },
        async ACT({ reader, output }) {
            const outcome = await monad(() => reader.read("Pick one: ", output));
            await reader.dispose();
            return outcome;
        },
        ASSERT(outcome, { failure }) {
            outcome.should.error(failure);
        }
    });

    test("a line source that cannot be opened fails the read and still lets disposal finish", {
        ARRANGE() {
            const { output } = recordingOutput();
            const failure = new Error("no input available");
            const reader = new PromptLineReader(() => { throw failure; });
            return { reader, output, failure };
        },
        async ACT({ reader, output }) {
            const outcome = await monad(() => reader.read("Pick one: ", output));
            await reader.dispose();
            return outcome;
        },
        ASSERT(outcome, { failure }) {
            outcome.should.error(failure);
        }
    });

    test("a line source that refuses to be asked fails the read and is still closed on disposal", {
        ARRANGE() {
            const { output } = recordingOutput();
            const failure = new Error("cannot read a line");
            const state = { closes: 0 };
            const reader = new PromptLineReader(() => ({
                echoesInput: false,
                ask() { throw failure; },
                close() { state.closes++; }
            }));
            return { reader, output, failure, state };
        },
        async ACT({ reader, output }) {
            const outcome = await monad(() => reader.read("Pick one: ", output));
            await reader.dispose();
            return outcome;
        },
        ASSERTS: {
            "the read fails with the source's error"(outcome, { failure }) {
                outcome.should.error(failure);
            },
            "disposal still closes the opened source"(_outcome, { state }) {
                Assert.strictEqual(state.closes, 1);
            }
        }
    });

    test("an output channel that refuses the closing line break fails the read rather than leaving it pending", {
        ARRANGE() {
            const failure = new Error("output channel failed mid-answer");
            const written:string[] = [];
            const output:OutputContext = {
                write(text) {
                    if (written.length > 0) {
                        throw failure;
                    }
                    written.push(text);
                },
                writeError() {},
                columns() { return 80; },
                rows() { return 24; },
                onResize() { return () => {}; }
            };
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            return { reader, output, failure, state };
        },
        async ACT({ reader, output, state }) {
            const outcome = await monad(() => {
                const answer = reader.read("Pick one: ", output);
                state.pending!("1");
                return answer;
            });
            await reader.dispose();
            return outcome;
        },
        ASSERTS: {
            "the read fails with the output channel's error"(outcome, { failure }) {
                outcome.should.error(failure);
            },
            "disposal still closes the opened source"(_outcome, { state }) {
                Assert.strictEqual(state.closes, 1);
            }
        }
    });

    test("a line source that answers and then throws keeps the answer it gave", {
        ARRANGE() {
            const { output } = recordingOutput();
            const state = { closes: 0 };
            const reader = new PromptLineReader(() => ({
                echoesInput: true,
                ask(onLine) {
                    onLine("1");
                    throw new Error("cannot read a line");
                },
                close() { state.closes++; }
            }));
            return { reader, output, state };
        },
        async ACT({ reader, output }) {
            const line = await reader.read("Pick one: ", output);
            await reader.dispose();
            return line;
        },
        ASSERT(line) {
            Assert.strictEqual(line, "1");
        }
    });

    test("a caller's signal that is already aborted refuses the read outright", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            const controller = new AbortController();
            controller.abort();
            return { reader, output, written, state, controller };
        },
        async ACT({ reader, output, controller }) {
            const outcome = await monad(() => reader.read("Pick one: ", output, controller.signal));
            await reader.dispose();
            return outcome;
        },
        ASSERTS: {
            "the read is refused as an abort"(outcome) {
                outcome.should.error(isAbortError);
            },
            "no prompt reaches the output channel"(_outcome, { written }) {
                Assert.deepStrictEqual(written, []);
            },
            "no line source is opened"(_outcome, { state }) {
                Assert.strictEqual(state.opens, 0);
            }
        }
    });

    test("a caller's signal aborted while the read waits rejects that read", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open } = stubLineSource();
            const reader = new PromptLineReader(open);
            const controller = new AbortController();
            return { reader, output, controller };
        },
        async ACT({ reader, output, controller }) {
            const outcome = await monad(() => {
                const answer = reader.read("Pick one: ", output, controller.signal);
                controller.abort();
                return answer;
            });
            await reader.dispose();
            return outcome;
        },
        ASSERT(outcome) {
            outcome.should.error(isAbortError);
        }
    });

    test("a read that answers before the caller aborts keeps its answer", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { open, state } = stubLineSource();
            const reader = new PromptLineReader(open);
            const controller = new AbortController();
            return { reader, output, state, controller };
        },
        async ACT({ reader, output, state, controller }) {
            const answer = reader.read("Pick one: ", output, controller.signal);
            state.pending!("2");
            const line = await answer;
            controller.abort();
            await reader.dispose();
            return line;
        },
        ASSERT(line) {
            Assert.strictEqual(line, "2");
        }
    });
});
