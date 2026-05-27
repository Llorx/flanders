import * as Assert from "assert";
import { readFileSync } from "fs";
import { resolve } from "path";

import test from "arrange-act-assert";

import type { AskContext } from "./contexts";
import { askChoice, askText } from "./PromptHelper";

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
});

test.describe("PromptHelper canonical usage", test => {
    test("askChoices is not called directly in any command file", {
        ARRANGE() {
            return {
                commandFiles: [
                    resolve(__dirname, "commands/Implement.js"),
                    resolve(__dirname, "commands/Install.js")
                ]
            };
        },
        ACT({ commandFiles }) {
            const matches:string[] = [];
            for (const file of commandFiles) {
                const content = readFileSync(file, "utf8");
                if (/\.askChoices\s*\(/.test(content)) {
                    matches.push(file);
                }
            }
            return matches;
        },
        ASSERT(matches) {
            Assert.strictEqual(matches.length, 0, `Command files that still call .askChoices() directly: ${matches.join(", ")}`);
        }
    });
});
