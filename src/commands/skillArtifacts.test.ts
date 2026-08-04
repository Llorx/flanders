import * as Assert from "assert";

import test, { monad } from "arrange-act-assert";

import { isAbortError } from "../abortError";
import { SKILLS, writeSkillArtifacts, skillArtifactPaths } from "./skillArtifacts";
import type { FsContext } from "../contexts";
import type { ToolName } from "../ai/ToolAdapter";
import { planSkillBody, specSkillBody, implementSkillBody, hardStopReviewSkillBody } from "../prompts/skills";
import { FLANDERS_INTERNAL_SPEC_MARKDOWN_PATHS } from "../prompts/internalSpecPath.fixtures";
import { removeStoredPath } from "./memoryFs.fixtures";
import { rejectThenSchedule, settleThenSchedule } from "./asyncSettlement.fixtures";

test.describe("installed skill body self-containment", test => {
    test("all final assembled bodies contain exactly zero flanders-internal spec markdown paths", {
        ARRANGE() {
            return SKILLS;
        },
        ACT(skills) {
            return skills.flatMap(skill =>
                (skill.body.match(FLANDERS_INTERNAL_SPEC_MARKDOWN_PATHS) ?? [])
                    .map(match => ({ skill: skill.name, match }))
            );
        },
        ASSERT(matches) {
            Assert.strictEqual(matches.length, 0, JSON.stringify(matches));
        }
    });

    test("the global detector recognizes every forbidden path form and ignores folder-only references", {
        ARRANGE() {
            const positive = [
                ["contracts relative", ".spec/contracts/ai-skills/spec-skill.md", 1],
                ["rules nested with fragment", "src/prompts/.spec/rules/ai/skills/skills-common.md#deterministic-regression-guard", 1],
                ["flanders absolute Windows", "C:\\repo\\.spec\\flanders\\file-placement.md", 1],
                ["plans absolute POSIX", "/repo/plans/2026-01-01_00.00-example.md", 1],
                ["contracts namespace", "contracts/ai-skills/spec-skill.md", 1],
                ["rules namespace Windows with fragment", "rules\\ai\\agents\\no-background-commands.md#scope", 1],
                ["flanders relative", ".spec/flanders/file-placement.md", 1],
                ["flanders namespace", "flanders/file-placement.md", 1],
                ["plans Windows with fragment", "plans\\2026-01-01_00.00-example.md#task-1", 1],
                ["non-ASCII filename", ".spec/rules/validación.md", 1],
                ["deferral sentence ending in a period", "The full obligation lives in rules/ai/agents/no-git-writes.md.", 1],
                ["abbreviated shared namespace", "shared/spec-folder-write-authority.md", 1],
                ["multiple paths", ".spec/contracts/one.md and rules/two.md#section", 2]
            ] as const;
            const negative = [
                ["contracts folder", ".spec/contracts", 0],
                ["rules folder with separator", ".spec/rules/", 0],
                ["flanders folder Windows", ".spec\\flanders\\", 0],
                ["flanders folder", ".spec/flanders", 0],
                ["plans folder", "plans/", 0],
                ["ordinary markdown file", "README.md", 0]
            ] as const;
            return { positive, negative };
        },
        ACT({ positive, negative }) {
            const matchCounts = (fixtures:readonly (readonly [string, string, number])[]) => fixtures.map(([name, value, expectedCount]) => ({
                name,
                count: (value.match(FLANDERS_INTERNAL_SPEC_MARKDOWN_PATHS) ?? []).length,
                expectedCount
            }));
            return {
                positive: matchCounts(positive),
                negative: matchCounts(negative)
            };
        },
        ASSERTS: {
            "matches every positive fixture the exact expected number of times"({ positive }) {
                Assert.deepStrictEqual(positive.filter(({ count, expectedCount }) => count !== expectedCount), []);
            },
            "matches no permitted folder-only or unrelated markdown fixture"({ negative }) {
                Assert.deepStrictEqual(negative.filter(({ count, expectedCount }) => count !== expectedCount), []);
            }
        }
    });
});

