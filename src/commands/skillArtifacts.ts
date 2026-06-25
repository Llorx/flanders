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

// The per-tool subfolders, under a scope root, where each tool keeps its user-installed artifacts.
// `antigravity` keeps its directory-plus-`SKILL.md` skills in different subfolders depending on the
// scope — `.agents/skills` under the project root, `.gemini/antigravity-cli/skills` under the home
// directory — which cannot be told apart from the scope-root path alone, so the scope discriminator
// chooses between them.
const CLAUDE_SKILLS_SUBDIR = ".claude/skills";
const CODEX_PROMPTS_SUBDIR = ".codex/prompts";
const ANTIGRAVITY_PROJECT_SKILLS_SUBDIR = ".agents/skills";
const ANTIGRAVITY_GLOBAL_SKILLS_SUBDIR = ".gemini/antigravity-cli/skills";

// The single source of the skills-root subfolder for the directory-plus-`SKILL.md` tools (`claude`
// and `antigravity`). `antigravity`'s subfolder is selected by the scope, so both the path computation
// below and the writer derive the antigravity destination from this one function — the path a write
// targets and the path a caller derives for detection can never diverge.
function directorySkillsSubdir(scope:"project"|"global", tool:"claude"|"antigravity"):string {
    if (tool === "claude") {
        return CLAUDE_SKILLS_SUBDIR;
    }
    return scope === "project" ? ANTIGRAVITY_PROJECT_SKILLS_SUBDIR : ANTIGRAVITY_GLOBAL_SKILLS_SUBDIR;
}

// The single source of the artifact path scheme for one skill under a scope root: for `claude`,
// `<scopeRoot>/.claude/skills/<name>/SKILL.md`; for `antigravity`, `<scopeRoot>/<scope-dependent
// subfolder>/<name>/SKILL.md`; for `codex`, `<scopeRoot>/.codex/prompts/<name>.md`. The `scope`
// discriminator only changes the `antigravity` subfolder; `claude` and `codex` ignore it. Both the
// writer below and `update`'s installation detection derive their paths from here, so the detected and
// written locations never drift apart.
export function skillArtifactPath(scopeRoot:string, scope:"project"|"global", tool:"claude"|"codex"|"antigravity", skillName:string):string {
    if (tool === "codex") {
        return joinPath(scopeRoot, CODEX_PROMPTS_SUBDIR, `${skillName}.md`);
    }
    return joinPath(scopeRoot, directorySkillsSubdir(scope, tool), skillName, "SKILL.md");
}

// The full set of one tool's Flanders skill artifact paths under a scope root, in `SKILLS` order.
export function skillArtifactPaths(scopeRoot:string, scope:"project"|"global", tool:"claude"|"codex"|"antigravity"):readonly string[] {
    return SKILLS.map(skill => skillArtifactPath(scopeRoot, scope, tool, skill.name));
}

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

// Writes a directory-plus-`SKILL.md` trio (`claude` and `antigravity`): each skill is written as
// `<skillsRoot>/<name>/SKILL.md` holding the full skill body, with the per-skill folder created
// recursively immediately before its `SKILL.md`. `isDisposed` is consulted before each artifact so a
// mid-write disposal stops further writes. Shared by both directory-form tools so their identical
// emission logic has one definition; the only difference is the scope-selected skills root.
async function writeDirectorySkillTrio(fs:FsContext, scopeRoot:string, scope:"project"|"global", tool:"claude"|"antigravity", isDisposed:() => boolean):Promise<WriteSkillArtifactsResult> {
    const skillsRoot = joinPath(scopeRoot, directorySkillsSubdir(scope, tool));
    const writtenPaths:string[] = [];
    for (const skill of SKILLS) {
        if (isDisposed()) {
            return { ok: false, diagnostic: null };
        }
        const skillFolder = joinPath(skillsRoot, skill.name);
        try {
            await fs.mkdir(skillFolder, { recursive: true });
        } catch {
            return { ok: false, diagnostic: `Cannot create destination: ${skillFolder}\n` };
        }
        const filePath = skillArtifactPath(scopeRoot, scope, tool, skill.name);
        try {
            await fs.writeFile(filePath, skill.body);
            writtenPaths.push(filePath);
        } catch {
            return { ok: false, diagnostic: `Cannot write file: ${filePath}\n` };
        }
    }
    return { ok: true, writtenPaths };
}

// Writes the given tool's full Flanders skill trio under `scopeRoot`, going through the injected
// `FsContext` only. `claude` and `antigravity` write `<scopeRoot>/<skills-root>/<name>/SKILL.md` with
// the full body, creating each per-skill folder (the antigravity skills root depends on `scope`);
// `codex` writes `<scopeRoot>/.codex/prompts/<name>.md` with the YAML frontmatter stripped. `isDisposed`
// is consulted before each artifact so a mid-write disposal stops further writes. The diagnostics are
// reproduced verbatim from `install`'s original inline blocks.
export async function writeSkillArtifacts(fs:FsContext, scopeRoot:string, scope:"project"|"global", tool:"claude"|"codex"|"antigravity", isDisposed:() => boolean):Promise<WriteSkillArtifactsResult> {
    for (const skill of SKILLS) {
        /* coverage ignore next 3 */ // — Defensive: skill bodies are compile-time constants that are always non-empty.
        if (!skill.body) {
            return { ok: false, diagnostic: `Skill "${skill.name}" has no content.\n` };
        }
    }
    if (tool === "codex") {
        const codexPromptsRoot = joinPath(scopeRoot, CODEX_PROMPTS_SUBDIR);
        try {
            await fs.mkdir(codexPromptsRoot, { recursive: true });
        } catch {
            return { ok: false, diagnostic: `Cannot create destination: ${codexPromptsRoot}\n` };
        }
        const writtenPaths:string[] = [];
        for (const skill of SKILLS) {
            if (isDisposed()) {
                return { ok: false, diagnostic: null };
            }
            const filePath = skillArtifactPath(scopeRoot, scope, "codex", skill.name);
            try {
                await fs.writeFile(filePath, stripYamlFrontmatter(skill.body));
                writtenPaths.push(filePath);
            } catch {
                return { ok: false, diagnostic: `Cannot write file: ${filePath}\n` };
            }
        }
        return { ok: true, writtenPaths };
    }
    return writeDirectorySkillTrio(fs, scopeRoot, scope, tool, isDisposed);
}
