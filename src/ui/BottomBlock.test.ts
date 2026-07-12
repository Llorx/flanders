import * as Assert from "assert";

import test from "arrange-act-assert";
import { Terminal } from "@xterm/headless";

import { BottomBlock } from "./BottomBlock";
import type { BottomBlockIO, ReviewerEntry } from "./BottomBlock";
import type { RandomContext, TimeoutHandle } from "../contexts";
import { workingPool, successPool, hardStopPool, interruptionPool, failurePool } from "../voiceVariants";
import { CYAN, YELLOW, MAGENTA, GREEN, ORANGE, RESET, SEPARATOR_GLYPH, formatDateTime, formatTerminalFooter, stripAnsi } from "./formatters";

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

// A stub RandomContext returning a fixed float. The default 0 maps pickVariant to
// workingPool[0] === "Workin'-diddly", the deterministic working label every test
// that does not override it observes.
function fakeRandom(value:number = 0):RandomContext {
    return { random() { return value; } };
}

const DEFAULT_LABEL = workingPool[0]!; // "Workin'-diddly", what fakeRandom(0) selects.

// The terminal-label variants fakeRandom(0) selects from each outcome's pool —
// the deterministic terminal labels the default-random finalize tests observe.
const DONE_LABEL = successPool[0]!;
const HARD_STOP_LABEL = hardStopPool[0]!;
const INTERRUPTED_LABEL = interruptionPool[0]!;
const FAILED_LABEL = failurePool[0]!;

// Extracts the working label rendered in a footer line: everything after the
// single space that follows the one-glyph spinner frame. Lets tests read the
// rotating label off the rendered footer rather than any private field.
function workingLabelOf(output:string):string {
    const footerPlain = stripAnsi(output.split("\n").pop() ?? "");
    return footerPlain.slice(footerPlain.indexOf(" ") + 1);
}

// Reads the metrics line — the third row of the most recent block draw — as plain
// text. The block draws separator, header, metrics, footer in that order, so the
// metrics row is index 2 of the last draw (the segment after the final clear). Lets
// the live-time tests assert on what the metrics line renders rather than any
// private field.
function metricsLineOf(output:string):string {
    const lastDraw = output.split(CLEAR_SEQ).pop() ?? "";
    const lines = lastDraw.split("\n");
    return stripAnsi(lines[2] ?? "");
}

function makeBlock(io:BottomBlockIO, time:ReturnType<typeof fakeTime>, random:RandomContext = fakeRandom(0)) {
    return new BottomBlock(io, time, random);
}

// Reads each visible viewport row of an @xterm/headless Terminal as a plain
// string (trailing whitespace trimmed). The viewport spans buffer rows
// `viewportY` to `viewportY + term.rows - 1`, which the active buffer's
// scrolling state can shift after a resize-reflow, so each visible row is
// addressed relative to `viewportY` rather than directly by buffer index.
function readEmulatorViewport(term:Terminal):string[] {
    const buf = term.buffer.active;
    const rows:string[] = [];
    for (let y = 0; y < term.rows; y++) {
        const line = buf.getLine(buf.viewportY + y);
        rows.push(line ? line.translateToString(true) : "");
    }
    return rows;
}

// Builds a real BottomBlock driven through an @xterm/headless terminal pinned to
// the bottom of a `cols`-wide, `termRows`-tall screen with representative
// header/metrics fields, and returns the live block together with the terminal,
// the fake clock that drives its animation, a `flush` that waits for the emulator
// to parse pending bytes, and a `resize` that applies a width change through the
// production resize-listener path. Shared setup for every test that asserts
// rendered terminal geometry against the emulator's rendered grid — shrink-reflow,
// widen-reflow, and footer-state transitions — per
// rules/testing/terminal-geometry-tested-against-emulator.md. Callers drive
// setFooter / resize / time.advance, await `flush`, read the grid via
// readEmulatorViewport, then dispose the block and the terminal.
//
// When `aboveContent` is supplied, those lines (each typically wider than `cols`
// so the emulator wraps them) are written into the scrolling region *above* the
// block before it mounts — modelling the populated, wrapped output region a real
// run reflows on resize — and the cursor is then padded down so the block still
// lands pinned to the bottom. With no `aboveContent` (the default) the region
// above the block is the original blank filler, leaving the existing emulator
// tests unaffected.
async function mountEmulatorBlock(cols:number, termRows:number, aboveContent?:readonly string[], random:RandomContext = fakeRandom(0)) {
    // convertEol mirrors how the OS layer translates LF to CRLF when stdout is a real TTY.
    const term = new Terminal({ cols, rows: termRows, convertEol: true, allowProposedApi: true });
    const resizeListeners = new Set<() => void>();
    const io:BottomBlockIO = {
        write(text:string) { term.write(text); },
        columns() { return term.cols; },
        onResize(listener:() => void) {
            resizeListeners.add(listener);
            return () => { resizeListeners.delete(listener); };
        }
    };
    const time = fakeTime();
    const flush = () => new Promise<void>(resolve => { term.write("", resolve); });
    // Apply a width change through the production resize-listener path.
    const resize = (newCols:number) => {
        term.resize(newCols, term.rows);
        for (const listener of resizeListeners) listener();
    };
    // Seed the scrolling region above the block — real wrapped output when
    // `aboveContent` is given, otherwise blank filler — then push the cursor down
    // so the block lands at the bottom of the viewport, matching the live UI which
    // is always pinned to the bottom of the terminal.
    if (aboveContent && aboveContent.length > 0) {
        let physicalRows = 0;
        for (const line of aboveContent) {
            await new Promise<void>(resolve => { term.write(line + "\n", resolve); });
            physicalRows += Math.max(1, Math.ceil(line.length / cols));
        }
        const pad = Math.max(0, termRows - 4 - physicalRows);
        if (pad > 0) await new Promise<void>(resolve => { term.write("\n".repeat(pad), resolve); });
    } else {
        await new Promise<void>(resolve => { term.write("\n".repeat(termRows - 4), resolve); });
    }
    const block = new BottomBlock(io, time, random);
    block.mount();
    block.setHeader({ indexLabel: "5/12", iteration: 2, activity: "implementing", taskNumber: "7.3", title: "Task title" });
    block.setMetrics({ task: { tokens: 100, baseSeconds: 5 }, plan: { tokens: 200, baseSeconds: 10 } });
    await flush();
    return { term, block, time, flush, resize };
}