function stubFs() {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    // Ordered log of every directory-creating and file-writing call, so a test can assert that each
    // destination folder is created (recursively) immediately before its artifact is written. A bare
    // `files` map cannot observe this: the stub `writeFile` succeeds regardless of directory existence,
    // so a regression dropping the `mkdir` calls would leave `files` identical.
    const ops:string[] = [];
    const fs:FsContext = {
        readFile(p) { return files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error("not found")); },
        writeFile(p, content) { ops.push(`writeFile ${p}`); files.set(p, content); return Promise.resolve(); },
        rename() { return Promise.reject(new Error("unexpected rename")); },
        readdir() { return Promise.resolve([]); },
        stat() { return Promise.reject(new Error("unexpected stat")); },
        exists(p) { return Promise.resolve(files.has(p) || dirs.has(p)); },
        mkdir(p, options) { ops.push(`mkdir ${p} recursive=${options?.recursive === true}`); dirs.add(p); return Promise.resolve(); },
        mkdtemp() { return Promise.reject(new Error("unexpected mkdtemp")); },
        rm(p) { removeStoredPath(files, dirs, p); return Promise.resolve(); }
    };
    return { fs, files, dirs, ops };
}

test.describe("writeSkillArtifacts claude", test => {
    test("writes the claude set under <scopeRoot>/.claude/skills/<name>/SKILL.md", {
        ARRANGE() {
            return stubFs();
        },
        ACT({ fs }) {
            return writeSkillArtifacts(fs, "/root", "claude", new AbortController().signal);
        },
        ASSERTS: {
            "returns ok:true with the four SKILL.md paths in skill order"(result) {
                Assert.deepStrictEqual(result, {
                    ok: true,
                    writtenPaths: [
                        "/root/.claude/skills/flanders-spec/SKILL.md",
                        "/root/.claude/skills/flanders-plan/SKILL.md",
                        "/root/.claude/skills/flanders-implement/SKILL.md",
                        "/root/.claude/skills/flanders-hard-stop-review/SKILL.md"
                    ]
                });
            },
            "writes the spec body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.claude/skills/flanders-spec/SKILL.md"), specSkillBody);
            },
            "writes the plan body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.claude/skills/flanders-plan/SKILL.md"), planSkillBody);
            },
            "writes the implement body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.claude/skills/flanders-implement/SKILL.md"), implementSkillBody);
            },
            "writes the hard-stop-review body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.claude/skills/flanders-hard-stop-review/SKILL.md"), hardStopReviewSkillBody);
            },
            "writes exactly four files"(_result, { files }) {
                Assert.strictEqual(files.size, 4);
            },
            "creates each per-skill folder recursively, immediately before writing its SKILL.md, in order"(_result, { ops }) {
                Assert.deepStrictEqual(ops, [
                    "mkdir /root/.claude/skills/flanders-spec recursive=true",
                    "writeFile /root/.claude/skills/flanders-spec/SKILL.md",
                    "mkdir /root/.claude/skills/flanders-plan recursive=true",
                    "writeFile /root/.claude/skills/flanders-plan/SKILL.md",
                    "mkdir /root/.claude/skills/flanders-implement recursive=true",
                    "writeFile /root/.claude/skills/flanders-implement/SKILL.md",
                    "mkdir /root/.claude/skills/flanders-hard-stop-review recursive=true",
                    "writeFile /root/.claude/skills/flanders-hard-stop-review/SKILL.md"
                ]);
            }
        }
    });

    test("a mkdir failure returns the exact Cannot create destination diagnostic and writes nothing", {
        ARRANGE() {
            const s = stubFs();
            (s.fs as { mkdir:FsContext["mkdir"] }).mkdir = (p:string) => Promise.reject(new Error(`EACCES: ${p}`));
            return s;
        },
        ACT({ fs }) {
            return writeSkillArtifacts(fs, "/root", "claude", new AbortController().signal);
        },
        ASSERTS: {
            "returns the exact offending-path diagnostic"(result) {
                Assert.deepStrictEqual(result, {
                    ok: false,
                    diagnostic: "Cannot create destination: /root/.claude/skills/flanders-spec\n"
                });
            },
            "writes no files"(_result, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("a writeFile failure returns the exact Cannot write file diagnostic", {
        ARRANGE() {
            const s = stubFs();
            (s.fs as { writeFile:FsContext["writeFile"] }).writeFile = (p:string) => Promise.reject(new Error(`EACCES: ${p}`));
            return s;
        },
        ACT({ fs }) {
            return writeSkillArtifacts(fs, "/root", "claude", new AbortController().signal);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Cannot write file: /root/.claude/skills/flanders-spec/SKILL.md\n"
            });
        }
    });

});

