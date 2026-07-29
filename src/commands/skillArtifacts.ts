import type { FsContext } from "../contexts";
import type { ToolName } from "../ai/ToolAdapter";
import { abortError } from "../abortError";
import { joinPath } from "../system/fsUtils";
import { planSkillBody, specSkillBody, workSkillBody, hardStopReviewSkillBody } from "../prompts/skills";

type SkillDef = Readonly<{
    name:string;
    body:string;
}>;

export const SKILLS:readonly SkillDef[] = [
    { name: "flanders-spec", body: specSkillBody },
    { name: "flanders-plan", body: planSkillBody },
    { name: "flanders-work", body: workSkillBody },
    { name: "flanders-hard-stop-review", body: hardStopReviewSkillBody }
];

const TOOL_SUBDIRS:Readonly<Record<ToolName, string>> = {
    claude: ".claude",
    codex: ".agents"
};
const SKILLS_SUBDIR = "skills";

export function skillArtifactPath(scopeRoot:string, tool:ToolName, skillName:string):string {
    return joinPath(scopeRoot, TOOL_SUBDIRS[tool], SKILLS_SUBDIR, skillName, "SKILL.md");
}

export function skillArtifactPaths(scopeRoot:string, tool:ToolName):readonly string[] {
    return SKILLS.map(skill => skillArtifactPath(scopeRoot, tool, skill.name));
}

export type WriteSkillArtifactsResult =
    | Readonly<{ ok:true; writtenPaths:readonly string[] }>
    | Readonly<{ ok:false; diagnostic:string }>;

type ArtifactSnapshot = Readonly<{
    folderPath:string;
    folderExisted:boolean;
    filePath:string;
    fileExisted:boolean;
    originalContent:string|null;
}>;

type RevertibleOutcome<T> =
    | Readonly<{ ok:true; value:T; revert:() => Promise<void> }>
    | Readonly<{ ok:false; error:unknown; revert:() => Promise<void> }>;

function throwIfAborted(signal:AbortSignal):void {
    if (signal.aborted) {
        throw abortError();
    }
}

async function existsBeforeMutation(fs:FsContext, path:string, signal:AbortSignal):Promise<boolean> {
    let existed:boolean;
    try {
        existed = await fs.exists(path);
    } catch {
        throw new Error(`Cannot inspect path: ${path}`);
    }
    throwIfAborted(signal);
    return existed;
}

async function settleRollback(operation:() => Promise<void>):Promise<void> {
    await Promise.allSettled([Promise.resolve().then(operation)]);
}

async function rollbackArtifacts(
    fs:FsContext,
    snapshots:readonly ArtifactSnapshot[],
    toolRoot:string,
    toolRootExisted:boolean,
    skillsRoot:string,
    skillsRootExisted:boolean
):Promise<void> {
    const destinationExisted = skillsRootExisted || snapshots.some(snapshot => snapshot.folderExisted || snapshot.fileExisted);
    for (const snapshot of [...snapshots].reverse()) {
        if (snapshot.fileExisted) {
            await settleRollback(() => fs.writeFile(snapshot.filePath, snapshot.originalContent!));
        } else {
            await settleRollback(() => fs.rm(snapshot.filePath, { force: true }));
        }
        if (!snapshot.folderExisted && !snapshot.fileExisted) {
            await settleRollback(() => fs.rm(snapshot.folderPath, { recursive: true, force: true }));
        }
    }
    if (!skillsRootExisted && !destinationExisted) {
        await settleRollback(() => fs.rm(skillsRoot, { recursive: true, force: true }));
    }
    if (!toolRootExisted && !destinationExisted) {
        await settleRollback(() => fs.rm(toolRoot, { recursive: true, force: true }));
    }
}

