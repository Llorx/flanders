import type { ScriptContext, SpawnedProcess } from "../contexts";

export type ToolAvailabilityEntry = Readonly<{
    tool:"claude"|"codex";
    available:boolean;
    reason:string|null;
}>;

export type ToolAvailabilityReport = readonly ToolAvailabilityEntry[];

function probeTool(tool:"claude"|"codex", script:ScriptContext):Promise<ToolAvailabilityEntry> {
    const binary = tool === "claude" ? "claude" : "codex";
    return new Promise<ToolAvailabilityEntry>(resolve => {
        let proc:SpawnedProcess;
        try {
            proc = script.spawn(binary, ["--version"], { stdio: "pipe" });
        } catch (e) {
            resolve({ tool, available: false, reason: `${binary}: spawn failed (${e instanceof Error ? e.message : String(e)})` });
            return;
        }
        let settled = false;
        const settle = (entry:ToolAvailabilityEntry) => {
            if (settled) return;
            settled = true;
            resolve(entry);
        };
        proc.on("error", e => {
            const msg = e instanceof Error ? e.message : String(e);
            settle({ tool, available: false, reason: `${binary}: spawn failed (${msg})` });
        });
        proc.on("exit", (code, signal) => {
            if (code === 0) {
                settle({ tool, available: true, reason: null });
            } else if (signal) {
                settle({ tool, available: false, reason: `${binary}: terminated by signal ${signal}` });
            } else {
                settle({ tool, available: false, reason: `${binary}: exited with code ${code}` });
            }
        });
    });
}

export async function verifyToolAvailability(tools:Set<"claude"|"codex">, script:ScriptContext):Promise<ToolAvailabilityReport> {
    const probes:Promise<ToolAvailabilityEntry>[] = [];
    for (const tool of tools) {
        probes.push(probeTool(tool, script));
    }
    return Promise.all(probes);
}