test.describe("writeSkillArtifacts codex", test => {
    test("writes the codex set under <scopeRoot>/.agents/skills/<name>/SKILL.md", {
        ARRANGE() {
            return stubFs();
        },
        ACT({ fs }) {
            return writeSkillArtifacts(fs, "/root", "codex", new AbortController().signal);
        },
        ASSERTS: {
            "returns ok:true with the four SKILL.md paths in skill order"(result) {
                Assert.deepStrictEqual(result, {
                    ok: true,
                    writtenPaths: [
                        "/root/.agents/skills/flanders-spec/SKILL.md",
                        "/root/.agents/skills/flanders-plan/SKILL.md",
                        "/root/.agents/skills/flanders-implement/SKILL.md",
                        "/root/.agents/skills/flanders-hard-stop-review/SKILL.md"
                    ]
                });
            },
            "writes the spec body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.agents/skills/flanders-spec/SKILL.md"), specSkillBody);
            },
            "writes the plan body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.agents/skills/flanders-plan/SKILL.md"), planSkillBody);
            },
            "writes the implement body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.agents/skills/flanders-implement/SKILL.md"), implementSkillBody);
            },
            "writes the hard-stop-review body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.agents/skills/flanders-hard-stop-review/SKILL.md"), hardStopReviewSkillBody);
            },
            "writes exactly four files"(_result, { files }) {
                Assert.strictEqual(files.size, 4);
            },
            "creates each per-skill folder recursively, immediately before writing its SKILL.md, in order"(_result, { ops }) {
                Assert.deepStrictEqual(ops, [
                    "mkdir /root/.agents/skills/flanders-spec recursive=true",
                    "writeFile /root/.agents/skills/flanders-spec/SKILL.md",
                    "mkdir /root/.agents/skills/flanders-plan recursive=true",
                    "writeFile /root/.agents/skills/flanders-plan/SKILL.md",
                    "mkdir /root/.agents/skills/flanders-implement recursive=true",
                    "writeFile /root/.agents/skills/flanders-implement/SKILL.md",
                    "mkdir /root/.agents/skills/flanders-hard-stop-review recursive=true",
                    "writeFile /root/.agents/skills/flanders-hard-stop-review/SKILL.md"
                ]);
            }
        }
    });

    test("a skill-folder mkdir failure returns the exact Cannot create destination diagnostic and writes nothing", {
        ARRANGE() {
            const s = stubFs();
            (s.fs as { mkdir:FsContext["mkdir"] }).mkdir = (p:string) => Promise.reject(new Error(`EACCES: ${p}`));
            return s;
        },
        ACT({ fs }) {
            return writeSkillArtifacts(fs, "/root", "codex", new AbortController().signal);
        },
        ASSERTS: {
            "returns the exact offending-path diagnostic"(result) {
                Assert.deepStrictEqual(result, {
                    ok: false,
                    diagnostic: "Cannot create destination: /root/.agents/skills/flanders-spec\n"
                });
            },
            "writes no files"(_result, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("a writeFile failure returns the exact Cannot write file diagnostic", {
        ARRANGE() {
            const s = stubFs();
            (s.fs as { writeFile:FsContext["writeFile"] }).writeFile = (p:string) => Promise.reject(new Error(`EACCES: ${p}`));
            return s;
        },
        ACT({ fs }) {
            return writeSkillArtifacts(fs, "/root", "codex", new AbortController().signal);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Cannot write file: /root/.agents/skills/flanders-spec/SKILL.md\n"
            });
        }
    });

});

type PendingOperationCase = Readonly<{
    tool:ToolName;
    operation:"mkdir"|"writeFile";
    outcome:"resolve"|"reject";
}>;