// Mounts an emulator-backed block (via mountEmulatorBlock) and applies a single
// shrink to `newCols` through the production resize path, returning the rendered
// viewport rows. The full-width separator reflows into ceil(initialCols/newCols)
// physical rows on a shrink, so this exercises the reflow the string-concatenating
// fake IO cannot model. Thin wrapper so the shrink and transition tests share one
// terminal/block setup, per docs/rules/code-deduplication.md.
async function renderEmulatorShrink(initialCols:number, newCols:number, termRows:number):Promise<string[]> {
    const { term, block, flush, resize } = await mountEmulatorBlock(initialCols, termRows);
    resize(newCols);
    await flush();
    const rows = readEmulatorViewport(term);
    block.dispose();
    term.dispose();
    return rows;
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
            "renders a working-pool label after the frame"(output) {
                Assert.ok(workingPool.includes(workingLabelOf(output)));
            },
            "renders the pool entry the stub random selected"(output) {
                Assert.strictEqual(workingLabelOf(output), DEFAULT_LABEL);
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

    test("setHeader with a detection-phase message renders it in magenta immediately after the index field with the per-task fields blank", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.setHeader({ indexLabel: "0/12", phaseMessage: "preparing build and test scripts" });
            return io.output;
        },
        ASSERTS: {
            "the header plain text is the index followed by the phase message and nothing else"(output) {
                const lines = output.split("\n");
                Assert.strictEqual(stripAnsi(lines[1] ?? ""), "0/12 preparing build and test scripts");
            },
            "the index field is cyan"(output) {
                Assert.ok(output.includes(CYAN + "0/12" + RESET));
            },
            "the phase message is magenta"(output) {
                Assert.ok(output.includes(MAGENTA + "preparing build and test scripts" + RESET));
            }
        }
    });

    test("the detection-phase header recomputes its fit from structured state on resize: truncated at a narrow width, full and magenta after widening", {
        ARRANGE() {
            const io = stubIO(10);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            return { io, block };
        },
        ACT({ io, block }) {
            block.setHeader({ indexLabel: "0/12", phaseMessage: "preparing build and test scripts" });
            const narrowOutput = io.output;
            io.reset();
            io.setCols(120);
            io.emitResize();
            const wideOutput = io.output;
            return { narrowOutput, wideOutput };
        },
        ASSERTS: {
            "the narrow draw truncates the header to the width with a trailing ellipsis"(result) {
                const lastDraw = result.narrowOutput.split(CLEAR_SEQ).pop() ?? "";
                const headerPlain = stripAnsi(lastDraw.split("\n")[1] ?? "");
                Assert.strictEqual(headerPlain, "0/12 prep…");
            },
            "the wide draw after resize restores the full untruncated header"(result) {
                const lastDraw = result.wideOutput.split(CLEAR_SEQ).pop() ?? "";
                const headerPlain = stripAnsi(lastDraw.split("\n")[1] ?? "");
                Assert.strictEqual(headerPlain, "0/12 preparing build and test scripts");
            },
            "the wide draw recomputes the magenta phase-message colour from the stored field"(result) {
                const lastDraw = result.wideOutput.split(CLEAR_SEQ).pop() ?? "";
                Assert.ok(lastDraw.includes(MAGENTA + "preparing build and test scripts" + RESET));
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
            block.setMetrics({ plan: { tokens: 1_200_000, baseSeconds: 3792 } });
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
            block.setMetrics({ task: { tokens: 16432, baseSeconds: 142 }, plan: { tokens: 1_200_000, baseSeconds: 3792 } });
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
            "no working label after switching to rate-limit"(result) {
                const afterSetFooter = result.afterSet.split(CLEAR_SEQ).pop() ?? "";
                Assert.ok(!afterSetFooter.includes(DEFAULT_LABEL));
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
            "shows the working label after switching back"(result) {
                Assert.ok(result.afterSwitch.includes(DEFAULT_LABEL));
            },
            "no countdown label after switching"(result) {
                Assert.ok(!result.afterSwitch.includes("Waiting rate limit"));
            },
            "animation ticks after 200ms"(result) {
                Assert.ok(result.afterAnimTick.includes(DEFAULT_LABEL));
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
            "contains the working label"(output) {
                Assert.ok(output.includes(DEFAULT_LABEL));
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
            "footer shows the success variant in orange"(result) {
                Assert.ok(result.afterFinalize.includes(ORANGE + DONE_LABEL + RESET));
            },
            "content after the terminal label is exactly the autowrap restore followed by a single newline"(result) {
                const labelStr = ORANGE + DONE_LABEL + RESET;
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

    test("finalize Hard stop shows a hard-stop variant", {
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
            Assert.ok(output.includes(ORANGE + HARD_STOP_LABEL + RESET));
        }
    });

    test("finalize Interrupted shows an interruption variant", {
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
            Assert.ok(output.includes(ORANGE + INTERRUPTED_LABEL + RESET));
        }
    });

    test("finalize Failed shows a failure variant", {
        ARRANGE() {
            const io = stubIO(80);
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
            Assert.ok(output.includes(ORANGE + FAILED_LABEL + RESET));
        }
    });

    for (const { outcome, pool } of [
        { outcome: "Done" as const, pool: successPool },
        { outcome: "Hard stop" as const, pool: hardStopPool },
        { outcome: "Interrupted" as const, pool: interruptionPool },
        { outcome: "Failed" as const, pool: failurePool }
    ]) {
        test(`finalize ${outcome} renders the ${outcome}-pool entry the injected random context selects`, {
            ARRANGE() {
                const io = stubIO(80);
                const time = fakeTime();
                // 0.5 * 10 = 5, so pool index 5 is selected — a different entry than the
                // fakeRandom(0) default, proving the variant is drawn through the injected
                // random context rather than fixed. At 80 cols every pool entry fits, so the
                // rendered footer is exactly the chosen variant.
                const block = makeBlock(io, time, fakeRandom(0.5));
                block.mount();
                io.reset();
                return { io, block, pool };
            },
            ACT({ io, block }) {
                block.finalize(outcome);
                return stripAnsi(io.output.split("\n").slice(-2)[0] ?? "");
            },
            ASSERTS: {
                "the rendered terminal label is an entry of the outcome's pool"(label, { pool }) {
                    Assert.ok(pool.includes(label));
                },
                "the rendered terminal label is exactly the pool entry the random value indexes"(label, { pool }) {
                    Assert.strictEqual(label, pool[5]);
                }
            }
        });
    }

    test("@xterm/headless: a long terminal variant at a narrow width is truncated to a single row with an ellipsis, keeping the block exactly four rows", {
        ARRANGE() {
            // 0.5 * 10 = 5 -> interruptionPool[5] === "Hold the phone — interrupted" (28 chars),
            // wider than the 12-col terminal, so the finalized terminal footer (drawn with
            // autowrap off) must be truncated to one 12-cell row rather than wrapping into a
            // second physical row, keeping the block at its fixed four-row height.
            return { cols: 12, termRows: 24, random: fakeRandom(0.5) };
        },
        async ACT({ cols, termRows, random }) {
            const { term, block, flush } = await mountEmulatorBlock(cols, termRows, undefined, random);
            block.finalize("Interrupted");
            await flush();
            const rows = readEmulatorViewport(term);
            block.dispose();
            term.dispose();
            return rows;
        },
        ASSERTS: {
            "the finalized footer is the long variant truncated to the width with a trailing ellipsis on a single row"(rows) {
                Assert.ok(rows.includes("Hold the ph…"));
            },
            "a separator row spanning exactly the narrow width is present"(rows, { cols }) {
                Assert.ok(rows.includes(SEPARATOR_GLYPH.repeat(cols)));
            },
            "the block occupies exactly four rows — the long label did not wrap into a fifth"(rows) {
                Assert.strictEqual(rows.filter(r => r !== "").length, 4);
            }
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
            block.setMetrics({ plan: { tokens: 1000, baseSeconds: 10 } });
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
            block.setMetrics({ task: { tokens: 100, baseSeconds: 10 }, plan: { tokens: 200, baseSeconds: 20 } });
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

    test("all animation frames include orange and the working label", {
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
            "all animation frames include the working label"(frames) {
                for (const frame of frames) {
                    Assert.ok(frame.includes(DEFAULT_LABEL), "should contain the working label");
                }
            },
            "all animation frames include reset"(frames) {
                for (const frame of frames) {
                    Assert.ok(frame.includes(RESET), "should contain reset");
                }
            }
        }
    });

    test("the working label at mount is the pool entry chosen through the injected random context", {
        ARRANGE() {
            const io = stubIO(80);
            const time = fakeTime();
            // 0.5 * 50 = 25, so workingPool[25] is selected — a different entry than the
            // fakeRandom(0) default, proving the selection routes through the random context.
            const block = makeBlock(io, time, fakeRandom(0.5));
            return { io, block };
        },
        ACT({ io, block }) {
            block.mount();
            return workingLabelOf(io.output);
        },
        ASSERTS: {
            "the label is a working-pool entry"(label) {
                Assert.ok(workingPool.includes(label));
            },
            "the label is exactly the entry the random value indexes"(label) {
                Assert.strictEqual(label, workingPool[25]);
            }
        }
    });

    test("mounting in the working state schedules both the animation and the label timers", {
        ARRANGE() {
            const io = stubIO(80);
            const time = fakeTime();
            const block = makeBlock(io, time);
            return { time, block };
        },
        ACT({ time, block }) {
            block.mount();
            return time.pendingCount;
        },
        ASSERT(pendingCount) {
            Assert.strictEqual(pendingCount, 2);
        }
    });

    test("advancing 9 seconds rotates the working label to a different pool entry", {
        ARRANGE() {
            const io = stubIO(80);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            const before = workingLabelOf(io.output);
            io.reset();
            return { io, time, before };
        },
        ACT({ io, time, before }) {
            time.advance(9000);
            return { before, after: workingLabelOf(io.output) };
        },
        ASSERTS: {
            "the label shown before rotation is a pool entry"(result) {
                Assert.ok(workingPool.includes(result.before));
            },
            "the label shown after 9 seconds is a pool entry"(result) {
                Assert.ok(workingPool.includes(result.after));
            },
            "the label after 9 seconds differs from the one shown before"(result) {
                Assert.notStrictEqual(result.after, result.before);
            }
        }
    });

    test("the spinner animation and the working-label rotation advance on independent cadences", {
        ARRANGE() {
            const io = stubIO(80);
            const time = fakeTime();
            const block = makeBlock(io, time);
            block.mount();
            const initialLabel = workingLabelOf(io.output);
            const initialFrame = stripAnsi(io.output.split("\n").pop() ?? "")[0];
            io.reset();
            return { io, time, initialLabel, initialFrame };
        },
        ACT({ io, time, initialLabel, initialFrame }) {
            time.advance(200);
            const afterAnim = io.output;
            const labelAfterAnim = workingLabelOf(afterAnim);
            const frameAfterAnim = stripAnsi(afterAnim.split("\n").pop() ?? "")[0];
            io.reset();
            time.advance(8800);
            const labelAfterLabelTick = workingLabelOf(io.output);
            return { initialLabel, initialFrame, labelAfterAnim, frameAfterAnim, labelAfterLabelTick };
        },
        ASSERTS: {
            "the spinner frame advances after a single 200 ms tick"(result) {
                Assert.notStrictEqual(result.frameAfterAnim, result.initialFrame);
            },
            "the working label is unchanged after the 200 ms spinner tick"(result) {
                Assert.strictEqual(result.labelAfterAnim, result.initialLabel);
            },
            "the working label rotates only once the full 9 seconds have elapsed"(result) {
                Assert.notStrictEqual(result.labelAfterLabelTick, result.initialLabel);
            }
        }
    });

    test("switching from working to reviewing tears down the working timers and runs only the single spinner tick", {
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
            const pendingAfterSwitch = time.pendingCount;
            io.reset();
            time.advance(10000);
            return { pendingAfterSwitch, output: io.output };
        },
        ASSERTS: {
            "exactly one timer — the spinner tick — is pending after leaving the working state"(result) {
                Assert.strictEqual(result.pendingAfterSwitch, 1);
            },
            "the working label never rotates in while reviewing"(result) {
                Assert.ok(!result.output.includes(DEFAULT_LABEL));
            },
            "the spinner keeps redrawing the reviewing line"(result) {
                Assert.ok(result.output.includes("review: "));
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

            block.setMetrics({ task: { tokens: 100, baseSeconds: 5 }, plan: { tokens: 200, baseSeconds: 10 } });
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
                // At 10 cols the success variant is fitted/truncated through the same
                // orange-fit path as the working/waiting footers, not emitted raw.
                Assert.ok(blockDraw.includes(formatTerminalFooter(DONE_LABEL, 10)));
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
                Assert.strictEqual(footerPlain, "⣋ review: claude (default): running");
            },
            "footer prefix and indicator are wrapped in ORANGE"(output) {
                Assert.ok(output.includes(ORANGE + "⣋ review: " + RESET));
            },
            "the running entry is wrapped in ORANGE"(output) {
                Assert.ok(output.includes(ORANGE + "claude (default): running" + RESET));
            },
            "no working label rendered while reviewing"(output) {
                const lastDraw = output.split(CLEAR_SEQ).pop() ?? "";
                Assert.ok(!lastDraw.includes(DEFAULT_LABEL));
            }
        }
    });

    test("setFooter reviewing from working cancels the working timers and schedules the single spinner tick", {
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
            "one spinner timer pending after entering reviewing"(result) {
                Assert.strictEqual(result.pendingAfterSet, 1);
            },
            "the spinner tick redraws while reviewing"(result) {
                Assert.ok(result.writesAfterAdvance > 0);
            }
        }
    });

    test("setFooter reviewing from rate-limit cancels the countdown timer and schedules the single spinner tick", {
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
            "one spinner timer pending after entering reviewing"(result) {
                Assert.strictEqual(result.pendingAfterSet, 1);
            },
            "the spinner tick redraws while reviewing"(result) {
                Assert.ok(result.writesAfterAdvance > 0);
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
                Assert.strictEqual(footerPlain, "⣋ review: claude: running, claude: running");
            },
            "wide draw after resize shows the full form with the descriptor"(result) {
                const lastDraw = result.wideDraw.split(CLEAR_SEQ).pop() ?? "";
                const footerPlain = stripAnsi(lastDraw.split("\n").pop() ?? "");
                Assert.strictEqual(footerPlain, "⣋ review: claude (default): running, claude (default): running");
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
            "both the animation and label timers are pending after switching to working"(result) {
                Assert.strictEqual(result.pendingAfterSwitch, 2);
            },
            "the animation tick redraws the block"(result) {
                Assert.ok(result.afterTick.includes(DEFAULT_LABEL));
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
            const reviewers:ReviewerEntry[] = [{ tool: "codex", model: "gpt-5", effort: "high", state: "pass" }];
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
                Assert.strictEqual(footerPlain, "⣋ review: codex (gpt-5 high): pass");
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
            "wide draw after resize shows the full working label without ellipsis"(result) {
                const lastDraw = result.wideDraw.split(CLEAR_SEQ).pop() ?? "";
                const footerPlain = stripAnsi(lastDraw.split("\n").pop() ?? "");
                Assert.strictEqual(footerPlain, `⣋ ${DEFAULT_LABEL}`);
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

    test("clearBlock emits the complete reflow-aware clear (cursor-up over the post-reflow height, erase, re-anchor) after a shrink resize", {
        ARRANGE() {
            // Mounted at 80 cols with a blank header and metrics; the footer is
            // the working frame "⣋ Workin'-diddly" (16 visible chars, the label
            // fakeRandom(0) selects). Recorded line widths are therefore
            // [80, 0, 0, 16]. After a shrink to 5 cols each previously-drawn line
            // reflows to ceil(width/5) rows:
            //   separator ceil(80/5)=16, header max(1,0)=1, metrics 1, footer ceil(16/5)=4
            // => 22 physical rows. The clear moves up 22-1=21 to the top of that
            // footprint, erases to end of screen, then drops back down 22-4=18 so
            // the freshly drawn four rows re-anchor at the bottom.
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
            return [...io.writes];
        },
        ASSERTS: {
            "the entire clear is emitted as a single write equal to the reflow-aware cursor-up/erase/re-anchor sequence"(writes) {
                Assert.strictEqual(writes[0], "\x1b[21A\r\x1b[J\x1b[18B");
            },
            "the write immediately after the clear is the block redraw, proving nothing else belongs to the clear"(writes) {
                Assert.ok(writes[1]!.startsWith("\x1b[?7l"), "redraw begins with autowrap-off");
            }
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

    test("@xterm/headless: after a k=2 shrink resize the rendered grid shows exactly four block rows at the bottom with the full fields and no stale separator row above them", {
        ARRANGE() {
            return { initialCols: 80, newCols: 40, termRows: 24 };
        },
        async ACT({ initialCols, newCols, termRows }) {
            return await renderEmulatorShrink(initialCols, newCols, termRows);
        },
        ASSERTS: {
            "separator row at the third-from-bottom position spans the new width with only ─ glyphs"(rows, { newCols, termRows }) {
                Assert.strictEqual(rows[termRows - 4], SEPARATOR_GLYPH.repeat(newCols));
            },
            "header row at the second-from-bottom position carries the header fields"(rows, { termRows }) {
                Assert.strictEqual(rows[termRows - 3], "5/12 iter 2 implementing 7.3 Task title");
            },
            "metrics row at the row-above-bottom position carries the metrics fields"(rows, { termRows }) {
                Assert.strictEqual(rows[termRows - 2], "task 100 5s  │  plan 200 10s");
            },
            "footer row at the bottom carries the working label with the first animation frame"(rows, { termRows }) {
                Assert.strictEqual(rows[termRows - 1], `⣋ ${DEFAULT_LABEL}`);
            },
            "row immediately above the block is not a stale all-─ separator"(rows, { newCols, termRows }) {
                Assert.notStrictEqual(rows[termRows - 5], SEPARATOR_GLYPH.repeat(newCols));
            },
            "the block occupies exactly four terminal rows — every row above the bottom four is empty"(rows, { termRows }) {
                Assert.deepStrictEqual(rows.slice(0, termRows - 4), new Array(termRows - 4).fill(""));
            }
        }
    });

    // The k=2 test above only exercises a separator that reflows into two rows;
    // a fixed/one-row clear happens to be correct there but leaves k-1 stale
    // separator rows for larger single-event shrinks (window restore, half-screen
    // snap, font-size change), which the reflow-aware clear must also handle.
    for (const { initialCols, newCols, k } of [
        { initialCols: 240, newCols: 40, k: 6 },
        { initialCols: 160, newCols: 20, k: 8 }
    ]) {
        test(`@xterm/headless: after a k=${k} shrink resize (${initialCols}->${newCols}) the block re-anchors to exactly four bottom rows with zero stale separator rows above`, {
            ARRANGE() {
                return { initialCols, newCols, termRows: 24 };
            },
            async ACT(params) {
                return await renderEmulatorShrink(params.initialCols, params.newCols, params.termRows);
            },
            ASSERTS: {
                "the separator row at the third-from-bottom position spans the new width with only ─ glyphs"(rows, { newCols, termRows }) {
                    Assert.strictEqual(rows[termRows - 4], SEPARATOR_GLYPH.repeat(newCols));
                },
                "the footer row at the bottom carries the working label, proving the block re-anchored to the bottom"(rows, { termRows }) {
                    Assert.strictEqual(rows[termRows - 1], `⣋ ${DEFAULT_LABEL}`);
                },
                "the row immediately above the block is not a stale all-─ separator chunk left by the reflow"(rows, { newCols, termRows }) {
                    Assert.notStrictEqual(rows[termRows - 5], SEPARATOR_GLYPH.repeat(newCols));
                },
                "every row above the bottom four is empty — no reflowed separator rows survive the redraw"(rows, { termRows }) {
                    Assert.deepStrictEqual(rows.slice(0, termRows - 4), new Array(termRows - 4).fill(""));
                }
            }
        });
    }

    // The shrink loops above cover narrowing; the obligation in ui.md § "Resizing"
    // is symmetric, so a *widen* must re-expand the block to the new width — the
    // separator spanning the wider terminal and the header/metrics shedding the
    // ellipsis/compact form they needed at the narrow width. Every prior emulator
    // resize test is a shrink; this loop adds the missing widen direction against
    // the rendered grid for two ratios. The header carries a title long enough to
    // truncate at both narrow widths, so the fuller-form restoration is observable.
    const WIDEN_TITLE = "Implement the resize re-fit across both directions";
    for (const { initialCols, wideCols } of [
        { initialCols: 20, wideCols: 80 },
        { initialCols: 40, wideCols: 160 }
    ]) {
        test(`@xterm/headless: after a widen resize (${initialCols}->${wideCols}) the block re-expands to the full new width with the header/metrics restored to their fuller form and no stale rows above`, {
            ARRANGE() {
                return { initialCols, wideCols, termRows: 24, title: WIDEN_TITLE };
            },
            async ACT({ initialCols, wideCols, termRows, title }) {
                const { term, block, flush, resize } = await mountEmulatorBlock(initialCols, termRows);
                block.setHeader({ indexLabel: "5/12", iteration: 2, activity: "implementing", taskNumber: "7.3", title });
                await flush();
                const narrow = readEmulatorViewport(term);
                resize(wideCols);
                await flush();
                const wide = readEmulatorViewport(term);
                block.dispose();
                term.dispose();
                return { narrow, wide };
            },
            ASSERTS: {
                "the header is truncated with a trailing ellipsis at the narrow width before the widen"(result, { termRows }) {
                    Assert.ok(result.narrow[termRows - 3]!.endsWith("…"), "header must be truncated at the narrow width");
                },
                "the separator row spans exactly the new wider width with only ─ glyphs"(result, { wideCols, termRows }) {
                    Assert.strictEqual(result.wide[termRows - 4], SEPARATOR_GLYPH.repeat(wideCols));
                },
                "the header row is restored to its full untruncated form at the new width"(result, { termRows, title }) {
                    Assert.strictEqual(result.wide[termRows - 3], `5/12 iter 2 implementing 7.3 ${title}`);
                },
                "the metrics row renders its full form at the new width"(result, { termRows }) {
                    Assert.strictEqual(result.wide[termRows - 2], "task 100 5s  │  plan 200 10s");
                },
                "the footer row carries the working label at the bottom of the terminal"(result, { termRows }) {
                    Assert.strictEqual(result.wide[termRows - 1], `⣋ ${DEFAULT_LABEL}`);
                },
                "every row above the four-row block is empty after the widen — no stale narrow separator or pre-widen content"(result, { termRows }) {
                    Assert.deepStrictEqual(result.wide.slice(0, termRows - 4), new Array(termRows - 4).fill(""));
                }
            }
        });
    }

    test("@xterm/headless: shrinking with a populated wrapped output region above re-anchors the block to four bottom rows with the output preserved above and no stale separator rows", {
        ARRANGE() {
            // Ten 120-char lines wrap to two rows each at 80 cols, filling the
            // 20 rows above the block exactly (no blank padding artifact) so the
            // setup mirrors a real run whose output has scrolled the block to the
            // bottom. On the shrink to 40 cols each line reflows to three rows and
            // overflows into scrollback — the condition the blank-filler shrink
            // tests never exercise.
            const aboveContent:string[] = [];
            for (let i = 0; i < 10; i++) aboveContent.push(`OUT${i} `.padEnd(120, "x"));
            return { initialCols: 80, newCols: 40, termRows: 24, aboveContent };
        },
        async ACT({ initialCols, newCols, termRows, aboveContent }) {
            const { term, block, flush, resize } = await mountEmulatorBlock(initialCols, termRows, aboveContent);
            resize(newCols);
            await flush();
            const rows = readEmulatorViewport(term);
            block.dispose();
            term.dispose();
            return rows;
        },
        ASSERTS: {
            "the separator row spans exactly the new width with only ─ glyphs"(rows, { newCols, termRows }) {
                Assert.strictEqual(rows[termRows - 4], SEPARATOR_GLYPH.repeat(newCols));
            },
            "the header row carries the header fields at the new width"(rows, { termRows }) {
                Assert.strictEqual(rows[termRows - 3], "5/12 iter 2 implementing 7.3 Task title");
            },
            "the metrics row carries the metrics fields at the new width"(rows, { termRows }) {
                Assert.strictEqual(rows[termRows - 2], "task 100 5s  │  plan 200 10s");
            },
            "the footer row is the bottom row, proving the block re-anchored to the bottom"(rows, { termRows }) {
                Assert.strictEqual(rows[termRows - 1], `⣋ ${DEFAULT_LABEL}`);
            },
            "no row above the block is a stale separator chunk left by the reflow"(rows, { termRows }) {
                Assert.ok(rows.slice(0, termRows - 4).every(r => !/^─+$/.test(r)), "no row above the block may be an all-separator row");
            },
            "the reflowed wrapped output region is preserved above the block"(rows, { termRows }) {
                Assert.ok(rows.slice(0, termRows - 4).some(r => r.includes("OUT")), "the seeded output must remain visible above the block");
            }
        }
    });

    test("@xterm/headless: a long working variant at a narrow width is truncated to a single row with an ellipsis, keeping the block exactly four rows", {
        ARRANGE() {
            // 0.47 * 50 = 23 -> workingPool[23] === "Diddly-developin'" (17 chars).
            // "⣋ Diddly-developin'" is 19 visible cells, wider than the 12-col terminal,
            // so the block (drawn with autowrap off) must truncate it to one 12-cell row
            // rather than letting it wrap into a second physical row.
            return { cols: 12, termRows: 24, random: fakeRandom(0.47) };
        },
        async ACT({ cols, termRows, random }) {
            const { term, block, flush } = await mountEmulatorBlock(cols, termRows, undefined, random);
            await flush();
            const rows = readEmulatorViewport(term);
            block.dispose();
            term.dispose();
            return rows;
        },
        ASSERTS: {
            "the footer row is the long variant truncated to the width with a trailing ellipsis"(rows, { termRows }) {
                Assert.strictEqual(rows[termRows - 1], "⣋ Diddly-de…");
            },
            "the separator row spans exactly the narrow width with only ─ glyphs"(rows, { cols, termRows }) {
                Assert.strictEqual(rows[termRows - 4], SEPARATOR_GLYPH.repeat(cols));
            },
            "the block occupies exactly four rows — every row above the bottom four is empty, so the long label did not wrap"(rows, { termRows }) {
                Assert.deepStrictEqual(rows.slice(0, termRows - 4), new Array(termRows - 4).fill(""));
            }
        }
    });

    test("reviewing footer with a waiting reviewer recomputes its countdown from time.now() on the spinner redraws and ticks it down", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "waiting", endTime: 120000 }];
            block.setFooter({ kind: "reviewing", reviewers });
            block.mount();
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            time.advance(1000);
            const firstTick = io.output;
            io.reset();
            time.advance(60000);
            const secondTick = io.output;
            return { firstTick, secondTick, pendingCount: time.pendingCount };
        },
        ASSERTS: {
            "the spinner tick clears and redraws the block"(result) {
                Assert.ok(result.firstTick.includes(CLEAR_SEQ));
            },
            "the first-window footer shows the reviewer countdown at 2m"(result) {
                const lastDraw = result.firstTick.split(CLEAR_SEQ).pop() ?? "";
                const footerPlain = stripAnsi(lastDraw.split("\n").pop() ?? "");
                Assert.ok(footerPlain.includes("review: "), `expected a review prefix, got: ${footerPlain}`);
                Assert.ok(footerPlain.endsWith("claude (default): waiting 2m"), `expected the 2m countdown, got: ${footerPlain}`);
            },
            "the later footer shows the countdown decreased to 1m"(result) {
                const lastDraw = result.secondTick.split(CLEAR_SEQ).pop() ?? "";
                const footerPlain = stripAnsi(lastDraw.split("\n").pop() ?? "");
                Assert.ok(footerPlain.endsWith("claude (default): waiting 1m"), `expected the 1m countdown, got: ${footerPlain}`);
            },
            "exactly one timer — the spinner tick — drives the live reviewing footer"(result) {
                Assert.strictEqual(result.pendingCount, 1);
            }
        }
    });

    test("reviewing footer schedules a spinner tick that finalize cancels through _cancelTimers", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "waiting", endTime: 600000 }];
            block.setFooter({ kind: "reviewing", reviewers });
            block.mount();
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            const pendingWhileReviewing = time.pendingCount;
            block.finalize("Done");
            const pendingAfterFinalize = time.pendingCount;
            io.reset();
            time.advance(5000);
            const writesAfterAdvance = io.writes.length;
            return { pendingWhileReviewing, pendingAfterFinalize, writesAfterAdvance };
        },
        ASSERTS: {
            "a spinner timer is pending while reviewing"(result) {
                Assert.strictEqual(result.pendingWhileReviewing, 1);
            },
            "finalize cancels the spinner timer"(result) {
                Assert.strictEqual(result.pendingAfterFinalize, 0);
            },
            "no spinner tick fires after finalize"(result) {
                Assert.strictEqual(result.writesAfterAdvance, 0);
            }
        }
    });

    test("switching between reviewing footers keeps the single spinner tick scheduled and redrawing", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            const waiting:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "waiting", endTime: 600000 }];
            block.setFooter({ kind: "reviewing", reviewers: waiting });
            block.mount();
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            const pendingWhileWaiting = time.pendingCount;
            const running:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            block.setFooter({ kind: "reviewing", reviewers: running });
            const pendingAfterSwitch = time.pendingCount;
            io.reset();
            time.advance(5000);
            const writesAfterAdvance = io.writes.length;
            return { pendingWhileWaiting, pendingAfterSwitch, writesAfterAdvance };
        },
        ASSERTS: {
            "a spinner timer was pending with the waiting reviewer"(result) {
                Assert.strictEqual(result.pendingWhileWaiting, 1);
            },
            "one spinner timer remains after switching to a running-only reviewing footer"(result) {
                Assert.strictEqual(result.pendingAfterSwitch, 1);
            },
            "the spinner keeps redrawing after the switch"(result) {
                Assert.ok(result.writesAfterAdvance > 0);
            }
        }
    });

    test("reviewing footer spinner tick is cancelled on dispose through _cancelTimers", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "waiting", endTime: 600000 }];
            block.setFooter({ kind: "reviewing", reviewers });
            block.mount();
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            block.dispose();
            const pendingAfterDispose = time.pendingCount;
            time.advance(5000);
            const writesAfterAdvance = io.writes.length;
            return { pendingAfterDispose, writesAfterAdvance };
        },
        ASSERTS: {
            "dispose cancels the spinner timer"(result) {
                Assert.strictEqual(result.pendingAfterDispose, 0);
            },
            "no tick fires after dispose"(result) {
                Assert.strictEqual(result.writesAfterAdvance, 0);
            }
        }
    });

    test("reviewing footer with two waiting reviewers renders each reviewer's own countdown from its own endTime", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.mount();
            io.reset();
            // Two reviewers waiting at the same instant with distinct end times must
            // each render their own compact countdown (2h14m vs 14m), proving the
            // countdowns are recomputed independently and not shared.
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "waiting", endTime: 134 * 60 * 1000 },
                { tool: "codex", model: "gpt-5", effort: "high", state: "waiting", endTime: 14 * 60 * 1000 }
            ];
            return { io, block, reviewers };
        },
        ACT({ io, block, reviewers }) {
            block.setFooter({ kind: "reviewing", reviewers });
            const output = io.output;
            block.dispose();
            return output;
        },
        ASSERT(output) {
            const footerPlain = stripAnsi(output.split("\n").pop() ?? "");
            Assert.strictEqual(footerPlain, "⣋ review: claude (default): waiting 2h14m, codex (gpt-5 high): waiting 14m");
        }
    });

    test("@xterm/headless: a reviewing footer with a waiting reviewer renders its compact countdown on the bottom row and keeps the block at exactly four rows", {
        ARRANGE() {
            return { cols: 120, termRows: 24 };
        },
        async ACT({ cols, termRows }) {
            const { term, block, flush } = await mountEmulatorBlock(cols, termRows);
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "waiting", endTime: 134 * 60 * 1000 },
                { tool: "codex", model: "gpt-5", effort: "high", state: "running" }
            ];
            block.setFooter({ kind: "reviewing", reviewers });
            await flush();
            const rows = readEmulatorViewport(term);
            block.dispose();
            term.dispose();
            return { rows, termRows };
        },
        ASSERTS: {
            "the footer row shows the reviewing line with the indicator and the compact countdown"(result) {
                Assert.strictEqual(result.rows[result.termRows - 1], "⣋ review: claude (default): waiting 2h14m, codex (gpt-5 high): running");
            },
            "the separator row spans the full width with only ─ glyphs"(result) {
                Assert.strictEqual(result.rows[result.termRows - 4], SEPARATOR_GLYPH.repeat(120));
            },
            "the block occupies exactly four terminal rows — every row above the bottom four is empty"(result) {
                Assert.deepStrictEqual(result.rows.slice(0, result.termRows - 4), new Array(result.termRows - 4).fill(""));
            }
        }
    });

    test("the reviewing line's animated indicator advances on each spinner tick", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            const block = makeBlock(io, time);
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            block.setFooter({ kind: "reviewing", reviewers });
            block.mount();
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            // The indicator is the single glyph at the start of the line, before the
            // `review: ` prefix; read it off the rendered footer rather than any
            // private field.
            const indicatorOf = (output:string) => {
                const footerPlain = stripAnsi(output.split(CLEAR_SEQ).pop()!.split("\n").pop() ?? "");
                return footerPlain.slice(0, footerPlain.indexOf(" review:"));
            };
            time.advance(200);
            const afterOne = indicatorOf(io.output);
            io.reset();
            time.advance(200);
            const afterTwo = indicatorOf(io.output);
            return { afterOne, afterTwo };
        },
        ASSERTS: {
            "the indicator is a single glyph that leads the prefix"(result) {
                Assert.strictEqual(result.afterOne.length, 1);
            },
            "the indicator glyph changes between consecutive ticks"(result) {
                Assert.notStrictEqual(result.afterTwo, result.afterOne);
            }
        }
    });
});

