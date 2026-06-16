import type { ScriptContext, SpawnedProcess } from "../contexts";

export type ModelProbeResult =
    | Readonly<{ kind:"list"; models:readonly string[] }>
    | Readonly<{ kind:"no-list" }>
    | Readonly<{ kind:"not-started"; reason:string }>;

// Markers a host shell emits when it cannot resolve the launched command. The spawn context launches
// every command through a platform shell (`src/system/.spec/rules/spawn/shell-launch-with-faithful-arguments.md`),
// so an absent `codex` surfaces as the shell's own not-found diagnostic (or exit status 127 on POSIX)
// rather than a spawn-primitive error. Pinned by `src/commands/.spec/rules/install/model-list-discovery.md`.
const COMMAND_NOT_FOUND_MARKERS:readonly string[] = ["not found", "not recognized", "no such file"];

function errorMessage(e:unknown):string {
    return e instanceof Error ? e.message : String(e);
}

function isCommandNotFound(combinedOutput:string):boolean {
    const lower = combinedOutput.toLowerCase();
    return COMMAND_NOT_FOUND_MARKERS.some(marker => lower.includes(marker));
}

export function probeModelList(script:ScriptContext):Promise<ModelProbeResult> {
    return new Promise<ModelProbeResult>(resolve => {
        const stdoutChunks:string[] = [];
        const stderrChunks:string[] = [];
        let settled = false;
        const settle = (result:ModelProbeResult) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        // `codex` could not be launched: surface why — stderr, then stdout, then the spawn primitive's
        // error message — never the bare exit code or signal on its own.
        const notStarted = (spawnMessage:string|null) => {
            const stderr = stderrChunks.join("");
            const stdout = stdoutChunks.join("");
            const reason = stderr !== "" ? stderr : stdout !== "" ? stdout : (spawnMessage ?? "");
            settle({ kind: "not-started", reason });
        };
        let proc:SpawnedProcess;
        try {
            proc = script.spawn("codex", ["debug", "models"], { stdio: "pipe" });
        } catch (e) {
            notStarted(errorMessage(e));
            return;
        }
        const capture = (chunks:string[]) => (chunk:Buffer|string) => {
            chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
        };
        if (proc.stdout) {
            proc.stdout.on("data", capture(stdoutChunks));
        }
        if (proc.stderr) {
            proc.stderr.on("data", capture(stderrChunks));
        }
        proc.on("error", (e) => {
            notStarted(errorMessage(e));
        });
        proc.on("exit", (code) => {
            const stdout = stdoutChunks.join("");
            const stderr = stderrChunks.join("");
            if (code === 127 || isCommandNotFound(stderr + stdout)) {
                notStarted(null);
                return;
            }
            if (code !== 0) {
                settle({ kind: "no-list" });
                return;
            }
            let parsed:unknown;
            try {
                parsed = JSON.parse(stdout);
            } catch {
                settle({ kind: "no-list" });
                return;
            }
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                settle({ kind: "no-list" });
                return;
            }
            const models = (parsed as Record<string, unknown>).models;
            if (!Array.isArray(models)) {
                settle({ kind: "no-list" });
                return;
            }
            const slugs:string[] = [];
            for (const entry of models) {
                if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
                    settle({ kind: "no-list" });
                    return;
                }
                const record = entry as Record<string, unknown>;
                if (typeof record.slug !== "string" || typeof record.visibility !== "string") {
                    settle({ kind: "no-list" });
                    return;
                }
                if (record.visibility === "list") {
                    slugs.push(record.slug);
                }
            }
            if (slugs.length === 0) {
                settle({ kind: "no-list" });
                return;
            }
            settle({ kind: "list", models: slugs });
        });
    });
}
