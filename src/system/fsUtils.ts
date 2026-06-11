import type { FsContext } from "../contexts";

const POSIX_SEPARATOR = "/";

export async function listFilesRecursive(fs:FsContext, root:string):Promise<string[]> {
    if (!(await fs.exists(root))) {
        return [];
    }
    const out:string[] = [];
    const walk = async (dirAbsolute:string, dirRelative:string) => {
        const entries = await fs.readdir(dirAbsolute);
        for (const entry of entries) {
            const childAbsolute = joinPath(dirAbsolute, entry.name);
            const childRelative = dirRelative ? joinPath(dirRelative, entry.name) : entry.name;
            if (entry.isDirectory) {
                await walk(childAbsolute, childRelative);
            } else if (entry.isFile) {
                out.push(childRelative);
            }
        }
    };
    await walk(root, "");
    return out.sort();
}

export function joinPath(...parts:string[]):string {
    const cleaned = parts
        .filter(p => p.length > 0)
        .map((p, i) => {
            if (i === 0) {
                return p.replace(/[\\/]+$/, "");
            }
            return p.replace(/^[\\/]+/, "").replace(/[\\/]+$/, "");
        });
    return cleaned.join(POSIX_SEPARATOR);
}

export async function fileSize(fs:FsContext, path:string):Promise<number> {
    const stat = await fs.stat(path);
    return stat.size;
}

export async function isNonEmptyFile(fs:FsContext, path:string):Promise<boolean> {
    if (!(await fs.exists(path))) {
        return false;
    }
    const stat = await fs.stat(path);
    return stat.isFile && stat.size > 0;
}
