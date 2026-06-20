import * as Assert from "assert";

import test from "arrange-act-assert";

import { formatCountdown, formatCompactCountdown, formatDateTime, truncateToWidth, formatTokens, formatActiveTime, formatHeaderLine, formatMetricsLine, formatReviewingFooter, formatTerminalFooter, formatWorkingFooter, formatWaitingFooter, formatSnapshotHeader, formatSnapshotMetrics, formatSnapshotBlock, CYAN, YELLOW, GREEN, RED, MAGENTA, BLUE, DIM, ORANGE, RESET, colorize, stripAnsi, renderSegments, renderSegmentsToWidth, SEPARATOR_GLYPH, type Segment, type MetricsPair, type ReviewerEntry } from "./formatters";

test.describe("formatCountdown", test => {
    test("returns minutes only when remaining is under one hour", {
        ARRANGE() { return 15 * 60 * 1000; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "15 minutes");
        }
    });

    test("returns 1 minute for very short remaining time", {
        ARRANGE() { return 1000; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "1 minutes");
        }
    });

    test("returns 1 minute for zero remaining", {
        ARRANGE() { return 0; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "1 minutes");
        }
    });

    test("ceils partial minutes upward", {
        ARRANGE() { return 2.5 * 60 * 1000; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "3 minutes");
        }
    });

    test("returns 59 minutes at boundary just under one hour", {
        ARRANGE() { return 59 * 60 * 1000; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "59 minutes");
        }
    });

    test("switches to hours+minutes format at exactly one hour", {
        ARRANGE() { return 60 * 60 * 1000; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "1 hours 0 minutes");
        }
    });

    test("formats hours and minutes for 1.5 hours", {
        ARRANGE() { return 90 * 60 * 1000; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "1 hours 30 minutes");
        }
    });

    test("formats hours and minutes for multi-hour wait", {
        ARRANGE() { return 5 * 60 * 60 * 1000 + 15 * 60 * 1000; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "5 hours 15 minutes");
        }
    });

    test("stays in hours+minutes for 23h59m (just under one day)", {
        ARRANGE() { return (23 * 60 + 59) * 60 * 1000; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "23 hours 59 minutes");
        }
    });

    test("switches to days format at exactly 24 hours", {
        ARRANGE() { return 24 * 60 * 60 * 1000; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "1 days, 0 hours, 0 minutes");
        }
    });

    test("formats days, hours, and minutes for multi-day wait", {
        ARRANGE() { return (2 * 24 * 60 + 3 * 60 + 45) * 60 * 1000; },
        ACT(ms) { return formatCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "2 days, 3 hours, 45 minutes");
        }
    });
});

test.describe("formatCompactCountdown", test => {
    test("returns compact minutes only when remaining is under one hour", {
        ARRANGE() { return 14 * 60 * 1000; },
        ACT(ms) { return formatCompactCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "14m");
        }
    });

    test("returns 1m for any remainder under one minute", {
        ARRANGE() { return 30 * 1000; },
        ACT(ms) { return formatCompactCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "1m");
        }
    });

    test("stays in minutes tier at the last value below the one-hour boundary", {
        ARRANGE() { return 59 * 60 * 1000; },
        ACT(ms) { return formatCompactCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "59m");
        }
    });

    test("returns compact hours and minutes for 134 minutes", {
        ARRANGE() { return 134 * 60 * 1000; },
        ACT(ms) { return formatCompactCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "2h14m");
        }
    });

    test("renders every component of the hour tier at exactly one hour", {
        ARRANGE() { return 60 * 60 * 1000; },
        ACT(ms) { return formatCompactCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "1h0m");
        }
    });

    test("stays in hours tier at the last value below the one-day boundary", {
        ARRANGE() { return (23 * 60 + 59) * 60 * 1000; },
        ACT(ms) { return formatCompactCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "23h59m");
        }
    });

    test("returns compact days, hours and minutes for one day plus 2h14m", {
        ARRANGE() { return (24 * 60 + 134) * 60 * 1000; },
        ACT(ms) { return formatCompactCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "1d2h14m");
        }
    });

    test("renders every component of the day tier at exactly one day", {
        ARRANGE() { return 24 * 60 * 60 * 1000; },
        ACT(ms) { return formatCompactCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "1d0h0m");
        }
    });

    test("does not zero-pad a single-digit minute component in the hour tier", {
        ARRANGE() { return 124 * 60 * 1000; },
        ACT(ms) { return formatCompactCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "2h4m");
        }
    });

    test("does not zero-pad single-digit hour and minute components in the day tier", {
        ARRANGE() { return (24 * 60 + 124) * 60 * 1000; },
        ACT(ms) { return formatCompactCountdown(ms); },
        ASSERT(result) {
            Assert.strictEqual(result, "1d2h4m");
        }
    });
});

test.describe("truncateToWidth", test => {
    test("returns text unchanged when it fits within columns", {
        ARRANGE() { return { text: "hello", cols: 10 }; },
        ACT({ text, cols }) { return truncateToWidth(text, cols); },
        ASSERT(result) {
            Assert.strictEqual(result, "hello");
        }
    });

    test("returns text unchanged when length equals columns exactly", {
        ARRANGE() { return { text: "abcde", cols: 5 }; },
        ACT({ text, cols }) { return truncateToWidth(text, cols); },
        ASSERT(result) {
            Assert.strictEqual(result, "abcde");
        }
    });

    test("truncates with ellipsis when text exceeds columns by one", {
        ARRANGE() { return { text: "abcdef", cols: 5 }; },
        ACT({ text, cols }) { return truncateToWidth(text, cols); },
        ASSERT(result) {
            Assert.strictEqual(result, "abcd…");
            Assert.strictEqual(result.length, 5);
        }
    });

    test("truncates long text preserving column count", {
        ARRANGE() { return { text: "1/1 iter 1 implementing Implement feature A", cols: 20 }; },
        ACT({ text, cols }) { return truncateToWidth(text, cols); },
        ASSERT(result) {
            Assert.strictEqual(result, "1/1 iter 1 implemen…");
            Assert.strictEqual(result.length, 20);
        }
    });

    test("returns ellipsis only when columns is 1", {
        ARRANGE() { return { text: "hello", cols: 1 }; },
        ACT({ text, cols }) { return truncateToWidth(text, cols); },
        ASSERT(result) {
            Assert.strictEqual(result, "…");
        }
    });

    test("returns empty string when columns is 0", {
        ARRANGE() { return { text: "hello", cols: 0 }; },
        ACT({ text, cols }) { return truncateToWidth(text, cols); },
        ASSERT(result) {
            Assert.strictEqual(result, "…");
        }
    });
});

test.describe("formatTokens", test => {
    test("returns plain integer for 0", {
        ARRANGE() { return 0; },
        ACT(n) { return formatTokens(n); },
        ASSERT(result) { Assert.strictEqual(result, "0"); }
    });

    test("returns plain integer for values below 1000", {
        ARRANGE() { return 999; },
        ACT(n) { return formatTokens(n); },
        ASSERT(result) { Assert.strictEqual(result, "999"); }
    });

    test("returns k suffix at exactly 1000", {
        ARRANGE() { return 1000; },
        ACT(n) { return formatTokens(n); },
        ASSERT(result) { Assert.strictEqual(result, "1.0k"); }
    });

    test("returns k suffix with one decimal for thousands", {
        ARRANGE() { return 16432; },
        ACT(n) { return formatTokens(n); },
        ASSERT(result) { Assert.strictEqual(result, "16.4k"); }
    });

    test("returns k suffix just below one million", {
        ARRANGE() { return 999999; },
        ACT(n) { return formatTokens(n); },
        ASSERT(result) { Assert.strictEqual(result, "1000.0k"); }
    });

    test("returns M suffix at exactly one million", {
        ARRANGE() { return 1_200_000; },
        ACT(n) { return formatTokens(n); },
        ASSERT(result) { Assert.strictEqual(result, "1.2M"); }
    });

    test("returns M suffix for large values", {
        ARRANGE() { return 12_345_678; },
        ACT(n) { return formatTokens(n); },
        ASSERT(result) { Assert.strictEqual(result, "12.3M"); }
    });
});