const PENDING_OPERATION_CASES:readonly PendingOperationCase[] = [
    { tool: "claude", operation: "mkdir", outcome: "resolve" },
    { tool: "claude", operation: "mkdir", outcome: "reject" },
    { tool: "claude", operation: "writeFile", outcome: "resolve" },
    { tool: "claude", operation: "writeFile", outcome: "reject" },
    { tool: "codex", operation: "mkdir", outcome: "resolve" },
    { tool: "codex", operation: "mkdir", outcome: "reject" },
    { tool: "codex", operation: "writeFile", outcome: "resolve" },
    { tool: "codex", operation: "writeFile", outcome: "reject" }
];

test.describe("writeSkillArtifacts cancellation", test => {
    for (const pendingCase of PENDING_OPERATION_CASES) {
        test(`${pendingCase.tool}: abort while ${pendingCase.operation} is pending, then ${pendingCase.outcome} it`, {
            ARRANGE() {
                const s = stubFs();
                const controller = new AbortController();
                let releasePending:(() => void)|null = null;
                let markPendingStarted:() => void = () => {};
                const pendingStarted = new Promise<void>(resolve => { markPendingStarted = resolve; });
                if (pendingCase.operation === "mkdir") {
                    const original = s.fs.mkdir.bind(s.fs);
                    (s.fs as { mkdir:FsContext["mkdir"] }).mkdir = (path, options) => new Promise<void>((resolve, reject) => {
                        releasePending = () => {
                            if (pendingCase.outcome === "reject") {
                                reject(new Error(`late mkdir failure: ${path}`));
                            } else {
                                void original(path, options).then(resolve, reject);
                            }
                        };
                        markPendingStarted();
                    });
                } else {
                    const original = s.fs.writeFile.bind(s.fs);
                    (s.fs as { writeFile:FsContext["writeFile"] }).writeFile = (path, content) => new Promise<void>((resolve, reject) => {
                        releasePending = () => {
                            if (pendingCase.outcome === "reject") {
                                reject(new Error(`late write failure: ${path}`));
                            } else {
                                void original(path, content).then(resolve, reject);
                            }
                        };
                        markPendingStarted();
                    });
                }
                return { ...s, controller, pendingStarted, getReleasePending: () => releasePending };
            },
            async ACT({ fs, controller, pendingStarted, getReleasePending }) {
                const resultPromise = monad(() => writeSkillArtifacts(fs, "/root", pendingCase.tool, controller.signal));
                await pendingStarted;
                controller.abort();
                getReleasePending()!();
                return await resultPromise;
            },
            ASSERTS: {
                "rejects with AbortError rather than a filesystem diagnostic"(result) {
                    result.should.error(isAbortError);
                },
                "rolls back every created file"(_result, { files }) {
                    Assert.deepStrictEqual([...files], []);
                },
                "rolls back every created directory"(_result, { dirs }) {
                    Assert.deepStrictEqual([...dirs], []);
                },
                "does not start the second artifact"(_result, { ops }) {
                    Assert.strictEqual(ops.some(operation => operation.includes("flanders-plan")), false);
                }
            }
        });
    }

    test("a pre-aborted signal rejects before any filesystem work starts", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            return await monad(() => writeSkillArtifacts(fs, "/root", "codex", AbortSignal.abort()));
        },
        ASSERTS: {
            "rejects with AbortError"(result) {
                result.should.error(isAbortError);
            },
            "performs no filesystem mutation"(_result, { ops }) {
                Assert.deepStrictEqual(ops, []);
            }
        }
    });

    test("an abort while the initial existence probe is pending stays silent when the probe later rejects", {
        ARRANGE() {
            const s = stubFs();
            const controller = new AbortController();
            let rejectExists:(() => void)|null = null;
            const existsStarted = new Promise<void>(resolve => {
                (s.fs as { exists:FsContext["exists"] }).exists = () => new Promise<boolean>((_resolve, reject) => {
                    rejectExists = () => reject(new Error("late pathless failure"));
                    resolve();
                });
            });
            return { ...s, controller, existsStarted, getRejectExists: () => rejectExists };
        },
        async ACT({ fs, controller, existsStarted, getRejectExists }) {
            const resultPromise = monad(() => writeSkillArtifacts(fs, "/root", "codex", controller.signal));
            await existsStarted;
            controller.abort();
            getRejectExists()!();
            return await resultPromise;
        },
        ASSERTS: {
            "rejects with AbortError rather than the probe error"(result) {
                result.should.error(isAbortError);
            },
            "starts no directory or file mutation"(_result, { ops }) {
                Assert.deepStrictEqual(ops, []);
            }
        }
    });

    test("a completed emission removes its abort listener and cannot be rolled back by a later abort", {
        ARRANGE() {
            const s = stubFs();
            const controller = new AbortController();
            const signal = controller.signal;
            const originalRemove = signal.removeEventListener.bind(signal);
            let removedAbortListeners = 0;
            (signal as { removeEventListener:AbortSignal["removeEventListener"] }).removeEventListener = (type, listener, options) => {
                if (type === "abort") {
                    removedAbortListeners++;
                }
                originalRemove(type, listener, options);
            };
            return { ...s, controller, signal, getRemovedAbortListeners: () => removedAbortListeners };
        },
        async ACT({ fs, controller, signal }) {
            const result = await writeSkillArtifacts(fs, "/root", "codex", signal);
            controller.abort();
            return result;
        },
        ASSERTS: {
            "returns the successful four-path result"(result) {
                Assert.strictEqual(result.ok, true);
            },
            "removes the abort listener on settlement"(_result, { getRemovedAbortListeners }) {
                Assert.strictEqual(getRemovedAbortListeners(), 1);
            },
            "keeps all emitted files after the later abort"(_result, { files }) {
                Assert.strictEqual(files.size, 4);
            }
        }
    });

    test("an abort after emission settles but before its observer runs rolls the emission back", {
        ARRANGE() {
            const s = stubFs();
            const controller = new AbortController();
            const originalWriteFile = s.fs.writeFile.bind(s.fs);
            let writeCount = 0;
            (s.fs as { writeFile:FsContext["writeFile"] }).writeFile = (path, content) => {
                writeCount++;
                const write = originalWriteFile(path, content);
                if (writeCount < 4) {
                    return write;
                }
                return settleThenSchedule(undefined, () => controller.abort());
            };
            return { ...s, controller };
        },
        async ACT({ fs, controller }) {
            return await monad(() => writeSkillArtifacts(fs, "/root", "codex", controller.signal));
        },
        ASSERTS: {
            "rejects with AbortError"(result) {
                result.should.error(isAbortError);
            },
            "rolls back every emitted file"(_result, { files }) {
                Assert.deepStrictEqual([...files], []);
            },
            "rolls back every emitted directory"(_result, { dirs }) {
                Assert.deepStrictEqual([...dirs], []);
            }
        }
    });

    test("an abort after the file-existence probe settles prevents the first mkdir", {
        ARRANGE() {
            const s = stubFs();
            const controller = new AbortController();
            let existsCalls = 0;
            (s.fs as { exists:FsContext["exists"] }).exists = () => {
                existsCalls++;
                if (existsCalls === 4) {
                    return settleThenSchedule(false, () => controller.abort());
                }
                return Promise.resolve(false);
            };
            return { ...s, controller };
        },
        async ACT({ fs, controller }) {
            return await monad(() => writeSkillArtifacts(fs, "/root", "codex", controller.signal));
        },
        ASSERTS: {
            "rejects with AbortError"(result) {
                result.should.error(isAbortError);
            },
            "starts no directory or file mutation"(_result, { ops }) {
                Assert.deepStrictEqual(ops, []);
            }
        }
    });

    test("an abort observed after a later snapshot-probe rejection rolls earlier artifacts back", {
        ARRANGE() {
            const s = stubFs();
            const controller = new AbortController();
            let existsCalls = 0;
            (s.fs as { exists:FsContext["exists"] }).exists = () => {
                existsCalls++;
                if (existsCalls === 5) {
                    return rejectThenSchedule(new Error("pathless failure"), () => controller.abort());
                }
                return Promise.resolve(false);
            };
            return { ...s, controller };
        },
        async ACT({ fs, controller }) {
            return await monad(() => writeSkillArtifacts(fs, "/root", "codex", controller.signal));
        },
        ASSERTS: {
            "rejects with AbortError"(result) {
                result.should.error(isAbortError);
            },
            "rolls back the artifact written before the rejection"(_result, { files }) {
                Assert.deepStrictEqual([...files], []);
            },
            "rolls back the directories created before the rejection"(_result, { dirs }) {
                Assert.deepStrictEqual([...dirs], []);
            },
            "does not begin the second artifact mutation"(_result, { ops }) {
                Assert.strictEqual(ops.some(operation => operation.includes("flanders-plan")), false);
            }
        }
    });

    const SNAPSHOT_EXISTENCE_PROBES:readonly Readonly<{ call:number; path:string }>[] = [
        { call: 1, path: "/root/.agents" },
        { call: 2, path: "/root/.agents/skills" },
        { call: 3, path: "/root/.agents/skills/flanders-spec" },
        { call: 4, path: "/root/.agents/skills/flanders-spec/SKILL.md" }
    ];
    for (const probe of SNAPSHOT_EXISTENCE_PROBES) {
        test(`snapshot existence failure ${probe.call} names ${probe.path}`, {
            ARRANGE() {
                const s = stubFs();
                let existsCalls = 0;
                (s.fs as { exists:FsContext["exists"] }).exists = () => {
                    existsCalls++;
                    return existsCalls === probe.call
                        ? Promise.reject(new Error("pathless failure"))
                        : Promise.resolve(false);
                };
                return s;
            },
            async ACT({ fs }) {
                return await monad(() => writeSkillArtifacts(fs, "/root", "codex", new AbortController().signal));
            },
            ASSERTS: {
                "rejects with an error naming the inspected path"(result) {
                    result.should.error(error => error instanceof Error && error.message === `Cannot inspect path: ${probe.path}`);
                },
                "performs no directory or file mutation"(_result, { ops }) {
                    Assert.deepStrictEqual(ops, []);
                }
            }
        });
    }

    test("a snapshot read failure names the file path", {
        ARRANGE() {
            const s = stubFs();
            const filePath = "/root/.agents/skills/flanders-spec/SKILL.md";
            s.files.set(filePath, "old content");
            (s.fs as { readFile:FsContext["readFile"] }).readFile = () => Promise.reject(new Error("snapshot failed"));
            return s;
        },
        async ACT({ fs }) {
            return await monad(() => writeSkillArtifacts(fs, "/root", "codex", new AbortController().signal));
        },
        ASSERT(result) {
            result.should.error(error => error instanceof Error && error.message === "Cannot read file: /root/.agents/skills/flanders-spec/SKILL.md");
        }
    });
});