test.describe("BottomBlock metrics-line live time counter", test => {
    test("a live pair's seconds are derived from the clock at render time: two renders at the same clock match and a render after the clock advances shows more, with no metrics push between", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 0 } });
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            // Redraw twice at the same clock through the resize path (no setMetrics,
            // no clock change), then advance the clock by setNow (no timer fires) and
            // redraw once more — isolating render-time derivation from any tick or push.
            io.emitResize();
            const firstRender = metricsLineOf(io.output);
            io.reset();
            io.emitResize();
            const sameClockRender = metricsLineOf(io.output);
            io.reset();
            time.setNow(4000);
            io.emitResize();
            const laterRender = metricsLineOf(io.output);
            return { firstRender, sameClockRender, laterRender };
        },
        ASSERTS: {
            "two renders at the same clock value show the identical metrics line"(result) {
                Assert.strictEqual(result.sameClockRender, result.firstRender);
            },
            "the metrics line at the unchanged clock reads zero seconds for both pairs"(result) {
                Assert.strictEqual(result.firstRender, "task 100 0s  │  plan 200 0s");
            },
            "a render four seconds later shows four seconds for both pairs with no metrics push"(result) {
                Assert.strictEqual(result.laterRender, "task 100 4s  │  plan 200 4s");
            }
        }
    });

    test("while working, the task and plan times climb once per second on the block's own animation ticks with no metrics push", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 0 } });
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            time.advance(1000);
            const afterOneSecond = metricsLineOf(io.output);
            io.reset();
            time.advance(2000);
            const afterThreeSeconds = metricsLineOf(io.output);
            return { afterOneSecond, afterThreeSeconds };
        },
        ASSERTS: {
            "after one second of animation ticks both times read 1s"(result) {
                Assert.strictEqual(result.afterOneSecond, "task 100 1s  │  plan 200 1s");
            },
            "after two more seconds of ticks both times read 3s"(result) {
                Assert.strictEqual(result.afterThreeSeconds, "task 100 3s  │  plan 200 3s");
            }
        }
    });

    test("while reviewing, the task and plan times climb on the spinner ticks with no metrics push", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            const reviewers:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "running" }];
            block.setFooter({ kind: "reviewing", reviewers });
            block.mount();
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 0 } });
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            time.advance(2000);
            return metricsLineOf(io.output);
        },
        ASSERT(metrics) {
            Assert.strictEqual(metrics, "task 100 2s  │  plan 200 2s");
        }
    });

    test("the plan time is the task's live active time plus the other tasks' accumulated seconds and advances in lockstep with the task time", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            // The plan pair shares the task's anchor and carries the other tasks'
            // accumulated active seconds (10) as its static base.
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 10 } });
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            time.advance(1000);
            const afterOneSecond = metricsLineOf(io.output);
            io.reset();
            time.advance(4000);
            const afterFiveSeconds = metricsLineOf(io.output);
            return { afterOneSecond, afterFiveSeconds };
        },
        ASSERTS: {
            "at task-live 1s the plan time is 1s + 10s = 11s"(result) {
                Assert.strictEqual(result.afterOneSecond, "task 100 1s  │  plan 200 11s");
            },
            "after four more seconds both times advanced by 4 (task 5s, plan 15s)"(result) {
                Assert.strictEqual(result.afterFiveSeconds, "task 100 5s  │  plan 200 15s");
            }
        }
    });

    test("advancing the clock alone never changes the token figures, only the time figures", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            block.setMetrics({ task: { tokens: 1500, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 2600, anchorMs: 0, baseSeconds: 0 } });
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            io.emitResize();
            const beforeAdvance = metricsLineOf(io.output);
            io.reset();
            time.advance(5000);
            const afterAdvance = metricsLineOf(io.output);
            return { beforeAdvance, afterAdvance };
        },
        ASSERTS: {
            "the token figures render before advancing the clock"(result) {
                Assert.strictEqual(result.beforeAdvance, "task 1.5k 0s  │  plan 2.6k 0s");
            },
            "after advancing five seconds the token figures are unchanged while the times advanced to 5s"(result) {
                Assert.strictEqual(result.afterAdvance, "task 1.5k 5s  │  plan 2.6k 5s");
            }
        }
    });

    test("a static metrics pair (no anchor) does not tick when the clock advances", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            // The pre-task plan total is pushed without an anchor, so it is static.
            block.setMetrics({ plan: { tokens: 200, baseSeconds: 30 } });
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            io.emitResize();
            const beforeAdvance = metricsLineOf(io.output);
            io.reset();
            time.advance(5000);
            // No footer-driven redraw changes the static value; force one render at the
            // advanced clock to prove the static pair did not tick.
            io.emitResize();
            const afterAdvance = metricsLineOf(io.output);
            return { beforeAdvance, afterAdvance };
        },
        ASSERTS: {
            "the static plan pair shows its base seconds with no task pair"(result) {
                Assert.strictEqual(result.beforeAdvance, "plan 200 30s");
            },
            "advancing the clock leaves the static plan time unchanged"(result) {
                Assert.strictEqual(result.afterAdvance, "plan 200 30s");
            }
        }
    });

    test("the metrics time freezes through a waiting state and resumes from the paused value with the elapsed wait excluded", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 0 } });
            time.advance(2000); // two active seconds before the wait
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            block.setFooter({ kind: "waiting", waitKind: "rate-limit", endTime: 999000 });
            const atWaitStart = metricsLineOf(io.output);
            io.reset();
            time.advance(5000); // the wait elapses; countdown ticks redraw
            const duringWait = metricsLineOf(io.output);
            io.reset();
            block.setFooter({ kind: "working" });
            const onResume = metricsLineOf(io.output);
            io.reset();
            time.advance(3000); // three active seconds after the wait
            const afterResume = metricsLineOf(io.output);
            return { atWaitStart, duringWait, onResume, afterResume };
        },
        ASSERTS: {
            "the metrics time freezes at its pre-wait value of 2s when the footer enters waiting"(result) {
                Assert.strictEqual(result.atWaitStart, "task 100 2s  │  plan 200 2s");
            },
            "advancing the clock during the wait does not change the metrics time"(result) {
                Assert.strictEqual(result.duringWait, "task 100 2s  │  plan 200 2s");
            },
            "the counter resumes from the paused value of 2s when work resumes"(result) {
                Assert.strictEqual(result.onResume, "task 100 2s  │  plan 200 2s");
            },
            "after resuming the counter continues with the elapsed wait excluded (2s + 3s = 5s)"(result) {
                Assert.strictEqual(result.afterResume, "task 100 5s  │  plan 200 5s");
            }
        }
    });

    test("the metrics time keeps advancing while a reviewing footer has a running reviewer", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 0 } });
            time.advance(2000); // two active seconds before the review stage
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            // One reviewer waits while the other runs: the running one keeps the counter live.
            const reviewers:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "running" },
                { tool: "codex", model: "", effort: "", state: "waiting", endTime: 600000 }
            ];
            block.setFooter({ kind: "reviewing", reviewers });
            const atReviewStart = metricsLineOf(io.output);
            io.reset();
            time.advance(5000); // spinner ticks redraw the block
            const duringReview = metricsLineOf(io.output);
            return { atReviewStart, duringReview };
        },
        ASSERTS: {
            "the metrics time carries its pre-review value of 2s into the review stage"(result) {
                Assert.strictEqual(result.atReviewStart, "task 100 2s  │  plan 200 2s");
            },
            "with a reviewer running the metrics time keeps climbing (2s + 5s = 7s)"(result) {
                Assert.strictEqual(result.duringReview, "task 100 7s  │  plan 200 7s");
            }
        }
    });

    test("the metrics time freezes while reviewing with no running reviewer and resumes when a reviewer returns to running, excluding the paused span", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 0 } });
            time.advance(2000); // two active seconds before the review stage
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            // One reviewer already has its verdict and the other is rate-limit
            // waiting: nothing is running, so the counter pauses.
            const paused:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "pass" },
                { tool: "codex", model: "", effort: "", state: "waiting", endTime: 600000 }
            ];
            block.setFooter({ kind: "reviewing", reviewers: paused });
            const atPauseStart = metricsLineOf(io.output);
            io.reset();
            time.advance(5000); // the pause elapses; spinner ticks redraw
            const duringPause = metricsLineOf(io.output);
            io.reset();
            const resumed:ReviewerEntry[] = [
                { tool: "claude", model: "", effort: "", state: "pass" },
                { tool: "codex", model: "", effort: "", state: "running" }
            ];
            block.setFooter({ kind: "reviewing", reviewers: resumed });
            const onResume = metricsLineOf(io.output);
            io.reset();
            time.advance(3000); // three active seconds after the reviewer resumes
            const afterResume = metricsLineOf(io.output);
            return { atPauseStart, duringPause, onResume, afterResume };
        },
        ASSERTS: {
            "the metrics time freezes at its pre-review value of 2s when no reviewer is running"(result) {
                Assert.strictEqual(result.atPauseStart, "task 100 2s  │  plan 200 2s");
            },
            "advancing the clock with no running reviewer does not change the metrics time"(result) {
                Assert.strictEqual(result.duringPause, "task 100 2s  │  plan 200 2s");
            },
            "the counter resumes from the paused value of 2s when a reviewer returns to running"(result) {
                Assert.strictEqual(result.onResume, "task 100 2s  │  plan 200 2s");
            },
            "after resuming the counter continues with the paused span excluded (2s + 3s = 5s)"(result) {
                Assert.strictEqual(result.afterResume, "task 100 5s  │  plan 200 5s");
            }
        }
    });

    test("the metrics pause spans consecutive no-running reviewing pushes, keeping its original freeze point until the footer returns to working", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 0 } });
            time.advance(2000); // two active seconds before the review stage
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            const waiting:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "waiting", endTime: 600000 }];
            block.setFooter({ kind: "reviewing", reviewers: waiting });
            io.reset();
            time.advance(4000); // paused span while the only reviewer waits
            // A second push that still has no running reviewer must keep the pause's
            // original freeze point rather than re-capturing the clock at 6s.
            const verdict:ReviewerEntry[] = [{ tool: "claude", model: "", effort: "", state: "pass" }];
            block.setFooter({ kind: "reviewing", reviewers: verdict });
            io.reset();
            time.advance(4000); // paused span while the verdict holds
            const duringVerdict = metricsLineOf(io.output);
            io.reset();
            block.setFooter({ kind: "working" });
            time.advance(3000); // three active seconds after the stage ends
            const afterWorking = metricsLineOf(io.output);
            return { duringVerdict, afterWorking };
        },
        ASSERTS: {
            "the metrics time holds at 2s across both no-running pushes"(result) {
                Assert.strictEqual(result.duringVerdict, "task 100 2s  │  plan 200 2s");
            },
            "back in working the counter resumes from the original freeze point with the whole pause excluded (2s + 3s = 5s)"(result) {
                Assert.strictEqual(result.afterWorking, "task 100 5s  │  plan 200 5s");
            }
        }
    });

    test("after dispose, advancing the clock fires no redraw even with a live metrics anchor and leaves no pending timer", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 0 } });
            io.reset();
            return { io, time, block };
        },
        ACT({ io, time, block }) {
            block.dispose();
            const afterDispose = io.output;
            time.advance(5000);
            const afterAdvance = io.output;
            return { afterDispose, afterAdvance, pendingCount: time.pendingCount };
        },
        ASSERTS: {
            "dispose itself writes nothing"(result) {
                Assert.strictEqual(result.afterDispose, "");
            },
            "advancing the clock after dispose fires no redraw of the live counter"(result) {
                Assert.strictEqual(result.afterAdvance, "");
            },
            "no redraw timer remains to drive the live counter"(result) {
                Assert.strictEqual(result.pendingCount, 0);
            }
        }
    });

    test("after finalize, advancing the clock fires no redraw of the live metrics counter", {
        ARRANGE() {
            const io = stubIO(120);
            const time = fakeTime();
            time.setNow(0);
            const block = makeBlock(io, time);
            block.setFooter({ kind: "working" });
            block.mount();
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 0 } });
            block.finalize("Done");
            io.reset();
            return { io, time };
        },
        ACT({ io, time }) {
            time.advance(5000);
            return { afterAdvance: io.output, pendingCount: time.pendingCount };
        },
        ASSERTS: {
            "advancing the clock after finalize fires no redraw"(result) {
                Assert.strictEqual(result.afterAdvance, "");
            },
            "no redraw timer remains after finalize"(result) {
                Assert.strictEqual(result.pendingCount, 0);
            }
        }
    });

    test("@xterm/headless: the live metrics time advances on the rendered grid while the block stays exactly four rows", {
        ARRANGE() {
            return { cols: 120, termRows: 24 };
        },
        async ACT({ cols, termRows }) {
            const { term, block, time, flush } = await mountEmulatorBlock(cols, termRows);
            // Replace the static seed with a live anchored pair, then let the clock
            // cross whole-second boundaries; the block's own animation ticks redraw it.
            block.setMetrics({ task: { tokens: 100, anchorMs: 0, baseSeconds: 0 }, plan: { tokens: 200, anchorMs: 0, baseSeconds: 0 } });
            await flush();
            time.advance(3000);
            await flush();
            const rows = readEmulatorViewport(term);
            block.dispose();
            term.dispose();
            return { rows, termRows };
        },
        ASSERTS: {
            "the metrics row on the grid shows both times advanced to 3s"(result) {
                Assert.strictEqual(result.rows[result.termRows - 2], "task 100 3s  │  plan 200 3s");
            },
            "the separator row spans the full width with only ─ glyphs"(result) {
                Assert.strictEqual(result.rows[result.termRows - 4], SEPARATOR_GLYPH.repeat(120));
            },
            "the block occupies exactly four terminal rows while the counter ticks"(result) {
                Assert.deepStrictEqual(result.rows.slice(0, result.termRows - 4), new Array(result.termRows - 4).fill(""));
            }
        }
    });
});