test.describe("formatActiveTime", test => {
    test("returns 0s for zero seconds", {
        ARRANGE() { return 0; },
        ACT(s) { return formatActiveTime(s); },
        ASSERT(result) { Assert.strictEqual(result, "0s"); }
    });

    test("returns seconds only for values under 60", {
        ARRANGE() { return 45; },
        ACT(s) { return formatActiveTime(s); },
        ASSERT(result) { Assert.strictEqual(result, "45s"); }
    });

    test("returns minutes and zero-padded seconds at exactly 60", {
        ARRANGE() { return 60; },
        ACT(s) { return formatActiveTime(s); },
        ASSERT(result) { Assert.strictEqual(result, "1m00s"); }
    });

    test("returns minutes and zero-padded seconds", {
        ARRANGE() { return 142; },
        ACT(s) { return formatActiveTime(s); },
        ASSERT(result) { Assert.strictEqual(result, "2m22s"); }
    });

    test("returns hours, zero-padded minutes and seconds at exactly 3600", {
        ARRANGE() { return 3600; },
        ACT(s) { return formatActiveTime(s); },
        ASSERT(result) { Assert.strictEqual(result, "1h00m00s"); }
    });

    test("returns hours with zero-padded minutes and seconds", {
        ARRANGE() { return 3792; },
        ACT(s) { return formatActiveTime(s); },
        ASSERT(result) { Assert.strictEqual(result, "1h03m12s"); }
    });

    test("handles large values", {
        ARRANGE() { return 90000; },
        ACT(s) { return formatActiveTime(s); },
        ASSERT(result) { Assert.strictEqual(result, "25h00m00s"); }
    });

    test("clamps negative values to 0", {
        ARRANGE() { return -10; },
        ACT(s) { return formatActiveTime(s); },
        ASSERT(result) { Assert.strictEqual(result, "0s"); }
    });
});

