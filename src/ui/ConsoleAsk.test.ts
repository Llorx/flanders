import * as Assert from "assert";

import test, { monad } from "arrange-act-assert";

import { isAbortError } from "../abortError";
import type { AskChoiceOptions, OutputContext } from "../contexts";
import { ConsoleAsk } from "./ConsoleAsk";
import type { LineReader } from "./ConsoleAsk";
import { recordingOutput } from "./recordingOutput.fixtures";

function scriptedReader(lines:readonly string[]) {
    const prompts:string[] = [];
    let next = 0;
    const reader:LineReader = {
        read(prompt:string, _out:OutputContext):Promise<string> {
            prompts.push(prompt);
            if (next >= lines.length) {
                return Promise.reject(new Error(`unscripted read: ${prompt}`));
            }
            return Promise.resolve(lines[next++]!);
        }
    };
    return { reader, prompts };
}

function question(fields:Partial<AskChoiceOptions>):AskChoiceOptions {
    return {
        header: "Header",
        question: "Which one?",
        options: [{ label: "alpha" }, { label: "beta" }],
        multiSelect: false,
        ...fields
    };
}

test.describe("ConsoleAsk askChoices", test => {
    test("returns the option the typed number selects", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { reader } = scriptedReader(["2"]);
            return { ask: new ConsoleAsk(reader, output) };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({})]);
        },
        ASSERT(answers) {
            Assert.deepStrictEqual(answers, [{ picked: [{ label: "beta" }] }]);
        }
    });

    test("renders the question, its options and the input prompt through the supplied channel", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { reader, prompts } = scriptedReader(["1"]);
            return { ask: new ConsoleAsk(reader, output), written, prompts, output };
        },
        async ACT({ ask, output }) {
            return await ask.askChoices([question({ options: [{ label: "alpha", description: "the first" }, { label: "beta" }] })], output);
        },
        ASSERTS: {
            "the header and question share one line"(_answers, { written }) {
                Assert.strictEqual(written[0], "\n[?] Header: Which one?\n");
            },
            "an option with a description shows it"(_answers, { written }) {
                Assert.strictEqual(written[1], "    1) alpha — the first\n");
            },
            "an option without a description shows the label alone"(_answers, { written }) {
                Assert.strictEqual(written[2], "    2) beta\n");
            },
            "the input prompt is handed to the reader"(_answers, { prompts }) {
                Assert.deepStrictEqual(prompts, ["Pick [1-2; free-text OK]: "]);
            }
        }
    });

    test("renders a question with no header without the separator", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { reader } = scriptedReader(["1"]);
            return { ask: new ConsoleAsk(reader, output), written };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({ header: "" })]);
        },
        ASSERT(_answers, { written }) {
            Assert.strictEqual(written[0], "\n[?] Which one?\n");
        }
    });

    test("marks the default entry and offers Enter for it", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { reader, prompts } = scriptedReader([""]);
            return { ask: new ConsoleAsk(reader, output), written, prompts };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({ defaultIndex: 1 })]);
        },
        ASSERTS: {
            "an empty line accepts the default entry"(answers) {
                Assert.deepStrictEqual(answers, [{ picked: [{ label: "beta" }] }]);
            },
            "the default entry is marked in the list"(_answers, { written }) {
                Assert.strictEqual(written[2], "    2) beta (default — press Enter)\n");
            },
            "the prompt advertises the default"(_answers, { prompts }) {
                Assert.strictEqual(prompts[0], "Pick [1-2; free-text OK], Enter for the default: ");
            }
        }
    });

    test("keeps free-form text as the answer's extra", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { reader } = scriptedReader(["something else"]);
            return { ask: new ConsoleAsk(reader, output) };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({})]);
        },
        ASSERT(answers) {
            Assert.deepStrictEqual(answers, [{ picked: [], extra: "something else" }]);
        }
    });

    test("keeps trailing text typed after a number as the answer's extra", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { reader } = scriptedReader(["1 with a note"]);
            return { ask: new ConsoleAsk(reader, output) };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({})]);
        },
        ASSERT(answers) {
            Assert.deepStrictEqual(answers, [{ picked: [{ label: "alpha" }], extra: "with a note" }]);
        }
    });

    test("re-asks after an out-of-range number and reports it", {
        ARRANGE() {
            const { output, errors } = recordingOutput();
            const { reader, prompts } = scriptedReader(["9", "1"]);
            return { ask: new ConsoleAsk(reader, output), errors, prompts };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({})]);
        },
        ASSERTS: {
            "the retry answer is the one returned"(answers) {
                Assert.deepStrictEqual(answers, [{ picked: [{ label: "alpha" }] }]);
            },
            "the rejection is reported"(_answers, { errors }) {
                Assert.deepStrictEqual(errors, ["Invalid input. Pick a valid option number, type free-form text, or use '-' / '+' to navigate.\n"]);
            },
            "the question is asked again"(_answers, { prompts }) {
                Assert.strictEqual(prompts.length, 2);
            }
        }
    });

    test("re-asks after a whitespace-only answer", {
        ARRANGE() {
            const { output, errors } = recordingOutput();
            const { reader } = scriptedReader(["   ", "1"]);
            return { ask: new ConsoleAsk(reader, output), errors };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({})]);
        },
        ASSERT(_answers, { errors }) {
            Assert.strictEqual(errors.length, 1);
        }
    });

    test("multi-select accepts a comma-separated list and drops repeats", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { reader, prompts } = scriptedReader(["2,1,2"]);
            return { ask: new ConsoleAsk(reader, output), prompts };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({ multiSelect: true })]);
        },
        ASSERTS: {
            "each distinct pick appears once, in the typed order"(answers) {
                Assert.deepStrictEqual(answers, [{ picked: [{ label: "beta" }, { label: "alpha" }] }]);
            },
            "the prompt advertises the comma-separated form"(_answers, { prompts }) {
                Assert.strictEqual(prompts[0], "Pick [1-2, comma-separated; free-text OK]: ");
            }
        }
    });

    test("multi-select pre-selects the supplied indexes and keeps them on an empty line", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { reader, prompts } = scriptedReader([""]);
            return { ask: new ConsoleAsk(reader, output), written, prompts };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({ multiSelect: true, defaultIndexes: [1] })]);
        },
        ASSERTS: {
            "the pre-selected entries are the answer"(answers) {
                Assert.deepStrictEqual(answers, [{ picked: [{ label: "beta" }] }]);
            },
            "the pre-selected entry is marked in the list"(_answers, { written }) {
                Assert.strictEqual(written[2], "  * 2) beta\n");
            },
            "the current selection is summarized"(_answers, { written }) {
                Assert.strictEqual(written[3], "  current: beta\n");
            },
            "the prompt advertises the pre-selection"(_answers, { prompts }) {
                Assert.strictEqual(prompts[0], "Pick [1-2, comma-separated; free-text OK], Enter for the default: ");
            }
        }
    });

    test("numbers each question of a multi-question run and offers navigation", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { reader, prompts } = scriptedReader(["1", "2"]);
            return { ask: new ConsoleAsk(reader, output), written, prompts };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({}), question({ question: "And which one?" })]);
        },
        ASSERTS: {
            "both answers are returned in order"(answers) {
                Assert.deepStrictEqual(answers, [{ picked: [{ label: "alpha" }] }, { picked: [{ label: "beta" }] }]);
            },
            "the first question carries its position"(_answers, { written }) {
                Assert.strictEqual(written[0], "\n[?] (1/2) Header: Which one?\n");
            },
            "the second question offers going back"(_answers, { prompts }) {
                Assert.strictEqual(prompts[1], "Pick [1-2; free-text OK], '-' back: ");
            }
        }
    });

    test("'-' returns to the previous question, which shows its recorded answer", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { reader, prompts } = scriptedReader(["1", "-", "2", "1"]);
            return { ask: new ConsoleAsk(reader, output), written, prompts };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({}), question({})]);
        },
        ASSERTS: {
            "the re-answered first question wins"(answers) {
                Assert.deepStrictEqual(answers[0], { picked: [{ label: "beta" }] });
            },
            "the revisited question summarizes the recorded answer"(_answers, { written }) {
                Assert.ok(written.includes("  current: alpha\n"), `expected a current-answer summary, got ${JSON.stringify(written)}`);
            },
            "the revisited question offers moving on"(_answers, { prompts }) {
                Assert.strictEqual(prompts[2], "Pick [1-2; free-text OK], '+' next: ");
            }
        }
    });

    test("'-' on the first question reports there is nowhere to go back to", {
        ARRANGE() {
            const { output, errors } = recordingOutput();
            const { reader } = scriptedReader(["-", "1"]);
            return { ask: new ConsoleAsk(reader, output), errors };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({})]);
        },
        ASSERT(_answers, { errors }) {
            Assert.deepStrictEqual(errors, ["Already at the first question.\n"]);
        }
    });

    test("'+' moves on from an already-answered question", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { reader } = scriptedReader(["1", "-", "+", "2"]);
            return { ask: new ConsoleAsk(reader, output) };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({}), question({})]);
        },
        ASSERT(answers) {
            Assert.deepStrictEqual(answers, [{ picked: [{ label: "alpha" }] }, { picked: [{ label: "beta" }] }]);
        }
    });

    test("'+' on an unanswered question asks for an answer first", {
        ARRANGE() {
            const { output, errors } = recordingOutput();
            const { reader } = scriptedReader(["+", "1", "2"]);
            return { ask: new ConsoleAsk(reader, output), errors };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({}), question({})]);
        },
        ASSERT(_answers, { errors }) {
            Assert.deepStrictEqual(errors, ["Answer this question first, then use '+' to move on.\n"]);
        }
    });

    test("'+' on the last question asks the user to submit it", {
        ARRANGE() {
            const { output, errors } = recordingOutput();
            const { reader } = scriptedReader(["1", "+", ""]);
            return { ask: new ConsoleAsk(reader, output), errors };
        },
        async ACT({ ask }) {
            // The last question arrives pre-answered by its pre-selection, so '+' has an answer to
            // move on from and nowhere to move to.
            return await ask.askChoices([question({}), question({ multiSelect: true, defaultIndexes: [0] })]);
        },
        ASSERT(_answers, { errors }) {
            Assert.deepStrictEqual(errors, ["Already at the last question — submit it to finish.\n"]);
        }
    });

    test("a revisited free-text answer is summarized as its text", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { reader } = scriptedReader(["just text", "-", "1", "2"]);
            return { ask: new ConsoleAsk(reader, output), written };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({}), question({})]);
        },
        ASSERT(_answers, { written }) {
            Assert.ok(written.includes("  current: just text\n"), `expected the free text summarized, got ${JSON.stringify(written)}`);
        }
    });

    test("a revisited numbered answer with trailing text is summarized as both", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { reader } = scriptedReader(["1 and a note", "-", "1", "2"]);
            return { ask: new ConsoleAsk(reader, output), written };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({}), question({})]);
        },
        ASSERT(_answers, { written }) {
            Assert.ok(written.includes("  current: alpha: and a note\n"), `expected label and note summarized, got ${JSON.stringify(written)}`);
        }
    });

    test("hands the caller's cancellation signal to the reader", {
        ARRANGE() {
            const { output } = recordingOutput();
            const seen:Array<AbortSignal|undefined> = [];
            const reader:LineReader = {
                read(_prompt:string, _out:OutputContext, signal?:AbortSignal):Promise<string> {
                    seen.push(signal);
                    return Promise.resolve("1");
                }
            };
            const controller = new AbortController();
            return { ask: new ConsoleAsk(reader, output), seen, controller };
        },
        async ACT({ ask, controller }) {
            return await ask.askChoices([question({})], undefined, controller.signal);
        },
        ASSERT(_answers, { seen, controller }) {
            Assert.deepStrictEqual(seen, [controller.signal]);
        }
    });

    test("an already-aborted signal is refused before any prompt output is produced", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const reads:string[] = [];
            const reader:LineReader = {
                read(prompt:string) {
                    reads.push(prompt);
                    return Promise.resolve("1");
                }
            };
            const controller = new AbortController();
            controller.abort();
            return { ask: new ConsoleAsk(reader, output), written, reads, controller };
        },
        async ACT({ ask, controller }) {
            return await monad(() => ask.askChoices([question({})], undefined, controller.signal));
        },
        ASSERTS: {
            "the call is refused as an abort"(result) {
                result.should.error(isAbortError);
            },
            "neither the question nor its options reach the output"(_result, { written }) {
                Assert.deepStrictEqual(written, []);
            },
            "the reader is never asked for a line"(_result, { reads }) {
                Assert.deepStrictEqual(reads, []);
            }
        }
    });

    test("a signal aborted while the submitted line is in flight is refused instead of answered", {
        ARRANGE() {
            const { output } = recordingOutput();
            const controller = new AbortController();
            const reader:LineReader = {
                read() {
                    return Promise.resolve("1").then(line => {
                        controller.abort();
                        return line;
                    });
                }
            };
            return { ask: new ConsoleAsk(reader, output), controller };
        },
        async ACT({ ask, controller }) {
            return await monad(() => ask.askChoices([question({})], undefined, controller.signal));
        },
        ASSERT(result) {
            result.should.error(isAbortError);
        }
    });

    test("a read failure propagates instead of being reported as an answer", {
        ARRANGE() {
            const { output } = recordingOutput();
            const failure = new Error("input channel failed");
            const reader:LineReader = { read() { return Promise.reject(failure); } };
            return { ask: new ConsoleAsk(reader, output), failure };
        },
        async ACT({ ask }) {
            return await monad(() => ask.askChoices([question({})]));
        },
        ASSERT(result, { failure }) {
            result.should.error(failure);
        }
    });

    test("falls back to its own output channel when the caller supplies none", {
        ARRANGE() {
            const { output, written } = recordingOutput();
            const { reader } = scriptedReader(["1"]);
            return { ask: new ConsoleAsk(reader, output), written };
        },
        async ACT({ ask }) {
            return await ask.askChoices([question({})]);
        },
        ASSERT(_answers, { written }) {
            Assert.strictEqual(written[0], "\n[?] Header: Which one?\n");
        }
    });
});

test.describe("ConsoleAsk askText", test => {
    test("returns the line the user submits", {
        ARRANGE() {
            const { output } = recordingOutput();
            const { reader, prompts } = scriptedReader(["typed answer"]);
            return { ask: new ConsoleAsk(reader, output), prompts };
        },
        async ACT({ ask }) {
            return await ask.askText("Name: ");
        },
        ASSERTS: {
            "the answer is the submitted line"(answer) {
                Assert.strictEqual(answer, "typed answer");
            },
            "the prompt is handed to the reader verbatim"(_answer, { prompts }) {
                Assert.deepStrictEqual(prompts, ["Name: "]);
            }
        }
    });
});
