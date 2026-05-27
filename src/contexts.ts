import type { SpawnOptions } from "child_process";

export type SpawnedReadable = {
    on(event:"data", listener:(chunk:Buffer|string) => void):void;
};

export type SpawnedProcess = {
    on(event:"exit", listener:(code:number|null) => void):void;
    on(event:"error", listener:(e:unknown) => void):void;
    kill(signal:"SIGINT"|"SIGTERM"):void;
    stdout?:SpawnedReadable;
    stderr?:SpawnedReadable;
    stdin?:Readonly<{
        write(chunk:string):void;
        end():void;
    }>;
};

export interface ClaudeContext {
    spawn(
        command:string,
        args:readonly string[],
        options:SpawnOptions
    ):SpawnedProcess;
}

export interface ScriptContext {
    spawn(
        command:string,
        args:readonly string[],
        options:SpawnOptions
    ):SpawnedProcess;
}

export type FsDirEntry = Readonly<{
    name:string;
    isFile:boolean;
    isDirectory:boolean;
}>;

export interface FsContext {
    readFile(path:string):Promise<string>;
    writeFile(path:string, content:string):Promise<void>;
    rename(oldPath:string, newPath:string):Promise<void>;
    readdir(path:string):Promise<readonly FsDirEntry[]>;
    stat(path:string):Promise<Readonly<{ size:number; isFile:boolean; isDirectory:boolean }>>;
    exists(path:string):Promise<boolean>;
    mkdir(path:string, options?:Readonly<{ recursive?:boolean }>):Promise<void>;
    mkdtemp(prefix:string):Promise<string>;
    rm(path:string, options?:Readonly<{ recursive?:boolean; force?:boolean }>):Promise<void>;
}

export type TimeoutHandle = Readonly<{ cancel():void }>;

export interface TimeContext {
    now():number;
    setTimeout(handler:() => void, ms:number):TimeoutHandle;
}

export type ChoiceOption = Readonly<{
    label:string;
    description?:string;
}>;

export type AskChoiceOptions = Readonly<{
    header:string;
    question:string;
    options:readonly ChoiceOption[];
    multiSelect:boolean;
}>;

export type AskAnswer = Readonly<{
    picked:readonly ChoiceOption[];
    extra?:string;
}>;

export interface AskContext {
    askChoices(questions:readonly AskChoiceOptions[], output?:OutputContext):Promise<readonly AskAnswer[]>;
    askText(prompt:string):Promise<string>;
}

export interface OutputContext {
    write(text:string):void;
    writeError(text:string):void;
    columns():number;
    rows():number;
    onResize(listener:() => void):() => void;
}
