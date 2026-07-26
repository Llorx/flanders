import { abortError } from "../abortError";
import type { AskAnswer, AskChoiceOptions, AskContext, ChoiceOption, OutputContext } from "../contexts";

export interface LineReader {
    read(prompt:string, out:OutputContext, signal?:AbortSignal):Promise<string>;
}

type ParsedAnswer = { picks:number[]; extra?:string };

function parseAnswer(raw:string, max:number, multi:boolean):ParsedAnswer|null {
    const trimmed = raw.trim();
    if (!trimmed) {
        return null;
    }
    const leadingNumbers = (multi ? /^\d+(?:\s*,\s*\d+)*/ : /^\d+/).exec(trimmed);
    if (leadingNumbers === null) {
        return { picks: [], extra: trimmed };
    }
    const numberPart = leadingNumbers[0];
    const extraPart = trimmed.slice(numberPart.length).trim();
    const picks:number[] = [];
    for (const token of numberPart.split(/\s*,\s*/)) {
        const n = Number.parseInt(token, 10);
        if (n < 1 || n > max) {
            return null;
        }
        if (!picks.includes(n)) {
            picks.push(n);
        }
    }
    return extraPart ? { picks, extra: extraPart } : { picks };
}

export class ConsoleAsk implements AskContext {
    constructor(private _reader:LineReader, private _output:OutputContext) {}

    async askChoices(questions:readonly AskChoiceOptions[], output?:OutputContext, signal?:AbortSignal):Promise<readonly AskAnswer[]> {
        if (signal?.aborted) {
            throw abortError();
        }
        const out = output ?? this._output;
        const total = questions.length;
        const answers:Array<AskAnswer|undefined> = questions.map(q =>
            q.multiSelect && q.defaultIndexes !== undefined && q.defaultIndexes.length > 0
                ? { picked: q.defaultIndexes.map(i => q.options[i]!) }
                : undefined
        );
        let idx = 0;
        while (idx < total) {
            const q = questions[idx]!;
            const existing = answers[idx];
            this._renderQuestion(q, idx, total, existing, out);
            const raw = await this._reader.read(this._promptText(q, idx, total, existing), out, signal);
            if (signal?.aborted) {
                throw abortError();
            }
            const trimmed = raw.trim();
            if (trimmed === "-") {
                if (idx > 0) {
                    idx--;
                } else {
                    out.writeError("Already at the first question.\n");
                }
                continue;
            }
            if (trimmed === "+") {
                if (existing === undefined) {
                    out.writeError("Answer this question first, then use '+' to move on.\n");
                } else if (idx + 1 < total) {
                    idx++;
                } else {
                    out.writeError("Already at the last question — submit it to finish.\n");
                }
                continue;
            }
            if (raw === "" && q.defaultIndex !== undefined) {
                answers[idx] = { picked: [q.options[q.defaultIndex]!] };
                idx++;
                continue;
            }
            if (raw === "" && q.multiSelect && existing !== undefined && existing.picked.length > 0) {
                idx++;
                continue;
            }
            const parsed = parseAnswer(raw, q.options.length, q.multiSelect);
            if (!parsed) {
                out.writeError("Invalid input. Pick a valid option number, type free-form text, or use '-' / '+' to navigate.\n");
                continue;
            }
            const picked:ChoiceOption[] = parsed.picks.map(i => q.options[i - 1]!);
            answers[idx] = parsed.extra ? { picked, extra: parsed.extra } : { picked };
            idx++;
        }
        return answers as AskAnswer[];
    }

    async askText(prompt:string):Promise<string> {
        return await this._reader.read(prompt, this._output);
    }

    private _renderQuestion(q:AskChoiceOptions, idx:number, total:number, existing:AskAnswer|undefined, out:OutputContext):void {
        const counter = total > 1 ? `(${idx + 1}/${total}) ` : "";
        out.write(`\n[?] ${counter}${q.header}${q.header ? ": " : ""}${q.question}\n`);
        const pickedLabels = new Set((existing?.picked ?? []).map(p => p.label));
        for (let i = 0; i < q.options.length; i++) {
            const o = q.options[i]!;
            const marker = pickedLabels.has(o.label) ? "*" : " ";
            const isDefault = q.defaultIndex === i;
            out.write(`  ${marker} ${i + 1}) ${o.label}${o.description ? ` — ${o.description}` : ""}${isDefault ? " (default — press Enter)" : ""}\n`);
        }
        if (existing) {
            const parts = [existing.picked.map(p => p.label).join(", "), existing.extra ?? ""];
            out.write(`  current: ${parts.filter(part => part.length > 0).join(": ")}\n`);
        }
    }

    private _promptText(q:AskChoiceOptions, idx:number, total:number, existing:AskAnswer|undefined):string {
        const hints:string[] = [];
        hints.push(q.multiSelect
            ? `[1-${q.options.length}, comma-separated; free-text OK]`
            : `[1-${q.options.length}; free-text OK]`);
        if (q.defaultIndex !== undefined || (q.multiSelect && existing !== undefined && existing.picked.length > 0)) {
            hints.push("Enter for the default");
        }
        if (idx > 0) {
            hints.push("'-' back");
        }
        if (existing !== undefined && idx + 1 < total) {
            hints.push("'+' next");
        }
        return `Pick ${hints.join(", ")}: `;
    }
}
