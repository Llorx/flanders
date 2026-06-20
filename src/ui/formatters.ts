export const CYAN = "\x1b[36m";
export const YELLOW = "\x1b[33m";
export const MAGENTA = "\x1b[35m";
export const GREEN = "\x1b[32m";
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

export function renderSegmentsToWidth(segments:Segment[], cols:number):string {
    let plainLen = 0;
    for (const seg of segments) plainLen += seg.text.length;
    if (plainLen <= cols) return renderSegments(segments);

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

export function formatCountdown(remainingMs:number):string {
    const totalMinutes = Math.max(1, Math.ceil(remainingMs / 60000));
    if (totalMinutes >= 24 * 60) {
        const days = Math.floor(totalMinutes / (24 * 60));
        const remainder = totalMinutes - days * 24 * 60;
        const hours = Math.floor(remainder / 60);
        const minutes = remainder % 60;
        return `${days} days, ${hours} hours, ${minutes} minutes`;
    }
    if (totalMinutes >= 60) {
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        return `${hours} hours ${minutes} minutes`;
    }
    return `${totalMinutes} minutes`;
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

    let fullPlainLen = 0;
    for (const seg of fullSegments) fullPlainLen += seg.text.length;
    if (fullPlainLen <= cols) return renderSegments(fullSegments);

    const compactSegments:Segment[] = [];
    if (task) compactSegments.push(...buildPairCompactSegments("t:", tTok!, tTime!));
    if (task && plan) compactSegments.push({ text: "│", color: DIM });
    if (plan) compactSegments.push(...buildPairCompactSegments("p:", pTok!, pTime!));

    let compactPlainLen = 0;
    for (const seg of compactSegments) compactPlainLen += seg.text.length;
    if (compactPlainLen <= cols) return renderSegments(compactSegments);

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
export type ReviewerState = "running" | "waiting" | "ok" | "fail";

export type ReviewerEntry = {
    tool:ReviewerTool;
    model:string;
    effort:string;
    state:ReviewerState;
};

function reviewerEntryDescriptor(model:string, effort:string):string {
    const modelToken = model === "" ? "default" : model;
    if (effort === model) {
        return `(${modelToken})`;
    }
    const effortToken = effort === "" ? "default" : effort;
    return `(${modelToken} ${effortToken})`;
}

function buildReviewingFullText(reviewers:readonly ReviewerEntry[]):string {
    let line = "review: ";
    for (let i = 0; i < reviewers.length; i++) {
        const r = reviewers[i]!;
        if (i > 0) line += ", ";
        line += `${r.tool} ${reviewerEntryDescriptor(r.model, r.effort)}: ${r.state}`;
    }
    return line;
}

function buildReviewingCompactText(reviewers:readonly ReviewerEntry[]):string {
    let line = "review: ";
    for (let i = 0; i < reviewers.length; i++) {
        const r = reviewers[i]!;
        if (i > 0) line += ", ";
        line += `${r.tool}: ${r.state}`;
    }
    return line;
}

export function formatReviewingFooter(reviewers:readonly ReviewerEntry[], cols:number):string {
    const fullText = buildReviewingFullText(reviewers);
    if (fullText.length <= cols) {
        return renderSegments([{ text: fullText, color: ORANGE }]);
    }
    const compactText = buildReviewingCompactText(reviewers);
    if (compactText.length <= cols) {
        return renderSegments([{ text: compactText, color: ORANGE }]);
    }
    return renderSegmentsToWidth([{ text: compactText, color: ORANGE }], cols);
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
