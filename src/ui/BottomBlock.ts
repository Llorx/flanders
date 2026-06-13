import type { TimeContext, TimeoutHandle } from "../contexts";
import { formatCountdown, formatDateTime, formatHeaderLine, formatMetricsLine, formatPreparingFooter, formatReviewingFooter, formatWaitingFooter, formatWorkingFooter, ORANGE, RESET, SEPARATOR_GLYPH, stripAnsi } from "./formatters";
import type { ReviewerEntry } from "./formatters";

export type { ReviewerEntry, ReviewerState, ReviewerTool } from "./formatters";

export type BottomBlockIO = {
    write(text:string):void;
    columns():number;
    onResize(listener:() => void):() => void;
};

export type Activity = "preparing" | "implementing" | "reviewing" | "building" | "testing";

export type HeaderFields = {
    indexLabel?:string|null;
    iteration?:number|null;
    activity?:Activity|null;
    taskNumber?:string|null;
    title?:string|null;
};

export type MetricsFields = {
    task?:{ tokens:number; seconds:number };
    plan?:{ tokens:number; seconds:number };
};

export type WaitKind = "rate-limit";

const WAIT_HEADINGS:Record<WaitKind, string> = {
    "rate-limit": "Waiting rate limit"
};

export type FooterState =
    | { kind:"blank" }
    | { kind:"working" }
    | { kind:"preparing" }
    | { kind:"waiting"; waitKind:WaitKind; endTime:number }
    | { kind:"reviewing"; reviewers:readonly ReviewerEntry[] }
    | { kind:"terminal"; label:TerminalLabel };

export type TerminalLabel = "Done" | "Hard stop" | "Interrupted" | "Failed";

const FRAMES = ["⣋", "⣙", "⣹", "⣸", "⣼", "⣴", "⣦", "⣧", "⣇", "⣏"];
const FRAME_MS = 200;
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
    private _animTimer:TimeoutHandle|null = null;
    private _countdownTimer:TimeoutHandle|null = null;
    private _unsubResize:(() => void)|null = null;
    private _prevLineWidths:readonly number[]|null = null;

    constructor(private _io:BottomBlockIO, private _time:TimeContext) {}

    mount():void {
        if (this._disposed) return;
        if (this._mounted) return;
        this._mounted = true;
        this._unsubResize = this._io.onResize(() => {
            this._clearBlock();
            this._drawBlock();
        });
        this._drawBlock();
        this._startFooterTimer();
    }

    isFinalized():boolean {
        return this._finalized;
    }

    setHeader(fields:HeaderFields):void {
        if (this._disposed || this._finalized) return;
        this._header = fields;
        if (this._mounted) {
            this._clearBlock();
            this._drawBlock();
        }
    }

    setMetrics(fields:MetricsFields):void {
        if (this._disposed || this._finalized) return;
        this._metrics = fields;
        if (this._mounted) {
            this._clearBlock();
            this._drawBlock();
        }
    }

    setFooter(state:FooterState):void {
        if (this._disposed || this._finalized) return;
        this._cancelTimers();
        this._footer = state;
        if (state.kind === "working" || state.kind === "preparing") {
            this._animFrame = 0;
        }
        if (this._mounted) {
            this._clearBlock();
            this._drawBlock();
            this._startFooterTimer();
        }
    }

    writeAbove(text:string):void {
        if (this._disposed) return;
        if (!this._mounted) {
            this._io.write(text);
            return;
        }
        this._clearBlock();
        this._io.write(text);
        this._drawBlock();
    }

    finalize(label:TerminalLabel):void {
        if (this._disposed) return;
        if (this._finalized) return;
        this._finalized = true;
        this._cancelTimers();
        this._footer = { kind: "terminal", label };
        if (this._unsubResize) {
            this._unsubResize();
            this._unsubResize = null;
        }
        if (this._mounted) {
            this._clearBlock();
            this._drawBlock();
            this._io.write("\n");
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
        if (this._countdownTimer) {
            this._countdownTimer.cancel();
            this._countdownTimer = null;
        }
    }

    private _startFooterTimer():void {
        if (this._footer.kind === "working" || this._footer.kind === "preparing") {
            this._scheduleAnimTick();
        } else if (this._footer.kind === "waiting") {
            this._scheduleCountdownTick();
        }
    }

    private _scheduleAnimTick():void {
        this._animTimer = this._time.setTimeout(() => {
            this._animTimer = null;
            /* coverage ignore next */ // — Defensive: _cancelTimers prevents this callback from firing after dispose/finalize/footer-change.
            if (this._disposed || this._finalized || (this._footer.kind !== "working" && this._footer.kind !== "preparing")) return;
            this._animFrame = (this._animFrame + 1) % FRAMES.length;
            this._clearBlock();
            this._drawBlock();
            this._scheduleAnimTick();
        }, FRAME_MS);
    }

    private _scheduleCountdownTick():void {
        this._countdownTimer = this._time.setTimeout(() => {
            this._countdownTimer = null;
            /* coverage ignore next */ // — Defensive: _cancelTimers prevents this callback from firing after dispose/finalize/footer-change.
            if (this._disposed || this._finalized || this._footer.kind !== "waiting") return;
            this._clearBlock();
            this._drawBlock();
            this._scheduleCountdownTick();
        }, 1000);
    }

    private _clearBlock():void {
        /* coverage ignore next */ // — Defensive: every caller of _clearBlock is gated by _mounted, and mount() runs _drawBlock (which records _prevLineWidths) before exposing the listeners/setters that can re-enter the clear path, so _prevLineWidths is always non-null here; the guard upholds the spec's "writes nothing before the first draw" obligation.
        if (!this._prevLineWidths) return;
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
        this._io.write(clear);
    }

    private _drawBlock():void {
        const cols = Math.max(0, this._io.columns());
        const separator = SEPARATOR_GLYPH.repeat(cols);
        const header = this._renderHeader(cols);
        const metrics = this._renderMetrics(cols);
        const footer = this._renderFooter(cols);
        this._io.write(AUTOWRAP_OFF + separator + "\n" + header + "\n" + metrics + "\n" + footer + AUTOWRAP_ON);
        this._prevLineWidths = [cols, stripAnsi(header).length, stripAnsi(metrics).length, stripAnsi(footer).length];
    }

    private _renderHeader(cols:number):string {
        return formatHeaderLine(
            this._header.indexLabel ?? null,
            this._header.iteration ?? null,
            this._header.activity ?? null,
            this._header.taskNumber ?? null,
            this._header.title ?? null,
            cols
        );
    }

    private _renderMetrics(cols:number):string {
        return formatMetricsLine(this._metrics.task, this._metrics.plan, cols);
    }

    private _renderFooter(cols:number):string {
        switch (this._footer.kind) {
            /* coverage ignore next 2 */ // — Defensive: "blank" is a valid state but no current code path sets it.
            case "blank":
                return "";
            case "working":
                return formatWorkingFooter(FRAMES[this._animFrame]!, cols);
            case "preparing":
                return formatPreparingFooter(FRAMES[this._animFrame]!, cols);
            case "waiting": {
                const remaining = Math.max(0, this._footer.endTime - this._time.now());
                const dateStr = formatDateTime(new Date(this._footer.endTime));
                const countdown = formatCountdown(remaining);
                return formatWaitingFooter(WAIT_HEADINGS[this._footer.waitKind], dateStr, countdown, cols);
            }
            case "reviewing":
                return formatReviewingFooter(this._footer.reviewers, cols);
            case "terminal":
                return `${ORANGE}${this._footer.label}${RESET}`;
        }
    }
}
