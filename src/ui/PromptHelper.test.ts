import * as Assert from "assert";

import test, { monad } from "arrange-act-assert";

import { abortError, isAbortError, isInputReleasedError } from "../abortError";
import type { AskChoiceOptions, AskContext } from "../contexts";
import { askChoice, askMultiChoice, askText, tryAskChoice } from "./PromptHelper";
import { recordingOutput } from "./recordingOutput.fixtures";

test.describe("askChoice", test => {
    test("returns the picked option with exact label and description", {
        ARRANGE() {
            const expected = { label: "option-a", description: "First option" };
            const ask:AskContext = {
                askChoices() {
                    return Promise.resolve([{ picked: [expected] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, expected };
        },
        async ACT({ ask }) {
            return await askChoice(ask, {
                header: "Test header",
                question: "Pick one?",
                options: [
                    { label: "option-a", description: "First option" },
                    { label: "option-b", description: "Second option" }
                ]
            });
        },
        ASSERTS: {
            "label matches exactly"(result, { expected }) {
                Assert.strictEqual(result.label, expected.label);
            },
            "description matches exactly"(result, { expected }) {
                Assert.strictEqual(result.description, expected.description);
            }
        }
    });

    test("throws AbortError when askChoices returns empty picked array", {
        ARRANGE() {
            const ask:AskContext = {
                askChoices() {
                    return Promise.resolve([{ picked: [] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask };
        },
        async ACT({ ask }) {
            return await monad(async () => await askChoice(ask, {
                header: "Test",
                question: "Pick one?",
                options: [{ label: "a" }]
            }));
        },
        ASSERTS: {
            "rejects with an Error"(res) {
                res.should.error(Error);
            },
            "rejects with the AbortError name"(res) {
                res.should.error({ name: "AbortError" });
            }
        }
    });

    test("throws AbortError when askChoices returns no answer", {
        ARRANGE() {
            const ask:AskContext = {
                askChoices() {
                    return Promise.resolve([]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask };
        },
        async ACT({ ask }) {
            return await monad(async () => await askChoice(ask, {
                header: "Test",
                question: "Pick one?",
                options: [{ label: "a" }]
            }));
        },
        ASSERTS: {
            "rejects with an Error"(res) {
                res.should.error(Error);
            },
            "rejects with the AbortError name"(res) {
                res.should.error({ name: "AbortError" });
            }
        }
    });

    test("passes defaultIndex equal to the index of the option whose label matches defaultLabel", {
        ARRANGE() {
            let captured:readonly AskChoiceOptions[]|null = null;
            const ask:AskContext = {
                askChoices(questions) {
                    captured = questions;
                    return Promise.resolve([{ picked: [{ label: "option-b" }] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, getCaptured: () => captured };
        },
        async ACT({ ask }) {
            return await askChoice(ask, {
                header: "Test header",
                question: "Pick one?",
                options: [
                    { label: "option-a" },
                    { label: "option-b" },
                    { label: "option-c" }
                ],
                defaultLabel: "option-b"
            });
        },
        ASSERT(_result, { getCaptured }) {
            Assert.strictEqual(getCaptured()![0]!.defaultIndex, 1);
        }
    });

    test("passes defaultIndex undefined when no defaultLabel is supplied", {
        ARRANGE() {
            let captured:readonly AskChoiceOptions[]|null = null;
            const ask:AskContext = {
                askChoices(questions) {
                    captured = questions;
                    return Promise.resolve([{ picked: [{ label: "option-a" }] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, getCaptured: () => captured };
        },
        async ACT({ ask }) {
            return await askChoice(ask, {
                header: "Test header",
                question: "Pick one?",
                options: [
                    { label: "option-a" },
                    { label: "option-b" }
                ]
            });
        },
        ASSERT(_result, { getCaptured }) {
            Assert.strictEqual(getCaptured()![0]!.defaultIndex, undefined);
        }
    });

    test("passes defaultIndex undefined when defaultLabel matches no option", {
        ARRANGE() {
            let captured:readonly AskChoiceOptions[]|null = null;
            const ask:AskContext = {
                askChoices(questions) {
                    captured = questions;
                    return Promise.resolve([{ picked: [{ label: "option-a" }] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, getCaptured: () => captured };
        },
        async ACT({ ask }) {
            return await askChoice(ask, {
                header: "Test header",
                question: "Pick one?",
                options: [
                    { label: "option-a" },
                    { label: "option-b" }
                ],
                defaultLabel: "no-such-label"
            });
        },
        ASSERT(_result, { getCaptured }) {
            Assert.strictEqual(getCaptured()![0]!.defaultIndex, undefined);
        }
    });

    test("a signal aborted while the answer is in flight is refused instead of returned", {
        ARRANGE() {
            const controller = new AbortController();
            const ask:AskContext = {
                askChoices() {
                    return Promise.resolve([{ picked: [{ label: "a" }] }]).then(answers => {
                        controller.abort();
                        return answers;
                    });
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, controller };
        },
        async ACT({ ask, controller }) {
            return await monad(() => askChoice(ask, {
                header: "Test",
                question: "Pick one?",
                options: [{ label: "a" }]
            }, undefined, controller.signal));
        },
        ASSERT(result) {
            result.should.error(isAbortError);
        }
    });

    test("a cancelled prompt is never reported as the user's own cancellation", {
        ARRANGE() {
            const controller = new AbortController();
            const ask:AskContext = {
                askChoices() {
                    controller.abort();
                    return Promise.resolve([{ picked: [{ label: "a" }] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, controller };
        },
        async ACT({ ask, controller }) {
            return await monad(() => askChoice(ask, {
                header: "Test",
                question: "Pick one?",
                options: [{ label: "a" }]
            }, undefined, controller.signal));
        },
        ASSERT(result) {
            result.should.error(e => isAbortError(e) && !isInputReleasedError(e));
        }
    });
});

test.describe("tryAskChoice", test => {
    // Aborts on the `picked` read, which askChoice performs after its own post-await recheck, so the
    // abort lands in the window between the prompt resolving and the wrapper resuming.
    function abortingOnAnswerRead(controller:AbortController):AskContext {
        const picked = [{ label: "alpha" }];
        return {
            askChoices() {
                return Promise.resolve([{
                    get picked() {
                        controller.abort();
                        return picked;
                    }
                }]);
            },
            askText() { return Promise.resolve(""); }
        };
    }
    const ARGS = { header: "Test", question: "Pick one?", options: [{ label: "alpha" }] };

    test("an abort landing after the prompt resolved yields no choice and no cancellation diagnostic", {
        ARRANGE() {
            const controller = new AbortController();
            const { output, errors } = recordingOutput();
            return { ask: abortingOnAnswerRead(controller), controller, output, errors };
        },
        async ACT({ ask, controller, output }) {
            return await tryAskChoice(ask, ARGS, output, controller.signal);
        },
        ASSERTS: {
            "no option is handed back"(result) {
                Assert.strictEqual(result, null);
            },
            "the cancellation the caller itself caused is not reported to the user"(_result, { errors }) {
                Assert.deepStrictEqual(errors, []);
            }
        }
    });

    test("the user releasing the input is reported with the shared cancellation diagnostic", {
        ARRANGE() {
            const { output, errors } = recordingOutput();
            const ask:AskContext = {
                askChoices() { return Promise.reject(abortError({ inputReleased: true })); },
                askText() { return Promise.resolve(""); }
            };
            return { ask, output, errors };
        },
        async ACT({ ask, output }) {
            const controller = new AbortController();
            const picked = await tryAskChoice(ask, ARGS, output, controller.signal);
            controller.abort();
            return picked;
        },
        ASSERTS: {
            "no option is handed back"(result) {
                Assert.strictEqual(result, null);
            },
            "the diagnostic reaches the supplied channel"(_result, { errors }) {
                Assert.deepStrictEqual(errors, ["Prompt cancelled, neighbor.\n"]);
            }
        }
    });
});

test.describe("askMultiChoice", test => {
    test("returns the full picked subset the user selected", {
        ARRANGE() {
            // The user picks both options but in a different order than they are
            // displayed; the helper must return that picked array verbatim — not the
            // options list (which is in a different order) and not just the first entry.
            const picked = [
                { label: "codex", description: "Codex CLI" },
                { label: "claude", description: "Claude Code" }
            ];
            const ask:AskContext = {
                askChoices() {
                    return Promise.resolve([{ picked }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, picked };
        },
        async ACT({ ask }) {
            return await askMultiChoice(ask, {
                header: "Test header",
                question: "Pick one or more?",
                options: [
                    { label: "claude", description: "Claude Code" },
                    { label: "codex", description: "Codex CLI" }
                ]
            });
        },
        ASSERT(result, { picked }) {
            Assert.deepStrictEqual(result, picked);
        }
    });

    test("renders the question through askChoices with multiSelect true", {
        ARRANGE() {
            let captured:readonly AskChoiceOptions[]|null = null;
            const ask:AskContext = {
                askChoices(questions) {
                    captured = questions;
                    return Promise.resolve([{ picked: [{ label: "claude" }] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, getCaptured: () => captured };
        },
        async ACT({ ask }) {
            return await askMultiChoice(ask, {
                header: "Test header",
                question: "Pick one or more?",
                options: [
                    { label: "claude" },
                    { label: "codex" }
                ]
            });
        },
        ASSERT(_result, { getCaptured }) {
            Assert.strictEqual(getCaptured()![0]!.multiSelect, true);
        }
    });

    test("throws AbortError when askChoices returns an empty picked array", {
        ARRANGE() {
            const ask:AskContext = {
                askChoices() {
                    return Promise.resolve([{ picked: [] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask };
        },
        async ACT({ ask }) {
            return await monad(async () => await askMultiChoice(ask, {
                header: "Test",
                question: "Pick one or more?",
                options: [{ label: "claude" }, { label: "codex" }]
            }));
        },
        ASSERTS: {
            "rejects with an Error"(res) {
                res.should.error(Error);
            },
            "rejects with the AbortError name"(res) {
                res.should.error({ name: "AbortError" });
            }
        }
    });

    test("throws AbortError when askChoices returns no answer", {
        ARRANGE() {
            const ask:AskContext = {
                askChoices() {
                    return Promise.resolve([]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask };
        },
        async ACT({ ask }) {
            return await monad(async () => await askMultiChoice(ask, {
                header: "Test",
                question: "Pick one or more?",
                options: [{ label: "claude" }, { label: "codex" }]
            }));
        },
        ASSERTS: {
            "rejects with an Error"(res) {
                res.should.error(Error);
            },
            "rejects with the AbortError name"(res) {
                res.should.error({ name: "AbortError" });
            }
        }
    });

    test("seeds defaultIndexes from the pre-selected subset, preserving option order", {
        ARRANGE() {
            let captured:readonly AskChoiceOptions[]|null = null;
            const ask:AskContext = {
                askChoices(questions) {
                    captured = questions;
                    return Promise.resolve([{ picked: [{ label: "claude" }] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, getCaptured: () => captured };
        },
        async ACT({ ask }) {
            return await askMultiChoice(ask, {
                header: "Test header",
                question: "Pick one or more?",
                options: [
                    { label: "codex" },
                    { label: "claude" }
                ],
                selected: [{ label: "claude" }, { label: "codex" }]
            });
        },
        ASSERT(_result, { getCaptured }) {
            // Both options are pre-selected, but in the reverse of their display order
            // (claude then codex, while the options list is codex then claude). The
            // seeded indexes [0, 1] are in option order — emitting in selection order
            // would give [1, 0] — proving multiple matches come out in option order.
            Assert.deepStrictEqual(getCaptured()![0]!.defaultIndexes, [0, 1]);
        }
    });

    test("passes defaultIndexes undefined when no pre-selection is supplied", {
        ARRANGE() {
            let captured:readonly AskChoiceOptions[]|null = null;
            const ask:AskContext = {
                askChoices(questions) {
                    captured = questions;
                    return Promise.resolve([{ picked: [{ label: "claude" }] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, getCaptured: () => captured };
        },
        async ACT({ ask }) {
            return await askMultiChoice(ask, {
                header: "Test header",
                question: "Pick one or more?",
                options: [
                    { label: "claude" },
                    { label: "codex" }
                ]
            });
        },
        ASSERT(_result, { getCaptured }) {
            Assert.strictEqual(getCaptured()![0]!.defaultIndexes, undefined);
        }
    });

    test("ignores a pre-selected entry whose label matches no option", {
        ARRANGE() {
            let captured:readonly AskChoiceOptions[]|null = null;
            const ask:AskContext = {
                askChoices(questions) {
                    captured = questions;
                    return Promise.resolve([{ picked: [{ label: "codex" }] }]);
                },
                askText() { return Promise.resolve(""); }
            };
            return { ask, getCaptured: () => captured };
        },
        async ACT({ ask }) {
            return await askMultiChoice(ask, {
                header: "Test header",
                question: "Pick one or more?",
                options: [
                    { label: "claude" },
                    { label: "codex" }
                ],
                selected: [{ label: "codex" }, { label: "no-such-tool" }]
            });
        },
        ASSERT(_result, { getCaptured }) {
            Assert.deepStrictEqual(getCaptured()![0]!.defaultIndexes, [1]);
        }
    });
});

test.describe("askText", test => {
    test("returns the user's verbatim typed string with no trimming", {
        ARRANGE() {
            const ask:AskContext = {
                askChoices() { return Promise.resolve([]); },
                askText() { return Promise.resolve("  hello world  "); }
            };
            return { ask };
        },
        async ACT({ ask }) {
            return await askText(ask, { question: "Enter value" });
        },
        ASSERT(result) {
            Assert.strictEqual(result, "  hello world  ");
        }
    });

    test("returns the literal empty string when the user presses Enter without typing", {
        ARRANGE() {
            const ask:AskContext = {
                askChoices() { return Promise.resolve([]); },
                askText() { return Promise.resolve(""); }
            };
            return { ask };
        },
        async ACT({ ask }) {
            return await askText(ask, { question: "Enter value" });
        },
        ASSERT(result) {
            Assert.strictEqual(result, "");
        }
    });

    test("throws AbortError when user aborts via Ctrl+C", {
        ARRANGE() {
            const ask:AskContext = {
                askChoices() { return Promise.resolve([]); },
                askText() { return Promise.reject(new Error("readline closed")); }
            };
            return { ask };
        },
        async ACT({ ask }) {
            return await monad(async () => await askText(ask, { question: "Enter value" }));
        },
        ASSERTS: {
            "rejects with an Error"(res) {
                res.should.error(Error);
            },
            "rejects with the AbortError name"(res) {
                res.should.error({ name: "AbortError" });
            }
        }
    });

    test("includes placeholder in the prompt when provided", {
        ARRANGE() {
            let capturedPrompt = "";
            const ask:AskContext = {
                askChoices() { return Promise.resolve([]); },
                askText(prompt) { capturedPrompt = prompt; return Promise.resolve("user-input"); }
            };
            return { ask, getCapturedPrompt: () => capturedPrompt };
        },
        async ACT({ ask }) {
            return await askText(ask, { question: "Enter model", placeholder: "leave empty for default" });
        },
        ASSERTS: {
            "returns the user's input"(result) {
                Assert.strictEqual(result, "user-input");
            },
            "prompt includes question and placeholder"(_result, { getCapturedPrompt }) {
                Assert.strictEqual(getCapturedPrompt(), "Enter model (leave empty for default): ");
            }
        }
    });

    test("returns the supplied default when the read yields the empty string", {
        ARRANGE() {
            const ask:AskContext = {
                askChoices() { return Promise.resolve([]); },
                askText() { return Promise.resolve(""); }
            };
            return { ask };
        },
        async ACT({ ask }) {
            return await askText(ask, { question: "Enter value", default: "stored-default" });
        },
        ASSERT(result) {
            Assert.strictEqual(result, "stored-default");
        }
    });

    test("returns the typed value verbatim, not the default, when the read is non-empty", {
        ARRANGE() {
            const ask:AskContext = {
                askChoices() { return Promise.resolve([]); },
                askText() { return Promise.resolve("  typed value  "); }
            };
            return { ask };
        },
        async ACT({ ask }) {
            return await askText(ask, { question: "Enter value", default: "stored-default" });
        },
        ASSERT(result) {
            Assert.strictEqual(result, "  typed value  ");
        }
    });
});
