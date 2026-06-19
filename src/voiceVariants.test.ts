import * as Assert from "assert";

import test from "arrange-act-assert";

import { workingPool, successPool, hardStopPool, interruptionPool, failurePool, tasksCompletedPool, allTasksCompletedPool, terminalPools, pickVariant } from "./voiceVariants";
import type { RandomContext } from "./contexts";

function randomContext(value:number):RandomContext {
    return {
        random() { return value; }
    };
}

// A float strictly below 1, used to exercise the upper boundary of random().
const JUST_BELOW_ONE = 1 - Number.EPSILON;

test.describe("voiceVariants pools", test => {
    test("workingPool", {
        ARRANGE() {
            return [
                "Workin'-diddly",
                "Toilin' away",
                "Okely-workin'",
                "Pluggin' away",
                "Diddly-doin'",
                "Beaverin' away",
                "Tinkerin'-diddly",
                "Hammerin' away",
                "Whittlin' away",
                "Doodly-doin'",
                "Scribblin'-diddly",
                "Codin'-aroo",
                "Buildin'-diddly",
                "Fixin'-diddly",
                "Noodlin' away",
                "Tappity-tappin'",
                "Diddly-dabblin'",
                "Plowin' ahead",
                "Chuggin' along",
                "Pressin' on-aroo",
                "Diligent-diddly",
                "Steady-diddly",
                "Crunchin'-diddly",
                "Diddly-developin'",
                "Wranglin' code",
                "Pokin' at it",
                "Diddly-debuggin'",
                "Cookin'-diddly",
                "Trundlin' along",
                "Diddly-draftin'",
                "Bustlin'-aroo",
                "Hummin' along",
                "Choppin'-diddly",
                "Sweatin'-diddly",
                "Diddly-deliverin'",
                "Craftin'-aroo",
                "Workin'-aroo",
                "Toilin'-diddly",
                "Diddly-drudgin'",
                "Gettin' it done",
                "Grindin'-diddly",
                "Diddly-graftin'",
                "Peggin' away",
                "Diddly-doodlin'",
                "Crankin'-diddly",
                "Hustlin'-diddly",
                "Diddly-diggin'",
                "Pluggin'-diddly",
                "Tappin' keys",
                "Dilly-workin'",
            ];
        },
        ACT() {
            return workingPool;
        },
        ASSERTS: {
            "contains the 50 working-label variants byte-for-byte in order"(pool, expected) {
                Assert.deepStrictEqual(pool, expected);
            },
            "has exactly 50 entries"(pool) {
                Assert.strictEqual(pool.length, 50);
            }
        }
    });

    test("successPool", {
        ARRANGE() {
            return [
                "Done-diddly",
                "Done-diddly-done",
                "All wrapped up, neighbor",
                "Okely-dokely — done",
                "Done-aroo",
                "Hi-diddly-done",
                "All done, neighborino",
                "Done and done-diddly",
                "That's a wrap, neighbor",
                "Mission accomplished-diddly",
            ];
        },
        ACT() {
            return successPool;
        },
        ASSERTS: {
            "contains the 10 success terminal-label variants byte-for-byte in order"(pool, expected) {
                Assert.deepStrictEqual(pool, expected);
            },
            "has exactly 10 entries"(pool) {
                Assert.strictEqual(pool.length, 10);
            }
        }
    });

    test("hardStopPool", {
        ARRANGE() {
            return [
                "Whoopsie, hard stop",
                "Dilly of a pickle — hard stop",
                "Hard stop, neighbor",
                "Hard stop-aroo",
                "Well, heck — hard stop",
                "Hard stop-diddly",
                "Fiddlesticks — hard stop",
                "Gotta call it — hard stop",
                "Pumpin' the brakes — hard stop",
                "Hard stop, neighborino",
            ];
        },
        ACT() {
            return hardStopPool;
        },
        ASSERTS: {
            "contains the 10 hard-stop terminal-label variants byte-for-byte in order"(pool, expected) {
                Assert.deepStrictEqual(pool, expected);
            },
            "has exactly 10 entries"(pool) {
                Assert.strictEqual(pool.length, 10);
            }
        }
    });

    test("interruptionPool", {
        ARRANGE() {
            return [
                "Interrupted-aroo",
                "Well, heck — interrupted",
                "Interrupted, neighbor",
                "Stopped short-diddly",
                "Cut off-aroo",
                "Hold the phone — interrupted",
                "Interrupted-diddly",
                "Toodle-oo — interrupted",
                "Interrupted, neighborino",
                "Halted-aroo",
            ];
        },
        ACT() {
            return interruptionPool;
        },
        ASSERTS: {
            "contains the 10 interruption terminal-label variants byte-for-byte in order"(pool, expected) {
                Assert.deepStrictEqual(pool, expected);
            },
            "has exactly 10 entries"(pool) {
                Assert.strictEqual(pool.length, 10);
            }
        }
    });

    test("failurePool", {
        ARRANGE() {
            return [
                "Aw, fiddlesticks — failed",
                "Dad-gummit — failed",
                "Failed, neighbor",
                "Failed-aroo",
                "Gosh-darn it — failed",
                "Heavens to Betsy — failed",
                "Failed-diddly",
                "Well, shucks — failed",
                "That's a no-go — failed",
                "Failed, neighborino",
            ];
        },
        ACT() {
            return failurePool;
        },
        ASSERTS: {
            "contains the 10 failure terminal-label variants byte-for-byte in order"(pool, expected) {
                Assert.deepStrictEqual(pool, expected);
            },
            "has exactly 10 entries"(pool) {
                Assert.strictEqual(pool.length, 10);
            }
        }
    });

    test("tasksCompletedPool", {
        ARRANGE() {
            return [
                "tasks completed — nothin' to do-diddly-do, neighbor!",
                "all done already, neighbor — okely-dokely!",
                "nothin' left to do here, neighbor!",
                "tasks completed — already shipshape, neighborino!",
                "nothin' to do-diddly-do — all set, neighbor!",
                "tasks completed — couldn't be tidier, neighbor!",
                "all squared away already — okely-dokely!",
                "nothin' doin' here — all done, neighbor!",
                "tasks completed — easy-peasy, neighborino!",
                "all wrapped up already, neighbor — toodle-oo!",
            ];
        },
        ACT() {
            return tasksCompletedPool;
        },
        ASSERTS: {
            "contains the 10 tasks-completed variants byte-for-byte in order"(pool, expected) {
                Assert.deepStrictEqual(pool, expected);
            },
            "has exactly 10 entries"(pool) {
                Assert.strictEqual(pool.length, 10);
            }
        }
    });

    test("allTasksCompletedPool", {
        ARRANGE() {
            return [
                "all tasks completed — okely-dokely-doo, neighbor!",
                "all tasks completed — hi-diddly-done, neighbor!",
                "every last task done-diddly-done, neighbor!",
                "all tasks completed — that's a wrap, neighborino!",
                "all tasks completed — mission accomplished-diddly!",
                "all tasks done and dusted, neighbor — okely-dokely!",
                "all tasks completed — nailed it-aroo, neighbor!",
                "every task done-diddly-done — toodle-oo, neighbor!",
                "all tasks completed — what a humdinger, neighbor!",
                "all tasks completed — done and done, neighborino!",
            ];
        },
        ACT() {
            return allTasksCompletedPool;
        },
        ASSERTS: {
            "contains the 10 all-tasks-completed variants byte-for-byte in order"(pool, expected) {
                Assert.deepStrictEqual(pool, expected);
            },
            "has exactly 10 entries"(pool) {
                Assert.strictEqual(pool.length, 10);
            }
        }
    });
});

