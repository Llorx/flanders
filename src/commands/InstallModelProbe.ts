import type { ScriptContext, SpawnedProcess } from "../contexts";

export function probeModelList(tool:"claude"|"codex", script:ScriptContext):Promise<readonly string[]|null> {
    if (tool === "claude") {
        return Promise.resolve(null);
    }
    return new Promise<readonly string[]|null>(resolve => {
        let proc:SpawnedProcess;
        try {
            proc = script.spawn("codex", ["debug", "models"], { stdio: "pipe" });
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
            let parsed:unknown;
            try {
                parsed = JSON.parse(chunks.join(""));
            } catch {
                settle(null);
                return;
            }
            if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
                settle(null);
                return;
            }
            const models = (parsed as Record<string, unknown>).models;
            if (!Array.isArray(models)) {
                settle(null);
                return;
            }
            const slugs:string[] = [];
            for (const entry of models) {
                if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
                    settle(null);
                    return;
                }
                const record = entry as Record<string, unknown>;
                if (typeof record.slug !== "string" || typeof record.visibility !== "string") {
                    settle(null);
                    return;
                }
                if (record.visibility === "list") {
                    slugs.push(record.slug);
                }
            }
            if (slugs.length === 0) {
                settle(null);
                return;
            }
            settle(slugs);
        });
    });
}
