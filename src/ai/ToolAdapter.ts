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

export type ToolAdapterUsageCallback = (usage:Readonly<{ inputTokens:number; outputTokens:number }>) => void;

type ToolAdapterInvokeArgsBase = Readonly<{
    prompt:string;
    model:string;
    effort:string;
    abortSignal:AbortSignal;
    onUsage?:ToolAdapterUsageCallback;
}>;

export type ToolAdapterInvokeArgsFresh = ToolAdapterInvokeArgsBase & Readonly<{
    resumeSessionId?:undefined;
    forkParentSessionId?:undefined;
}>;

export type ToolAdapterInvokeArgsResume = ToolAdapterInvokeArgsBase & Readonly<{
    resumeSessionId:string;
    forkParentSessionId?:undefined;
}>;

export type ToolAdapterInvokeArgsFork = ToolAdapterInvokeArgsBase & Readonly<{
    resumeSessionId?:undefined;
    forkParentSessionId:string;
}>;

export type ToolAdapterInvokeArgs =
    | ToolAdapterInvokeArgsFresh
    | ToolAdapterInvokeArgsResume
    | ToolAdapterInvokeArgsFork;

export interface ToolAdapter {
    invoke(args:ToolAdapterInvokeArgs):AsyncIterable<ToolEvent>;
}

export type ToolName = "claude" | "codex";
