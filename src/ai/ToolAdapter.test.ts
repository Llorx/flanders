import * as Assert from "assert";

import test from "arrange-act-assert";

import type { ToolEvent, ToolAdapterInvokeArgs, ToolName } from "./ToolAdapter";

function exhaustiveSwitch(event:ToolEvent):string {
    switch (event.type) {
        case "output": return event.title;
        case "session": return event.id;
        case "error": return event.message;
        case "rate_limit": return String(event.waitUntilMs);
        case "done": return "done";
    }
}

test.describe("ToolAdapter types", test => {
    test("output event missing details fails to compile via satisfies", {
        ARRANGE() {
            // @ts-expect-error — output event missing required field "details"
            const _bad = { type: "output" as const, title: "Read", subtitle: "/foo" } satisfies ToolEvent;
            void _bad;
        },
        ACT() {},
        ASSERT() {
            Assert.ok(true);
        }
    });

    test("exhaustive switch over ToolEvent.type covers all five variants", {
        ARRANGE() {
            const events:readonly ToolEvent[] = [
                { type: "output", title: "Read", subtitle: "/foo", details: "bar" },
                { type: "session", id: "s1" },
                { type: "error", retryable: true, message: "fail" },
                { type: "rate_limit", waitUntilMs: 123 },
                { type: "done" }
            ];
            return { events };
        },
        ACT({ events }) {
            return events.map(exhaustiveSwitch);
        },
        ASSERTS: {
            "returns the expected value for each variant"(result) {
                Assert.deepStrictEqual(result, ["Read", "s1", "fail", "123", "done"]);
            }
        }
    });

    test("ToolName admits exactly claude, codex, and antigravity", {
        ARRANGE() {
            // Positive: each of the three closed-set names is assignable to ToolName.
            const tools = ["claude", "codex", "antigravity"] as const satisfies readonly ToolName[];
            // Negative: a name outside the closed set is not a ToolName, so the set stays closed.
            // @ts-expect-error — "cursor" is not one of the three permitted tool identities
            const _bad = "cursor" satisfies ToolName;
            void _bad;
            return { tools };
        },
        ACT({ tools }) {
            return tools;
        },
        ASSERTS: {
            "carries the three permitted tool names in order"(result) {
                Assert.deepStrictEqual(result, ["claude", "codex", "antigravity"]);
            }
        }
    });

    test("ToolAdapterInvokeArgs fresh variant accepts prompt, model, effort, abortSignal", {
        ARRANGE() {
            const args:ToolAdapterInvokeArgs = { prompt: "p", model: "m", effort: "e", abortSignal: AbortSignal.abort() };
            return { args };
        },
        ACT({ args }) {
            return args;
        },
        ASSERT(result) {
            Assert.strictEqual(result.prompt, "p");
        }
    });

    test("ToolAdapterInvokeArgs resume variant accepts resumeSessionId", {
        ARRANGE() {
            const args:ToolAdapterInvokeArgs = { prompt: "p", model: "m", effort: "e", abortSignal: AbortSignal.abort(), resumeSessionId: "r" };
            return { args };
        },
        ACT({ args }) {
            return args;
        },
        ASSERT(result) {
            Assert.strictEqual(result.resumeSessionId, "r");
        }
    });

    test("ToolAdapterInvokeArgs fresh variant accepts optional onUsage callback", {
        ARRANGE() {
            let captured:{ inputTokens:number; outputTokens:number }|null = null;
            const args:ToolAdapterInvokeArgs = {
                prompt: "p",
                model: "m",
                effort: "e",
                abortSignal: AbortSignal.abort(),
                onUsage(usage) { captured = usage; }
            };
            return { args, getCaptured() { return captured; } };
        },
        ACT({ args }) {
            args.onUsage?.({ inputTokens: 10, outputTokens: 20 });
            return args;
        },
        ASSERT(_result, { getCaptured }) {
            Assert.deepStrictEqual(getCaptured(), { inputTokens: 10, outputTokens: 20 });
        }
    });

});
