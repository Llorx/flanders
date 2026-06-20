export const CYAN = "\x1b[36m";
export const YELLOW = "\x1b[33m";
export const MAGENTA = "\x1b[35m";
export const GREEN = "\x1b[32m";
export const RED = "\x1b[31m";
export const BLUE = "\x1b[34m";
export const DIM = "\x1b[2m";
export const ORANGE = "\x1b[38;5;208m";
export const RESET = "\x1b[0m";

export const SEPARATOR_GLYPH = "─";

export function colorize(text:string, code:string):string {
    return code + text + RESET;
}

export function stripAnsi(s:string):string {
    return s.replace(/\x1b\[[?\d;]*[a-zA-Z]/g, "");
}

export type Segment = {
    text:string;
    color?:string;
};

export function renderSegments(segments:Segment[]):string {
    let result = "";
    for (const seg of segments) {
        if (seg.color) {
            result += seg.color + seg.text + RESET;
        } else {
            result += seg.text;
        }
    }
    return result;
}

export function segmentsWidth(segments:readonly Segment[]):number {
    let width = 0;
    for (const seg of segments) width += seg.text.length;
    return width;
}

export function renderSegmentsToWidth(segments:Segment[], cols:number):string {
    if (segmentsWidth(segments) <= cols) return renderSegments(segments);

    let result = "";
    let remaining = Math.max(0, cols - 1);
    for (const seg of segments) {
        if (remaining <= 0) break;
        const chunk = seg.text.slice(0, remaining);
        if (seg.color) {
            result += seg.color + chunk + RESET;
        } else {
            result += chunk;
        }
        remaining -= chunk.length;
    }
    result += "…";
    return result;
}

type CountdownTier = "days" | "hours" | "minutes";

type CountdownParts = {
    tier:CountdownTier;
    days:number;
    hours:number;
    minutes:number;
};

function decomposeCountdown(remainingMs:number):CountdownParts {
    const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    if (totalMinutes >= 24 * 60) {
        const days = Math.floor(totalMinutes / (24 * 60));
        const remainder = totalMinutes - days * 24 * 60;
        const hours = Math.floor(remainder / 60);
        const minutes = remainder % 60;
        return { tier: "days", days, hours, minutes };
    }
    if (totalMinutes >= 60) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return { tier: "hours", days: 0, hours, minutes };
    }
    return { tier: "minutes", days: 0, hours: 0, minutes: totalMinutes };
}

export function formatCountdown(remainingMs:number):string {
    const { tier, days, hours, minutes } = decomposeCountdown(remainingMs);
    if (tier === "days") {
        return `${days} days, ${hours} hours, ${minutes} minutes`;
    }
    if (tier === "hours") {
        return `${hours} hours ${minutes} minutes`;
    }
    return `${minutes} minutes`;
}

export function formatCompactCountdown(remainingMs:number):string {
    const { tier, days, hours, minutes } = decomposeCountdown(remainingMs);
    if (tier === "days") {
        return `${days}d${hours}h${minutes}m`;
    }
    if (tier === "hours") {
        return `${hours}h${minutes}m`;
    }
    return `${minutes}m`;
}

export function formatDateTime(date:Date):string {
    const pad = (n:number) => String(n).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function truncateToWidth(text:string, cols:number):string {
    if (text.length <= cols) return text;
    return text.slice(0, Math.max(0, cols - 1)) + "…";
}

export function formatTokens(n:number):string {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1000) return (n / 1000).toFixed(1) + "k";
    return String(Math.floor(n));
}

