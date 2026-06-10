import type { ScriptContext, TimeContext } from "./contexts";

import { listIgnoredPaths, listNonIgnoredFiles } from "./Git";

export type SpecLists = Readonly<{ contracts:readonly string[]; rules:readonly string[] }>;

export function classifySpecPaths(paths:readonly string[]):{ contracts:string[]; rules:string[] } {
    const contracts:string[] = [];
    const rules:string[] = [];
    for (const filePath of paths) {
        const segments = filePath.split("/");
        const docsIndex = segments.indexOf(".docs");
        if (docsIndex === -1) {
            continue;
        }
        if (segments.length <= docsIndex + 2) {
            continue;
        }
        const kind = segments[docsIndex + 1];
        if (kind === "contracts") {
            contracts.push(filePath);
        } else if (kind === "rules") {
            rules.push(filePath);
        }
    }
    return { contracts, rules };
}

export async function discoverSpecs(script:ScriptContext, time:TimeContext, projectRoot:string):Promise<SpecLists> {
    const files = await listNonIgnoredFiles(script, time, projectRoot);
    const { contracts, rules } = classifySpecPaths(files);
    const ignored = await listIgnoredPaths(script, time, projectRoot, [...contracts, ...rules]);
    const survivingContracts = contracts.filter(p => !ignored.has(p)).sort();
    const survivingRules = rules.filter(p => !ignored.has(p)).sort();
    return { contracts: survivingContracts, rules: survivingRules };
}
