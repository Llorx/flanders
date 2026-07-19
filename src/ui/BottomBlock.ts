import type { RandomContext, TimeContext, TimeoutHandle } from "../contexts";
import { pickVariant, terminalPools, workingPool } from "../voiceVariants";
import { formatCountdown, formatDateTime, formatHeaderLine, formatMetricsLine, formatReviewingFooter, formatTerminalFooter, formatWaitingFooter, formatWorkingFooter, SEPARATOR_GLYPH, stripAnsi } from "./formatters";
import type { MetricsPair, ReviewerEntry } from "./formatters";

export type { ReviewerEntry, ReviewerState, ReviewerTool } from "./formatters";

export type BottomBlockIO = {
    write(text:string):void;
    columns():number;
    onResize(listener:() => void):() => void;
};

export type Activity = "implementing" | "reviewing" | "building" | "testing";

export type HeaderFields = {
    indexLabel?:string|null;
    // The build-and-test detection-phase message, shown immediately after the index
    // while no task is selected. Held as raw data so the header recomputes its colour
    // and width-fit at render time, never stored as a precomputed string.
    phaseMessage?:string|null;
    iteration?:number|null;
    activity?:Activity|null;
    taskNumber?:string|null;
    title?:string|null;
};

// The structured state the block holds for one metrics pair. The displayed whole
// seconds are NOT a precomputed count: when `anchorMs` is present the pair is live
// and its seconds are derived on every redraw as
// floor((evalNow - anchorMs - <accumulated pauses>)/1000) + baseSeconds, where
// evalNow is the live clock while the counter runs and the frozen pause-start clock
// while it is paused (the footer waiting, or reviewing with no reviewer running).
// When `anchorMs` is absent the pair is static and shows exactly `baseSeconds`
// (the pre-task plan total, which must not tick).
export type MetricsPairFields = {
    tokens:number;
    anchorMs?:number;
    baseSeconds:number;
};

export type MetricsFields = {
    task?:MetricsPairFields;
    plan?:MetricsPairFields;
};

export type WaitKind = "rate-limit";

const WAIT_HEADINGS:Record<WaitKind, string> = {
    "rate-limit": "Waiting rate limit"
};

export type FooterState =
    | { kind:"blank" }
    | { kind:"working" }
    | { kind:"waiting"; waitKind:WaitKind; endTime:number }
    | { kind:"reviewing"; reviewers:readonly ReviewerEntry[] }
    | { kind:"terminal"; text:string };

export type TerminalLabel = "Done" | "Hard stop" | "Interrupted" | "Failed";

const FRAMES = ["⣋", "⣙", "⣹", "⣸", "⣼", "⣴", "⣦", "⣧", "⣇", "⣏"];
const FRAME_MS = 200;
const LABEL_MS = 9000;
const AUTOWRAP_OFF = "\x1b[?7l";
const AUTOWRAP_ON = "\x1b[?7h";
const CR = "\r";
const CLEAR_TO_END = "\x1b[J";

export class BottomBlock {
    private _mounted = false;
    private _finalized = false;
    private _disposed = false;
    private _header:HeaderFields = {};
    private _metrics:MetricsFields = {};
    private _footer:FooterState = { kind: "working" };
    private _animFrame = 0;
    private _workingLabel = "";
    private _animTimer:TimeoutHandle|null = null;
    private _labelTimer:TimeoutHandle|null = null;
    private _countdownTimer:TimeoutHandle|null = null;
    private _unsubResize:(() => void)|null = null;
    private _prevLineWidths:readonly number[]|null = null;
    // The clock value at which the metrics-time counter is currently frozen — set
    // while the counter is paused (the footer in its waiting state, or in its
    // reviewing state with no reviewer running), null while it runs. When set,
    // every redraw evaluates the live metrics pairs against this frozen clock so
    // the displayed seconds hold steady through the pause.
    private _metricsPausedAtMs:number|null = null;
    // Total milliseconds of completed pauses since the current metrics anchor was
    // pushed. Subtracted from the live window so the counter resumes after a pause
    // with the paused span excluded; reset whenever a fresh anchor is set (the
    // orchestrator's pushed anchor already accounts for completed pauses).
    private _metricsPauseAccumMs = 0;

    constructor(private _io:BottomBlockIO, private _time:TimeContext, private _random:RandomContext) {}

    mount():void {
        if (this._disposed) return;
        if (this._mounted) return;
        this._mounted = true;
        if (this._footer.kind === "working") {
            this._workingLabel = pickVariant(workingPool, this._random);
        }
        this._unsubResize = this._io.onResize(() => {
            this._redraw();
        });
        this._redraw();
        this._startFooterTimer();
    }

    isFinalized():boolean {
        return this._finalized;
    }

    setHeader(fields:HeaderFields):void {
        if (this._disposed || this._finalized) return;
        this._header = fields;
        if (this._mounted) {
            this._redraw();
        }
    }