test.describe("formatHeaderLine", test => {
    test("applies magenta to implementing activity", {
        ARRANGE() {
            return { indexLabel: "1/3", iter: 2, activity: "implementing", taskNumber: "3.1", title: "Add feature", cols: 120 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            Assert.ok(result.includes(MAGENTA + "implementing" + RESET), "activity should be magenta");
        }
    });

    test("applies magenta to reviewing activity", {
        ARRANGE() {
            return { indexLabel: "1/1", iter: 1, activity: "reviewing", taskNumber: undefined, title: "T", cols: 120 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            Assert.ok(result.includes(MAGENTA + "reviewing" + RESET), "reviewing should be magenta");
        }
    });

    test("applies magenta to building activity", {
        ARRANGE() {
            return { indexLabel: "1/1", iter: 1, activity: "building", taskNumber: undefined, title: "T", cols: 120 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            Assert.ok(result.includes(MAGENTA + "building" + RESET), "building should be magenta");
        }
    });

    test("applies magenta to testing activity", {
        ARRANGE() {
            return { indexLabel: "1/1", iter: 1, activity: "testing", taskNumber: undefined, title: "T", cols: 120 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            Assert.ok(result.includes(MAGENTA + "testing" + RESET), "testing should be magenta");
        }
    });

    test("applies green to done activity", {
        ARRANGE() {
            return { indexLabel: "2/5", iter: 3, activity: "done", taskNumber: "7.3", title: "Fix bug", cols: 120 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            Assert.ok(result.includes(GREEN + "done" + RESET), "done should be green");
            Assert.ok(!result.includes(MAGENTA), "done should not use magenta");
        }
    });

    test("renders all fields with correct colors when fitting within cols", {
        ARRANGE() {
            return { indexLabel: "5/12", iter: 2, activity: "implementing", taskNumber: "7.3", title: "Add login page", cols: 120 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            Assert.ok(result.includes(CYAN + "5/12" + RESET), "index should be cyan");
            Assert.ok(result.includes(YELLOW + "iter 2" + RESET), "iteration should be yellow");
            Assert.ok(result.includes(MAGENTA + "implementing" + RESET), "activity should be magenta");
            Assert.ok(result.includes(GREEN + "7.3" + RESET), "task number should be green");
            Assert.ok(result.includes("Add login page"), "title should be present");
            Assert.ok(!result.includes("…"), "no ellipsis when fitting");
        }
    });

    test("omits task number token when taskNumber is undefined", {
        ARRANGE() {
            return { indexLabel: "1/1", iter: 1, activity: "implementing", taskNumber: undefined as string|undefined, title: "Do the thing", cols: 120 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            const plain = stripAnsi(result);
            Assert.strictEqual(plain, "1/1 iter 1 implementing Do the thing");
            Assert.ok(!plain.includes("  "), "no double space when task number is absent");
        }
    });

    test("omits task number token when taskNumber is empty string", {
        ARRANGE() {
            return { indexLabel: "1/1", iter: 1, activity: "building", taskNumber: "" as string|undefined, title: "Build it", cols: 120 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            const plain = stripAnsi(result);
            Assert.strictEqual(plain, "1/1 iter 1 building Build it");
            Assert.ok(!plain.includes("  "), "no double space when task number is empty");
        }
    });

    test("returns untruncated string at exact boundary (plain length === cols)", {
        ARRANGE() {
            const plain = "1/1 iter 1 implementing Implement feature A";
            return { indexLabel: "1/1", iter: 1, activity: "implementing", taskNumber: undefined as string|undefined, title: "Implement feature A", cols: plain.length };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            const plain = stripAnsi(result);
            Assert.strictEqual(plain, "1/1 iter 1 implementing Implement feature A");
            Assert.ok(!result.includes("…"), "no ellipsis at exact boundary");
        }
    });

    test("truncates with ellipsis when plain text exceeds cols", {
        ARRANGE() {
            return { indexLabel: "1/1", iter: 1, activity: "implementing", taskNumber: undefined as string|undefined, title: "Implement feature A", cols: 20 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            const plain = stripAnsi(result);
            Assert.strictEqual(plain.length, 20, "plain text length equals cols");
            Assert.ok(plain.endsWith("…"), "ends with ellipsis");
            Assert.strictEqual(plain, "1/1 iter 1 implemen…");
        }
    });

    test("truncated output preserves color escapes in surviving prefix", {
        ARRANGE() {
            return { indexLabel: "5/12", iter: 2, activity: "implementing", taskNumber: "7.3", title: "Long title here", cols: 15 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERT(result) {
            const plain = stripAnsi(result);
            Assert.strictEqual(plain.length, 15);
            Assert.ok(plain.endsWith("…"));
            Assert.ok(result.includes(CYAN), "cyan escape present in truncated output");
            Assert.ok(result.includes(YELLOW), "yellow escape present in truncated output");
        }
    });

    test("strip-ANSI of fitting render matches the plain text the previous header builder produced", {
        ARRANGE() {
            const indexLabel = "3/7";
            const iteration = 4;
            const activity = "reviewing";
            const taskNumber = "2.1";
            const title = "Refactor module";
            let legacy = `${indexLabel} iter ${iteration} ${activity}`;
            legacy += ` ${taskNumber}`;
            legacy += ` ${title}`;
            return { indexLabel, iteration, activity, taskNumber, title, legacy, cols: 200 };
        },
        ACT({ indexLabel, iteration, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iteration, activity, taskNumber, title, cols);
        },
        ASSERT(result, { legacy }) {
            Assert.strictEqual(stripAnsi(result), legacy);
        }
    });

    test("strip-ANSI of fitting render without task number matches the previous plain text", {
        ARRANGE() {
            const indexLabel = "1/1";
            const iteration = 1;
            const activity = "implementing";
            const title = "Implement feature A";
            const legacy = `${indexLabel} iter ${iteration} ${activity} ${title}`;
            return { indexLabel, iteration, activity, title, legacy, cols: 200 };
        },
        ACT({ indexLabel, iteration, activity, title, cols }) {
            return formatHeaderLine(indexLabel, iteration, activity, undefined, title, cols);
        },
        ASSERT(result, { legacy }) {
            Assert.strictEqual(stripAnsi(result), legacy);
        }
    });

    test("returns empty string when all fields are null", {
        ARRANGE() {
            return { cols: 120 };
        },
        ACT({ cols }) {
            return formatHeaderLine(null, null, null, null, null, cols);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "");
        }
    });

    test("renders only indexLabel when other fields are null (0/N case)", {
        ARRANGE() {
            return { indexLabel: "0/5", cols: 120 };
        },
        ACT({ indexLabel, cols }) {
            return formatHeaderLine(indexLabel, null, null, null, null, cols);
        },
        ASSERTS: {
            "plain text is just the index label"(result) {
                Assert.strictEqual(stripAnsi(result), "0/5");
            },
            "index label is cyan"(result) {
                Assert.ok(result.includes(CYAN + "0/5" + RESET));
            },
            "no trailing spaces"(result) {
                Assert.ok(!stripAnsi(result).includes(" "));
            }
        }
    });

    test("renders only indexLabel when other fields are null (N/N case)", {
        ARRANGE() {
            return { indexLabel: "5/5", cols: 120 };
        },
        ACT({ indexLabel, cols }) {
            return formatHeaderLine(indexLabel, null, null, null, null, cols);
        },
        ASSERTS: {
            "plain text is just the index label"(result) {
                Assert.strictEqual(stripAnsi(result), "5/5");
            },
            "index label is cyan"(result) {
                Assert.ok(result.includes(CYAN + "5/5" + RESET));
            }
        }
    });

    test("renders all fields with correct colors when all non-null (no regression)", {
        ARRANGE() {
            return { indexLabel: "5/12", iter: 2, activity: "implementing", taskNumber: "7.3", title: "Add login page", cols: 120 };
        },
        ACT({ indexLabel, iter, activity, taskNumber, title, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, taskNumber, title, cols);
        },
        ASSERTS: {
            "plain text matches full header"(result) {
                Assert.strictEqual(stripAnsi(result), "5/12 iter 2 implementing 7.3 Add login page");
            },
            "index is cyan"(result) {
                Assert.ok(result.includes(CYAN + "5/12" + RESET));
            },
            "iteration is yellow"(result) {
                Assert.ok(result.includes(YELLOW + "iter 2" + RESET));
            },
            "activity is magenta"(result) {
                Assert.ok(result.includes(MAGENTA + "implementing" + RESET));
            },
            "task number is green"(result) {
                Assert.ok(result.includes(GREEN + "7.3" + RESET));
            },
            "title is present"(result) {
                Assert.ok(result.includes("Add login page"));
            }
        }
    });

    test("renders activity without color when not done and not in LIVE_ACTIVITIES", {
        ARRANGE() {
            return { indexLabel: "1/1", iter: 1, activity: "unknown", cols: 120 };
        },
        ACT({ indexLabel, iter, activity, cols }) {
            return formatHeaderLine(indexLabel, iter, activity, null, null, cols);
        },
        ASSERTS: {
            "plain text contains the activity"(result) {
                Assert.strictEqual(stripAnsi(result), "1/1 iter 1 unknown");
            },
            "no GREEN color applied"(result) {
                Assert.ok(!result.includes(GREEN + "unknown"));
            },
            "no MAGENTA color applied"(result) {
                Assert.ok(!result.includes(MAGENTA + "unknown"));
            }
        }
    });

    test("truncates partial header with ellipsis when indexLabel alone exceeds cols", {
        ARRANGE() {
            return { indexLabel: "0/12345", cols: 4 };
        },
        ACT({ indexLabel, cols }) {
            return formatHeaderLine(indexLabel, null, null, null, null, cols);
        },
        ASSERTS: {
            "plain text length equals cols"(result) {
                Assert.strictEqual(stripAnsi(result).length, 4);
            },
            "ends with ellipsis"(result) {
                Assert.ok(stripAnsi(result).endsWith("…"));
            }
        }
    });
});

test.describe("formatMetricsLine", test => {
    test("returns full form when it fits within cols", {
        ARRANGE() {
            return { task: {tokens:16432, seconds:142}, plan: {tokens:1_200_000, seconds:3792}, cols: 100 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "task 16.4k 2m22s  │  plan 1.2M 1h03m12s");
        }
    });

    test("returns compact form when full form does not fit but compact does", {
        ARRANGE() {
            const full = "task 16.4k 2m22s  │  plan 1.2M 1h03m12s";
            return { task: {tokens:16432, seconds:142}, plan: {tokens:1_200_000, seconds:3792}, cols: full.length - 1 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "t:16.4k 2m22s│p:1.2M 1h03m12s");
        }
    });

    test("returns truncated compact form when even compact does not fit", {
        ARRANGE() {
            return { task: {tokens:16432, seconds:142}, plan: {tokens:1_200_000, seconds:3792}, cols: 15 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERTS: {
            "plain text length equals cols"(result) {
                Assert.strictEqual(stripAnsi(result).length, 15);
            },
            "ends with ellipsis"(result) {
                Assert.ok(stripAnsi(result).endsWith("…"));
            },
            "exact truncated string matches"(result) {
                Assert.strictEqual(stripAnsi(result), "t:16.4k 2m22s│…");
            }
        }
    });

    test("full form applies dim to labels and separator, green to tokens, blue to time", {
        ARRANGE() {
            return { task: {tokens:16432, seconds:142}, plan: {tokens:1_200_000, seconds:3792}, cols: 100 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERTS: {
            "task label is dim"(result) {
                Assert.ok(result.includes(DIM + "task" + RESET));
            },
            "plan label is dim"(result) {
                Assert.ok(result.includes(DIM + "plan" + RESET));
            },
            "separator is dim"(result) {
                Assert.ok(result.includes(DIM + "│" + RESET));
            },
            "task tokens are green"(result) {
                Assert.ok(result.includes(GREEN + "16.4k" + RESET));
            },
            "plan tokens are green"(result) {
                Assert.ok(result.includes(GREEN + "1.2M" + RESET));
            },
            "task time is blue"(result) {
                Assert.ok(result.includes(BLUE + "2m22s" + RESET));
            },
            "plan time is blue"(result) {
                Assert.ok(result.includes(BLUE + "1h03m12s" + RESET));
            }
        }
    });

    test("compact form applies dim to labels and separator, green to tokens, blue to time", {
        ARRANGE() {
            const full = "task 16.4k 2m22s  │  plan 1.2M 1h03m12s";
            return { task: {tokens:16432, seconds:142}, plan: {tokens:1_200_000, seconds:3792}, cols: full.length - 1 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERTS: {
            "t: label is dim"(result) {
                Assert.ok(result.includes(DIM + "t:" + RESET));
            },
            "p: label is dim"(result) {
                Assert.ok(result.includes(DIM + "p:" + RESET));
            },
            "separator is dim"(result) {
                Assert.ok(result.includes(DIM + "│" + RESET));
            },
            "task tokens are green"(result) {
                Assert.ok(result.includes(GREEN + "16.4k" + RESET));
            },
            "plan tokens are green"(result) {
                Assert.ok(result.includes(GREEN + "1.2M" + RESET));
            },
            "task time is blue"(result) {
                Assert.ok(result.includes(BLUE + "2m22s" + RESET));
            },
            "plan time is blue"(result) {
                Assert.ok(result.includes(BLUE + "1h03m12s" + RESET));
            }
        }
    });

    test("returns empty string when both pairs are undefined", {
        ARRANGE() {
            return { task: undefined as MetricsPair|undefined, plan: undefined as MetricsPair|undefined, cols: 100 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "");
        }
    });

    test("renders only plan pair when task is undefined", {
        ARRANGE() {
            return { task: undefined as MetricsPair|undefined, plan: {tokens:1_200_000, seconds:3792}, cols: 100 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERTS: {
            "plain text shows only the plan pair"(result) {
                Assert.strictEqual(stripAnsi(result), "plan 1.2M 1h03m12s");
            },
            "does not contain task label"(result) {
                Assert.ok(!stripAnsi(result).includes("task"), "task label must be absent");
            },
            "does not contain separator"(result) {
                Assert.ok(!stripAnsi(result).includes("│"), "separator must be absent");
            }
        }
    });

    test("renders only plan pair in compact form when full form does not fit", {
        ARRANGE() {
            const full = "plan 1.2M 1h03m12s";
            return { task: undefined as MetricsPair|undefined, plan: {tokens:1_200_000, seconds:3792}, cols: full.length - 1 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERTS: {
            "plain text shows compact plan pair"(result) {
                Assert.strictEqual(stripAnsi(result), "p:1.2M 1h03m12s");
            },
            "does not contain task label"(result) {
                Assert.ok(!stripAnsi(result).includes("t:"), "compact task label must be absent");
            }
        }
    });

    test("truncates plan-only compact form when cols is narrower than compact output", {
        ARRANGE() {
            return { task: undefined as MetricsPair|undefined, plan: {tokens:1_200_000, seconds:3792}, cols: 5 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERTS: {
            "plain text length equals cols"(result) {
                Assert.strictEqual(stripAnsi(result).length, 5);
            },
            "ends with ellipsis"(result) {
                Assert.ok(stripAnsi(result).endsWith("…"));
            }
        }
    });

    test("renders only task pair when plan is undefined", {
        ARRANGE() {
            return { task: {tokens:1000, seconds:60}, plan: undefined as MetricsPair|undefined, cols: 100 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERTS: {
            "plain text shows only the task pair"(result) {
                Assert.strictEqual(stripAnsi(result), "task 1.0k 1m00s");
            },
            "does not contain plan label"(result) {
                Assert.ok(!stripAnsi(result).includes("plan"), "plan label must be absent");
            },
            "does not contain separator"(result) {
                Assert.ok(!stripAnsi(result).includes("│"), "separator must be absent");
            }
        }
    });

    test("both pairs present falls back to compact form and truncates at minimum width", {
        ARRANGE() {
            return { task: {tokens:16432, seconds:142}, plan: {tokens:1_200_000, seconds:3792}, cols: 5 };
        },
        ACT({ task, plan, cols }) {
            return formatMetricsLine(task, plan, cols);
        },
        ASSERTS: {
            "plain text length equals cols"(result) {
                Assert.strictEqual(stripAnsi(result).length, 5);
            },
            "ends with ellipsis"(result) {
                Assert.ok(stripAnsi(result).endsWith("…"));
            }
        }
    });
});

test.describe("formatDateTime", test => {
    test("formats a date as YYYY-MM-DD HH:MM", {
        ARRANGE() { return new Date(2025, 0, 15, 9, 5); },
        ACT(date) { return formatDateTime(date); },
        ASSERT(result) {
            Assert.strictEqual(result, "2025-01-15 09:05");
        }
    });

    test("pads single-digit month and day", {
        ARRANGE() { return new Date(2025, 2, 3, 14, 30); },
        ACT(date) { return formatDateTime(date); },
        ASSERT(result) {
            Assert.strictEqual(result, "2025-03-03 14:30");
        }
    });
});

test.describe("colorize", test => {
    test("wraps text with the given ANSI code and appends reset", {
        ARRANGE() { return { text: "x", code: CYAN }; },
        ACT({ text, code }) { return colorize(text, code); },
        ASSERT(result) {
            Assert.ok(result.startsWith(CYAN), "starts with cyan escape");
            Assert.ok(result.includes("x"), "contains the text");
            Assert.ok(result.endsWith(RESET), "ends with reset");
            Assert.strictEqual(result, CYAN + "x" + RESET);
        }
    });
});

test.describe("stripAnsi", test => {
    test("returns input unchanged when it contains no ANSI sequences", {
        ARRANGE() { return "plain text 123"; },
        ACT(s) { return stripAnsi(s); },
        ASSERT(result) {
            Assert.strictEqual(result, "plain text 123");
        }
    });

    test("removes simple SGR color codes", {
        ARRANGE() { return CYAN + "abc" + RESET; },
        ACT(s) { return stripAnsi(s); },
        ASSERT(result) {
            Assert.strictEqual(result, "abc");
        }
    });

    test("removes multi-parameter SGR codes such as the 256-color orange", {
        ARRANGE() { return ORANGE + "abc" + RESET; },
        ACT(s) { return stripAnsi(s); },
        ASSERT(result) {
            Assert.strictEqual(result, "abc");
        }
    });

    test("removes non-SGR CSI sequences — cursor-up, erase-display, and DECAWM autowrap toggles", {
        ARRANGE() { return "\x1b[?7l" + "block" + "\x1b[?7h" + "\x1b[3A" + "\r" + "\x1b[J"; },
        ACT(s) { return stripAnsi(s); },
        ASSERT(result) {
            Assert.strictEqual(result, "block\r");
        }
    });

    test("removes every occurrence in a single input, not just the first", {
        ARRANGE() { return CYAN + "a" + RESET + " " + GREEN + "b" + RESET; },
        ACT(s) { return stripAnsi(s); },
        ASSERT(result) {
            Assert.strictEqual(result, "a b");
        }
    });
});

test.describe("renderSegments", test => {
    test("renders mixed colored and default segments", {
        ARRANGE():Segment[] {
            return [
                { text: "a", color: CYAN },
                { text: " " },
                { text: "b", color: YELLOW }
            ];
        },
        ACT(segments:Segment[]) { return renderSegments(segments); },
        ASSERT(result) {
            Assert.ok(result.includes(CYAN + "a" + RESET), "cyan segment rendered");
            Assert.ok(result.includes(" "), "middle segment present");
            Assert.ok(result.includes(YELLOW + "b" + RESET), "yellow segment rendered");
            Assert.strictEqual(stripAnsi(result), "a b");
        }
    });
});

test.describe("renderSegmentsToWidth", test => {
    test("returns full colored string when total plain length fits within cols", {
        ARRANGE() {
            return {
                segments: [
                    { text: "ab", color: CYAN },
                    { text: " " },
                    { text: "cd", color: GREEN }
                ] as Segment[],
                cols: 10
            };
        },
        ACT({ segments, cols }) { return renderSegmentsToWidth(segments, cols); },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "ab cd");
            Assert.ok(result.includes(CYAN), "contains cyan escape");
            Assert.ok(result.includes(GREEN), "contains green escape");
            Assert.ok(!result.includes("…"), "no ellipsis when fitting");
        }
    });

    test("does not append ellipsis at exact boundary (plain length === cols)", {
        ARRANGE() {
            return {
                segments: [
                    { text: "abc", color: CYAN },
                    { text: "de" }
                ] as Segment[],
                cols: 5
            };
        },
        ACT({ segments, cols }) { return renderSegmentsToWidth(segments, cols); },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "abcde");
            Assert.ok(!result.includes("…"), "no ellipsis at exact boundary");
        }
    });

    test("truncates mid-segment with ellipsis when plain length exceeds cols", {
        ARRANGE() {
            return {
                segments: [
                    { text: "hello", color: CYAN },
                    { text: " " },
                    { text: "world", color: YELLOW }
                ] as Segment[],
                cols: 8
            };
        },
        ACT({ segments, cols }) { return renderSegmentsToWidth(segments, cols); },
        ASSERT(result) {
            const plain = stripAnsi(result);
            Assert.strictEqual(plain.length, 8, "plain text length equals cols");
            Assert.ok(plain.endsWith("…"), "ends with ellipsis");
            Assert.strictEqual(plain, "hello w…");
        }
    });

    test("appends reset after each colored segment in truncated output", {
        ARRANGE() {
            return {
                segments: [
                    { text: "abcdef", color: CYAN }
                ] as Segment[],
                cols: 4
            };
        },
        ACT({ segments, cols }) { return renderSegmentsToWidth(segments, cols); },
        ASSERT(result) {
            Assert.ok(result.includes(RESET), "contains reset escape");
            Assert.strictEqual(stripAnsi(result), "abc…");
        }
    });
});

test.describe("SEPARATOR_GLYPH", test => {
    test("matches the glyph used by BottomBlock", {
        ARRANGE() {
            return SEPARATOR_GLYPH;
        },
        ACT(glyph) { return glyph; },
        ASSERT(glyph) {
            Assert.strictEqual(glyph, "─", "separator glyph is the box-drawing horizontal line");
        }
    });
});

test.describe("formatSnapshotHeader", test => {
    test("uses green for done activity", {
        ARRANGE() {
            return { indexLabel: "2/5", iter: 3, taskNumber: "7.3", title: "Fix bug" };
        },
        ACT({ indexLabel, iter, taskNumber, title }) {
            return formatSnapshotHeader(indexLabel, iter, taskNumber, title);
        },
        ASSERT(result) {
            Assert.ok(result.includes(GREEN + "done" + RESET), "done should be green");
            Assert.ok(!result.includes(MAGENTA), "done should not use magenta");
        }
    });

    test("applies correct colors to all fields", {
        ARRANGE() {
            return { indexLabel: "5/12", iter: 2, taskNumber: "7.3", title: "Add login page" };
        },
        ACT({ indexLabel, iter, taskNumber, title }) {
            return formatSnapshotHeader(indexLabel, iter, taskNumber, title);
        },
        ASSERT(result) {
            Assert.ok(result.includes(CYAN + "5/12" + RESET), "index should be cyan");
            Assert.ok(result.includes(YELLOW + "iter 2" + RESET), "iteration should be yellow");
            Assert.ok(result.includes(GREEN + "done" + RESET), "activity should be green");
            Assert.ok(result.includes(GREEN + "7.3" + RESET), "task number should be green");
            Assert.ok(result.includes("Add login page"), "title should be present");
        }
    });

    test("never truncates even when plain length exceeds a typical column count", {
        ARRANGE() {
            const title = "A very long task title that would definitely exceed any reasonable terminal width if we were truncating";
            return { indexLabel: "1/1", iter: 1, taskNumber: "1.1", title };
        },
        ACT({ indexLabel, iter, taskNumber, title }) {
            return formatSnapshotHeader(indexLabel, iter, taskNumber, title);
        },
        ASSERT(result) {
            const plain = stripAnsi(result);
            Assert.ok(!result.includes("…"), "must not contain ellipsis");
            Assert.ok(plain.includes("A very long task title that would definitely exceed any reasonable terminal width if we were truncating"), "full title preserved");
            Assert.strictEqual(plain, "1/1 iter 1 done 1.1 A very long task title that would definitely exceed any reasonable terminal width if we were truncating");
        }
    });
});

test.describe("formatSnapshotMetrics", test => {
    test("always returns full form with correct colors", {
        ARRANGE() {
            return { taskTokens: 16432, taskSeconds: 142, planTokens: 1_200_000, planSeconds: 3792 };
        },
        ACT({ taskTokens, taskSeconds, planTokens, planSeconds }) {
            return formatSnapshotMetrics(taskTokens, taskSeconds, planTokens, planSeconds);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "task 16.4k 2m22s  │  plan 1.2M 1h03m12s");
            Assert.ok(result.includes(DIM + "task" + RESET), "task label should be dim");
            Assert.ok(result.includes(DIM + "plan" + RESET), "plan label should be dim");
            Assert.ok(result.includes(DIM + "│" + RESET), "separator should be dim");
            Assert.ok(result.includes(GREEN + "16.4k" + RESET), "task tokens should be green");
            Assert.ok(result.includes(GREEN + "1.2M" + RESET), "plan tokens should be green");
            Assert.ok(result.includes(BLUE + "2m22s" + RESET), "task time should be blue");
            Assert.ok(result.includes(BLUE + "1h03m12s" + RESET), "plan time should be blue");
        }
    });

    test("never falls back to compact form regardless of value sizes", {
        ARRANGE() {
            return { taskTokens: 16432, taskSeconds: 142, planTokens: 1_200_000, planSeconds: 3792 };
        },
        ACT({ taskTokens, taskSeconds, planTokens, planSeconds }) {
            return formatSnapshotMetrics(taskTokens, taskSeconds, planTokens, planSeconds);
        },
        ASSERT(result) {
            const plain = stripAnsi(result);
            Assert.ok(!plain.includes("t:"), "must not contain compact t: label");
            Assert.ok(!plain.includes("p:"), "must not contain compact p: label");
            Assert.ok(!plain.includes("…"), "must not contain ellipsis");
            Assert.ok(plain.startsWith("task "), "starts with full task label");
            Assert.ok(plain.includes("  │  plan "), "contains full separator and plan label");
        }
    });
});

test.describe("formatSnapshotBlock", test => {
    test("produces separator, header, metrics, separator sequence terminated by newlines", {
        ARRANGE() {
            return { indexLabel: "3/7", iter: 2, taskNumber: "2.1", title: "Refactor module", taskTokens: 5000, taskSeconds: 90, planTokens: 50000, planSeconds: 600, cols: 80 };
        },
        ACT({ indexLabel, iter, taskNumber, title, taskTokens, taskSeconds, planTokens, planSeconds, cols }) {
            return formatSnapshotBlock(indexLabel, iter, taskNumber, title, taskTokens, taskSeconds, planTokens, planSeconds, cols);
        },
        ASSERT(result) {
            const lines = result.split("\n");
            Assert.strictEqual(lines.length, 5, "4 lines + trailing empty from final newline");

            const sep = SEPARATOR_GLYPH.repeat(80);
            Assert.strictEqual(lines[0], sep, "first line is separator");
            Assert.strictEqual(lines[3], sep, "fourth line is separator");
            Assert.strictEqual(lines[4], "", "trailing empty string after final newline");

            const headerPlain = stripAnsi(lines[1]!);
            Assert.ok(headerPlain.includes("done"), "header contains done activity");
            Assert.ok(headerPlain.includes("2.1"), "header contains task number");
            Assert.ok(headerPlain.includes("Refactor module"), "header contains title");

            const metricsPlain = stripAnsi(lines[2]!);
            Assert.ok(metricsPlain.includes("task"), "metrics contains task label");
            Assert.ok(metricsPlain.includes("plan"), "metrics contains plan label");
        }
    });

    test("separator plain length equals cols", {
        ARRANGE() {
            return { indexLabel: "1/1", iter: 1, taskNumber: "1.1", title: "T", taskTokens: 0, taskSeconds: 0, planTokens: 0, planSeconds: 0, cols: 40 };
        },
        ACT({ indexLabel, iter, taskNumber, title, taskTokens, taskSeconds, planTokens, planSeconds, cols }) {
            return formatSnapshotBlock(indexLabel, iter, taskNumber, title, taskTokens, taskSeconds, planTokens, planSeconds, cols);
        },
        ASSERT(result) {
            const lines = result.split("\n");
            Assert.strictEqual(lines[0]!.length, 40, "first separator has length cols");
            Assert.strictEqual(lines[3]!.length, 40, "second separator has length cols");
            for (const ch of lines[0]!) {
                Assert.strictEqual(ch, SEPARATOR_GLYPH, "separator uses shared glyph");
            }
        }
    });

    test("narrow cols does not cause ellipsis or compact labels in header or metrics", {
        ARRANGE() {
            return { indexLabel: "5/12", iter: 3, taskNumber: "7.3", title: "A long task title here", taskTokens: 16432, taskSeconds: 142, planTokens: 1_200_000, planSeconds: 3792, cols: 10 };
        },
        ACT({ indexLabel, iter, taskNumber, title, taskTokens, taskSeconds, planTokens, planSeconds, cols }) {
            return formatSnapshotBlock(indexLabel, iter, taskNumber, title, taskTokens, taskSeconds, planTokens, planSeconds, cols);
        },
        ASSERT(result) {
            const lines = result.split("\n");
            const headerPlain = stripAnsi(lines[1]!);
            const metricsPlain = stripAnsi(lines[2]!);

            Assert.ok(!headerPlain.includes("…"), "header must not contain ellipsis");
            Assert.ok(!metricsPlain.includes("…"), "metrics must not contain ellipsis");
            Assert.ok(!metricsPlain.includes("t:"), "metrics must not contain compact t: label");
            Assert.ok(!metricsPlain.includes("p:"), "metrics must not contain compact p: label");

            Assert.strictEqual(headerPlain, "5/12 iter 3 done 7.3 A long task title here");
            Assert.strictEqual(metricsPlain, "task 16.4k 2m22s  │  plan 1.2M 1h03m12s");
        }
    });

    test("snapshot header plain length equals full field length even when exceeding cols", {
        ARRANGE() {
            const title = "Very long title exceeding column width";
            return { indexLabel: "1/1", iter: 1, taskNumber: "1.1", title, taskTokens: 0, taskSeconds: 0, planTokens: 0, planSeconds: 0, cols: 10 };
        },
        ACT({ indexLabel, iter, taskNumber, title, taskTokens, taskSeconds, planTokens, planSeconds, cols }) {
            return formatSnapshotBlock(indexLabel, iter, taskNumber, title, taskTokens, taskSeconds, planTokens, planSeconds, cols);
        },
        ASSERT(result) {
            const lines = result.split("\n");
            const headerPlain = stripAnsi(lines[1]!);
            const expected = "1/1 iter 1 done 1.1 Very long title exceeding column width";
            Assert.strictEqual(headerPlain, expected);
            Assert.ok(headerPlain.length > 10, "header plain length exceeds cols");
        }
    });
});

test.describe("formatReviewingFooter", test => {
    // The animated indicator is a single glyph the block supplies; the formatter
    // interpolates whatever frame it is handed. A fixed sentinel keeps the expected
    // lines readable and matches the first spinner frame the block renders.
    const FRAME = "⣋";

    test("renders single fully-defaulted reviewer in full form", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): running");
        }
    });

    test("renders distinct model and effort with space-joined descriptor", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "codex", model: "gpt-5.5", effort: "xhigh", state: "pass" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ codex (gpt-5.5 xhigh): pass");
        }
    });

    test("omits effort token when configured model equals configured effort (non-empty)", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "high", effort: "high", state: "waiting" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (high): waiting");
        }
    });

    test("renders 'default' for empty model when effort is set and differs", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "high", state: "fail" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default high): fail");
        }
    });

    test("renders 'default' for empty effort when model is set and differs", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "codex", model: "low", effort: "", state: "running" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ codex (low default): running");
        }
    });

    test("renders state 'running' verbatim", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): running");
        }
    });

    test("renders state 'waiting' verbatim", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "waiting" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): waiting");
        }
    });

    test("renders state 'pass' verbatim", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "pass" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): pass");
        }
    });

    test("renders state 'fail' verbatim", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "fail" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): fail");
        }
    });

    test("renders multiple reviewers separated by comma-space in configured order", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "running" },
                { tool: "codex", model: "gpt-5", effort: "high", state: "pass" },
                { tool: "claude", model: "sonnet", effort: "sonnet", state: "fail" }
            ];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 200, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): running, codex (gpt-5 high): pass, claude (sonnet): fail");
        }
    });

    test("returns full form when cols equals full text length exactly", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            const fullText = "review: ⣋ claude (default): running";
            return { reviewers, cols: fullText.length, fullText };
        },
        ACT({ reviewers, cols }) {
            return formatReviewingFooter(FRAME, reviewers, cols, 0);
        },
        ASSERT(result, { fullText }) {
            Assert.strictEqual(stripAnsi(result), fullText);
        }
    });

    test("returns compact form when full form does not fit by one column", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "running" },
                { tool: "claude", model: "", effort: "", state: "running" }
            ];
            const fullText = "review: ⣋ claude (default): running, claude (default): running";
            return { reviewers, cols: fullText.length - 1 };
        },
        ACT({ reviewers, cols }) {
            return formatReviewingFooter(FRAME, reviewers, cols, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude: running, claude: running");
        }
    });

    test("returns compact form at boundary where compact equals cols exactly", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "running" },
                { tool: "claude", model: "", effort: "", state: "running" }
            ];
            const compact = "review: ⣋ claude: running, claude: running";
            return { reviewers, cols: compact.length, compact };
        },
        ACT({ reviewers, cols }) {
            return formatReviewingFooter(FRAME, reviewers, cols, 0);
        },
        ASSERT(result, { compact }) {
            Assert.strictEqual(stripAnsi(result), compact);
        }
    });

    test("returns truncated compact form when neither full nor compact fits", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "running" },
                { tool: "claude", model: "", effort: "", state: "running" }
            ];
            return { reviewers, cols: 15 };
        },
        ACT({ reviewers, cols }) {
            return formatReviewingFooter(FRAME, reviewers, cols, 0);
        },
        ASSERTS: {
            "exact truncated plain string matches"(result) {
                Assert.strictEqual(stripAnsi(result), "review: ⣋ clau…");
            },
            "plain text length equals cols"(result) {
                Assert.strictEqual(stripAnsi(result).length, 15);
            },
            "ends with ellipsis"(result) {
                Assert.ok(stripAnsi(result).endsWith("…"));
            }
        }
    });

    test("emits the orange prefix-and-indicator segment with the running entry following", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(result, ORANGE + "review: ⣋ " + RESET + ORANGE + "claude (default): running" + RESET);
        }
    });

    test("emits the compact form keeping the orange prefix-and-indicator segment", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "running" },
                { tool: "claude", model: "", effort: "", state: "running" }
            ];
            const fullText = "review: ⣋ claude (default): running, claude (default): running";
            return { reviewers, cols: fullText.length - 1 };
        },
        ACT({ reviewers, cols }) {
            return formatReviewingFooter(FRAME, reviewers, cols, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(result, ORANGE + "review: ⣋ " + RESET + ORANGE + "claude: running" + RESET + ORANGE + ", " + RESET + ORANGE + "claude: running" + RESET);
        }
    });

    test("truncated form keeps the orange prefix-and-indicator segment with a trailing ellipsis", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "running" },
                { tool: "claude", model: "", effort: "", state: "running" }
            ];
            return { reviewers, cols: 15 };
        },
        ACT({ reviewers, cols }) {
            return formatReviewingFooter(FRAME, reviewers, cols, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(result, ORANGE + "review: ⣋ " + RESET + ORANGE + "clau" + RESET + "…");
        }
    });

    test("colors a passed reviewer's whole entry green while the prefix and indicator stay orange", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "codex", model: "gpt-5", effort: "high", state: "pass" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERTS: {
            "the passed entry is wrapped in green"(result) {
                Assert.ok(result.includes(GREEN + "codex (gpt-5 high): pass" + RESET));
            },
            "the prefix and indicator stay orange"(result) {
                Assert.ok(result.includes(ORANGE + "review: ⣋ " + RESET));
            },
            "the passed entry is neither orange nor red"(result) {
                Assert.ok(!result.includes(ORANGE + "codex (gpt-5 high): pass"));
                Assert.ok(!result.includes(RED + "codex (gpt-5 high): pass"));
            }
        }
    });

    test("colors a failed reviewer's whole entry red while the prefix and indicator stay orange", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "codex", model: "gpt-5", effort: "high", state: "fail" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 120, 0);
        },
        ASSERTS: {
            "the failed entry is wrapped in red"(result) {
                Assert.ok(result.includes(RED + "codex (gpt-5 high): fail" + RESET));
            },
            "the prefix and indicator stay orange"(result) {
                Assert.ok(result.includes(ORANGE + "review: ⣋ " + RESET));
            },
            "the failed entry is not green"(result) {
                Assert.ok(!result.includes(GREEN + "codex (gpt-5 high): fail"));
            }
        }
    });

    test("colors each entry by its own verdict — running and waiting orange, pass green, fail red", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "running" },
                { tool: "codex", model: "gpt-5", effort: "high", state: "pass" },
                { tool: "claude", model: "sonnet", effort: "sonnet", state: "fail" },
                { tool: "codex", model: "", effort: "", state: "waiting" }
            ];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 200, 0);
        },
        ASSERTS: {
            "the running entry is orange"(result) {
                Assert.ok(result.includes(ORANGE + "claude (default): running" + RESET));
            },
            "the passed entry is green"(result) {
                Assert.ok(result.includes(GREEN + "codex (gpt-5 high): pass" + RESET));
            },
            "the failed entry is red"(result) {
                Assert.ok(result.includes(RED + "claude (sonnet): fail" + RESET));
            },
            "the waiting entry is orange"(result) {
                Assert.ok(result.includes(ORANGE + "codex (default): waiting" + RESET));
            }
        }
    });

    test("recomputes compaction tier per call when only width changes", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "running" },
                { tool: "claude", model: "", effort: "", state: "running" }
            ];
            return { reviewers };
        },
        ACT({ reviewers }) {
            const wide = formatReviewingFooter(FRAME, reviewers, 120, 0);
            const narrow = formatReviewingFooter(FRAME, reviewers, 50, 0);
            const tiny = formatReviewingFooter(FRAME, reviewers, 15, 0);
            return { wide, narrow, tiny };
        },
        ASSERTS: {
            "wide width returns the full form"(result) {
                Assert.strictEqual(stripAnsi(result.wide), "review: ⣋ claude (default): running, claude (default): running");
            },
            "narrow width returns the compact form"(result) {
                Assert.strictEqual(stripAnsi(result.narrow), "review: ⣋ claude: running, claude: running");
            },
            "tiny width returns the truncated form"(result) {
                Assert.strictEqual(stripAnsi(result.tiny), "review: ⣋ clau…");
            }
        }
    });

    test("renders a waiting reviewer with an endTime as 'waiting <compact>' alongside other reviewers", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "waiting", endTime: 134 * 60 * 1000 },
                { tool: "codex", model: "gpt-5", effort: "high", state: "running" }
            ];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 200, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): waiting 2h14m, codex (gpt-5 high): running");
        }
    });

    test("computes a waiting reviewer's remaining wait from endTime minus nowMs", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "waiting", endTime: 200 * 60 * 1000 }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 200, 66 * 60 * 1000);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): waiting 2h14m");
        }
    });

    test("clamps a waiting reviewer's elapsed remaining wait to zero, rendering '1m'", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "waiting", endTime: 1000 }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 200, 60000);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): waiting 1m");
        }
    });

    test("renders a waiting reviewer with no endTime as the bare 'waiting'", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "waiting" }];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 200, 5_000_000);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): waiting");
        }
    });

    test("keeps a waiting reviewer's countdown through the compact-form tier, dropping only the descriptor", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "sonnet", effort: "high", state: "waiting", endTime: 134 * 60 * 1000 },
                { tool: "codex", model: "gpt-5", effort: "high", state: "running" }
            ];
            const compact = "review: ⣋ claude: waiting 2h14m, codex: running";
            // cols equal to the compact width: the full form (with descriptors) does
            // not fit, the compact form fits exactly, so the countdown must survive.
            return { reviewers, cols: compact.length, compact };
        },
        ACT({ reviewers, cols }) {
            return formatReviewingFooter(FRAME, reviewers, cols, 0);
        },
        ASSERT(result, { compact }) {
            Assert.strictEqual(stripAnsi(result), compact);
        }
    });

    test("cuts a waiting reviewer's countdown only at the truncation tier", {
        ARRANGE() {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "sonnet", effort: "high", state: "waiting", endTime: 134 * 60 * 1000 }];
            return { reviewers, cols: 15 };
        },
        ACT({ reviewers, cols }) {
            return formatReviewingFooter(FRAME, reviewers, cols, 0);
        },
        ASSERTS: {
            "exact truncated plain string matches"(result) {
                Assert.strictEqual(stripAnsi(result), "review: ⣋ clau…");
            },
            "plain text length equals cols"(result) {
                Assert.strictEqual(stripAnsi(result).length, 15);
            }
        }
    });

    test("renders each waiting reviewer's own countdown independently from its own endTime", {
        ARRANGE() {
            // Two reviewers waiting at the same instant with distinct end times must
            // each render their own compact countdown (2h14m vs 14m), not a shared one.
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "waiting", endTime: 134 * 60 * 1000 },
                { tool: "codex", model: "", effort: "", state: "waiting", endTime: 14 * 60 * 1000 }
            ];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 200, 0);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): waiting 2h14m, codex (default): waiting 14m");
        }
    });

    test("recomputes each waiting reviewer's countdown against a shared nowMs", {
        ARRANGE() {
            // Distinct end times relative to a non-zero nowMs: each remaining wait is
            // (endTime - nowMs), so the two countdowns differ (1h0m vs 5m).
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "waiting", endTime: 70 * 60 * 1000 },
                { tool: "codex", model: "", effort: "", state: "waiting", endTime: 15 * 60 * 1000 }
            ];
            return { reviewers };
        },
        ACT({ reviewers }) {
            return formatReviewingFooter(FRAME, reviewers, 200, 10 * 60 * 1000);
        },
        ASSERT(result) {
            Assert.strictEqual(stripAnsi(result), "review: ⣋ claude (default): waiting 1h0m, codex (default): waiting 5m");
        }
    });
});

