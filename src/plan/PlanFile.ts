import type { FsContext } from "../contexts";

export type TaskMetrics = Readonly<{ it:number; ot:number; t:number }>;

export type PlanTask = Readonly<{
    line:number;
    raw:string;
    title:string;
    taskNumber:string;
    done:boolean;
    metrics:TaskMetrics;
}>;

// A single markdown-link reference a task body makes into a `.spec/contracts` or `.spec/rules`
// file: `path` is the project-root-relative target (leading `/` and any `#…` fragment removed),
// `anchor` is the substring after the first `#` of the target, or `null` when it carries no `#`.
export type LinkedReference = Readonly<{
    path:string;
    anchor:string|null;
}>;

export type PlanParseResult = Readonly<{
    tasks:readonly PlanTask[];
    malformed:readonly Readonly<{ line:number; raw:string }>[];
    lineCount:number;
    size:number;
}>;

export const TASK_LINE = /^(\s*[-*+]\s+)\[([ xX])\](\{[^}]*\})(\s.*)?$/;
const MALFORMED_TASK_LINE = /^\s*[-*+]\s+\[[^\]]*\]\{/;
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

const MARKDOWN_LINK = /\[[^\]]*\]\(([^)]+)\)/g;
const CONTRACTS_SEGMENT = ".spec/contracts/";
const RULES_SEGMENT = ".spec/rules/";
const HEADING_LINE = /^(#{1,6})\s+(.+)$/;
// The one-line sentence that opens the consolidated `spec.md` body, above its reference units.
const SPEC_FILE_LEAD = "The following is the consolidated content of every contract and rule this task references.";

function detectNewline(content:string):string {
    const newlineMatch = /\r\n|\n/.exec(content);
    return newlineMatch ? newlineMatch[0] : "\n";
}

function taskBodyLines(content:string, taskLineNumber:number):string[] {
    const lines = content.split(/\r?\n/);
    const body:string[] = [];
    for (let i = taskLineNumber; i < lines.length; i++) {
        const line = lines[i]!;
        if (TASK_LINE.test(line)) break;
        body.push(line);
    }
    return body;
}

// The full verbatim text of a leaf task: its own line plus its body, from the task line
// down to — but not including — the next task line (open or done) or the end of the file.
// Newline style and content are preserved exactly, reusing taskBodyLines' boundary scan.
export function extractFullTaskText(content:string, taskLineNumber:number):string {
    const lines = content.split(/\r?\n/);
    const taskLine = lines[taskLineNumber - 1]!;
    const body = taskBodyLines(content, taskLineNumber);
    return [taskLine, ...body].join(detectNewline(content));
}

// The canonical markdown-link scanner for a task body. Walks every markdown link in the task's
// body in document order and yields a `{ path, anchor }` for each target that points into a
// `.spec/contracts` or `.spec/rules` folder. The leading `/` and any `#…` fragment are removed
// from the target to form `path`; `anchor` is the substring after the first `#`, or `null` when
// the target carries no `#`. Every qualifying occurrence is preserved in first-appearance order
// — the array is NOT de-duplicated, so the same file may appear more than once with different
// anchors. This is the single place markdown links are scanned; the orchestrator's `spec.md`
// builder consumes it through PlanFile.linkedReferences.
export function parseLinkedReferences(content:string, taskLineNumber:number):LinkedReference[] {
    const body = taskBodyLines(content, taskLineNumber);
    const references:LinkedReference[] = [];
    for (const line of body) {
        let m;
        while ((m = MARKDOWN_LINK.exec(line)) !== null) {
            const target = m[1]!;
            const hashIndex = target.indexOf("#");
            const anchor = hashIndex === -1 ? null : target.slice(hashIndex + 1);
            const rawPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
            const path = rawPath.replace(/^\//, "");
            if (path.includes(CONTRACTS_SEGMENT) || path.includes(RULES_SEGMENT)) {
                references.push({ path, anchor });
            }
        }
    }
    return references;
}

// Computes the GitHub-style heading anchor slug for a heading's text: trim surrounding
// whitespace, lowercase, drop every character that is not an ASCII letter, digit, space,
// hyphen, or underscore, then replace each remaining space with a hyphen. An apostrophe is
// dropped (`worker's` → `workers`) and a spaced em-dash collapses to a double hyphen
// (`completes — cancelling` → `completes--cancelling`).
export function headingAnchor(headingText:string):string {
    return headingText
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9 _-]/g, "")
        .replace(/ /g, "-");
}

