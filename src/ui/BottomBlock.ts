import type { TimeContext, TimeoutHandle } from "../contexts";
import { formatCountdown, formatDateTime, formatHeaderLine, formatMetricsLine, formatReviewingFooter, ORANGE, RESET, SEPARATOR_GLYPH } from "./formatters";
import type { ReviewerEntry } from "./formatters";

export type { ReviewerEntry, ReviewerState, ReviewerTool } from "./formatters";

export type BottomBlockIO = {
    write(text:string):void;
    columns():number;
    onResize(listener:() => void):() => void;
};

export type Activity = "implementing" | "reviewing" | "building" | "testing";

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
    | { kind:"waiting"; waitKind:WaitKind; endTime:number }
    | { kind:"reviewing"; reviewers:readonly ReviewerEntry[] }
    | { kind:"terminal"; label:TerminalLabel };

export type TerminalLabel = "Done" | "Hard stop" | "Interrupted" | "Failed";

const FRAMES = ["⣋", "⣙", "⣹", "⣸", "⣼", "⣴", "⣦", "⣧", "⣇", "⣏"];
const FRAME_MS = 200;
const CURSOR_UP_3 = "\x1b[3A";
const CLEAR_TO_END = "\x1b[J";
const CR = "\r";

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
        if (state.kind === "working") {
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
        if (this._footer.kind === "working") {
            this._scheduleAnimTick();
        } else if (this._footer.kind === "waiting") {
            this._scheduleCountdownTick();
        }
    }

    private _scheduleAnimTick():void {
        this._animTimer = this._time.setTimeout(() => {
            this._animTimer = null;
            /* coverage ignore next */ // — Defensive: _cancelTimers prevents this callback from firing after dispose/finalize/footer-change.
            if (this._disposed || this._finalized || this._footer.kind !== "working") return;
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
        this._io.write(CURSOR_UP_3 + CR + CLEAR_TO_END);
    }

    private _drawBlock():void {
        const cols = Math.max(0, this._io.columns());
        const separator = SEPARATOR_GLYPH.repeat(cols);
        const header = this._renderHeader(cols);
        const metrics = this._renderMetrics(cols);
        const footer = this._renderFooter(cols);
        this._io.write(separator + "\n" + header + "\n" + metrics + "\n" + footer);
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
                return `${ORANGE}${FRAMES[this._animFrame]} Working${RESET}`;
            case "waiting": {
                const remaining = Math.max(0, this._footer.endTime - this._time.now());
                const dateStr = formatDateTime(new Date(this._footer.endTime));
                const countdown = formatCountdown(remaining);
                return `${ORANGE}${WAIT_HEADINGS[this._footer.waitKind]} — ${dateStr} — ${countdown}${RESET}`;
            }
            case "reviewing":
                return formatReviewingFooter(this._footer.reviewers, cols);
            case "terminal":
                return `${ORANGE}${this._footer.label}${RESET}`;
        }
    }
}