test.describe("formatWorkingFooter", test => {
    test("returns the full ORANGE-wrapped string when the plain text fits within cols", {
        ARRANGE() {
            return { frame: "⣋", label: "Workin'-diddly", cols: 120 };
        },
        ACT({ frame, label, cols }) {
            return formatWorkingFooter(frame, label, cols);
        },
        ASSERT(result) {
            Assert.strictEqual(result, ORANGE + "⣋ Workin'-diddly" + RESET);
        }
    });

    test("interpolates the frame and the label as `${frame} ${label}`", {
        ARRANGE() {
            return { frame: "⣙", label: "Toilin' away", cols: 120 };
        },
        ACT({ frame, label, cols }) {
            return formatWorkingFooter(frame, label, cols);
        },
        ASSERT(result) {
            Assert.strictEqual(result, ORANGE + "⣙ Toilin' away" + RESET);
        }
    });

    test("returns the full untruncated string at exact boundary (plain length === cols)", {
        ARRANGE() {
            const frame = "⣋";
            const label = "Workin'-diddly";
            const plain = `${frame} ${label}`;
            return { frame, label, cols: plain.length, plain };
        },
        ACT({ frame, label, cols }) {
            return formatWorkingFooter(frame, label, cols);
        },
        ASSERTS: {
            "returns the full ORANGE-wrapped string"(result, { plain }) {
                Assert.strictEqual(result, ORANGE + plain + RESET);
            },
            "contains no ellipsis"(result) {
                Assert.ok(!result.includes("…"));
            }
        }
    });

    test("truncates with a trailing ellipsis when the plain text exceeds cols", {
        ARRANGE() {
            return { frame: "⣋", label: "Workin'-diddly", cols: 5 };
        },
        ACT({ frame, label, cols }) {
            return formatWorkingFooter(frame, label, cols);
        },
        ASSERTS: {
            "exact truncated plain string matches"(result) {
                Assert.strictEqual(stripAnsi(result), "⣋ Wo…");
            },
            "plain text length equals cols"(result) {
                Assert.strictEqual(stripAnsi(result).length, 5);
            },
            "ends with ellipsis"(result) {
                Assert.ok(stripAnsi(result).endsWith("…"));
            },
            "colors the surviving prefix in ORANGE with trailing RESET"(result) {
                Assert.strictEqual(result, ORANGE + "⣋ Wo" + RESET + "…");
            }
        }
    });

    test("truncates a long working variant rather than letting it overflow", {
        ARRANGE() {
            return { frame: "⣋", label: "Diddly-developin'", cols: 12 };
        },
        ACT({ frame, label, cols }) {
            return formatWorkingFooter(frame, label, cols);
        },
        ASSERTS: {
            "exact truncated plain string matches"(result) {
                Assert.strictEqual(stripAnsi(result), "⣋ Diddly-de…");
            },
            "plain text length equals cols"(result) {
                Assert.strictEqual(stripAnsi(result).length, 12);
            }
        }
    });
});

