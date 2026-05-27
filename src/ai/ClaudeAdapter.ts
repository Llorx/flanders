import type { SpawnOptions } from "child_process";

import type { AskChoiceOptions, AskContext, AskAnswer, ChoiceOption, ClaudeContext, TimeContext, SpawnedProcess } from "../contexts";
import type { ToolAdapter, ToolAdapterInvokeArgs, ToolEvent } from "./ToolAdapter";

const TOOL_INPUT_INLINE_MAX = 120;

const GIT_READ_SUBCOMMANDS = new Set([
    "status", "diff", "log", "show", "blame", "shortlog", "describe",
    "ls-files", "ls-tree", "cat-file", "rev-parse", "rev-list",
    "name-rev", "merge-base", "for-each-ref", "version", "help"
]);

type ClaudeNativeContentBlock = Readonly<{
    type?:string;
    text?:string;
    thinking?:string;
    name?:string;
    id?:string;
    input?:Readonly<Record<string, unknown>>;
    tool_use_id?:string;
    content?:string|ReadonlyArray<Readonly<{ type?:string; text?:string }>>;
    is_error?:boolean;
}>;

type ClaudeControlRequestBody = Readonly<{
    subtype?:string;
    request_id?:string;
    tool_name?:string;
    input?:unknown;
    tool_input?:unknown;
}>;

type ClaudeNativeEvent = Readonly<{
    type?:string;
    subtype?:string;
    is_error?:boolean;
    api_error_status?:number|null;
    session_id?:string;
    request_id?:string;
    request?:ClaudeControlRequestBody;
    message?:Readonly<{
        role?:string;
        content?:ReadonlyArray<ClaudeNativeContentBlock>;
        usage?:Readonly<{
            input_tokens?:number;
            output_tokens?:number;
            cache_creation_input_tokens?:number;
            cache_read_input_tokens?:number;
        }>;
    }>;
    error?:Readonly<{
        message?:string;
    }>;
    result?:string;
    usage?:Readonly<{
        input_tokens?:number;
        output_tokens?:number;
        cache_creation_input_tokens?:number;
        cache_read_input_tokens?:number;
    }>;
    rate_limit_info?:Readonly<{
        status?:string;
        resetsAt?:number;
        rateLimitType?:string;
        isUsingOverage?:boolean;
        overageStatus?:string;
        overageResetsAt?:number;
        utilization?:number;
        surpassedThreshold?:number;
    }>;
}>;

type PermissionResponse =
    | Readonly<{ behavior:"allow"; updatedInput?:unknown; updated_permissions?:readonly unknown[] }>
    | Readonly<{ behavior:"deny"; message:string; interrupt?:boolean }>;

type RawQuestion = Readonly<{
    question?:string;
    header?:string;
    multiSelect?:boolean;
    options?:ReadonlyArray<Readonly<{ label?:string; description?:string }>>;
}>;

type ExtractedQuestion = Readonly<{
    question:string;
    header:string;
    multiSelect:boolean;
    options:ReadonlyArray<Readonly<{ label:string; description?:string }>>;
}>;

export type ClaudeAdapterContexts = Readonly<{
    claude:ClaudeContext;
    time:TimeContext;
    ask:AskContext;
}>;

