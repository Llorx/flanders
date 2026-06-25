import * as Assert from "assert";

import test from "arrange-act-assert";

import type { AskChoiceOptions, AskContext } from "../contexts";
import { askChoice, askMultiChoice, askText } from "./PromptHelper";

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
            try {
                await askChoice(ask, {
                    header: "Test",
                    question: "Pick one?",
                    options: [{ label: "a" }]
                });
                return null;
            } catch (e) {
                return e;
            }
        },
        ASSERT(result) {
            Assert.ok(result instanceof Error);
            Assert.strictEqual(result.name, "AbortError");
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
            try {
                await askChoice(ask, {
                    header: "Test",
                    question: "Pick one?",
                    options: [{ label: "a" }]
                });
                return null;
            } catch (e) {
                return e;
            }
        },
        ASSERT(result) {
            Assert.ok(result instanceof Error);
            Assert.strictEqual(result.name, "AbortError");
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
});

test.describe("askMultiChoice", test => {
    test("returns the full picked subset the user selected", {
        ARRANGE() {
            const picked = [
                { label: "claude", description: "Claude Code" },
                { label: "antigravity", description: "Antigravity CLI" }
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
                    { label: "codex", description: "Codex CLI" },
                    { label: "antigravity", description: "Antigravity CLI" }
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
                    { label: "codex" },
                    { label: "antigravity" }
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
            try {
                await askMultiChoice(ask, {
                    header: "Test",
                    question: "Pick one or more?",
                    options: [{ label: "claude" }, { label: "codex" }]
                });
                return null;
            } catch (e) {
                return e;
            }
        },
        ASSERT(result) {
            Assert.ok(result instanceof Error);
            Assert.strictEqual(result.name, "AbortError");
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
            try {
                await askMultiChoice(ask, {
                    header: "Test",
                    question: "Pick one or more?",
                    options: [{ label: "claude" }, { label: "codex" }]
                });
                return null;
            } catch (e) {
                return e;
            }
        },
        ASSERT(result) {
            Assert.ok(result instanceof Error);
            Assert.strictEqual(result.name, "AbortError");
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
                    { label: "claude" },
                    { label: "codex" },
                    { label: "antigravity" }
                ],
                selected: [{ label: "antigravity" }, { label: "claude" }]
            });
        },
        ASSERT(_result, { getCaptured }) {
            Assert.deepStrictEqual(getCaptured()![0]!.defaultIndexes, [0, 2]);
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
            try {
                await askText(ask, { question: "Enter value" });
                return null;
            } catch (e) {
                return e;
            }
        },
        ASSERT(result) {
            Assert.ok(result instanceof Error);
            Assert.strictEqual(result.name, "AbortError");
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