test.describe("formatWaitingFooter", test => {
    test("returns the full ORANGE-wrapped string when the plain text fits within cols", {
        ARRANGE() {
            return { heading: "Waiting rate limit", dateTime: "2025-01-15 09:05", countdown: "15 minutes", cols: 120 };
        },
        ACT({ heading, dateTime, countdown, cols }) {
            return formatWaitingFooter(heading, dateTime, countdown, cols);
        },
        ASSERT(result) {
            Assert.strictEqual(result, ORANGE + "Waiting rate limit — 2025-01-15 09:05 — 15 minutes" + RESET);
        }
    });

    test("returns the full untruncated string at exact boundary (plain length === cols)", {
        ARRANGE() {
            const heading = "Waiting rate limit";
            const dateTime = "2025-01-15 09:05";
            const countdown = "15 minutes";
            const plain = `${heading} — ${dateTime} — ${countdown}`;
            return { heading, dateTime, countdown, cols: plain.length, plain };
        },
        ACT({ heading, dateTime, countdown, cols }) {
            return formatWaitingFooter(heading, dateTime, countdown, cols);
        },
        ASSERTS: {
            "returns the full ORANGE-wrapped string"(result, { plain }) {
                Assert.strictEqual(result, ORANGE + plain + RESET);
            },
            "contains no ellipsis"(result) {
                Assert.ok(!result.includes("…"));
            }
        }
    });

    test("truncates with a trailing ellipsis when the plain text exceeds cols", {
        ARRANGE() {
            return { heading: "Waiting rate limit", dateTime: "2025-01-15 09:05", countdown: "15 minutes", cols: 15 };
        },
        ACT({ heading, dateTime, countdown, cols }) {
            return formatWaitingFooter(heading, dateTime, countdown, cols);
        },
        ASSERTS: {
            "exact truncated plain string matches"(result) {
                Assert.strictEqual(stripAnsi(result), "Waiting rate l…");
            },
            "plain text length equals cols"(result) {
                Assert.strictEqual(stripAnsi(result).length, 15);
            },
            "ends with ellipsis"(result) {
                Assert.ok(stripAnsi(result).endsWith("…"));
            },
            "colors the surviving prefix in ORANGE with trailing RESET"(result) {
                Assert.strictEqual(result, ORANGE + "Waiting rate l" + RESET + "…");
            }
        }
    });
});

