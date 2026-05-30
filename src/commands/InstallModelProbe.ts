import type { ScriptContext, SpawnedProcess } from "../contexts";

export function probeModelList(tool:"claude"|"codex", script:ScriptContext):Promise<readonly string[]|null> {
    if (tool === "claude") {
        return Promise.resolve(null);
    }
    return new Promise<readonly string[]|null>(resolve => {
        let proc:SpawnedProcess;
        try {
            proc = script.spawn("codex", ["models", "list", "--json"], { stdio: "pipe" });
        } catch {
            resolve(null);
            return;
        }
        const chunks:string[] = [];
        let settled = false;
        const settle = (result:readonly string[]|null) => {
            if (settled) return;
            settled = true;
            resolve(result);
        };
        if (proc.stdout) {
            proc.stdout.on("data", (chunk) => {
                chunks.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
            });
        }
        proc.on("error", () => {
            settle(null);
        });
        proc.on("exit", (code) => {
            if (code !== 0) {
                settle(null);
                return;
            }
            try {
                const parsed:unknown = JSON.parse(chunks.join(""));
                if (!Array.isArray(parsed) || parsed.length === 0) {
                    settle(null);
                    return;
                }
                const first:unknown = parsed[0];
                if (typeof first === "string") {
                    if (parsed.every((v:unknown) => typeof v === "string")) {
                        settle(parsed as string[]);
                        return;
                    }
                } else if (typeof first === "object" && first !== null) {
                    const ids:string[] = [];
                    for (const item of parsed as unknown[]) {
                        if (typeof item === "object" && item !== null && "id" in item && typeof (item as Record<string, unknown>).id === "string") {
                            ids.push((item as Record<string, unknown>).id as string);
                        } else {
                            settle(null);
                            return;
                        }
                    }
                    settle(ids);
                    return;
                }
                settle(null);
            } catch {
                settle(null);
            }
        });
    });
}
