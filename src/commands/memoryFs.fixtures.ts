function storedPathsAtOrBelow(paths:Iterable<string>, target:string):string[] {
    const prefix = `${target}/`;
    return [...paths].filter(path => path === target || path.startsWith(prefix));
}

export function removeStoredPath(files:Map<string, string>, dirs:Set<string>, target:string):void {
    for (const path of storedPathsAtOrBelow(files.keys(), target)) {
        files.delete(path);
    }
    for (const path of storedPathsAtOrBelow(dirs, target)) {
        dirs.delete(path);
    }
}