test.describe("formatTerminalFooter", test => {
    test("returns the full ORANGE-wrapped label when the plain text fits within cols", {
        ARRANGE() {
            return { label: "All wrapped up, neighbor", cols: 120 };
        },
        ACT({ label, cols }) {
            return formatTerminalFooter(label, cols);
        },
        ASSERT(result) {
            Assert.strictEqual(result, ORANGE + "All wrapped up, neighbor" + RESET);
        }
    });

    test("returns the full untruncated label at exact boundary (plain length === cols)", {
        ARRANGE() {
            const label = "All wrapped up, neighbor";
            return { label, cols: label.length };
        },
        ACT({ label, cols }) {
            return formatTerminalFooter(label, cols);
        },
        ASSERTS: {
            "returns the full ORANGE-wrapped label"(result, { label }) {
                Assert.strictEqual(result, ORANGE + label + RESET);
            },
            "contains no ellipsis"(result) {
                Assert.ok(!result.includes("…"));
            }
        }
    });

    test("truncates a long terminal variant with a trailing ellipsis when the plain text exceeds cols", {
        ARRANGE() {
            return { label: "Hold the phone — interrupted", cols: 12 };
        },
        ACT({ label, cols }) {
            return formatTerminalFooter(label, cols);
        },
        ASSERTS: {
            "exact truncated plain string matches"(result) {
                Assert.strictEqual(stripAnsi(result), "Hold the ph…");
            },
            "plain text length equals cols"(result) {
                Assert.strictEqual(stripAnsi(result).length, 12);
            },
            "colors the surviving prefix in ORANGE with trailing RESET"(result) {
                Assert.strictEqual(result, ORANGE + "Hold the ph" + RESET + "…");
            }
        }
    });
});
