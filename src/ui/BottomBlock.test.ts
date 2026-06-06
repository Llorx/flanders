import * as Assert from "assert";

import test from "arrange-act-assert";

import { BottomBlock } from "./BottomBlock";
import type { BottomBlockIO, ReviewerEntry } from "./BottomBlock";
import type { TimeoutHandle } from "../contexts";
import { CYAN, YELLOW, MAGENTA, GREEN, ORANGE, RESET, SEPARATOR_GLYPH, formatDateTime, stripAnsi } from "./formatters";

type FakeTimer = { handler:() => void; at:number };

function fakeTime() {
    const timers:FakeTimer[] = [];
    let now = 0;
    return {
        now() { return now; },
        setNow(ms:number) { now = ms; },
        setTimeout(handler:() => void, ms:number):TimeoutHandle {
            const timer:FakeTimer = { handler, at: now + ms };
            timers.push(timer);
            return {
                cancel() {
                    const idx = timers.indexOf(timer);
                    if (idx !== -1) timers.splice(idx, 1);
                }
            };
        },
        advance(ms:number) {
            const target = now + ms;
            for (;;) {
                let earliest = -1;
                for (let i = 0; i < timers.length; i++) {
                    if (timers[i]!.at <= target && (earliest === -1 || timers[i]!.at < timers[earliest]!.at)) {
                        earliest = i;
                    }
                }
                if (earliest === -1) break;
                const [timer] = timers.splice(earliest, 1);
                now = timer!.at;
                timer!.handler();
            }
            now = target;
        },
        get pendingCount() { return timers.length; }
    };
}

function stubIO(cols:number = 80) {
    const writes:string[] = [];
    const resizeListeners:Set<() => void> = new Set();
    return {
        writes,
        get output() { return writes.join(""); },
        reset() { writes.length = 0; },
        write(text:string) { writes.push(text); },
        columns() { return cols; },
        setCols(n:number) { cols = n; },
        onResize(listener:() => void) {
            resizeListeners.add(listener);
            return () => { resizeListeners.delete(listener); };
        },
        emitResize() { for (const l of resizeListeners) l(); },
        get resizeListenerCount() { return resizeListeners.size; }
    };
}

const SEP = SEPARATOR_GLYPH;
const CLEAR_SEQ = "\x1b[3A\r\x1b[J";
const ALT_SCREEN_ON = "\x1b[?1049h";

function makeBlock(io:BottomBlockIO, time:ReturnType<typeof fakeTime>) {
    return new BottomBlock(io, time);
}

