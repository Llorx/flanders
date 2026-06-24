import type { OutputContext, TimeContext } from "../contexts";
import type { ToolAdapter, ToolAdapterUsageCallback, ToolTokenUsage, ToolEventOutput } from "./ToolAdapter";
import { run } from "./AiRunner";
import { colorize, CYAN, DIM, GREEN, MAGENTA, YELLOW } from "../ui/formatters";

const TOOL_RESULT_MAX_LINES = 5;

export type AiSessionResult = Readonly<{
    text:string;
    sessionId:string|null;
    inputTokens:number;
    outputTokens:number;
}>;

export type AiSessionOptions = Readonly<{
    adapter:ToolAdapter;
    prompt:string;
    model:string;
    effort:string;
    resumeSessionId?:string|null;
    priorSessionUsage?:ToolTokenUsage;
    onLongWaitStart?(kind:"rate-limit", endTimeMs:number):void;
    onLongWaitEnd?():void;
}>;

export type AiSessionContexts = Readonly<{
    time:TimeContext;
    output:OutputContext;
}>;

export class AiSession {
    private _disposed = false;
    private _abortController:AbortController|null = null;
    private _runPromise:Promise<AiSessionResult>|null = null;

    constructor(
        private _options:AiSessionOptions,
        private _contexts:AiSessionContexts
    ) {}

    async run():Promise<AiSessionResult> {
        if (this._disposed) {
            throw new Error("AiSession disposed");
        }

        const controller = new AbortController();
        this._abortController = controller;

        let inputTokens = 0;
        let outputTokens = 0;
        let capturedText = "";
        let textOpen = false;
        let inAssistantBlock = false;

        const onUsage:ToolAdapterUsageCallback = (usage) => {
            inputTokens += usage.inputTokens;
            outputTokens += usage.outputTokens;
        };

        const closeOpenTextLine = () => {
            if (textOpen) {
                this._contexts.output.write("\n");
                textOpen = false;
            }
        };

        const emitText = (text:string) => {
            this._contexts.output.write(text);
            textOpen = !text.endsWith("\n");
        };

        const onOutput = (event:ToolEventOutput) => {
            if (event.title === "Assistant") {
                if (!inAssistantBlock) {
                    this._contexts.output.write(colorize("Assistant", GREEN) + "\n");
                    inAssistantBlock = true;
                }
                emitText(event.details);
                capturedText += event.details;
                return;
            }

            inAssistantBlock = false;
            closeOpenTextLine();

            if (event.title === "Result") {
                const formatted = formatToolResultLines(event.details);
                this._contexts.output.write(formatted);
                return;
            }

            if (event.title === "stderr") {
                this._contexts.output.writeError(event.details);
                return;
            }

            if (event.title === "Thinking") {
                this._contexts.output.write(colorize("● Thinking(" + event.subtitle + ")", DIM) + "\n");
                return;
            }

            this._contexts.output.write("● " + colorize(event.title, CYAN) + "(" + colorize(event.subtitle, YELLOW) + ")\n");
        };

        const promise = (async () => {
            try {
                const result = await run({
                    adapter: this._options.adapter,
                    prompt: this._options.prompt,
                    model: this._options.model,
                    effort: this._options.effort,
                    ...(this._options.resumeSessionId != null ? { resumeSessionId: this._options.resumeSessionId } : null),
                    ...(this._options.priorSessionUsage != null ? { priorSessionUsage: this._options.priorSessionUsage } : null),
                    abortSignal: controller.signal,
                    callbacks: {
                        onOutput,
                        onSessionId: () => {},
                        onUsage,
                        onWaitStart: this._options.onLongWaitStart,
                        onWaitEnd: this._options.onLongWaitEnd
                    },
                    time: this._contexts.time
                });

                closeOpenTextLine();

                return {
                    text: capturedText,
                    sessionId: result.sessionId,
                    inputTokens,
                    outputTokens
                };
            } finally {
                if (this._abortController === controller) {
                    this._abortController = null;
                }
            }
        })();

        this._runPromise = promise;
        try {
            return await promise;
        } finally {
            if (this._runPromise === promise) {
                this._runPromise = null;
            }
        }
    }

    async dispose() {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        this._abortController?.abort();
        if (this._runPromise) {
            try {
                await this._runPromise;
            } catch {
                // Swallow errors from aborted runs during disposal.
            }
        }
    }
}

function formatToolResultLines(text:string):string {
    const prefix = colorize("  ⎿ ", MAGENTA);
    const trimmed = text.replace(/\s+$/, "");
    const lines = trimmed.split("\n");
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