    setMetrics(fields:MetricsFields):void {
        if (this._disposed || this._finalized) return;
        this._metrics = fields;
        // A fresh anchor already excludes every completed pause (the orchestrator
        // folds them into the value it pushes), so the block's own pause accumulator
        // starts over from this push.
        this._metricsPauseAccumMs = 0;
        if (this._mounted) {
            this._redraw();
        }
    }

    setFooter(state:FooterState):void {
        if (this._disposed || this._finalized) return;
        this._cancelTimers();
        // Drive the metrics-time freeze from the footer state: the waiting state
        // pauses the counter, and so does a reviewing state in which no reviewer is
        // running (every reviewer waiting or at its verdict) — the review stage
        // advances the counter only while at least one reviewer is running. Entering
        // a pause captures the clock so the live pairs hold steady through it (a
        // pause spanning consecutive footer pushes keeps its original capture);
        // leaving it folds the elapsed span into the pause accumulator so the
        // counter resumes from where it paused with the paused span excluded.
        const paused = state.kind === "waiting" || (state.kind === "reviewing" && !state.reviewers.some(r => r.state === "running"));
        if (paused) {
            if (this._metricsPausedAtMs === null) {
                this._metricsPausedAtMs = this._time.now();
            }
        } else if (this._metricsPausedAtMs !== null) {
            this._metricsPauseAccumMs += this._time.now() - this._metricsPausedAtMs;
            this._metricsPausedAtMs = null;
        }
        this._footer = state;
        if (state.kind === "working") {
            this._animFrame = 0;
            this._workingLabel = pickVariant(workingPool, this._random);
        } else if (state.kind === "reviewing") {
            this._animFrame = 0;
        }
        if (this._mounted) {
            this._redraw();
            this._startFooterTimer();
        }
    }

    writeAbove(text:string):void {
        if (this._disposed) return;
        if (!this._mounted) {
            this._io.write(text);
            return;
        }
        this._redraw(text);
    }

    finalize(label:TerminalLabel):void {
        if (this._disposed) return;
        if (this._finalized) return;
        this._finalized = true;
        this._cancelTimers();
        // The terminal label is one variant chosen at random from the outcome's
        // pool through the injected RandomContext; the chosen string is carried on
        // the footer state and width-fitted at render time (never precomputed).
        this._footer = { kind: "terminal", text: pickVariant(terminalPools[label], this._random) };
        if (this._unsubResize) {
            this._unsubResize();
            this._unsubResize = null;
        }
        if (this._mounted) {
            this._redraw("", "\n");
        }
    }

    dispose():void {
        if (this._disposed) return;
        this._disposed = true;
        this._cancelTimers();
        if (this._unsubResize) {
            this._unsubResize();
            this._unsubResize = null;
        }
    }

    private _cancelTimers():void {
        if (this._animTimer) {
            this._animTimer.cancel();
            this._animTimer = null;
        }
        if (this._labelTimer) {
            this._labelTimer.cancel();
            this._labelTimer = null;
        }
        if (this._countdownTimer) {
            this._countdownTimer.cancel();
            this._countdownTimer = null;
        }
    }

    private _startFooterTimer():void {
        switch (this._footer.kind) {
            case "working":
                this._scheduleAnimTick();
                this._scheduleLabelTick();
                break;
            // The reviewing line carries a single animated indicator that runs for
            // the whole review stage, so the spinner tick is scheduled here too. Its
            // 200 ms redraws also recompute every reviewer's live countdown from the
            // clock, so no separate countdown timer is needed while reviewing.
            case "reviewing":
                this._scheduleAnimTick();
                break;
            case "waiting":
                this._scheduleCountdownTick();
                break;
            /* coverage ignore next 3 */ // — Defensive: mount()/setFooter only reach _startFooterTimer with working/reviewing/waiting; the terminal footer is set only by finalize (which schedules no timer) and the blank footer is never set.
            case "blank":
            case "terminal":
                break;
        }
    }

    private _scheduleAnimTick():void {
        this._animTimer = this._time.setTimeout(() => {
            this._animTimer = null;
            /* coverage ignore next */ // — Defensive: _cancelTimers prevents this callback from firing after dispose/finalize/footer-change.
            if (this._disposed || this._finalized || (this._footer.kind !== "working" && this._footer.kind !== "reviewing")) return;
            this._animFrame = (this._animFrame + 1) % FRAMES.length;
            this._redraw();
            this._scheduleAnimTick();
        }, FRAME_MS);
    }

    private _scheduleLabelTick():void {
        // The working label rotates on its own 9 s cadence, independent of the 200 ms spinner
        // animation; each rotation picks a pool entry different from the one currently shown.
        this._labelTimer = this._time.setTimeout(() => {
            this._labelTimer = null;
            /* coverage ignore next */ // — Defensive: _cancelTimers prevents this callback from firing after dispose/finalize/footer-change.
            if (this._disposed || this._finalized || this._footer.kind !== "working") return;
            this._workingLabel = pickVariant(workingPool, this._random, this._workingLabel);
            this._redraw();
            this._scheduleLabelTick();
        }, LABEL_MS);
    }