test.describe("skillArtifactPaths", test => {
    test("publishes no path under the former skill name", {
        ARRANGE() {
            return { removedName: "flanders" + "-work" };
        },
        ACT() {
            return [
                ...skillArtifactPaths("/root", "claude"),
                ...skillArtifactPaths("/root", "codex")
            ];
        },
        ASSERT(paths, { removedName }) {
            Assert.strictEqual(paths.some(path => path.includes(removedName)), false);
        }
    });

    test("claude paths use .claude/skills/<name>/SKILL.md", {
        ARRANGE() {
            return {
                expected: [
                    "/root/.claude/skills/flanders-spec/SKILL.md",
                    "/root/.claude/skills/flanders-plan/SKILL.md",
                    "/root/.claude/skills/flanders-implement/SKILL.md",
                    "/root/.claude/skills/flanders-hard-stop-review/SKILL.md"
                ]
            };
        },
        ACT() {
            return skillArtifactPaths("/root", "claude");
        },
        ASSERT(result, { expected }) {
            Assert.deepStrictEqual(result, expected);
        }
    });

    test("codex paths use .agents/skills/<name>/SKILL.md", {
        ARRANGE() {
            return {
                expected: [
                    "/root/.agents/skills/flanders-spec/SKILL.md",
                    "/root/.agents/skills/flanders-plan/SKILL.md",
                    "/root/.agents/skills/flanders-implement/SKILL.md",
                    "/root/.agents/skills/flanders-hard-stop-review/SKILL.md"
                ]
            };
        },
        ACT() {
            return skillArtifactPaths("/root", "codex");
        },
        ASSERT(result, { expected }) {
            Assert.deepStrictEqual(result, expected);
        }
    });
});
