import type { FsContext } from "../contexts";
import { joinPath } from "../system/fsUtils";
import { planSkillBody, specSkillBody, workSkillBody } from "../prompts/skills";

type SkillDef = Readonly<{
    name:string;
    body:string;
}>;

export const SKILLS:readonly SkillDef[] = [
    { name: "flanders-spec", body: specSkillBody },
    { name: "flanders-plan", body: planSkillBody },
    { name: "flanders-work", body: workSkillBody }
];

export function stripYamlFrontmatter(body:string):string {
    if (!body.startsWith("---\n") && !body.startsWith("---\r\n")) {
        return body;
    }
    const newlineAfterOpener = body.indexOf("\n") + 1;
    const closerIndex = body.indexOf("\n---\n", newlineAfterOpener);
    if (closerIndex === -1) {
        const closerCrlf = body.indexOf("\n---\r\n", newlineAfterOpener);
        if (closerCrlf === -1) {
            return body;
        }
        return body.slice(closerCrlf + "\n---\r\n".length);
    }
    return body.slice(closerIndex + "\n---\n".length);
}

// The outcome of emitting one tool's skill trio for a destination. On success the caller obtains every
// written path; on failure `diagnostic` carries the exact message to surface (or `null` when the run was
// disposed mid-write, which stops further writes without surfacing a diagnostic). The caller decides how
// to react — print the diagnostic, append the paths, and pick the exit code — so this shared emission
// path stays free of the output context and is reused verbatim by both `install` and `update`.
export type WriteSkillArtifactsResult =
    | Readonly<{ ok:true; writtenPaths:readonly string[] }>
    | Readonly<{ ok:false; diagnostic:string|null }>;

// Writes the given tool's full Flanders skill trio under `scopeRoot`, going through the injected
// `FsContext` only. For `claude` it writes `<scopeRoot>/.claude/skills/<name>/SKILL.md`, creating each
// per-skill folder; for `codex` it writes `<scopeRoot>/.codex/prompts/<name>.md` with the YAML
// frontmatter stripped. `isDisposed` is consulted before each artifact so a mid-write disposal stops
// further writes. The diagnostics are reproduced verbatim from `install`'s original inline blocks.
export async function writeSkillArtifacts(fs:FsContext, scopeRoot:string, tool:"claude"|"codex", isDisposed:() => boolean):Promise<WriteSkillArtifactsResult> {
    for (const skill of SKILLS) {
        /* coverage ignore next 3 */ // — Defensive: skill bodies are compile-time constants that are always non-empty.
        if (!skill.body) {
            return { ok: false, diagnostic: `Skill "${skill.name}" has no content.\n` };
        }
    }
    const writtenPaths:string[] = [];
    if (tool === "claude") {
        const claudeSkillsRoot = joinPath(scopeRoot, ".claude/skills");
        for (const skill of SKILLS) {
            if (isDisposed()) {
                return { ok: false, diagnostic: null };
            }
            const skillFolder = joinPath(claudeSkillsRoot, skill.name);
            try {
                await fs.mkdir(skillFolder, { recursive: true });
            } catch {
                return { ok: false, diagnostic: `Cannot create destination: ${skillFolder}\n` };
            }
            const filePath = joinPath(skillFolder, "SKILL.md");
            try {
                await fs.writeFile(filePath, skill.body);
                writtenPaths.push(filePath);
            } catch {
                return { ok: false, diagnostic: `Cannot write file: ${filePath}\n` };
            }
        }
        return { ok: true, writtenPaths };
    }
    const codexPromptsRoot = joinPath(scopeRoot, ".codex/prompts");
    try {
        await fs.mkdir(codexPromptsRoot, { recursive: true });
    } catch {
        return { ok: false, diagnostic: `Cannot create destination: ${codexPromptsRoot}\n` };
    }
    for (const skill of SKILLS) {
        if (isDisposed()) {
            return { ok: false, diagnostic: null };
        }
        const filePath = joinPath(codexPromptsRoot, `${skill.name}.md`);
        try {
            await fs.writeFile(filePath, stripYamlFrontmatter(skill.body));
            writtenPaths.push(filePath);
        } catch {
            return { ok: false, diagnostic: `Cannot write file: ${filePath}\n` };
        }
    }
    return { ok: true, writtenPaths };
}