    private _scheduleCountdownTick():void {
        this._countdownTimer = this._time.setTimeout(() => {
            this._countdownTimer = null;
            /* coverage ignore next */ // — Defensive: _cancelTimers prevents this callback from firing after dispose/finalize/footer-change.
            if (this._disposed || this._finalized || this._footer.kind !== "waiting") return;
            this._redraw();
            this._scheduleCountdownTick();
        }, 1000);
    }

    // The single redraw entry point every mounted update goes through — a state
    // change, an animation tick, a write above the block, a resize, and the
    // finalize transition. It composes the clear of the previous block, any text
    // scrolled above, the fresh draw, and any trailing suffix into ONE io.write,
    // synchronously in the tick that triggered the update. Emitting those pieces
    // as separate writes lets the terminal render the intermediate state — the
    // content scrolled with the block absent — as a visible flash.
    private _redraw(aboveText = "", suffix = ""):void {
        this._io.write(this._clearString() + aboveText + this._drawString() + suffix);
    }

    private _clearString():string {
        // On the first draw there is no previous block, so there is nothing to clear.
        if (!this._prevLineWidths) return "";
        // The block is drawn with autowrap disabled, so at draw time it is
        // exactly four physical rows. But a terminal that has since shrunk
        // reflows each previously-drawn line that is now wider than the new
        // width into ceil(prevWidth / currentCols) physical rows — the
        // full-width separator and, at small widths, the header and metrics
        // too. The clear must move the cursor up over the previous block's
        // post-reflow physical height (computed against the current width),
        // not a fixed three rows, or stale rows from the larger draw are left
        // on screen. At an unchanged or larger width every line still
        // occupies one row, so this reduces to the canonical three-row move.
        const cols = Math.max(1, this._io.columns());
        let rows = 0;
        for (const w of this._prevLineWidths) {
            rows += Math.max(1, Math.ceil(w / cols));
        }
        // Move to the top of the previous block's post-reflow footprint and
        // erase it entirely, then drop back down so the freshly drawn four
        // rows re-anchor at the bottom of the terminal (the block is always
        // bottom-pinned). On an unchanged or larger width the footprint is
        // four rows, so this reduces to the canonical three-row cursor-up
        // with no re-anchor move.
        let clear = `\x1b[${rows - 1}A` + CR + CLEAR_TO_END;
        if (rows > 4) {
            clear += `\x1b[${rows - 4}B`;
        }
        return clear;
    }

    private _drawString():string {
        const cols = Math.max(0, this._io.columns());
        const separator = SEPARATOR_GLYPH.repeat(cols);
        const header = this._renderHeader(cols);
        const metrics = this._renderMetrics(cols);
        const footer = this._renderFooter(cols);
        this._prevLineWidths = [cols, stripAnsi(header).length, stripAnsi(metrics).length, stripAnsi(footer).length];
        return AUTOWRAP_OFF + separator + "\n" + header + "\n" + metrics + "\n" + footer + AUTOWRAP_ON;
    }

    private _renderHeader(cols:number):string {
        return formatHeaderLine(
            this._header.indexLabel ?? null,
            this._header.phaseMessage ?? null,
            this._header.iteration ?? null,
            this._header.activity ?? null,
            this._header.taskNumber ?? null,
            this._header.title ?? null,
            cols
        );
    }

    private _renderMetrics(cols:number):string {
        return formatMetricsLine(this._resolvePair(this._metrics.task), this._resolvePair(this._metrics.plan), cols);
    }

    // Derives the whole seconds a metrics pair displays on this redraw from the
    // current clock (or the frozen wait clock) and the pair's active-time anchor,
    // so the seconds climb once per second on their own between metrics pushes. A
    // pair without an anchor is static and renders exactly its baseSeconds.
    private _resolvePair(pair:MetricsPairFields|undefined):MetricsPair|undefined {
        if (!pair) return undefined;
        if (pair.anchorMs === undefined) {
            return { tokens: pair.tokens, seconds: pair.baseSeconds };
        }
        const evalNow = this._metricsPausedAtMs ?? this._time.now();
        const activeMs = Math.max(0, evalNow - pair.anchorMs - this._metricsPauseAccumMs);
        return { tokens: pair.tokens, seconds: Math.floor(activeMs / 1000) + pair.baseSeconds };
    }

    private _renderFooter(cols:number):string {
        switch (this._footer.kind) {
            /* coverage ignore next 2 */ // — Defensive: "blank" is a valid state but no current code path sets it.
            case "blank":
                return "";
            case "working":
                return formatWorkingFooter(FRAMES[this._animFrame]!, this._workingLabel, cols);
            case "waiting": {
                const remaining = Math.max(0, this._footer.endTime - this._time.now());
                const dateStr = formatDateTime(new Date(this._footer.endTime));
                const countdown = formatCountdown(remaining);
                return formatWaitingFooter(WAIT_HEADINGS[this._footer.waitKind], dateStr, countdown, cols);
            }
            case "reviewing":
                return formatReviewingFooter(FRAMES[this._animFrame]!, this._footer.reviewers, cols, this._time.now());
            case "terminal":
                return formatTerminalFooter(this._footer.text, cols);
        }
    }
}
