import * as path from "path";

import type { OutputContext, ScriptContext, TimeContext } from "../contexts";

type GitResult = { code:number; stdout:string; stderr:string };

export function isGitAvailable(script:ScriptContext, _time:TimeContext):Promise<boolean> {
    return new Promise<boolean>(resolve => {
        const proc = script.spawn("git", ["--version"], { stdio: "pipe" });
        proc.on("error", () => resolve(false));
        proc.on("exit", code => resolve(code === 0));
    });
}

export function isInsideWorkTree(script:ScriptContext, _time:TimeContext, cwd:string):Promise<boolean> {
    return new Promise<boolean>(resolve => {
        const proc = script.spawn("git", ["rev-parse", "--is-inside-work-tree"], { stdio: "pipe", cwd });
        const stdoutChunks:string[] = [];
        proc.stdout?.on("data", chunk => { stdoutChunks.push(String(chunk)); });
        proc.on("error", () => resolve(false));
        proc.on("exit", code => {
            if (code !== 0) return resolve(false);
            resolve(stdoutChunks.join("").trim() === "true");
        });
    });
}

export function addAll(script:ScriptContext, _time:TimeContext, output:OutputContext, cwd:string):Promise<GitResult> {
    return _streamingGit(script, output, ["add", "-A"], cwd);
}

export function commit(script:ScriptContext, _time:TimeContext, output:OutputContext, cwd:string, message:string):Promise<GitResult> {
    return _streamingGit(script, output, ["commit", "--allow-empty", "-m", message], cwd);
}

function _streamingGit(script:ScriptContext, output:OutputContext, args:string[], cwd:string):Promise<GitResult> {
    return new Promise<GitResult>(resolve => {
        const proc = script.spawn("git", args, { stdio: "pipe", cwd });
        const stdoutChunks:string[] = [];
        const stderrChunks:string[] = [];
        proc.stdout?.on("data", chunk => {
            const text = String(chunk);
            stdoutChunks.push(text);
            output.write(text);
        });
        proc.stderr?.on("data", chunk => {
            const text = String(chunk);
            stderrChunks.push(text);
            output.writeError(text);
        });
        proc.on("error", e => {
            const msg = e instanceof Error ? e.message : String(e);
            resolve({ code: -1, stdout: "", stderr: msg });
        });
        proc.on("exit", code => {
            resolve({ code: code ?? -1, stdout: stdoutChunks.join(""), stderr: stderrChunks.join("") });
        });
    });
}

export function countPendingChangesExcept(script:ScriptContext, _time:TimeContext, cwd:string, excludePath:string):Promise<number> {
    return new Promise<number>((resolve, reject) => {
        const proc = script.spawn("git", ["status", "--porcelain=v1", "--untracked-files=all"], { stdio: "pipe", cwd });
        const stdoutChunks:string[] = [];
        const stderrChunks:string[] = [];
        proc.stdout?.on("data", chunk => { stdoutChunks.push(String(chunk)); });
        proc.stderr?.on("data", chunk => { stderrChunks.push(String(chunk)); });
        proc.on("error", e => reject(e instanceof Error ? e : new Error(String(e))));
        proc.on("exit", code => {
            if (code !== 0) {
                return reject(new Error(stderrChunks.join("")));
            }
            const stdout = stdoutChunks.join("");
            const normalizedExclude = path.normalize(path.resolve(cwd, excludePath));
            let count = 0;
            for (const line of stdout.split("\n")) {
                if (line.length === 0) continue;
                const rawPath = line.slice(3);
                let entryPath:string;
                if (line[0] === "R") {
                    const arrowIdx = rawPath.indexOf(" -> ");
                    entryPath = arrowIdx !== -1 ? rawPath.slice(arrowIdx + 4) : rawPath;
                } else {
                    entryPath = rawPath;
                }
                const normalizedEntry = path.normalize(path.resolve(cwd, entryPath));
                if (normalizedEntry !== normalizedExclude) {
                    count++;
                }
            }
            resolve(count);
        });
    });
}

export function listNonIgnoredFiles(script:ScriptContext, _time:TimeContext, cwd:string):Promise<string[]> {
    return new Promise<string[]>((resolve, reject) => {
        const proc = script.spawn("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { stdio: "pipe", cwd });
        const stdoutChunks:string[] = [];
        const stderrChunks:string[] = [];
        proc.stdout?.on("data", chunk => { stdoutChunks.push(String(chunk)); });
        proc.stderr?.on("data", chunk => { stderrChunks.push(String(chunk)); });
        proc.on("error", e => reject(e instanceof Error ? e : new Error(String(e))));
        proc.on("exit", code => {
            if (code !== 0) {
                return reject(new Error(stderrChunks.join("")));
            }
            const seen = new Set<string>();
            const result:string[] = [];
            for (const entry of stdoutChunks.join("").split("\0")) {
                if (entry.length === 0) continue;
                if (seen.has(entry)) continue;
                seen.add(entry);
                result.push(entry);
            }
            resolve(result);
        });
    });
}

export function listIgnoredPaths(script:ScriptContext, _time:TimeContext, cwd:string, paths:readonly string[]):Promise<Set<string>> {
    if (paths.length === 0) {
        return Promise.resolve(new Set<string>());
    }
    return new Promise<Set<string>>((resolve, reject) => {
        const proc = script.spawn("git", ["check-ignore", "-z", "--stdin"], { stdio: "pipe", cwd });
        const stdoutChunks:string[] = [];
        const stderrChunks:string[] = [];
        proc.stdout?.on("data", chunk => { stdoutChunks.push(String(chunk)); });
        proc.stderr?.on("data", chunk => { stderrChunks.push(String(chunk)); });
        proc.on("error", e => reject(e instanceof Error ? e : new Error(String(e))));
        proc.on("exit", code => {
            if (code === 1) {
                return resolve(new Set<string>());
            }
            if (code !== 0) {
                return reject(new Error(stderrChunks.join("")));
            }
            const ignored = new Set<string>();
            for (const entry of stdoutChunks.join("").split("\0")) {
                if (entry.length === 0) continue;
                ignored.add(entry);
            }
            resolve(ignored);
        });
        proc.stdin?.write(paths.join("\0") + "\0");
        proc.stdin?.end();
    });
}
