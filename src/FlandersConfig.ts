import type { FsContext } from "./contexts";
import { joinPath } from "./fsUtils";

export type FlandersConfig = Readonly<{
    worker:Readonly<{ tool:"claude"|"codex"; model:string; effort:string }>;
    reviewer:Readonly<{ tool:"claude"|"codex"; model:string; effort:string }>;
}>;

type ReadArgs = Readonly<{
    projectRoot:string;
    homeDir:string;
}>;

type WriteArgs = Readonly<{
    scope:"project"|"global";
    projectRoot:string;
    homeDir:string;
    config:FlandersConfig;
}>;

const CONFIG_PATH = ".flanders/config.json";
const CONFIG_DIR = ".flanders";

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
    if (!("reviewer" in obj) || typeof obj["reviewer"] !== "object" || obj["reviewer"] === null || Array.isArray(obj["reviewer"])) {
        throw new Error(`Malformed config at ${filePath}: missing or invalid field "reviewer"`);
    }
    validateRole(obj["worker"] as Record<string, unknown>, "worker", filePath);
    validateRole(obj["reviewer"] as Record<string, unknown>, "reviewer", filePath);
    return raw as FlandersConfig;
}

function validateRole(role:Record<string, unknown>, name:string, filePath:string):void {
    if (!("tool" in role) || typeof role["tool"] !== "string") {
        throw new Error(`Malformed config at ${filePath}: missing or invalid field "${name}.tool"`);
    }
    if (role["tool"] !== "claude" && role["tool"] !== "codex") {
        throw new Error(`Malformed config at ${filePath}: invalid value for "${name}.tool": "${role["tool"]}"`);
    }
    if (!("model" in role) || typeof role["model"] !== "string") {
        throw new Error(`Malformed config at ${filePath}: missing or invalid field "${name}.model"`);
    }
    if (!("effort" in role) || typeof role["effort"] !== "string") {
        throw new Error(`Malformed config at ${filePath}: missing or invalid field "${name}.effort"`);
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
