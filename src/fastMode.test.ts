import * as Assert from "assert";

import test from "arrange-act-assert";

import { modelSupportsFastMode } from "./fastMode";

test.describe("modelSupportsFastMode predicate boundaries", test => {
    test("returns true for each of the six fast-capable identifiers", {
        ARRANGE() {
            return { ids: ["opus", "opus[1m]", "claude-opus-4-8", "claude-opus-4-8[1m]", "claude-opus-4-7", "claude-opus-4-7[1m]"] };
        },
        ACT({ ids }) {
            return ids.map(modelSupportsFastMode);
        },
        ASSERT(results) {
            Assert.deepStrictEqual(results, [true, true, true, true, true, true]);
        }
    });

    test("returns false for every identifier outside the fast-capable set", {
        ARRANGE() {
            // Every non-fast `claude` catalog identifier (Opus 4.6 and its 1M variant, every Sonnet/
            // Haiku/Fable alias and pinned version and their 1M variants), plus the cross-family alias,
            // a custom-typed identifier, and the empty default-model string. A regression that marked
            // any one of these fast-capable flips its boolean and fails the exact deep-equal.
            return { ids: [
                "claude-opus-4-6",
                "claude-opus-4-6[1m]",
                "sonnet",
                "sonnet[1m]",
                "claude-sonnet-4-6",
                "claude-sonnet-4-6[1m]",
                "claude-sonnet-4-5",
                "claude-sonnet-4-5[1m]",
                "haiku",
                "claude-haiku-4-5-20251001",
                "fable",
                "claude-fable-5",
                "best",
                "my-private-opus",
                ""
            ] };
        },
        ACT({ ids }) {
            return ids.map(modelSupportsFastMode);
        },
        ASSERT(results) {
            Assert.deepStrictEqual(results, [
                false, false,
                false, false, false, false, false, false,
                false, false,
                false, false,
                false,
                false,
                false
            ]);
        }
    });
});