// Extracts the section a heading anchor names from a file's content: the first heading line
// whose computed anchor equals `anchor`, through the line immediately before the next heading
// of the same or higher level (equal or fewer `#`), or through the end of the file when none
// follows. Returns `null` when no heading's anchor matches — which includes `#L<n>` line
// fragments, since a line fragment never equals a computed heading anchor.
export function extractHeadingSection(content:string, anchor:string):string|null {
    const lines = content.split(/\r?\n/);
    let startIdx = -1;
    let level = 0;
    for (let i = 0; i < lines.length; i++) {
        const headingMatch = HEADING_LINE.exec(lines[i]!);
        if (headingMatch && headingAnchor(headingMatch[2]!) === anchor) {
            startIdx = i;
            level = headingMatch[1]!.length;
            break;
        }
    }
    if (startIdx === -1) {
        return null;
    }
    let endIdx = lines.length;
    for (let i = startIdx + 1; i < lines.length; i++) {
        const headingMatch = HEADING_LINE.exec(lines[i]!);
        if (headingMatch && headingMatch[1]!.length <= level) {
            endIdx = i;
            break;
        }
    }
    return lines.slice(startIdx, endIdx).join(detectNewline(content));
}

// Builds the consolidated `spec.md` body from the ordered references and a lookup from each
// referenced path to that file's full content. A reference whose `anchor` is `null`, or whose
// anchor resolves to no heading (a `#L<n>` line fragment or any unmatched anchor), contributes
// the whole file. Distinct files are emitted in first-appearance order; a file with any
// whole-file reference is emitted once as a whole-file unit and its sections are not emitted
// separately; otherwise each distinct resolved section is emitted once in first-appearance
// order. Each unit renders as a `## <namespace>` (whole file) or `## <namespace>#<anchor>`
// (section) heading followed by the verbatim content; the body opens with a one-line lead
// sentence and the units are joined by a blank line.
export function buildSpecFileContent(references:readonly LinkedReference[], fileContents:ReadonlyMap<string, string>):string {
    type FileUnit = { whole:boolean; sections:Array<{ anchor:string; content:string }> };
    const order:string[] = [];
    const byPath = new Map<string, FileUnit>();
    for (const { path, anchor } of references) {
        let unit = byPath.get(path);
        if (!unit) {
            unit = { whole: false, sections: [] };
            byPath.set(path, unit);
            order.push(path);
        }
        if (anchor === null) {
            unit.whole = true;
            continue;
        }
        const section = extractHeadingSection(fileContents.get(path)!, anchor);
        if (section === null) {
            unit.whole = true;
        } else if (!unit.sections.some(existing => existing.anchor === anchor)) {
            unit.sections.push({ anchor, content: section });
        }
    }
    const units:string[] = [];
    for (const path of order) {
        const unit = byPath.get(path)!;
        if (unit.whole) {
            units.push(`## ${path}\n\n${fileContents.get(path)!}`);
        } else {
            for (const { anchor, content } of unit.sections) {
                units.push(`## ${path}#${anchor}\n\n${content}`);
            }
        }
    }
    return [SPEC_FILE_LEAD, ...units].join("\n\n");
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
    linkedReferences(task:PlanTask):LinkedReference[] {
        return parseLinkedReferences(this._content, task.line);
    }
    fullTaskText(task:PlanTask):string {
        return extractFullTaskText(this._content, task.line);
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
        const newline = detectNewline(this._content);
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
