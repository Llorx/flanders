import type { FsContext } from "../contexts";
import { joinPath } from "../system/fsUtils";
import { TOOL_NAMES } from "../toolNames";
import type { ToolName } from "../ai/ToolAdapter";

export type FlandersRole = Readonly<{ tool:ToolName; model:string; effort:string; fast:boolean }>;

export type FlandersReviewer = FlandersRole & Readonly<{ optional:boolean }>;

export type FlandersConfig = Readonly<{
    worker:FlandersRole;
    reviewers:readonly FlandersReviewer[];
    minimumReviews:number;
}>;

type ReadArgs = Readonly<{
    projectRoot:string;
    homeDir:string;
}>;

// Single source for the scope + base-directory shape shared by the per-scope reader
// and the writer; both compose it so the scope/base-directory fields have one definition.
type ScopedConfigArgs = ReadArgs & Readonly<{
    scope:"project"|"global";
}>;

type WriteArgs = ScopedConfigArgs & Readonly<{
    config:FlandersConfig;
}>;

const CONFIG_PATH = ".flanders/config.json";
const CONFIG_DIR = ".flanders";
const ALLOWED_TOP_LEVEL_KEYS = ["worker", "reviewers", "minimumReviews"];

function configPath(base:string):string {
    return joinPath(base, CONFIG_PATH);
}

function configDir(base:string):string {
    return joinPath(base, CONFIG_DIR);
}

function validate(raw:unknown, filePath:string):FlandersConfig {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        throw new Error(`Malformed config at ${filePath}: expected a JSON object`);
    }
    const obj = raw as Record<string, unknown>;
    if (!("worker" in obj) || typeof obj["worker"] !== "object" || obj["worker"] === null || Array.isArray(obj["worker"])) {
        throw new Error(`Malformed config at ${filePath}: missing or invalid field "worker"`);
    }
    if (!("reviewers" in obj) || !Array.isArray(obj["reviewers"])) {
        throw new Error(`Malformed config at ${filePath}: missing or invalid field "reviewers"`);
    }
    const reviewers = obj["reviewers"] as unknown[];
    if (reviewers.length === 0) {
        throw new Error(`Malformed config at ${filePath}: field "reviewers" must be a non-empty array`);
    }
    validateRole(obj["worker"] as Record<string, unknown>, "worker", filePath);
    for (let i = 0; i < reviewers.length; i++) {
        const entry = reviewers[i];
        if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
            throw new Error(`Malformed config at ${filePath}: missing or invalid field "reviewers[${i}]"`);
        }
        const reviewer = entry as Record<string, unknown>;
        validateRole(reviewer, `reviewers[${i}]`, filePath);
        if (!("optional" in reviewer) || typeof reviewer["optional"] !== "boolean") {
            throw new Error(`Malformed config at ${filePath}: missing or invalid field "reviewers[${i}].optional"`);
        }
    }
    const minimumReviews = obj["minimumReviews"];
    if (typeof minimumReviews !== "number" || !Number.isInteger(minimumReviews) || minimumReviews < 1 || minimumReviews > reviewers.length) {
        throw new Error(`Malformed config at ${filePath}: field "minimumReviews" must be an integer in [1, ${reviewers.length}]`);
    }
    for (const key of Object.keys(obj)) {
        if (!ALLOWED_TOP_LEVEL_KEYS.includes(key)) {
            throw new Error(`Malformed config at ${filePath}: unexpected top-level key "${key}"`);
        }
    }
    return raw as FlandersConfig;
}

function validateRole(role:Record<string, unknown>, name:string, filePath:string):void {
    if (!("tool" in role) || typeof role["tool"] !== "string") {
        throw new Error(`Malformed config at ${filePath}: missing or invalid field "${name}.tool"`);
    }
    if (!(TOOL_NAMES as readonly string[]).includes(role["tool"])) {
        throw new Error(`Malformed config at ${filePath}: invalid value for "${name}.tool": "${role["tool"]}"`);
    }
    if (!("model" in role) || typeof role["model"] !== "string") {
        throw new Error(`Malformed config at ${filePath}: missing or invalid field "${name}.model"`);
    }
    if (!("effort" in role) || typeof role["effort"] !== "string") {
        throw new Error(`Malformed config at ${filePath}: missing or invalid field "${name}.effort"`);
    }
    // `fast`'s type is validated here, but not the cross-field eligibility invariant (that `fast` is
    // only ever `true` for a `claude` role on a fast-capable model). That invariant is stated by the
    // file-format rule yet deliberately not reader-enforced — it is enforced at install time, in the
    // flag validation and interactive gating of `src/commands/Install.ts`, mirroring how the
    // "antigravity effort is always empty" invariant is stated but not reader-enforced. The reader
    // therefore accepts any boolean `fast` regardless of this role's tool or model.
    if (!("fast" in role) || typeof role["fast"] !== "boolean") {
        throw new Error(`Malformed config at ${filePath}: missing or invalid field "${name}.fast"`);
    }
}

export async function read(fs:FsContext, args:ReadArgs):Promise<FlandersConfig | null> {
    const projectPath = configPath(args.projectRoot);
    if (await fs.exists(projectPath)) {
        const content = await fs.readFile(projectPath);
        let parsed:unknown;
        try {
            parsed = JSON.parse(content);
        } catch {
            throw new Error(`Malformed config at ${projectPath}: invalid JSON`);
        }
        return validate(parsed, projectPath);
    }
    const globalPath = configPath(args.homeDir);
    if (await fs.exists(globalPath)) {
        const content = await fs.readFile(globalPath);
        let parsed:unknown;
        try {
            parsed = JSON.parse(content);
        } catch {
            throw new Error(`Malformed config at ${globalPath}: invalid JSON`);
        }
        return validate(parsed, globalPath);
    }
    return null;
}

// Lenient pre-selection reader (install): targets the chosen scope's file directly,
// applies no project-over-global precedence, and falls back to null — never throws —
// on an absent, unreadable, unparseable, or malformed file. The consume-to-run `read`
// above keeps its hard-error behavior; both share the single `validate` shape check.
export async function readScope(fs:FsContext, args:ScopedConfigArgs):Promise<FlandersConfig | null> {
    const base = args.scope === "project" ? args.projectRoot : args.homeDir;
    const target = configPath(base);
    try {
        const content = await fs.readFile(target);
        return validate(JSON.parse(content), target);
    } catch {
        return null;
    }
}

export async function write(fs:FsContext, args:WriteArgs):Promise<string> {
    const base = args.scope === "project" ? args.projectRoot : args.homeDir;
    const dir = configDir(base);
    const target = configPath(base);
    const tmp = target + ".tmp";
    const content = JSON.stringify(args.config, null, 2) + "\n";
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, target);
    return target;
}
