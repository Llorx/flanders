import type { FsContext } from "./contexts";

export type TaskMetrics = Readonly<{ it:number; ot:number; t:number }>;

export type PlanTask = Readonly<{
    line:number;
    raw:string;
    title:string;
    taskNumber:string;
    done:boolean;
    metrics:TaskMetrics;
}>;

export type PlanParseResult = Readonly<{
    tasks:readonly PlanTask[];
    malformed:readonly Readonly<{ line:number; raw:string }>[];
    lineCount:number;
    size:number;
}>;

const TASK_LINE = /^(\s*[-*+]\s+)\[([ xX])\](\{[^}]*\})(\s.*)?$/;
const MALFORMED_TASK_LINE = /^\s*[-*+]\s+\[([^\]]*)\]/;
const HEADING_NUMBER = /^#{1,6}\s+(\d+(?:\.\d+)*)\b/;

function validateMetrics(jsonStr:string):TaskMetrics|null {
    let parsed:unknown;
    try {
        parsed = JSON.parse(jsonStr);
    } catch {
        return null;
    }
    /* coverage ignore next 3 */ // — Defensive: TASK_LINE regex ensures metricsStr starts with "{", so JSON.parse always returns an object.
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return null;
    }
    const keys = Object.keys(parsed);
    if (keys.length !== 3 || !keys.includes("it") || !keys.includes("ot") || !keys.includes("t")) {
        return null;
    }
    const obj = parsed as Record<string, unknown>;
    for (const key of ["it", "ot", "t"] as const) {
        const v = obj[key];
        if (!Number.isInteger(v) || (v as number) < 0) {
            return null;
        }
    }
    return { it: obj["it"] as number, ot: obj["ot"] as number, t: obj["t"] as number };
}

function validateMetricsInput(metrics:TaskMetrics):void {
    for (const key of ["it", "ot", "t"] as const) {
        const v = metrics[key];
        if (!Number.isInteger(v) || v < 0) {
            throw new Error(`Invalid metric "${key}": ${v} (must be a non-negative integer)`);
        }
    }
}

export function parsePlan(content:string):PlanParseResult {
    const tasks:PlanTask[] = [];
    const malformed:Array<{ line:number; raw:string }> = [];
    const lines = content.split(/\r?\n/);
    let currentNumber = "";
    for (let i = 0; i < lines.length; i++) {
        const raw = lines[i]!;
        const headingMatch = HEADING_NUMBER.exec(raw);
        if (headingMatch) {
            currentNumber = headingMatch[1]!;
        }
        const match = TASK_LINE.exec(raw);
        if (match) {
            const checkbox = match[2]!;
            if (checkbox !== " " && checkbox !== "x") {
                malformed.push({ line: i + 1, raw });
                continue;
            }
            const metricsStr = match[3]!;
            const metrics = validateMetrics(metricsStr);
            if (!metrics) {
                malformed.push({ line: i + 1, raw });
                continue;
            }
            const trailing = match[4] ?? "";
            tasks.push({
                line: i + 1,
                raw,
                title: trailing.trimStart(),
                taskNumber: currentNumber,
                done: checkbox === "x",
                metrics
            });
            continue;
        }
        const malformedMatch = MALFORMED_TASK_LINE.exec(raw);
        if (malformedMatch) {
            malformed.push({ line: i + 1, raw });
        }
    }
    const trailingNewline = content.endsWith("\n");
    const lineCount = trailingNewline ? lines.length - 1 : lines.length;
    return {
        tasks,
        malformed,
        lineCount,
        size: content.length
    };
}

export class PlanFile {
    private constructor(
        readonly path:string,
        private _content:string,
        private _fs:FsContext
    ) {}
    static async load(path:string, fs:FsContext):Promise<PlanFile> {
        const content = await fs.readFile(path);
        return new PlanFile(path, content, fs);
    }
    parse():PlanParseResult {
        return parsePlan(this._content);
    }
    nextOpenTask():PlanTask|null {
        for (const task of this.parse().tasks) {
            if (!task.done) {
                return task;
            }
        }
        return null;
    }
    async updateMetrics(lineNumber:number, metrics:TaskMetrics):Promise<void> {
        return this._rewriteTaskLine(lineNumber, metrics, "none");
    }
    async markDone(lineNumber:number, metrics:TaskMetrics):Promise<void> {
        return this._rewriteTaskLine(lineNumber, metrics, "done");
    }
    async markOpen(lineNumber:number, metrics:TaskMetrics):Promise<void> {
        return this._rewriteTaskLine(lineNumber, metrics, "open");
    }
    planTotals():TaskMetrics {
        const { tasks } = parsePlan(this._content);
        let it = 0, ot = 0, t = 0;
        for (const task of tasks) {
            it += task.metrics.it;
            ot += task.metrics.ot;
            t += task.metrics.t;
        }
        return { it, ot, t };
    }
    private async _rewriteTaskLine(lineNumber:number, metrics:TaskMetrics, flip:"open"|"done"|"none"):Promise<void> {
        validateMetricsInput(metrics);
        const newlineMatch = /\r\n|\n/.exec(this._content);
        const newline = newlineMatch ? newlineMatch[0] : "\n";
        const lines = this._content.split(/\r?\n/);
        const idx = lineNumber - 1;
        const raw = lines[idx];
        if (raw === undefined) {
            throw new Error(`Plan line ${lineNumber} not found in ${this.path}`);
        }
        const match = TASK_LINE.exec(raw);
        if (!match) {
            throw new Error(`Plan line ${lineNumber} is not a task line: ${raw}`);
        }
        if (flip === "done" && match[2] !== " ") {
            throw new Error(`Plan line ${lineNumber} is not an open task: ${raw}`);
        }
        if (flip === "open" && match[2] !== "x") {
            throw new Error(`Plan line ${lineNumber} is not a done task: ${raw}`);
        }
        const metricsStr = `{"it":${metrics.it},"ot":${metrics.ot},"t":${metrics.t}}`;
        if (flip === "done") {
            lines[idx] = raw.replace(/\[ \]\{[^}]*\}/, `[x]${metricsStr}`);
        } else if (flip === "open") {
            lines[idx] = raw.replace(/\[x\]\{[^}]*\}/, `[ ]${metricsStr}`);
        } else {
            lines[idx] = raw.replace(/\{[^}]*\}/, metricsStr);
        }
        this._content = lines.join(newline);
        await this._fs.writeFile(this.path, this._content);
    }
}
