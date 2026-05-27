import type { SpawnOptions } from "child_process";

import type { AskChoiceOptions, AskContext, ChoiceOption, ClaudeContext, OutputContext, SpawnedProcess, TimeContext, TimeoutHandle } from "./contexts";
import { wait } from "./wait";

const RATE_LIMIT_CHUNK_MS = 60 * 60 * 1000;
const INITIAL_TRANSIENT_WAIT_MS = 1_000;
const TRANSIENT_WAIT_CAP_MS = 60_000;

const TOOL_RESULT_MAX_LINES = 5;
const TOOL_INPUT_INLINE_MAX = 120;

export type ClaudeResult = Readonly<{
    text:string;
    sessionId:string|null;
    inputTokens:number;
    outputTokens:number;
}>;

export type ClaudeContentBlock = Readonly<{
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

export type ClaudeDelta = Readonly<{
    type?:string;
    text?:string;
    partial_json?:string;
}>;

export type ClaudeControlRequestBody = Readonly<{
    subtype?:string;
    request_id?:string;
    tool_name?:string;
    input?:unknown;
    tool_input?:unknown;
}>;

export type ClaudeEvent = Readonly<{
    type?:string;
    subtype?:string;
    is_error?:boolean;
    api_error_status?:number|null;
    session_id?:string;
    index?:number;
    request_id?:string;
    request?:ClaudeControlRequestBody;
    message?:Readonly<{
        role?:string;
        content?:ReadonlyArray<ClaudeContentBlock>;
        usage?:Readonly<{
            input_tokens?:number;
            output_tokens?:number;
            cache_creation_input_tokens?:number;
            cache_read_input_tokens?:number;
        }>;
    }>;
    content_block?:ClaudeContentBlock;
    delta?:ClaudeDelta;
    event?:ClaudeEvent;
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

export type PermissionRequest = Readonly<{
    request_id:string;
    tool_name:string;
    tool_input:unknown;
}>;

export type PermissionResponse =
    | Readonly<{ behavior:"allow"; updatedInput?:unknown; updated_permissions?:readonly unknown[] }>
    | Readonly<{ behavior:"deny"; message:string; interrupt?:boolean }>;

export type ClaudeRunOptions = Readonly<{
    prompt:string;
    cwd?:string;
    initialSessionId?:string|null;
    forkFromSessionId?:string|null;
    onEvent?(event:ClaudeEvent):void;
    onStderr?(chunk:string):void;
    onPermissionRequest?(req:PermissionRequest):Promise<PermissionResponse>;
    onLongWaitStart?(kind:"rate-limit", endTimeMs:number):void;
    onLongWaitEnd?():void;
}>;

class RateLimitError extends Error {
    constructor(
        readonly retryAfterMs:number,
        readonly inputTokens:number = 0,
        readonly outputTokens:number = 0
    ) {
        super(`rate_limit: retry after ${retryAfterMs}ms`);
    }
}

class RetryableTransientError extends Error {
    constructor(
        readonly inputTokens:number = 0,
        readonly outputTokens:number = 0
    ) {
        super("retryable transient error");
    }
}

export class NonRetryableError extends Error {
    constructor(message:string) {
        super(message);
    }
}

export class Claude {
    private _disposed = false;
    private _process:SpawnedProcess|null = null;
    private _waitAbort:AbortController|null = null;
    private _runPromise:Promise<ClaudeResult>;
    private _sessionId:string|null;
    private _forkFromSessionId:string|null;
    private _killTimer:TimeoutHandle|null = null;
    private _transientAttempt:number = 0;
    constructor(
        readonly options:ClaudeRunOptions,
        private _context:ClaudeContext,
        private _time:TimeContext
    ) {
        this._sessionId = options.initialSessionId ?? null;
        this._forkFromSessionId = options.forkFromSessionId ?? null;
        this._runPromise = this._run();
        this._runPromise.catch(() => {});
    }
    result():Promise<ClaudeResult> {
        return this._runPromise;
    }
    sendUserMessage(content:string):void {
        this._writeStdin({ type: "user", message: { role: "user", content } });
    }
    sendControlResponse(requestId:string, response:PermissionResponse):void {
        this._writeStdin({
            type: "control_response",
            response: {
                subtype: "success",
                request_id: requestId,
                response
            }
        });
    }
    endSession():void {
        if (this._disposed) {
            return;
        }
        this._process?.stdin?.end();
    }
    private _writeStdin(payload:unknown):void {
        if (this._disposed) {
            return;
        }
        const stdin = this._process?.stdin;
        /* coverage ignore next 3 */ // — Defensive: spawn uses stdio:"pipe" so stdin is always present.
        if (!stdin) {
            return;
        }
        stdin.write(JSON.stringify(payload) + "\n");
    }
    private async _run():Promise<ClaudeResult> {
        if (this._sessionId != null && this._forkFromSessionId != null) {
            throw new Error("Cannot specify both forkFromSessionId and initialSessionId");
        }
        let totalInputTokens = 0;
        let totalOutputTokens = 0;
        for (;;) {
            /* coverage ignore next 3 */ // — Defensive: every retry path checks _disposed before continuing; this top-of-loop guard is unreachable.
            if (this._disposed) {
                throw new Error("Claude disposed");
            }
            try {
                const result = await this._runOnce();
                totalInputTokens += result.inputTokens;
                totalOutputTokens += result.outputTokens;
                this._transientAttempt = 0;
                return { ...result, inputTokens: totalInputTokens, outputTokens: totalOutputTokens };
            } catch (e) {
                if (e instanceof RateLimitError) {
                    totalInputTokens += e.inputTokens;
                    totalOutputTokens += e.outputTokens;
                    /* coverage ignore next 3 */ // — Defensive: dispose during _runOnce exits via process-exit path before reaching here.
                    if (this._disposed) {
                        throw new Error("Claude disposed");
                    }
                    this.options.onLongWaitStart?.("rate-limit", this._time.now() + e.retryAfterMs);
                    try {
                        await this._scheduleWait(e.retryAfterMs, RATE_LIMIT_CHUNK_MS);
                    } finally {
                        this.options.onLongWaitEnd?.();
                    }
                    if (this._disposed) {
                        throw new Error("Claude disposed");
                    }
                    continue;
                }
                if (e instanceof RetryableTransientError) {
                    totalInputTokens += e.inputTokens;
                    totalOutputTokens += e.outputTokens;
                    this._transientAttempt++;
                    const waitMs = Math.min(TRANSIENT_WAIT_CAP_MS, INITIAL_TRANSIENT_WAIT_MS * 2 ** (this._transientAttempt - 1));
                    await this._scheduleWait(waitMs, waitMs);
                    if (this._disposed) {
                        throw new Error("Claude disposed");
                    }
                    continue;
                }
                throw e;
            }
        }
    }
    private _runOnce():Promise<ClaudeResult> {
        return new Promise<ClaudeResult>((resolve, reject) => {
            /* coverage ignore next 3 */ // — Defensive: _runOnce is called from the constructor-started loop where _disposed is always false.
            if (this._disposed) {
                return reject(new Error("Claude disposed"));
            }
            const args:string[] = [];
            if (this._sessionId) {
                args.push("--resume", this._sessionId);
            } else if (this._forkFromSessionId) {
                args.push("--resume", this._forkFromSessionId, "--fork-session");
                this._forkFromSessionId = null;
            }
            args.push("--model=claude-opus-4-6", "--effort=xhigh", "--input-format=stream-json", "--output-format=stream-json", "--include-partial-messages", "--permission-prompt-tool=stdio", "--verbose", "-p");
            const spawnOptions:SpawnOptions = {
                stdio: "pipe",
                ...(this.options.cwd ? { cwd: this.options.cwd } : null)
            };
            const proc = this._context.spawn("claude", args, spawnOptions);
            this._process = proc;
            const initialMessage = {
                type: "user",
                message: { role: "user", content: this.options.prompt }
            };
            proc.stdin?.write(JSON.stringify(initialMessage) + "\n");
            const collected:{ text:string; session:string|null; rateLimit:RateLimitError|null; isRetryableError:boolean; nonRetryableReason:string|null; inputTokens:number; outputTokens:number } = {
                text: "",
                session: null,
                rateLimit: null,
                isRetryableError: false,
                nonRetryableReason: null,
                inputTokens: 0,
                outputTokens: 0
            };
            this._attachStreamParser(proc, collected);
            let settled = false;
            const settle = (outcome:{ ok:true; value:ClaudeResult }|{ ok:false; error:Error }) => {
                if (settled) {
                    return;
                }
                settled = true;
                this._process = null;
                if (outcome.ok) {
                    resolve(outcome.value);
                } else {
                    reject(outcome.error);
                }
            };
            proc.on("error", e => {
                settle({ ok: false, error: e instanceof Error ? e : new Error(String(e)) });
            });
            proc.on("exit", code => {
                if (collected.session) {
                    this._sessionId = collected.session;
                }
                if (this._disposed) {
                    settle({ ok: false, error: new Error("Claude disposed") });
                    return;
                }
                if (collected.rateLimit) {
                    settle({ ok: false, error: new RateLimitError(collected.rateLimit.retryAfterMs, collected.inputTokens, collected.outputTokens) });
                    return;
                }
                if (collected.isRetryableError) {
                    settle({ ok: false, error: new RetryableTransientError(collected.inputTokens, collected.outputTokens) });
                    return;
                }
                if (collected.nonRetryableReason) {
                    settle({ ok: false, error: new NonRetryableError(collected.nonRetryableReason) });
                    return;
                }
                if (code === 0 || code === null) {
                    settle({ ok: true, value: { text: collected.text, sessionId: collected.session, inputTokens: collected.inputTokens, outputTokens: collected.outputTokens } });
                } else {
                    settle({ ok: false, error: new NonRetryableError(`Claude process exited with code ${code}`) });
                }
            });
        });
    }
    private _attachStreamParser(proc:SpawnedProcess, collected:{ text:string; session:string|null; rateLimit:RateLimitError|null; isRetryableError:boolean; nonRetryableReason:string|null; inputTokens:number; outputTokens:number }) {
        let buffer = "";
        const handleLine = (line:string) => {
            if (!line) {
                return;
            }
            let parsed:ClaudeEvent|null = null;
            try {
                parsed = JSON.parse(line) as ClaudeEvent;
            } catch {
                return;
            }
            if (!parsed) {
                return;
            }
            if (parsed.session_id && !collected.session) {
                collected.session = parsed.session_id;
            }
            if (parsed.type === "rate_limit_event" && parsed.rate_limit_info?.status === "rejected") {
                const info = parsed.rate_limit_info;
                const target = info.isUsingOverage && typeof info.overageResetsAt === "number"
                    ? info.overageResetsAt
                    : info.resetsAt;
                if (typeof target === "number") {
                    const retryAfterMs = Math.max(0, target * 1000 - this._time.now());
                    collected.rateLimit = new RateLimitError(retryAfterMs);
                }
            } else if (parsed.type === "result") {
                if (typeof parsed.result === "string") {
                    collected.text = parsed.result;
                }
                const u = parsed.usage;
                if (u) {
                    collected.inputTokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
                    collected.outputTokens = u.output_tokens ?? 0;
                }
                if (parsed.is_error) {
                    const subtype = parsed.subtype;
                    const status = parsed.api_error_status;
                    if (subtype === "error_max_turns" || subtype === "error_max_budget_usd" || subtype === "error_max_structured_output_retries") {
                        collected.nonRetryableReason = subtype;
                    } else if (
                        (typeof status === "number" && (status >= 500 || status === 408 || status === 425)) ||
                        status === null ||
                        subtype === "error_during_execution"
                    ) {
                        collected.isRetryableError = true;
                    } else {
                        collected.nonRetryableReason = typeof status === "number" ? `HTTP ${status}` : "unknown error";
                    }
                }
            } else if (parsed.type === "assistant" && parsed.message?.content) {
                let text = "";
                for (const block of parsed.message.content) {
                    if (block.type === "text" && typeof block.text === "string") {
                        text += block.text;
                    }
                }
                if (text) {
                    collected.text = text;
                }
            } else if (parsed.type === "control_request" || parsed.type === "sdk_control_request") {
                this._handleControlRequest(parsed);
            }
            try {
                this.options.onEvent?.(parsed);
            } catch (e) {
                if (this.options.onStderr) {
                    this.options.onStderr(`onEvent handler threw: ${String(e)}\n`);
                }
            }
        };
        proc.stdout?.on("data", chunk => {
            buffer += String(chunk);
            for (;;) {
                const nl = buffer.indexOf("\n");
                if (nl < 0) {
                    break;
                }
                const line = buffer.slice(0, nl).replace(/\r$/, "");
                buffer = buffer.slice(nl + 1);
                handleLine(line);
            }
        });
        proc.stderr?.on("data", chunk => {
            if (this.options.onStderr) {
                this.options.onStderr(String(chunk));
            }
        });
    }
    private _scheduleWait(totalMs:number, chunkMs:number):Promise<void> {
        const abort = new AbortController();
        this._waitAbort = abort;
        return wait(totalMs, chunkMs, this._time, abort.signal).then(() => {
            if (this._waitAbort === abort) {
                this._waitAbort = null;
            }
        });
    }
    private _handleControlRequest(parsed:ClaudeEvent):void {
        const req = parsed.request;
        if (!req) {
            return;
        }
        if (req.subtype !== "can_use_tool" && req.subtype !== "permission") {
            return;
        }
        const requestId = parsed.request_id ?? req.request_id;
        if (typeof requestId !== "string" || requestId.length === 0) {
            return;
        }
        const toolName = req.tool_name;
        if (typeof toolName !== "string") {
            return;
        }
        const toolInput = req.input ?? req.tool_input;
        const handler = this.options.onPermissionRequest;
        const responsePromise = handler
            ? handler({ request_id: requestId, tool_name: toolName, tool_input: toolInput })
            : Promise.resolve<PermissionResponse>({
                behavior: "allow",
                updatedInput: typeof toolInput === "object" && toolInput !== null ? toolInput : {}
            });
        responsePromise.then(response => {
            this.sendControlResponse(requestId, response);
        }, err => {
            this.sendControlResponse(requestId, {
                behavior: "deny",
                message: err instanceof Error ? err.message : String(err)
            });
        });
    }
    async dispose() {
        if (this._disposed) {
            try {
                await this._runPromise;
            } catch {

            }
            return;
        }
        this._disposed = true;
        this._waitAbort?.abort();
        const proc = this._process;
        if (proc) {
            const exitWaiter = new Promise<void>(resolve => {
                proc.on("exit", () => resolve());
            });
            proc.stdin?.end();
            proc.kill("SIGINT");
            this._killTimer = this._time.setTimeout(() => {
                this._killTimer = null;
                proc.kill("SIGTERM");
            }, 5000);
            await exitWaiter;
            this._killTimer?.cancel();
            this._killTimer = null;
        }
        try {
            await this._runPromise;
        } catch {

        }
    }
}

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