test.describe("terminalPools", test => {
    test("maps each terminal outcome key to its pool", {
        ARRANGE() {
            return { successPool, hardStopPool, interruptionPool, failurePool };
        },
        ACT() {
            return terminalPools;
        },
        ASSERTS: {
            "maps Done to the success pool"(pools, { successPool }) {
                Assert.strictEqual(pools["Done"], successPool);
            },
            "maps Hard stop to the hard-stop pool"(pools, { hardStopPool }) {
                Assert.strictEqual(pools["Hard stop"], hardStopPool);
            },
            "maps Interrupted to the interruption pool"(pools, { interruptionPool }) {
                Assert.strictEqual(pools["Interrupted"], interruptionPool);
            },
            "maps Failed to the failure pool"(pools, { failurePool }) {
                Assert.strictEqual(pools["Failed"], failurePool);
            }
        }
    });
});

test.describe("pickVariant", test => {
    test("returns the entry the random context selects", {
        ARRANGE() {
            const pool = ["a", "b", "c", "d"];
            // 0.5 * 4 = 2, so index 2 is selected.
            const random = randomContext(0.5);
            return { pool, random };
        },
        ACT({ pool, random }) {
            return pickVariant(pool, random);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "c");
        }
    });

    test("returns the first entry at the lower boundary random() === 0", {
        ARRANGE() {
            const pool = ["a", "b", "c", "d"];
            const random = randomContext(0);
            return { pool, random };
        },
        ACT({ pool, random }) {
            return pickVariant(pool, random);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "a");
        }
    });

    test("returns the last entry at the upper boundary random() just below 1", {
        ARRANGE() {
            const pool = ["a", "b", "c", "d"];
            const random = randomContext(JUST_BELOW_ONE);
            return { pool, random };
        },
        ACT({ pool, random }) {
            return pickVariant(pool, random);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "d");
        }
    });

    test("with exclude set, selects from the remaining entries at the lower boundary", {
        ARRANGE() {
            const pool = ["a", "b", "c", "d"];
            // exclude "a" removes it; index 0 of the remaining ["b","c","d"] is "b".
            const random = randomContext(0);
            return { pool, random };
        },
        ACT({ pool, random }) {
            return pickVariant(pool, random, "a");
        },
        ASSERTS: {
            "does not return the excluded entry"(result) {
                Assert.notStrictEqual(result, "a");
            },
            "returns the first of the remaining entries"(result) {
                Assert.strictEqual(result, "b");
            }
        }
    });

    test("with exclude set, never returns the excluded entry at the upper boundary", {
        ARRANGE() {
            const pool = ["a", "b", "c", "d"];
            // exclude "a"; remaining is ["b","c","d"], last index is "d".
            const random = randomContext(JUST_BELOW_ONE);
            return { pool, random };
        },
        ACT({ pool, random }) {
            return pickVariant(pool, random, "a");
        },
        ASSERTS: {
            "does not return the excluded entry"(result) {
                Assert.notStrictEqual(result, "a");
            },
            "returns an entry drawn from the pool"(result, { pool }) {
                Assert.ok(pool.includes(result));
            },
            "returns the last of the remaining entries"(result) {
                Assert.strictEqual(result, "d");
            }
        }
    });

    test("with a single-entry pool, returns the sole entry even when it is excluded", {
        ARRANGE() {
            const pool = ["only"];
            const random = randomContext(JUST_BELOW_ONE);
            return { pool, random };
        },
        ACT({ pool, random }) {
            return pickVariant(pool, random, "only");
        },
        ASSERT(result) {
            Assert.strictEqual(result, "only");
        }
    });
});
