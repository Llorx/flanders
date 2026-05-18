import { Claude, ClaudeEvent, ClaudeResult, PermissionRequest, PermissionResponse } from "./Claude";
import type { AskChoiceOptions, AskContext, ChoiceOption, ClaudeContext, OutputContext, TimeContext } from "./contexts";

const TOOL_RESULT_MAX_LINES = 5;
const TOOL_INPUT_INLINE_MAX = 120;

export type ClaudeSessionOptions = Readonly<{
    prompt:string;
    cwd?:string;
    initialSessionId?:string|null;
    forkFromSessionId?:string|null;
    onLongWaitStart?(kind:"rate-limit", endTimeMs:number):void;
    onLongWaitEnd?():void;
}>;

export type ClaudeSessionContexts = Readonly<{
    claude:ClaudeContext;
    time:TimeContext;
    output:OutputContext;
    ask:AskContext;
}>;

type RawQuestion = Readonly<{
    question?:string;
    header?:string;
    multiSelect?:boolean;
    options?:ReadonlyArray<Readonly<{ label?:string; description?:string }>>;
}>;

export class ClaudeSession {
    private _disposed = false;
    private _claude:Claude|null = null;
    private _printedAnyOutputThisRun = false;
    private _seenTextThisMessage = "";
    private _textOpen = false;
    constructor(
        private _options:ClaudeSessionOptions,
        private _contexts:ClaudeSessionContexts
    ) {}
    async run():Promise<ClaudeResult> {
        if (this._disposed) {
            throw new Error("ClaudeSession disposed");
        }
        this._resetState();
        const claude = new Claude({
            prompt: this._options.prompt,
            ...(this._options.cwd ? { cwd: this._options.cwd } : null),
            ...(this._options.initialSessionId != null ? { initialSessionId: this._options.initialSessionId } : null),
            ...(this._options.forkFromSessionId != null ? { forkFromSessionId: this._options.forkFromSessionId } : null),
            onEvent: event => this._onEvent(event),
            onStderr: chunk => this._contexts.output.writeError(chunk),
            onPermissionRequest: req => this._onPermissionRequest(req),
            onLongWaitStart: this._options.onLongWaitStart,
            onLongWaitEnd: this._options.onLongWaitEnd
        }, this._contexts.claude, this._contexts.time);
        this._claude = claude;
        try {
            return await claude.result();
        } finally {
            await claude.dispose();
            if (this._claude === claude) {
                this._claude = null;
            }
        }
    }
    async dispose() {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        await this._claude?.dispose();
        this._claude = null;
    }
    private _resetState() {
        this._printedAnyOutputThisRun = false;
        this._seenTextThisMessage = "";
        this._textOpen = false;
    }
    private async _onPermissionRequest(req:PermissionRequest):Promise<PermissionResponse> {
        if (req.tool_name === "AskUserQuestion") {
            return await this._handleAskUserQuestion(req.tool_input);
        }
        return {
            behavior: "allow",
            updatedInput: typeof req.tool_input === "object" && req.tool_input !== null ? req.tool_input : {}
        };
    }
    private async _handleAskUserQuestion(toolInput:unknown):Promise<PermissionResponse> {
        const questions = extractQuestions(toolInput);
        if (questions.length === 0) {
            return {
                behavior: "allow",
                updatedInput: typeof toolInput === "object" && toolInput !== null ? toolInput : {}
            };
        }
        this._closeOpenTextLine();
        // NOTE: the claude CLI applies a ~60s timeout on control_request responses.
        // The user can navigate between questions with '-' and '+' while answering.
        const askOptions:AskChoiceOptions[] = questions.map(q => ({
            header: q.header,
            question: q.question,
            options: q.options.map(o => ({ label: o.label, description: o.description } as ChoiceOption)),
            multiSelect: q.multiSelect
        }));
        const allAnswers = await this._contexts.ask.askChoices(askOptions);
        if (this._disposed) {
            return { behavior: "deny", message: "session disposed", interrupt: true };
        }
        const answers:Record<string, string> = {};
        for (let i = 0; i < questions.length; i++) {
            const q = questions[i]!;
            const answer = allAnswers[i]!;
            const labels = answer.picked.map(p => p.label).join(", ");
            let composed:string;
            if (labels && answer.extra) {
                composed = `${labels}: ${answer.extra}`;
            } else if (labels) {
                composed = labels;
            } else if (answer.extra) {
                composed = answer.extra;
            } else {
                composed = "(no answer)";
            }
            answers[q.question] = composed;
        }
        return {
            behavior: "allow",
            updatedInput: { questions, answers }
        };
    }
    private _onEvent(event:ClaudeEvent) {
        if (event.error?.message) {
            this._closeOpenTextLine();
            this._contexts.output.writeError(`[claude error] ${event.error.message}\n`);
            this._printedAnyOutputThisRun = true;
            return;
        }
        const sse = event.type === "stream_event" && event.event ? event.event : event;
        if (sse?.type === "content_block_start" && sse.content_block?.type === "text" && typeof sse.content_block.text === "string" && sse.content_block.text.length > 0) {
            this._emitText(sse.content_block.text);
            this._seenTextThisMessage += sse.content_block.text;
            return;
        }
        if (sse?.type === "content_block_delta" && sse.delta?.type === "text_delta" && typeof sse.delta.text === "string" && sse.delta.text.length > 0) {
            this._emitText(sse.delta.text);
            this._seenTextThisMessage += sse.delta.text;
            return;
        }
        if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
                if (block.type === "text" && typeof block.text === "string" && block.text.length > 0) {
                    const remainder = block.text.startsWith(this._seenTextThisMessage)
                        ? block.text.slice(this._seenTextThisMessage.length)
                        : block.text;
                    if (remainder.length > 0) {
                        this._emitText(remainder);
                        this._seenTextThisMessage = block.text;
                    }
                } else if (block.type === "tool_use" && typeof block.name === "string") {
                    this._closeOpenTextLine();
                    this._contexts.output.write(`● ${block.name}(${formatToolInput(block.input)})\n`);
                    this._printedAnyOutputThisRun = true;
                }
            }
            return;
        }
        if (event.type === "user" && event.message?.content) {
            for (const block of event.message.content) {
                if (block.type === "tool_result") {
                    this._closeOpenTextLine();
                    const text = renderToolResultContent(block.content);
                    if (text) {
                        this._contexts.output.write(formatToolResultLines(text, block.is_error === true));
                        this._printedAnyOutputThisRun = true;
                    }
                }
            }
            return;
        }
        if (sse?.type === "message_stop") {
            this._closeOpenTextLine();
            this._seenTextThisMessage = "";
            return;
        }
        if (event.type === "result" && typeof event.result === "string") {
            this._closeOpenTextLine();
            if (!this._printedAnyOutputThisRun) {
                this._contexts.output.write(event.result);
                this._contexts.output.write("\n");
                this._printedAnyOutputThisRun = true;
            }
            this._claude?.endSession();
        }
    }
    private _emitText(text:string) {
        this._contexts.output.write(text);
        this._textOpen = !text.endsWith("\n");
        this._printedAnyOutputThisRun = true;
    }
    private _closeOpenTextLine() {
        if (this._textOpen) {
            this._contexts.output.write("\n");
            this._textOpen = false;
        }
    }
}