export function formatToolInput(input:Readonly<Record<string, unknown>>|undefined):string {
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
        return i["pattern"];
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

function toolResultSummary(content:unknown):string {
    const text = renderToolResultContent(content);
    if (!text) {
        return "";
    }
    /* coverage ignore next */ // — split() on a non-empty string always yields ≥1 element; ?? is a defensive fallback.
    const firstLine = text.split("\n")[0] ?? "";
    return firstLine;
}

function isGitWriteCommand(command:string):boolean {
    const re = /\bgit\s+(?:(?:-[a-zA-Z]\s+\S+|--\S+)\s+)*(\w[\w-]*)/g;
    let m;
    while ((m = re.exec(command)) !== null) {
        if (!GIT_READ_SUBCOMMANDS.has(m[1]!)) {
            return true;
        }
    }
    return false;
}

export class ClaudeAdapter implements ToolAdapter {
    constructor(private _contexts:ClaudeAdapterContexts) {}

    invoke(args:ToolAdapterInvokeArgs):AsyncIterable<ToolEvent> {
        const iter = new ClaudeAdapterIterator(args, this._contexts);
        return {
            [Symbol.asyncIterator]() {
                return iter;
            }
        };
    }
}

class ClaudeAdapterIterator implements AsyncIterator<ToolEvent> {
    private _proc:SpawnedProcess|null = null;
    private _capturedSessionId:string|null = null;
    private _queue:ToolEvent[] = [];
    private _done = false;
    private _error:Error|null = null;
    private _waitResolve:(() => void)|null = null;
    private _abortListener:(() => void)|null = null;
    private _exitPromise:Promise<void>|null = null;

    constructor(
        private _args:ToolAdapterInvokeArgs,
        private _contexts:ClaudeAdapterContexts
    ) {
        this._start();
    }

    private _start():void {
        if (this._args.effort) {
            this._queue.push({
                type: "output",
                title: "Effort unsupported",
                subtitle: "",
                details: "Claude CLI does not currently expose a stable effort flag; the supplied effort is ignored."
            });
        }

        const argv = this._buildArgv();
        const spawnOptions:SpawnOptions = { stdio: "pipe" };
        const proc = this._contexts.claude.spawn("claude", argv, spawnOptions);
        this._proc = proc;

        const initialMessage = {
            type: "user",
            message: { role: "user", content: this._args.prompt }
        };
        proc.stdin?.write(JSON.stringify(initialMessage) + "\n");

        let exitResolve:(() => void)|null = null;
        this._exitPromise = new Promise<void>(resolve => { exitResolve = resolve; });

        let buffer = "";
        proc.stdout?.on("data", (chunk:Buffer|string) => {
            buffer += String(chunk);
            for (;;) {
                const nl = buffer.indexOf("\n");
                if (nl < 0) break;
                const line = buffer.slice(0, nl).replace(/\r$/, "");
                buffer = buffer.slice(nl + 1);
                if (line) {
                    this._handleLine(line);
                }
            }
        });

        let stderrBuf = "";
        proc.stderr?.on("data", (chunk:Buffer|string) => {
            stderrBuf += String(chunk);
        });

        proc.on("error", (e:unknown) => {
            if (!this._done) {
                this._done = true;
                this._error = e instanceof Error ? e : new Error(String(e));
                this._wake();
            }
            exitResolve?.();
        });

        proc.on("exit", () => {
            if (stderrBuf) {
                this._queue.push({
                    type: "output",
                    title: "stderr",
                    subtitle: "",
                    details: stderrBuf
                });
                stderrBuf = "";
            }
            if (!this._done) {
                this._done = true;
                this._wake();
            }
            exitResolve?.();
        });

        this._abortListener = () => {
            if (this._proc) {
                this._proc.kill("SIGINT");
            }
            this._done = true;
            this._wake();
        };
        if (this._args.abortSignal.aborted) {
            this._abortListener();
        } else {
            this._args.abortSignal.addEventListener("abort", this._abortListener, { once: true });
        }
    }

    private _buildArgv():string[] {
        const argv:string[] = [];

        if (this._args.resumeSessionId) {
            argv.push("--resume", this._args.resumeSessionId);
        } else if (this._args.forkParentSessionId) {
            argv.push("--resume", this._args.forkParentSessionId, "--fork-session");
        }

        if (this._args.model) {
            argv.push("--model", this._args.model);
        }

        argv.push(
            "--input-format", "stream-json",
            "--output-format", "stream-json",
            "--include-partial-messages",
            "--permission-prompt-tool=stdio",
            "--verbose",
            "--print"
        );

        return argv;
    }

    private _handleLine(line:string):void {
        let parsed:ClaudeNativeEvent|null = null;
        try {
            parsed = JSON.parse(line) as ClaudeNativeEvent;
        } catch {
            return;
        }
        if (!parsed) return;

        if (parsed.session_id) {
            if (this._capturedSessionId === null) {
                this._capturedSessionId = parsed.session_id;
                this._queue.push({ type: "session", id: parsed.session_id });
            } else if (this._capturedSessionId !== parsed.session_id) {
                this._capturedSessionId = parsed.session_id;
                this._queue.push({ type: "session", id: parsed.session_id });
            }
        }

        if (parsed.type === "control_request" || parsed.type === "sdk_control_request") {
            this._handleControlRequest(parsed);
            this._wake();
            return;
        }

        if (parsed.type === "assistant" && parsed.message?.content) {
            for (const block of parsed.message.content) {
                if (block.type === "tool_use" && typeof block.name === "string") {
                    this._queue.push({
                        type: "output",
                        title: block.name,
                        subtitle: formatToolInput(block.input),
                        details: ""
                    });
                } else if (block.type === "text" && typeof block.text === "string") {
                    this._queue.push({
                        type: "output",
                        title: "Assistant",
                        subtitle: "",
                        details: block.text
                    });
                } else if (block.type === "thinking" && typeof block.thinking === "string") {
                    this._queue.push({
                        type: "output",
                        title: "Thinking",
                        subtitle: "",
                        details: block.thinking
                    });
                }
            }
        }

        if (parsed.type === "user" && parsed.message?.content) {
            for (const block of parsed.message.content) {
                if (block.type === "tool_result") {
                    const text = renderToolResultContent(block.content);
                    this._queue.push({
                        type: "output",
                        title: "Result",
                        subtitle: toolResultSummary(block.content),
                        details: text
                    });
                }
            }
        }

        if (parsed.type === "result") {
            const u = parsed.usage;
            if (u && this._args.onUsage) {
                const inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
                const outputTokens = u.output_tokens ?? 0;
                this._args.onUsage({ inputTokens, outputTokens });
            }

            /* coverage ignore next 4 */ // — Unreachable: the general session_id check at the top of _handleLine always captures before the result handler runs.
            if (parsed.session_id && !this._capturedSessionId) {
                this._capturedSessionId = parsed.session_id;
                this._queue.push({ type: "session", id: parsed.session_id });
            }

            if (!parsed.is_error) {
                this._queue.push({ type: "done" });
                this._done = true;
            } else {
                this._queue.push(this._classifyError(parsed));
                this._done = true;
            }
        }

        this._wake();
    }

    private _classifyError(parsed:ClaudeNativeEvent):ToolEvent {
        const status = parsed.api_error_status;
        const subtype = parsed.subtype;
        const message = parsed.error?.message ?? "unknown error";

        if (status === 429) {
            const info = parsed.rate_limit_info;
            if (info) {
                const target = info.isUsingOverage && typeof info.overageResetsAt === "number"
                    ? info.overageResetsAt
                    : info.resetsAt;
                if (typeof target === "number") {
                    return { type: "rate_limit", waitUntilMs: target * 1000 };
                }
            }
            return { type: "error", retryable: true, message };
        }

        if (typeof status === "number" && status >= 500) {
            return { type: "error", retryable: true, message };
        }
        if (status === 408 || status === 425) {
            return { type: "error", retryable: true, message };
        }
        if (status === null) {
            return { type: "error", retryable: true, message };
        }

        if (subtype === "error_during_execution") {
            return { type: "error", retryable: true, message };
        }
        if (subtype === "error_max_turns" || subtype === "error_max_budget_usd" || subtype === "error_max_structured_output_retries") {
            return { type: "error", retryable: false, message };
        }

        return { type: "error", retryable: false, message };
    }

    private _handleControlRequest(parsed:ClaudeNativeEvent):void {
        const req = parsed.request;
        if (!req) return;
        if (req.subtype !== "can_use_tool" && req.subtype !== "permission") return;

        const requestId = parsed.request_id ?? req.request_id;
        if (typeof requestId !== "string" || requestId.length === 0) return;

        const toolName = req.tool_name;
        if (typeof toolName !== "string") return;

        const toolInput = req.input ?? req.tool_input;

        if (toolName === "AskUserQuestion") {
            this._handleAskUserQuestion(requestId, toolInput);
            return;
        }

        if (toolName === "Bash" || toolName === "PowerShell") {
            const command = typeof toolInput === "object" && toolInput !== null
                ? (toolInput as Record<string, unknown>)["command"]
                : undefined;
            if (typeof command === "string" && isGitWriteCommand(command)) {
                this._sendControlResponse(requestId, {
                    behavior: "deny",
                    message: "git-write operations are not permitted for subagents"
                });
                return;
            }
        }

        const response:PermissionResponse = {
            behavior: "allow",
            updatedInput: typeof toolInput === "object" && toolInput !== null ? toolInput : {}
        };
        this._sendControlResponse(requestId, response);
    }

    private _handleAskUserQuestion(requestId:string, toolInput:unknown):void {
        const questions = extractQuestions(toolInput);
        if (questions.length === 0) {
            const response:PermissionResponse = {
                behavior: "allow",
                updatedInput: typeof toolInput === "object" && toolInput !== null ? toolInput : {}
            };
            this._sendControlResponse(requestId, response);
            return;
        }

        const askOptions:AskChoiceOptions[] = questions.map(q => ({
            header: q.header,
            question: q.question,
            options: q.options.map(o => ({ label: o.label, description: o.description } as ChoiceOption)),
            multiSelect: q.multiSelect
        }));

        this._contexts.ask.askChoices(askOptions).then((allAnswers:readonly AskAnswer[]) => {
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
            this._sendControlResponse(requestId, {
                behavior: "allow",
                updatedInput: { questions, answers }
            });
        }, (err:unknown) => {
            this._sendControlResponse(requestId, {
                behavior: "deny",
                message: err instanceof Error ? err.message : String(err)
            });
        });
    }

    private _sendControlResponse(requestId:string, response:PermissionResponse):void {
        /* coverage ignore next */ // — Defensive: stdin is always available when stdio:"pipe".
        if (!this._proc?.stdin) return;
        this._proc.stdin.write(JSON.stringify({
            type: "control_response",
            response: {
                subtype: "success",
                request_id: requestId,
                response
            }
        }) + "\n");
    }

    private _wake():void {
        if (this._waitResolve) {
            const resolve = this._waitResolve;
            this._waitResolve = null;
            resolve();
        }
    }

    private _wait():Promise<void> {
        return new Promise<void>(resolve => {
            this._waitResolve = resolve;
        });
    }

    async next():Promise<IteratorResult<ToolEvent>> {
        for (;;) {
            if (this._queue.length > 0) {
                return { value: this._queue.shift()!, done: false };
            }
            if (this._error) {
                throw this._error;
            }
            if (this._done && this._queue.length === 0) {
                this._cleanup();
                if (this._exitPromise) {
                    await this._exitPromise;
                }
                return { value: undefined as unknown as ToolEvent, done: true };
            }
            await this._wait();
        }
    }

    async return():Promise<IteratorResult<ToolEvent>> {
        this._done = true;
        this._cleanup();
        if (this._proc) {
            this._proc.kill("SIGINT");
            if (this._exitPromise) {
                await this._exitPromise;
            }
        }
        return { value: undefined as unknown as ToolEvent, done: true };
    }

    private _cleanup():void {
        if (this._abortListener) {
            this._args.abortSignal.removeEventListener("abort", this._abortListener);
            this._abortListener = null;
        }
    }
}

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
