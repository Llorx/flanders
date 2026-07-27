import * as path from "path";

import type { OutputContext, ScriptContext, TimeContext } from "../contexts";
import { ScriptRunner } from "./ScriptRunner";

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

export type PreflightChanges = {
    unstagedOutsideSpec:number;
    uncommittedSpecPaths:string[];
};

const SPEC_FOLDER_NAME = ".spec";
const RENAMED = "R";
const COPIED = "C";

function _isSpecPath(entryPath:string):boolean {
    // Porcelain paths are always slash-separated, on every platform.
    const enclosingDirectories = entryPath.split("/").slice(0, -1);
    return enclosingDirectories.includes(SPEC_FOLDER_NAME);
}

function _carriesOriginRecord(indexStatus:string, worktreeStatus:string):boolean {
    return [indexStatus, worktreeStatus].some(status => status === RENAMED || status === COPIED);
}

export function inspectPreflightChanges(script:ScriptContext, _time:TimeContext, cwd:string, excludePath:string):Promise<PreflightChanges> {
    return new Promise<PreflightChanges>((resolve, reject) => {
        // `-z` is what keeps every path verbatim: without it git C-quotes any path carrying
        // non-ASCII, a quote, a backslash, or a control character, and the quoted form matches
        // neither the `.spec` segment test nor the excluded plan path. It also drops the
        // " -> " rename spelling, emitting the destination and then the origin as two records.
        const proc = script.spawn("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], { stdio: "pipe", cwd });
        const stdoutChunks:string[] = [];
        const stderrChunks:string[] = [];
        proc.stdout?.on("data", chunk => { stdoutChunks.push(String(chunk)); });
        proc.stderr?.on("data", chunk => { stderrChunks.push(String(chunk)); });
        proc.on("error", e => reject(e instanceof Error ? e : new Error(String(e))));
        proc.on("exit", code => {
            if (code !== 0) {
                return reject(new Error(stderrChunks.join("")));
            }
            const records = stdoutChunks.join("").split("\0");
            const normalizedExclude = path.normalize(path.resolve(cwd, excludePath));
            const isExcluded = (entryPath:string) => path.normalize(path.resolve(cwd, entryPath)) === normalizedExclude;
            let unstagedOutsideSpec = 0;
            const uncommittedSpecPaths:string[] = [];
            for (let i = 0; i < records.length; i++) {
                const record = records[i]!;
                if (record.length === 0) continue;
                // Porcelain v1 status is the two-character field "XY": X is the index (staged)
                // column and Y is the working-tree (unstaged) column. Either column can carry a
                // rename or a copy, and both spell their origin path as the record that follows —
                // which must be consumed here or the next iteration reads it as a status record.
                const indexStatus = record[0]!;
                const worktreeStatus = record[1]!;
                const currentPath = record.slice(3);
                const originPath = _carriesOriginRecord(indexStatus, worktreeStatus) ? records[++i] ?? null : null;
                // A rename takes its origin path away, so that path is uncommitted state of its
                // own; a copy leaves its origin exactly as committed.
                const removedPath = indexStatus === RENAMED || worktreeStatus === RENAMED ? originPath : null;
                for (const entryPath of removedPath === null ? [currentPath] : [currentPath, removedPath]) {
                    if (_isSpecPath(entryPath) && !isExcluded(entryPath)) {
                        uncommittedSpecPaths.push(entryPath);
                    }
                }
                // Staged-only entries elsewhere ("M ", "A ", "D ", "R ", "C " — Y is a space) are
                // left in the index for the commit/check stage to fold into the first task's commit.
                if (worktreeStatus !== " " && !_isSpecPath(currentPath) && !isExcluded(currentPath)) {
                    unstagedOutsideSpec++;
                }
            }
            resolve({ unstagedOutsideSpec, uncommittedSpecPaths });
        });
    });
}

export async function readStagedDiff(script:ScriptContext, time:TimeContext, cwd:string):Promise<string> {
    const runner = new ScriptRunner({
        command: "git",
        args: ["diff", "--cached", "--binary", "--no-ext-diff", "--"],
        cwd
    }, script, time);
    try {
        const result = await runner.result();
        if (result.code !== 0) {
            throw new Error(result.stderr);
        }
        return result.stdout;
    } finally {
        await runner.dispose();
    }
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