type ExtractedQuestion = Readonly<{
    question:string;
    header:string;
    multiSelect:boolean;
    options:ReadonlyArray<Readonly<{ label:string; description?:string }>>;
}>;

function extractQuestions(input:unknown):ExtractedQuestion[] {
    if (typeof input !== "object" || input === null) {
        return [];
    }
    const qs = (input as { [k:string]:unknown })["questions"];
    if (!Array.isArray(qs)) {
        return [];
    }
    const out:ExtractedQuestion[] = [];
    for (const raw of qs as RawQuestion[]) {
        if (typeof raw !== "object" || raw === null) {
            continue;
        }
        const question = typeof raw.question === "string" ? raw.question : "";
        const header = typeof raw.header === "string" ? raw.header : "";
        const multiSelect = raw.multiSelect === true;
        const options:Array<{ label:string; description?:string }> = [];
        if (Array.isArray(raw.options)) {
            for (const o of raw.options) {
                if (typeof o !== "object" || o === null) {
                    continue;
                }
                const label = typeof o.label === "string" ? o.label : "";
                if (!label) {
                    continue;
                }
                const opt:{ label:string; description?:string } = { label };
                if (typeof o.description === "string") {
                    opt.description = o.description;
                }
                options.push(opt);
            }
        }
        if (!question || options.length === 0) {
            continue;
        }
        out.push({ question, header, multiSelect, options });
    }
    return out;
}

function formatToolInput(input:Readonly<Record<string, unknown>>|undefined):string {
    if (!input || typeof input !== "object") {
        return "";
    }
    const i = input as Record<string, unknown>;
    if (typeof i["command"] === "string") {
        return i["command"];
    }
    if (typeof i["file_path"] === "string") {
        return i["file_path"];
    }
    if (typeof i["path"] === "string") {
        return i["path"];
    }
    if (typeof i["pattern"] === "string") {
        return typeof i["path"] === "string" ? `${i["pattern"]} in ${i["path"]}` : i["pattern"];
    }
    if (typeof i["url"] === "string") {
        return i["url"];
    }
    if (typeof i["query"] === "string") {
        return i["query"];
    }
    const json = JSON.stringify(input);
    if (json.length > TOOL_INPUT_INLINE_MAX) {
        return json.slice(0, TOOL_INPUT_INLINE_MAX - 3) + "...";
    }
    return json;
}

function renderToolResultContent(content:unknown):string {
    if (typeof content === "string") {
        return content;
    }
    if (Array.isArray(content)) {
        let out = "";
        for (const block of content) {
            if (block && typeof block === "object") {
                const b = block as { type?:string; text?:string };
                if (b.type === "text" && typeof b.text === "string") {
                    out += b.text;
                }
            }
        }
        return out;
    }
    return "";
}

function formatToolResultLines(text:string, isError:boolean):string {
    const lines = text.replace(/\s+$/, "").split("\n");
    const prefix = isError ? "  ⎿ [error] " : "  ⎿ ";
    if (lines.length === 0 || (lines.length === 1 && lines[0] === "")) {
        return `${prefix}(empty)\n`;
    }
    const visible = lines.slice(0, TOOL_RESULT_MAX_LINES);
    let out = "";
    for (let i = 0; i < visible.length; i++) {
        out += (i === 0 ? prefix : "    ") + visible[i] + "\n";
    }
    if (lines.length > TOOL_RESULT_MAX_LINES) {
        out += `    … +${lines.length - TOOL_RESULT_MAX_LINES} more lines\n`;
    }
    return out;
}