test.describe("BottomBlock", test => {
    test("mount initial paints separator, header blank, metrics blank, footer Working with first frame", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            return { io, time };
        },
        ACT({ io, time }) {
            const block = makeBlock(io, time);
            block.mount();
            return io.output;
        },
        ASSERTS: {
            "contains separator spanning terminal width"(output) {
                Assert.ok(output.includes(SEP.repeat(20)));
            },
            "header line is blank"(output) {
                const sep = SEP.repeat(20);
                const afterSep = output.slice(output.indexOf(sep) + sep.length + 1);
                const lines = afterSep.split("\n");
                Assert.strictEqual(stripAnsi(lines[0] ?? "MISSING"), "");
            },
            "metrics line is blank"(output) {
                const sep = SEP.repeat(20);
                const afterSep = output.slice(output.indexOf(sep) + sep.length + 1);
                const lines = afterSep.split("\n");
                Assert.strictEqual(stripAnsi(lines[1] ?? "MISSING"), "");
            },
            "contains orange color"(output) {
                Assert.ok(output.includes(ORANGE));
            },
            "contains Working label"(output) {
                Assert.ok(output.includes("Working"));
            },
            "contains first animation frame"(output) {
                Assert.ok(output.includes("⣋"));
            }
        }
    });

    test("second mount call produces no additional output", {
        ARRANGE() {
            const io = stubIO(10);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            return { io, block };
        },
        ACT({ io, block }) {
            const before = io.writes.length;
            block.mount();
            return io.writes.length - before;
        },
        ASSERT(added) {
            Assert.strictEqual(added, 0);
        }
    });

    test("setHeader with indexLabel only redraws with that info and rest blank", {
        ARRANGE() {
            const io = stubIO(80);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.setHeader({ indexLabel: "3/7" });
            return io.output;
        },
        ASSERTS: {
            "clears old block"(output) {
                Assert.ok(output.includes(CLEAR_SEQ));
            },
            "header plain text is just the index label"(output) {
                const lines = output.split("\n");
                const headerLine = lines[1] ?? "";
                Assert.strictEqual(stripAnsi(headerLine), "3/7");
            },
            "index label is cyan"(output) {
                Assert.ok(output.includes(CYAN + "3/7" + RESET));
            }
        }
    });

    test("setHeader with all fields redraws with full header", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.setHeader({ indexLabel: "5/12", iteration: 2, activity: "implementing", taskNumber: "7.3", title: "Add login page" });
            return io.output;
        },
        ASSERTS: {
            "contains cyan index"(output) {
                Assert.ok(output.includes(CYAN + "5/12" + RESET));
            },
            "contains yellow iteration"(output) {
                Assert.ok(output.includes(YELLOW + "iter 2" + RESET));
            },
            "contains magenta activity"(output) {
                Assert.ok(output.includes(MAGENTA + "implementing" + RESET));
            },
            "contains green task number"(output) {
                Assert.ok(output.includes(GREEN + "7.3" + RESET));
            },
            "contains title"(output) {
                Assert.ok(output.includes("Add login page"));
            }
        }
    });

    test("setMetrics with only plan pair redraws with plan present and task absent", {
        ARRANGE() {
            const io = stubIO(100);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.setMetrics({ plan: { tokens: 1_200_000, seconds: 3792 } });
            return io.output;
        },
        ASSERTS: {
            "plain metrics contains plan label"(output) {
                const lines = output.split("\n");
                const metricsPlain = stripAnsi(lines[2] ?? "");
                Assert.ok(metricsPlain.includes("plan"));
            },
            "plain metrics contains formatted token count"(output) {
                const lines = output.split("\n");
                const metricsPlain = stripAnsi(lines[2] ?? "");
                Assert.ok(metricsPlain.includes("1.2M"));
            },
            "plain metrics does not contain task label"(output) {
                const lines = output.split("\n");
                const metricsPlain = stripAnsi(lines[2] ?? "");
                Assert.ok(!metricsPlain.includes("task"));
            },
            "plain metrics does not contain separator bar"(output) {
                const lines = output.split("\n");
                const metricsPlain = stripAnsi(lines[2] ?? "");
                Assert.ok(!metricsPlain.includes("│"));
            }
        }
    });

    test("setMetrics with both pairs and insufficient width falls to compact form", {
        ARRANGE() {
            const io = stubIO(30);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.setMetrics({ task: { tokens: 16432, seconds: 142 }, plan: { tokens: 1_200_000, seconds: 3792 } });
            return io.output;
        },
        ASSERT(output) {
            const lines = output.split("\n");
            const metricsPlain = stripAnsi(lines[2] ?? "");
            Assert.ok(metricsPlain.includes("t:") || metricsPlain.includes("…"), "falls back to compact or truncated form");
        }
    });

    test("setFooter rate-limit changes footer to countdown, cancels animation, and programs tick every second", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            time.setNow(1000);
            block.setFooter({ kind: "waiting", waitKind: "rate-limit", endTime: 61000 });
            const afterSet = io.output;
            io.reset();
            time.advance(1000);
            const afterTick = io.output;
            return { afterSet, afterTick, pendingCount: time.pendingCount };
        },
        ASSERTS: {
            "footer heading is exactly Waiting rate limit"(result) {
                const footer = stripAnsi(result.afterSet.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[0], "Waiting rate limit");
            },
            "footer expected-end field is exactly the formatted endTime"(result) {
                const footer = stripAnsi(result.afterSet.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[1], formatDateTime(new Date(61000)));
            },
            "footer includes countdown in minutes"(result) {
                Assert.ok(result.afterSet.includes("1 minutes"));
            },
            "no Working label after switching to rate-limit"(result) {
                const afterSetFooter = result.afterSet.split(CLEAR_SEQ).pop() ?? "";
                Assert.ok(!afterSetFooter.includes("Working"));
            },
            "countdown tick heading is exactly Waiting rate limit"(result) {
                const footer = stripAnsi(result.afterTick.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[0], "Waiting rate limit");
            },
            "has a pending countdown timer"(result) {
                Assert.strictEqual(result.pendingCount, 1);
            },
            "footer is rendered in orange"(result) {
                Assert.ok(result.afterSet.includes(ORANGE + "Waiting rate limit"));
            }
        }
    });

    test("setFooter working from rate-limit cancels countdown and resumes animation", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.setFooter({ kind: "waiting", waitKind: "rate-limit", endTime: 60000 });
            block.mount();
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            block.setFooter({ kind: "working" });
            const afterSwitch = io.output;
            io.reset();
            time.advance(200);
            const afterAnimTick = io.output;
            return { afterSwitch, afterAnimTick };
        },
        ASSERTS: {
            "shows Working after switching back"(result) {
                Assert.ok(result.afterSwitch.includes("Working"));
            },
            "no countdown label after switching"(result) {
                Assert.ok(!result.afterSwitch.includes("Waiting rate limit"));
            },
            "animation ticks after 200ms"(result) {
                Assert.ok(result.afterAnimTick.includes("Working"));
            }
        }
    });

    test("animation frame advances at 200ms and each advance redraws entire block", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            time.advance(200);
            return io.output;
        },
        ASSERTS: {
            "clears old block"(output) {
                Assert.ok(output.includes(CLEAR_SEQ));
            },
            "redraws separator"(output) {
                Assert.ok(output.includes(SEP.repeat(20)));
            },
            "shows second animation frame"(output) {
                Assert.ok(output.includes("⣙"));
            },
            "contains Working label"(output) {
                Assert.ok(output.includes("Working"));
            }
        }
    });

    test("countdown redraws each second recomputing against time.now()", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(59000);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "waiting", waitKind: "rate-limit", endTime: 121000 });
            block.mount();
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            time.advance(1000);
            const firstTick = io.output;
            io.reset();
            time.advance(1000);
            const secondTick = io.output;
            return { firstTick, secondTick };
        },
        ASSERTS: {
            "first tick heading is exactly Waiting rate limit"(result) {
                const footer = stripAnsi(result.firstTick.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[0], "Waiting rate limit");
            },
            "first tick clears block"(result) {
                Assert.ok(result.firstTick.includes(CLEAR_SEQ));
            },
            "second tick heading is exactly Waiting rate limit"(result) {
                const footer = stripAnsi(result.secondTick.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[0], "Waiting rate limit");
            },
            "second tick clears block"(result) {
                Assert.ok(result.secondTick.includes(CLEAR_SEQ));
            },
            "first tick shows 2 minutes remaining"(result) {
                Assert.ok(result.firstTick.includes("2 minutes"));
            },
            "second tick shows 1 minutes remaining"(result) {
                Assert.ok(result.secondTick.includes("1 minutes"));
            }
        }
    });

    test("truncation: long indexLabel with small width gets ellipsis; wider width after resize does not", {
        ARRANGE() {
            const io = stubIO(6);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            return { io, time, block };
        },
        ACT({ io, block }) {
            block.setHeader({ indexLabel: "0/12345" });
            const narrowOutput = io.output;
            io.reset();
            io.setCols(80);
            io.emitResize();
            const wideOutput = io.output;
            return { narrowOutput, wideOutput };
        },
        ASSERTS: {
            "narrow width truncates with ellipsis"(result) {
                const lastDraw = result.narrowOutput.split(CLEAR_SEQ).pop() ?? "";
                const lines = lastDraw.split("\n");
                const headerPlain = stripAnsi(lines[1] ?? "");
                Assert.ok(headerPlain.endsWith("…"), "header ends with ellipsis at narrow width");
            },
            "wide width after resize does not truncate"(result) {
                const lastDraw = result.wideOutput.split(CLEAR_SEQ).pop() ?? "";
                const lines = lastDraw.split("\n");
                const headerPlain = stripAnsi(lines[1] ?? "");
                Assert.ok(!headerPlain.includes("…"), "header has no ellipsis after resize to wider width");
                Assert.strictEqual(headerPlain, "0/12345");
            }
        }
    });

    test("writeAbove during rate-limit maintains countdown and block consistency", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.setFooter({ kind: "waiting", waitKind: "rate-limit", endTime: 120000 });
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.writeAbove("some output line\n");
            return io.output;
        },
        ASSERTS: {
            "clears block before writing"(output) {
                Assert.ok(output.includes(CLEAR_SEQ));
            },
            "text appears before block"(output) {
                const textIdx = output.indexOf("some output line");
                const sepIdx = output.lastIndexOf(SEP.repeat(120));
                Assert.ok(textIdx < sepIdx);
            },
            "redrawn block heading is exactly Waiting rate limit"(output) {
                const footer = stripAnsi(output.split("\n").pop() ?? "");
                Assert.strictEqual(footer.split(" — ")[0], "Waiting rate limit");
            }
        }
    });

    test("finalize Done paints terminal footer, leaves cursor below, cancels timers, unsubscribes resize, and is idempotent", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            block.finalize("Done");
            const afterFinalize = io.output;
            io.reset();
            block.finalize("Done");
            const afterSecondFinalize = io.output;
            time.advance(1000);
            const afterTimerAdvance = io.output;
            return { afterFinalize, afterSecondFinalize, afterTimerAdvance, pendingCount: time.pendingCount, resizeCount: io.resizeListenerCount };
        },
        ASSERTS: {
            "footer shows Done in orange"(result) {
                Assert.ok(result.afterFinalize.includes(ORANGE + "Done" + RESET));
            },
            "content after the terminal label is exactly the autowrap restore followed by a single newline"(result) {
                const labelStr = ORANGE + "Done" + RESET;
                const labelIdx = result.afterFinalize.lastIndexOf(labelStr);
                Assert.ok(labelIdx !== -1, "terminal label should be present");
                Assert.strictEqual(result.afterFinalize.slice(labelIdx + labelStr.length), "\x1b[?7h\n");
            },
            "no timers pending after finalize"(result) {
                Assert.strictEqual(result.pendingCount, 0);
            },
            "resize unsubscribed"(result) {
                Assert.strictEqual(result.resizeCount, 0);
            },
            "second finalize produces no output"(result) {
                Assert.strictEqual(result.afterSecondFinalize, "");
            },
            "no writes after time advance following finalize"(result) {
                Assert.strictEqual(result.afterTimerAdvance, "");
            }
        }
    });

    test("finalize Hard stop shows correct label", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.finalize("Hard stop");
            return io.output;
        },
        ASSERT(output) {
            Assert.ok(output.includes(ORANGE + "Hard stop" + RESET));
        }
    });

    test("finalize Interrupted shows correct label", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.finalize("Interrupted");
            return io.output;
        },
        ASSERT(output) {
            Assert.ok(output.includes(ORANGE + "Interrupted" + RESET));
        }
    });

    test("finalize Failed shows correct label", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.finalize("Failed");
            return io.output;
        },
        ASSERT(output) {
            Assert.ok(output.includes(ORANGE + "Failed" + RESET));
        }
    });

    test("after finalize setHeader setMetrics setFooter are no-op", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            block.finalize("Done");
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.setHeader({ indexLabel: "1/1" });
            block.setMetrics({ plan: { tokens: 1000, seconds: 10 } });
            block.setFooter({ kind: "working" });
            return io.writes.length;
        },
        ASSERT(writeCount) {
            Assert.strictEqual(writeCount, 0);
        }
    });

    test("dispose before finalize cancels timers and unsubscribes but does not write", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            block.dispose();
            const afterDispose = io.output;
            time.advance(1000);
            const afterAdvance = io.output;
            return { afterDispose, afterAdvance, pendingCount: time.pendingCount, resizeCount: io.resizeListenerCount };
        },
        ASSERTS: {
            "no writes from dispose itself"(result) {
                Assert.strictEqual(result.afterDispose, "");
            },
            "no writes after timer advance"(result) {
                Assert.strictEqual(result.afterAdvance, "");
            },
            "no pending timers"(result) {
                Assert.strictEqual(result.pendingCount, 0);
            },
            "resize unsubscribed"(result) {
                Assert.strictEqual(result.resizeCount, 0);
            }
        }
    });

    test("writeAbove after dispose writes nothing", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            block.dispose();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.writeAbove("should be ignored\n");
            return io.writes.length;
        },
        ASSERT(writeCount) {
            Assert.strictEqual(writeCount, 0);
        }
    });

    test("finalize after dispose writes nothing", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            block.dispose();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.finalize("Done");
            return io.writes.length;
        },
        ASSERT(writeCount) {
            Assert.strictEqual(writeCount, 0);
        }
    });

    test("mount after dispose is no-op", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.dispose();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.mount();
            return io.writes.length;
        },
        ASSERT(writeCount) {
            Assert.strictEqual(writeCount, 0);
        }
    });

    test("second dispose call is no-op", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            return { io, block };
        },
        ACT({ io, block }) {
            block.dispose();
            const before = io.writes.length;
            block.dispose();
            return io.writes.length - before;
        },
        ASSERT(added) {
            Assert.strictEqual(added, 0);
        }
    });

    test("resize after finalize does not write anything", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            block.finalize("Done");
            io.reset();
            return io;
        },
        ACT(io) {
            io.emitResize();
            return io.writes.length;
        },
        ASSERT(writeCount) {
            Assert.strictEqual(writeCount, 0);
        }
    });

    test("no alternate-screen buffer sequences are emitted", {
        ARRANGE() {
            const io = stubIO(10);
            const time = fakeTime();
            return { io, time };
        },
        ACT({ io, time }) {
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            block.setHeader({ indexLabel: "1/1", iteration: 1, activity: "implementing", taskNumber: "1.1", title: "test" });
            block.setMetrics({ task: { tokens: 100, seconds: 10 }, plan: { tokens: 200, seconds: 20 } });
            block.writeAbove("text\n");
            block.finalize("Done");
            return io.output;
        },
        ASSERT(output) {
            Assert.ok(!output.includes(ALT_SCREEN_ON));
        }
    });

    test("animation runs at 5fps rate", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            let redrawCount = 0;
            for (let i = 0; i < 5; i++) {
                io.reset();
                time.advance(200);
                if (io.writes.length > 0) redrawCount++;
            }
            return redrawCount;
        },
        ASSERT(redrawCount) {
            Assert.strictEqual(redrawCount, 5, "5 redraws in 1 second = 5fps");
        }
    });

    test("all animation frames include orange and Working", {
        ARRANGE() {
            const io = stubIO(40);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            return { io, time };
        },
        ACT({ io, time }) {
            const frames:string[] = [];
            for (let i = 0; i < 10; i++) {
                io.reset();
                time.advance(200);
                frames.push(io.output);
            }
            return frames;
        },
        ASSERTS: {
            "all animation frames include orange"(frames) {
                for (const frame of frames) {
                    Assert.ok(frame.includes(ORANGE), "should contain orange");
                }
            },
            "all animation frames include Working"(frames) {
                for (const frame of frames) {
                    Assert.ok(frame.includes("Working"), "should contain Working");
                }
            },
            "all animation frames include reset"(frames) {
                for (const frame of frames) {
                    Assert.ok(frame.includes(RESET), "should contain reset");
                }
            }
        }
    });

    test("full lifecycle emits expected write sequence", {
        ARRANGE() {
            const io = stubIO(10);
            const time = fakeTime();
            return { io, time };
        },
        ACT({ io, time }) {
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            const afterMount = [...io.writes];
            io.reset();

            block.setHeader({ indexLabel: "1/3", iteration: 1, activity: "implementing", taskNumber: "1.1", title: "Test" });
            const afterSetHeader = [...io.writes];
            io.reset();

            block.setMetrics({ task: { tokens: 100, seconds: 5 }, plan: { tokens: 200, seconds: 10 } });
            const afterSetMetrics = [...io.writes];
            io.reset();

            block.writeAbove("line\n");
            const afterWriteAbove = [...io.writes];
            io.reset();

            block.finalize("Done");
            const afterFinalize = [...io.writes];
            return { afterMount, afterSetHeader, afterSetMetrics, afterWriteAbove, afterFinalize };
        },
        ASSERTS: {
            "mount writes the block directly"(result) {
                Assert.strictEqual(result.afterMount.length, 1);
                Assert.ok(result.afterMount[0]!.includes(SEP.repeat(10)));
            },
            "setHeader clears then redraws"(result) {
                Assert.strictEqual(result.afterSetHeader[0], CLEAR_SEQ);
                Assert.ok(result.afterSetHeader[1]!.includes(SEP.repeat(10)));
            },
            "setMetrics clears then redraws"(result) {
                Assert.strictEqual(result.afterSetMetrics[0], CLEAR_SEQ);
                Assert.ok(result.afterSetMetrics[1]!.includes(SEP.repeat(10)));
            },
            "writeAbove clears, writes text, then redraws"(result) {
                Assert.strictEqual(result.afterWriteAbove[0], CLEAR_SEQ);
                Assert.strictEqual(result.afterWriteAbove[1], "line\n");
                Assert.ok(result.afterWriteAbove[2]!.includes(SEP.repeat(10)));
            },
            "finalize clears, redraws with terminal label, and ends with newline"(result) {
                Assert.strictEqual(result.afterFinalize[0], CLEAR_SEQ);
                const blockDraw = result.afterFinalize[1]!;
                Assert.ok(blockDraw.includes(ORANGE + "Done" + RESET));
                Assert.strictEqual(result.afterFinalize[2], "\n");
            }
        }
    });

    test("separator adjusts when columns changes between redraws", {
        ARRANGE() {
            const io = stubIO(10);
            const time = fakeTime();
            return { io, time };
        },
        ACT({ io, time }) {
            const block = makeBlock(io, time);
            block.mount();
            const firstHas10 = io.output.includes(SEP.repeat(10));
            io.reset();
            io.setCols(5);
            block.setHeader({ indexLabel: "1/1" });
            const secondHas5 = io.output.includes(SEP.repeat(5));
            const secondLacks10 = !io.output.includes(SEP.repeat(10));
            return { firstHas10, secondHas5, secondLacks10 };
        },
        ASSERTS: {
            "first draw uses 10-column separator"(result) {
                Assert.ok(result.firstHas10);
            },
            "second draw uses 5-column separator"(result) {
                Assert.ok(result.secondHas5);
            },
            "old separator width absent after resize"(result) {
                Assert.ok(result.secondLacks10);
            }
        }
    });

    test("resize redraws block at new width when mounted", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            const b = makeBlock(io, time);
            b.setHeader({ indexLabel: "1/1" });
            b.mount();
            io.reset();
            return io;
        },
        ACT(io) {
            io.setCols(30);
            io.emitResize();
            return io.output;
        },
        ASSERTS: {
            "clears old block"(output) {
                Assert.ok(output.includes(CLEAR_SEQ));
            },
            "separator spans new width"(output) {
                Assert.ok(output.includes(SEP.repeat(30)));
            }
        }
    });

    test("writeAbove when not mounted writes text directly", {
        ARRANGE() {
            const io = stubIO(10);
            const time = fakeTime();
            return { io, time };
        },
        ACT({ io, time }) {
            const block = makeBlock(io, time);
            block.writeAbove("plain text\n");
            return io.output;
        },
        ASSERT(output) {
            Assert.strictEqual(output, "plain text\n");
        }
    });

    test("setFooter reviewing draws the reviewing line in ORANGE and contains the prefix and a configured reviewer", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            return { io, block, reviewers };
        },
        ACT({ io, block, reviewers }) {
            block.setFooter({ kind: "reviewing", reviewers });
            return io.output;
        },
        ASSERTS: {
            "footer line plain text equals the formatted reviewing line"(output) {
                const lines = output.split("\n");
                const footerPlain = stripAnsi(lines[lines.length - 1] ?? "");
                Assert.strictEqual(footerPlain, "review: claude (default): running");
            },
            "footer line is wrapped in ORANGE"(output) {
                Assert.ok(output.includes(ORANGE + "review: claude (default): running" + RESET));
            },
            "no Working label rendered while reviewing"(output) {
                const lastDraw = output.split(CLEAR_SEQ).pop() ?? "";
                Assert.ok(!lastDraw.includes("Working"));
            }
        }
    });

    test("setFooter reviewing from working cancels animation timer and schedules no new timer", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            block.setFooter({ kind: "reviewing", reviewers });
            const pendingAfterSet = time.pendingCount;
            io.reset();
            time.advance(2000);
            const writesAfterAdvance = io.writes.length;
            return { pendingAfterSet, writesAfterAdvance };
        },
        ASSERTS: {
            "no timer pending after entering reviewing"(result) {
                Assert.strictEqual(result.pendingAfterSet, 0);
            },
            "no writes occur while time passes in the reviewing state"(result) {
                Assert.strictEqual(result.writesAfterAdvance, 0);
            }
        }
    });

    test("setFooter reviewing from rate-limit cancels countdown timer and schedules no new timer", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.setFooter({ kind: "waiting", waitKind: "rate-limit", endTime: 600000 });
            block.mount();
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            block.setFooter({ kind: "reviewing", reviewers });
            const pendingAfterSet = time.pendingCount;
            io.reset();
            time.advance(5000);
            const writesAfterAdvance = io.writes.length;
            return { pendingAfterSet, writesAfterAdvance };
        },
        ASSERTS: {
            "no timer pending after entering reviewing"(result) {
                Assert.strictEqual(result.pendingAfterSet, 0);
            },
            "countdown does not tick while reviewing"(result) {
                Assert.strictEqual(result.writesAfterAdvance, 0);
            }
        }
    });

    test("reviewing line recomputes its compaction tier on resize from the stored structured reviewer list", {
        ARRANGE() {
            const io = stubIO(50);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "running" },
                { tool: "claude", model: "", effort: "", state: "running" }
            ];
            return { io, block, reviewers };
        },
        ACT({ io, block, reviewers }) {
            block.setFooter({ kind: "reviewing", reviewers });
            const narrowDraw = io.output;
            io.reset();
            io.setCols(80);
            io.emitResize();
            const wideDraw = io.output;
            return { narrowDraw, wideDraw };
        },
        ASSERTS: {
            "narrow draw shows the compact form without the descriptor"(result) {
                const lastDraw = result.narrowDraw.split(CLEAR_SEQ).pop() ?? "";
                const footerPlain = stripAnsi(lastDraw.split("\n").pop() ?? "");
                Assert.strictEqual(footerPlain, "review: claude: running, claude: running");
            },
            "wide draw after resize shows the full form with the descriptor"(result) {
                const lastDraw = result.wideDraw.split(CLEAR_SEQ).pop() ?? "";
                const footerPlain = stripAnsi(lastDraw.split("\n").pop() ?? "");
                Assert.strictEqual(footerPlain, "review: claude (default): running, claude (default): running");
            }
        }
    });

    test("switching from reviewing back to working schedules the animation again", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            block.setFooter({ kind: "reviewing", reviewers });
            block.mount();
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            block.setFooter({ kind: "working" });
            const pendingAfterSwitch = time.pendingCount;
            io.reset();
            time.advance(200);
            const afterTick = io.output;
            return { pendingAfterSwitch, afterTick };
        },
        ASSERTS: {
            "a timer is pending after switching to working"(result) {
                Assert.strictEqual(result.pendingAfterSwitch, 1);
            },
            "the animation tick redraws the block"(result) {
                Assert.ok(result.afterTick.includes("Working"));
            }
        }
    });

    test("setFooter reviewing after finalize is a no-op", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            block.finalize("Done");
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            block.setFooter({ kind: "reviewing", reviewers });
            return io.writes.length;
        },
        ASSERT(writeCount) {
            Assert.strictEqual(writeCount, 0);
        }
    });

    test("setFooter reviewing after dispose is a no-op", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            block.dispose();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            block.setFooter({ kind: "reviewing", reviewers });
            return io.writes.length;
        },
        ASSERT(writeCount) {
            Assert.strictEqual(writeCount, 0);
        }
    });

    test("writeAbove while reviewing keeps the reviewing footer line beneath the new output", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            const reviewers:ReviewerEntry[] = [{ tool: "codex", model: "gpt-5", effort: "high", state: "ok" }];
            block.setFooter({ kind: "reviewing", reviewers });
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.writeAbove("scrollback line\n");
            return io.output;
        },
        ASSERTS: {
            "the new text appears before the redrawn block"(output) {
                const textIdx = output.indexOf("scrollback line");
                const sepIdx = output.lastIndexOf(SEP.repeat(120));
                Assert.ok(textIdx >= 0 && sepIdx > textIdx);
            },
            "the redrawn footer line is the formatted reviewing line"(output) {
                const footerPlain = stripAnsi(output.split("\n").pop() ?? "");
                Assert.strictEqual(footerPlain, "review: codex (gpt-5 high): ok");
            }
        }
    });

    test("working footer truncates at narrow width and re-expands after resize to a wider width", {
        ARRANGE() {
            const io = stubIO(5);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            return { io };
        },
        ACT({ io }) {
            const narrowDraw = io.output;
            io.reset();
            io.setCols(20);
            io.emitResize();
            const wideDraw = io.output;
            return { narrowDraw, wideDraw };
        },
        ASSERTS: {
            "narrow draw shows the working footer truncated with a trailing ellipsis"(result) {
                const footerPlain = stripAnsi(result.narrowDraw.split("\n").pop() ?? "");
                Assert.strictEqual(footerPlain, "⣋ Wo…");
            },
            "wide draw after resize shows the full Working label without ellipsis"(result) {
                const lastDraw = result.wideDraw.split(CLEAR_SEQ).pop() ?? "";
                const footerPlain = stripAnsi(lastDraw.split("\n").pop() ?? "");
                Assert.strictEqual(footerPlain, "⣋ Working");
            }
        }
    });

    test("waiting footer truncates at narrow width and re-expands after resize to a wider width", {
        ARRANGE() {
            const io = stubIO(15);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "waiting", waitKind: "rate-limit", endTime: 60000 });
            block.mount();
            return { io };
        },
        ACT({ io }) {
            const narrowDraw = io.output;
            io.reset();
            io.setCols(120);
            io.emitResize();
            const wideDraw = io.output;
            return { narrowDraw, wideDraw };
        },
        ASSERTS: {
            "narrow draw shows the waiting footer truncated with a trailing ellipsis"(result) {
                const footerPlain = stripAnsi(result.narrowDraw.split("\n").pop() ?? "");
                Assert.strictEqual(footerPlain, "Waiting rate l…");
            },
            "wide draw after resize shows the full waiting label without ellipsis"(result) {
                const lastDraw = result.wideDraw.split(CLEAR_SEQ).pop() ?? "";
                const footerPlain = stripAnsi(lastDraw.split("\n").pop() ?? "");
                Assert.strictEqual(footerPlain, `Waiting rate limit — ${formatDateTime(new Date(60000))} — 1 minutes`);
            }
        }
    });

    test("waiting footer recomputes the countdown on a resize redraw against the current clock", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "waiting", waitKind: "rate-limit", endTime: 120000 });
            block.mount();
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            time.setNow(60000);
            io.emitResize();
            const lastDraw = io.output.split(CLEAR_SEQ).pop() ?? "";
            return stripAnsi(lastDraw.split("\n").pop() ?? "");
        },
        ASSERT(footerPlain) {
            Assert.strictEqual(footerPlain, `Waiting rate limit — ${formatDateTime(new Date(120000))} — 1 minutes`);
        }
    });

    test("clearBlock emits exactly \\x1b[3A\\r\\x1b[J once a block has been drawn", {
        ARRANGE() {
            const io = stubIO(80);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.setHeader({ indexLabel: "1/1" });
            return io.writes[0];
        },
        ASSERT(clearWrite) {
            Assert.strictEqual(clearWrite, "\x1b[3A\r\x1b[J");
        }
    });

    test("clearBlock still emits exactly \\x1b[3A\\r\\x1b[J after a shrink resize", {
        ARRANGE() {
            const io = stubIO(80);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            io.setCols(5);
            return { io };
        },
        ACT({ io }) {
            io.emitResize();
            return io.writes[0];
        },
        ASSERT(clearWrite) {
            Assert.strictEqual(clearWrite, "\x1b[3A\r\x1b[J");
        }
    });

    test("draw block emits autowrap-off before the separator and autowrap-on after the footer, with the separator spanning cols glyphs", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            return { io, time };
        },
        ACT({ io, time }) {
            const block = makeBlock(io, time);
            block.mount();
            return io.writes[0]!;
        },
        ASSERTS: {
            "the write begins with the autowrap-off CSI followed by the cols-wide separator and its newline"(write) {
                Assert.ok(write.startsWith("\x1b[?7l" + SEP.repeat(20) + "\n"));
            },
            "the write ends with the autowrap-on CSI"(write) {
                Assert.ok(write.endsWith("\x1b[?7h"));
            },
            "the autowrap-off CSI appears once and only at the very start"(write) {
                Assert.strictEqual(write.indexOf("\x1b[?7l"), 0);
                Assert.strictEqual(write.lastIndexOf("\x1b[?7l"), 0);
            },
            "the autowrap-on CSI appears once and only at the very end"(write) {
                const lastIdx = write.lastIndexOf("\x1b[?7h");
                Assert.strictEqual(lastIdx, write.length - "\x1b[?7h".length);
                Assert.strictEqual(write.indexOf("\x1b[?7h"), lastIdx);
            },
            "exactly four block lines sit between the autowrap toggles"(write) {
                const inner = write.slice("\x1b[?7l".length, write.length - "\x1b[?7h".length);
                Assert.strictEqual(inner.split("\n").length, 4);
            }
        }
    });

    test("first paint writes no clear sequence because no block has been drawn yet", {
        ARRANGE() {
            const io = stubIO(20);
            const time = fakeTime();
            return { io, time };
        },
        ACT({ io, time }) {
            const block = makeBlock(io, time);
            block.mount();
            return { writes: [...io.writes], output: io.output };
        },
        ASSERTS: {
            "mount emits exactly one write so no clear preceded the first draw"(result) {
                Assert.strictEqual(result.writes.length, 1);
            },
            "the single write begins with autowrap-off followed by the separator at the current width and not a cursor-up CSI"(result) {
                Assert.ok(result.writes[0]!.startsWith("\x1b[?7l" + SEP.repeat(20)));
            },
            "the first-paint output contains no cursor-up CSI sequence in any form (parameterless \\x1b[A or parameterised \\x1b[<n>A)"(result) {
                Assert.ok(!/\x1b\[\d*A/.test(result.output), "first paint must not contain any CSI cursor-up sequence");
            }
        }
    });
});
