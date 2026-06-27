import type { TOOL_NAMES } from "../toolNames";

export type ToolEventOutput = Readonly<{
    type:"output";
    title:string;
    subtitle:string;
    details:string;
}>;

export type ToolEventSession = Readonly<{
    type:"session";
    id:string;
}>;

export type ToolEventError = Readonly<{
    type:"error";
    retryable:boolean;
    message:string;
}>;

export type ToolEventRateLimit = Readonly<{
    type:"rate_limit";
    waitUntilMs:number;
}>;

export type ToolEventDone = Readonly<{
    type:"done";
}>;

export type ToolEvent =
    | ToolEventOutput
    | ToolEventSession
    | ToolEventError
    | ToolEventRateLimit
    | ToolEventDone;

export type ToolTokenUsage = Readonly<{ inputTokens:number; outputTokens:number }>;

export type ToolAdapterUsageCallback = (usage:ToolTokenUsage) => void;

type ToolAdapterInvokeArgsBase = Readonly<{
    prompt:string;
    model:string;
    effort:string;
    fast:boolean;
    abortSignal:AbortSignal;
    onUsage?:ToolAdapterUsageCallback;
    priorSessionUsage?:ToolTokenUsage;
}>;

export type ToolAdapterInvokeArgsFresh = ToolAdapterInvokeArgsBase & Readonly<{
    resumeSessionId?:undefined;
}>;

export type ToolAdapterInvokeArgsResume = ToolAdapterInvokeArgsBase & Readonly<{
    resumeSessionId:string;
}>;

export type ToolAdapterInvokeArgs =
    | ToolAdapterInvokeArgsFresh
    | ToolAdapterInvokeArgsResume;

export interface ToolAdapter {
    invoke(args:ToolAdapterInvokeArgs):AsyncIterable<ToolEvent>;
}

export type ToolName = (typeof TOOL_NAMES)[number];