function runCancellable<T>(signal:AbortSignal, operation:() => Promise<RevertibleOutcome<T>>):Promise<T> {
    return new Promise<T>((resolve, reject) => {
        if (signal.aborted) {
            reject(abortError());
            return;
        }
        let settled = false;
        let operationPromise:Promise<RevertibleOutcome<T>>;
        let revertPromise:Promise<void>|null = null;
        const finish = (settle:() => void) => {
            if (settled) {
                return;
            }
            settled = true;
            signal.removeEventListener("abort", onAbort);
            settle();
        };
        const rejectAsAborted = () => finish(() => reject(abortError()));
        const revertAndRejectAsAborted = (outcome:RevertibleOutcome<T>) => {
            revertPromise ??= Promise.resolve().then(outcome.revert);
            void revertPromise.then(rejectAsAborted, rejectAsAborted);
        };
        const onAbort = () => {
            void operationPromise.then(revertAndRejectAsAborted, rejectAsAborted);
        };
        signal.addEventListener("abort", onAbort, { once: true });
        operationPromise = Promise.resolve().then(operation);
        operationPromise.then(
            outcome => {
                if (signal.aborted) {
                    revertAndRejectAsAborted(outcome);
                    return;
                }
                if (!outcome.ok) {
                    finish(() => reject(outcome.error));
                    return;
                }
                finish(() => resolve(outcome.value));
            },
            error => {
                if (signal.aborted) {
                    rejectAsAborted();
                    return;
                }
                finish(() => reject(error));
            }
        );
    });
}

async function writeDirectorySkillArtifacts(fs:FsContext, scopeRoot:string, tool:ToolName, signal:AbortSignal):Promise<RevertibleOutcome<WriteSkillArtifactsResult>> {
    throwIfAborted(signal);
    const toolRoot = joinPath(scopeRoot, TOOL_SUBDIRS[tool]);
    const skillsRoot = joinPath(toolRoot, SKILLS_SUBDIR);
    const toolRootExisted = await existsBeforeMutation(fs, toolRoot, signal);
    throwIfAborted(signal);
    const skillsRootExisted = await existsBeforeMutation(fs, skillsRoot, signal);
    throwIfAborted(signal);
    const snapshots:ArtifactSnapshot[] = [];
    const writtenPaths:string[] = [];
    const revert = () => rollbackArtifacts(fs, snapshots, toolRoot, toolRootExisted, skillsRoot, skillsRootExisted);
    try {
        for (const skill of SKILLS) {
            throwIfAborted(signal);
            const folderPath = joinPath(skillsRoot, skill.name);
            const filePath = skillArtifactPath(scopeRoot, tool, skill.name);
            const folderExisted = await existsBeforeMutation(fs, folderPath, signal);
            throwIfAborted(signal);
            const fileExisted = await existsBeforeMutation(fs, filePath, signal);
            throwIfAborted(signal);
            let originalContent:string|null = null;
            if (fileExisted) {
                try {
                    originalContent = await fs.readFile(filePath);
                } catch {
                    throw new Error(`Cannot read file: ${filePath}`);
                }
                throwIfAborted(signal);
            }
            snapshots.push({ folderPath, folderExisted, filePath, fileExisted, originalContent });
            try {
                await fs.mkdir(folderPath, { recursive: true });
                throwIfAborted(signal);
            } catch {
                if (signal.aborted) {
                    throw abortError();
                }
                return { ok: true, value: { ok: false, diagnostic: `Cannot create destination: ${folderPath}\n` }, revert };
            }
            try {
                await fs.writeFile(filePath, skill.body);
                throwIfAborted(signal);
                writtenPaths.push(filePath);
            } catch {
                if (signal.aborted) {
                    throw abortError();
                }
                return { ok: true, value: { ok: false, diagnostic: `Cannot write file: ${filePath}\n` }, revert };
            }
        }
        return { ok: true, value: { ok: true, writtenPaths }, revert };
    } catch (error) {
        return { ok: false, error, revert };
    }
}

export function writeSkillArtifacts(fs:FsContext, scopeRoot:string, tool:ToolName, signal:AbortSignal):Promise<WriteSkillArtifactsResult> {
    return runCancellable(signal, () => {
        for (const skill of SKILLS) {
            /* coverage ignore next 7 */ // — Defensive: skill bodies are compile-time constants that are always non-empty.
            if (!skill.body) {
                return Promise.resolve({
                    ok: true,
                    value: { ok: false, diagnostic: `Skill "${skill.name}" has no content.\n` } as const,
                    revert: () => Promise.resolve()
                });
            }
        }
        return writeDirectorySkillArtifacts(fs, scopeRoot, tool, signal);
    });
}