export function formatActiveTime(seconds:number):string {
    const s = Math.max(0, Math.floor(seconds));
    if (s < 60) return `${s}s`;
    const pad2 = (n:number) => String(n).padStart(2, "0");
    if (s < 3600) {
        const m = Math.floor(s / 60);
        return `${m}m${pad2(s % 60)}s`;
    }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h${pad2(m)}m${pad2(s % 60)}s`;
}

const LIVE_ACTIVITIES = new Set(["implementing", "reviewing", "building", "testing"]);

export function formatHeaderLine(indexLabel:string|null, iteration:number|null, activity:string|null, taskNumber:string|null|undefined, title:string|null, cols:number):string {
    const segments:Segment[] = [];
    if (indexLabel != null) {
        segments.push({ text: indexLabel, color: CYAN });
    }
    if (iteration != null) {
        if (segments.length > 0) segments.push({ text: " " });
        segments.push({ text: `iter ${iteration}`, color: YELLOW });
    }
    if (activity != null) {
        const activityColor = activity === "done" ? GREEN : LIVE_ACTIVITIES.has(activity) ? MAGENTA : undefined;
        if (segments.length > 0) segments.push({ text: " " });
        segments.push({ text: activity, color: activityColor });
    }
    if (taskNumber) {
        if (segments.length > 0) segments.push({ text: " " });
        segments.push({ text: taskNumber, color: GREEN });
    }
    if (title != null) {
        if (segments.length > 0) segments.push({ text: " " });
        segments.push({ text: title });
    }
    if (segments.length === 0) return "";
    return renderSegmentsToWidth(segments, cols);
}

export type MetricsPair = { tokens:number; seconds:number };

function buildFullMetricsSegments(tTok:string, tTime:string, pTok:string, pTime:string):Segment[] {
    return [
        { text: "task", color: DIM },
        { text: " " },
        { text: tTok, color: GREEN },
        { text: " " },
        { text: tTime, color: BLUE },
        { text: "  " },
        { text: "│", color: DIM },
        { text: "  " },
        { text: "plan", color: DIM },
        { text: " " },
        { text: pTok, color: GREEN },
        { text: " " },
        { text: pTime, color: BLUE },
    ];
}

function buildPairFullSegments(label:string, tok:string, time:string):Segment[] {
    return [
        { text: label, color: DIM },
        { text: " " },
        { text: tok, color: GREEN },
        { text: " " },
        { text: time, color: BLUE },
    ];
}

function buildPairCompactSegments(label:string, tok:string, time:string):Segment[] {
    return [
        { text: label, color: DIM },
        { text: tok, color: GREEN },
        { text: " " },
        { text: time, color: BLUE },
    ];
}

export function formatMetricsLine(task:MetricsPair|undefined, plan:MetricsPair|undefined, cols:number):string {
    if (!task && !plan) return "";

    const tTok = task ? formatTokens(task.tokens) : undefined;
    const tTime = task ? formatActiveTime(task.seconds) : undefined;
    const pTok = plan ? formatTokens(plan.tokens) : undefined;
    const pTime = plan ? formatActiveTime(plan.seconds) : undefined;

    const fullSegments:Segment[] = [];
    if (task) fullSegments.push(...buildPairFullSegments("task", tTok!, tTime!));
    if (task && plan) fullSegments.push({ text: "  " }, { text: "│", color: DIM }, { text: "  " });
    if (plan) fullSegments.push(...buildPairFullSegments("plan", pTok!, pTime!));

    if (segmentsWidth(fullSegments) <= cols) return renderSegments(fullSegments);

    const compactSegments:Segment[] = [];
    if (task) compactSegments.push(...buildPairCompactSegments("t:", tTok!, tTime!));
    if (task && plan) compactSegments.push({ text: "│", color: DIM });
    if (plan) compactSegments.push(...buildPairCompactSegments("p:", pTok!, pTime!));

    if (segmentsWidth(compactSegments) <= cols) return renderSegments(compactSegments);

    return renderSegmentsToWidth(compactSegments, cols);
}

export function formatSnapshotHeader(indexLabel:string, iteration:number, taskNumber:string|undefined, title:string):string {
    return formatHeaderLine(indexLabel, iteration, "done", taskNumber, title, Number.MAX_SAFE_INTEGER);
}

export function formatSnapshotMetrics(taskTokens:number, taskSeconds:number, planTokens:number, planSeconds:number):string {
    const tTok = formatTokens(taskTokens);
    const tTime = formatActiveTime(taskSeconds);
    const pTok = formatTokens(planTokens);
    const pTime = formatActiveTime(planSeconds);
    return renderSegments(buildFullMetricsSegments(tTok, tTime, pTok, pTime));
}

export function formatSnapshotBlock(indexLabel:string, iteration:number, taskNumber:string|undefined, title:string, taskTokens:number, taskSeconds:number, planTokens:number, planSeconds:number, cols:number):string {
    const sep = SEPARATOR_GLYPH.repeat(cols);
    const header = formatSnapshotHeader(indexLabel, iteration, taskNumber, title);
    const metrics = formatSnapshotMetrics(taskTokens, taskSeconds, planTokens, planSeconds);
    return sep + "\n" + header + "\n" + metrics + "\n" + sep + "\n";
}

export type ReviewerTool = "claude" | "codex";
export type ReviewerState = "running" | "waiting" | "pass" | "fail";

export type ReviewerEntry = {
    tool:ReviewerTool;
    model:string;
    effort:string;
    state:ReviewerState;
    // Absolute target end of this reviewer's rate-limit wait, present only while
    // `state` is `"waiting"`. When set, the rendered `<state>` carries a live
    // compact countdown recomputed from the current clock on every redraw.
    endTime?:number;
};

function reviewerEntryDescriptor(model:string, effort:string):string {
    const modelToken = model === "" ? "default" : model;
    if (effort === model) {
        return `(${modelToken})`;
    }
    const effortToken = effort === "" ? "default" : effort;
    return `(${modelToken} ${effortToken})`;
}

// Renders a reviewer's `<state>`: a waiting reviewer with a known end time
// carries its compact countdown (`waiting 2h14m`), recomputed from `nowMs` so it
// is never cached between redraws; every other state — including a waiting
// reviewer with no end time — renders bare. Shared by the full and compact
// builders so the countdown survives compaction and only the truncation tier may
// cut it.
function reviewerStateText(r:ReviewerEntry, nowMs:number):string {
    if (r.state === "waiting" && r.endTime != null) {
        return `waiting ${formatCompactCountdown(Math.max(0, r.endTime - nowMs))}`;
    }
    return r.state;
}

// The verdict color that tints a reviewer's whole entry: green once it has
// passed, red once it has failed. A reviewer still running or in a rate-limit
// wait keeps the footer's orange, so only a reached verdict recolors its entry.
function reviewerEntryColor(state:ReviewerState):string {
    if (state === "pass") return GREEN;
    if (state === "fail") return RED;
    return ORANGE;
}

// Builds the reviewing line as colored segments. The single animated indicator
// and the `review: ` prefix that follows it form one leading orange segment;
// each `, ` separator stays orange; and every reviewer entry carries its own
// verdict color (orange while running/waiting, green on pass, red on fail). The
// compact tier drops each entry's `(<model> <effort>)` descriptor while leaving
// the indicator and prefix intact; truncation cuts from the end, so the indicator
// and prefix at the start always survive.
function buildReviewingSegments(frame:string, reviewers:readonly ReviewerEntry[], nowMs:number, compact:boolean):Segment[] {
    const segments:Segment[] = [{ text: `${frame} review: `, color: ORANGE }];
    for (let i = 0; i < reviewers.length; i++) {
        const r = reviewers[i]!;
        if (i > 0) segments.push({ text: ", ", color: ORANGE });
        const descriptor = compact ? "" : ` ${reviewerEntryDescriptor(r.model, r.effort)}`;
        segments.push({ text: `${r.tool}${descriptor}: ${reviewerStateText(r, nowMs)}`, color: reviewerEntryColor(r.state) });
    }
    return segments;
}

export function formatReviewingFooter(frame:string, reviewers:readonly ReviewerEntry[], cols:number, nowMs:number):string {
    const full = buildReviewingSegments(frame, reviewers, nowMs, false);
    if (segmentsWidth(full) <= cols) {
        return renderSegments(full);
    }
    const compact = buildReviewingSegments(frame, reviewers, nowMs, true);
    if (segmentsWidth(compact) <= cols) {
        return renderSegments(compact);
    }
    return renderSegmentsToWidth(compact, cols);
}

function fitOrangeFooterLine(text:string, cols:number):string {
    if (text.length <= cols) {
        return renderSegments([{ text, color: ORANGE }]);
    }
    return renderSegmentsToWidth([{ text, color: ORANGE }], cols);
}

export function formatWorkingFooter(frame:string, label:string, cols:number):string {
    return fitOrangeFooterLine(`${frame} ${label}`, cols);
}

export function formatTerminalFooter(label:string, cols:number):string {
    return fitOrangeFooterLine(label, cols);
}

export function formatWaitingFooter(heading:string, dateTime:string, countdown:string, cols:number):string {
    return fitOrangeFooterLine(`${heading} — ${dateTime} — ${countdown}`, cols);
}
