import * as Assert from "assert";

import test from "arrange-act-assert";

import { Update } from "./Update";
import type { UpdateContexts } from "./Update";
import { skillArtifactPaths } from "./skillArtifacts";
import { planSkillBody, specSkillBody, implementSkillBody, hardStopReviewSkillBody } from "../prompts/skills";
import { removeStoredPath } from "./memoryFs.fixtures";
import { interceptAbortListenerRemoval } from "./abortController.fixtures";
import { settleThenSchedule } from "./asyncSettlement.fixtures";

function stubContexts() {
    const written:string[] = [];
    const errors:string[] = [];
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    // Every path handed to any FsContext method, so a test can prove no method ever touched a given
    // path (e.g. a `.flanders/config.json`). `mutationPaths` is the subset handed to side-effecting
    // methods — writeFile, mkdir, rename, rm — so a test can prove an uninstalled destination saw no
    // filesystem mutation, not merely that no file landed in the `files` map.
    const allPaths:string[] = [];
    const mutationPaths:string[] = [];
    const contexts:UpdateContexts = {
        fs: {
            readFile(p) { allPaths.push(p); return files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error("not found")); },
            writeFile(p, content) { allPaths.push(p); mutationPaths.push(p); files.set(p, content); return Promise.resolve(); },
            rename(oldPath, newPath) { allPaths.push(oldPath, newPath); mutationPaths.push(oldPath, newPath); return Promise.reject(new Error("unexpected rename")); },
            readdir(p) { allPaths.push(p); return Promise.resolve([]); },
            stat(p) { allPaths.push(p); return Promise.reject(new Error("unexpected stat")); },
            exists(p) { allPaths.push(p); return Promise.resolve(files.has(p) || dirs.has(p)); },
            mkdir(p) { allPaths.push(p); mutationPaths.push(p); dirs.add(p); return Promise.resolve(); },
            mkdtemp(prefix) { allPaths.push(prefix); return Promise.reject(new Error("unexpected mkdtemp")); },
            rm(p) { allPaths.push(p); mutationPaths.push(p); removeStoredPath(files, dirs, p); return Promise.resolve(); }
        },
        output: {
            write(text) { written.push(text); },
            writeError(text) { errors.push(text); },
            columns() { return 80; },
            rows() { return 24; },
            onResize() { return () => {}; }
        },
        platform: {
            isWindows() { return false; },
            tmpdir() { return "/tmp"; },
            homedir() { return "/home/testuser"; }
        }
    };
    return { contexts, written, errors, files, dirs, allPaths, mutationPaths };
}

const PROJ = "/proj";

// The per-tool destination directories under each scope root, used to assert that filesystem
// mutations are confined to the installed destination(s) and never reach an uninstalled one.
const PROJ_CLAUDE_DIR = "/proj/.claude/skills";
const PROJ_CODEX_DIR = "/proj/.agents/skills";
const HOME_CLAUDE_DIR = "/home/testuser/.claude/skills";
const HOME_CODEX_DIR = "/home/testuser/.agents/skills";

// Asserts that every recorded filesystem mutation path begins with one of the allowed destination
// directory prefixes — proving no uninstalled destination saw a mkdir/writeFile/rename/rm.
function assertMutationsConfinedTo(mutationPaths:readonly string[], allowedDirs:readonly string[]) {
    Assert.deepStrictEqual(
        mutationPaths.filter(p => !allowedDirs.some(dir => p.startsWith(dir))),
        []
    );
}

const PROJ_CLAUDE = {
    spec: "/proj/.claude/skills/flanders-spec/SKILL.md",
    plan: "/proj/.claude/skills/flanders-plan/SKILL.md",
    implement: "/proj/.claude/skills/flanders-implement/SKILL.md",
    hardStop: "/proj/.claude/skills/flanders-hard-stop-review/SKILL.md"
};
const PROJ_CODEX = {
    spec: "/proj/.agents/skills/flanders-spec/SKILL.md",
    plan: "/proj/.agents/skills/flanders-plan/SKILL.md",
    implement: "/proj/.agents/skills/flanders-implement/SKILL.md",
    hardStop: "/proj/.agents/skills/flanders-hard-stop-review/SKILL.md"
};
const HOME_CLAUDE = {
    spec: "/home/testuser/.claude/skills/flanders-spec/SKILL.md",
    plan: "/home/testuser/.claude/skills/flanders-plan/SKILL.md",
    implement: "/home/testuser/.claude/skills/flanders-implement/SKILL.md",
    hardStop: "/home/testuser/.claude/skills/flanders-hard-stop-review/SKILL.md"
};
const HOME_CODEX = {
    spec: "/home/testuser/.agents/skills/flanders-spec/SKILL.md",
    plan: "/home/testuser/.agents/skills/flanders-plan/SKILL.md",
    implement: "/home/testuser/.agents/skills/flanders-implement/SKILL.md",
    hardStop: "/home/testuser/.agents/skills/flanders-hard-stop-review/SKILL.md"
};

test.describe("Update refresh by scope and tool", test => {
    test("refreshes a project-scope Claude installation to the full set", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "rewrites the spec skill with the current body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.spec), specSkillBody);
            },
            "rewrites the plan skill with the current body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.plan), planSkillBody);
            },
            "rewrites the implement skill with the current body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.implement), implementSkillBody);
            },
            "rewrites the hard-stop-review skill with the current body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.hardStop), hardStopReviewSkillBody);
            },
            "writes exactly the four Claude artifacts"(_code, { files }) {
                Assert.strictEqual(files.size, 4);
            },
            "prints exactly the four written paths, one per line, with no blank lines"(_code, { written }) {
                Assert.strictEqual(written.join(""), [PROJ_CLAUDE.spec, PROJ_CLAUDE.plan, PROJ_CLAUDE.implement, PROJ_CLAUDE.hardStop].map(p => `${p}\n`).join(""));
            },
            "produces no errors"(_code, { errors }) {
                Assert.strictEqual(errors.length, 0);
            },
            "confines every filesystem mutation to the installed project Claude destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CLAUDE_DIR]);
            }
        }
    });

    test("refreshes a project-scope Codex installation with complete skill bodies", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CODEX.spec, "old content");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "rewrites the spec skill with the complete body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.spec), specSkillBody);
            },
            "rewrites the plan skill with the complete body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.plan), planSkillBody);
            },
            "rewrites the implement skill with the complete body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.implement), implementSkillBody);
            },
            "rewrites the hard-stop-review skill with the complete body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.hardStop), hardStopReviewSkillBody);
            },
            "writes exactly the four Codex artifacts"(_code, { files }) {
                Assert.strictEqual(files.size, 4);
            },
            "confines every filesystem mutation to the installed project Codex destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CODEX_DIR]);
            }
        }
    });

    test("refreshes a global-scope Claude installation under the home directory", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(HOME_CLAUDE.spec, "old content");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "rewrites the spec skill under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CLAUDE.spec), specSkillBody);
            },
            "rewrites the plan skill under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CLAUDE.plan), planSkillBody);
            },
            "rewrites the implement skill under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CLAUDE.implement), implementSkillBody);
            },
            "rewrites the hard-stop-review skill under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CLAUDE.hardStop), hardStopReviewSkillBody);
            },
            "writes exactly the four global Claude artifacts"(_code, { files }) {
                Assert.strictEqual(files.size, 4);
            },
            "confines every filesystem mutation to the installed global Claude destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [HOME_CLAUDE_DIR]);
            }
        }
    });

    test("refreshes a global-scope Codex installation under the home directory", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(HOME_CODEX.spec, "old content");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "rewrites the spec skill under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CODEX.spec), specSkillBody);
            },
            "rewrites the plan skill under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CODEX.plan), planSkillBody);
            },
            "rewrites the implement skill under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CODEX.implement), implementSkillBody);
            },
            "rewrites the hard-stop-review skill under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CODEX.hardStop), hardStopReviewSkillBody);
            },
            "writes exactly the four global Codex artifacts"(_code, { files }) {
                Assert.strictEqual(files.size, 4);
            },
            "confines every filesystem mutation to the installed global Codex destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [HOME_CODEX_DIR]);
            }
        }
    });

    test("refreshes both tools at the same scope when both are installed", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            s.files.set(PROJ_CODEX.spec, "old content");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "rewrites the Claude set"(_code, { files }) {
                Assert.ok(files.has(PROJ_CLAUDE.spec) && files.has(PROJ_CLAUDE.plan) && files.has(PROJ_CLAUDE.implement) && files.has(PROJ_CLAUDE.hardStop));
            },
            "rewrites the Codex set"(_code, { files }) {
                Assert.ok(files.has(PROJ_CODEX.spec) && files.has(PROJ_CODEX.plan) && files.has(PROJ_CODEX.implement) && files.has(PROJ_CODEX.hardStop));
            },
            "writes exactly the eight artifacts across both tools"(_code, { files }) {
                Assert.strictEqual(files.size, 8);
            },
            "prints exactly every written path across both tools, one per line, in order, with no blank lines"(_code, { written }) {
                Assert.strictEqual(written.join(""), [
                    PROJ_CLAUDE.spec, PROJ_CLAUDE.plan, PROJ_CLAUDE.implement, PROJ_CLAUDE.hardStop,
                    PROJ_CODEX.spec, PROJ_CODEX.plan, PROJ_CODEX.implement, PROJ_CODEX.hardStop
                ].map(p => `${p}\n`).join(""));
            },
            "confines every filesystem mutation to the two installed project destinations"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CLAUDE_DIR, PROJ_CODEX_DIR]);
            }
        }
    });

    // The single-artifact detection cases share one arrange/act/assert core: seeding only one of the
    // four artifacts at a destination must still make `update` detect the installation and refresh the
    // complete four-artifact set there with the current bodies. Only the destination map, its
    // mutation-boundary directory, and which artifact is the sole seeded marker vary, so the cases are
    // data over that one shared core rather than a copy per case.
    const DETECTION_SKILLS:ReadonlyArray<{ key:"spec"|"plan"|"implement"|"hardStop"; body:string }> = [
        { key: "spec", body: specSkillBody },
        { key: "plan", body: planSkillBody },
        { key: "implement", body: implementSkillBody },
        { key: "hardStop", body: hardStopReviewSkillBody }
    ];
    const DETECTION_CASES:ReadonlyArray<{
        title:string;
        dest:Record<"spec"|"plan"|"implement"|"hardStop", string>;
        destDir:string;
        seededPath:string;
    }> = [
        { title: "completes a project Claude installation detected via the plan artifact alone", dest: PROJ_CLAUDE, destDir: PROJ_CLAUDE_DIR, seededPath: PROJ_CLAUDE.plan },
        { title: "completes a project Claude installation detected via the implement artifact alone", dest: PROJ_CLAUDE, destDir: PROJ_CLAUDE_DIR, seededPath: PROJ_CLAUDE.implement },
        { title: "completes a project Claude installation detected via the hard-stop-review artifact alone", dest: PROJ_CLAUDE, destDir: PROJ_CLAUDE_DIR, seededPath: PROJ_CLAUDE.hardStop },
        { title: "completes a global Claude installation detected via the hard-stop-review artifact alone", dest: HOME_CLAUDE, destDir: HOME_CLAUDE_DIR, seededPath: HOME_CLAUDE.hardStop },
        { title: "completes a project Codex installation detected via the plan artifact alone", dest: PROJ_CODEX, destDir: PROJ_CODEX_DIR, seededPath: PROJ_CODEX.plan },
        { title: "completes a project Codex installation detected via the implement artifact alone", dest: PROJ_CODEX, destDir: PROJ_CODEX_DIR, seededPath: PROJ_CODEX.implement },
        { title: "completes a project Codex installation detected via the hard-stop-review artifact alone", dest: PROJ_CODEX, destDir: PROJ_CODEX_DIR, seededPath: PROJ_CODEX.hardStop },
        { title: "completes a global Codex installation detected via the hard-stop-review artifact alone", dest: HOME_CODEX, destDir: HOME_CODEX_DIR, seededPath: HOME_CODEX.hardStop }
    ];
    for (const detectionCase of DETECTION_CASES) {
        test(detectionCase.title, {
            ARRANGE() {
                const s = stubContexts();
                // Only one artifact is present — detection must still find the installation.
                s.files.set(detectionCase.seededPath, "old content");
                return s;
            },
            async ACT({ contexts }) {
                const cmd = new Update([], { projectRoot: PROJ }, contexts);
                const code = await cmd.result();
                await cmd.dispose();
                return code;
            },
            ASSERTS: {
                "exits with code 0"(code) {
                    Assert.strictEqual(code, 0);
                },
                "refreshes every artifact of the destination with the current body, rewriting the stale seeded one"(_code, { files }) {
                    for (const skill of DETECTION_SKILLS) {
                        Assert.strictEqual(files.get(detectionCase.dest[skill.key]), skill.body);
                    }
                },
                "ends holding exactly the four published artifacts"(_code, { files }) {
                    Assert.strictEqual(files.size, Object.values(detectionCase.dest).length);
                },
                "prints exactly the four current artifact paths"(_code, { written }) {
                    Assert.deepStrictEqual(written, Object.values(detectionCase.dest).map(path => `${path}\n`));
                },
                "confines every filesystem mutation to the installed destination"(_code, { mutationPaths }) {
                    assertMutationsConfinedTo(mutationPaths, [detectionCase.destDir]);
                }
            }
        });
    }

    test("refreshes only installed destinations across scopes and tools", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            s.files.set(HOME_CODEX.spec, "old content");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "refreshes the installed project Claude destination"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.implement), implementSkillBody);
            },
            "refreshes the installed global Codex destination"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CODEX.implement), implementSkillBody);
            },
            "leaves the uninstalled project Codex destination untouched"(_code, { files }) {
                Assert.ok(!files.has(PROJ_CODEX.spec) && !files.has(PROJ_CODEX.plan) && !files.has(PROJ_CODEX.implement) && !files.has(PROJ_CODEX.hardStop));
            },
            "leaves the uninstalled global Claude destination untouched"(_code, { files }) {
                Assert.ok(!files.has(HOME_CLAUDE.spec) && !files.has(HOME_CLAUDE.plan) && !files.has(HOME_CLAUDE.implement) && !files.has(HOME_CLAUDE.hardStop));
            },
            "performs no filesystem mutation on either uninstalled destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CLAUDE_DIR, HOME_CODEX_DIR]);
            },
            "writes exactly the eight artifacts of the two installed destinations"(_code, { files }) {
                Assert.strictEqual(files.size, 8);
            },
            "prints exactly every written path across both refreshed destinations, one per line, in order, with no blank lines"(_code, { written }) {
                Assert.strictEqual(written.join(""), [
                    PROJ_CLAUDE.spec, PROJ_CLAUDE.plan, PROJ_CLAUDE.implement, PROJ_CLAUDE.hardStop,
                    HOME_CODEX.spec, HOME_CODEX.plan, HOME_CODEX.implement, HOME_CODEX.hardStop
                ].map(p => `${p}\n`).join(""));
            }
        }
    });
});

test.describe("Update with no installation", test => {
    test("errors directing the user to install and exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            const unrelatedPath = "/proj/.claude/skills/unrelated/SKILL.md";
            const expectedDetectionPaths = [
                ...skillArtifactPaths(PROJ, "claude"),
                ...skillArtifactPaths(PROJ, "codex"),
                ...skillArtifactPaths("/home/testuser", "claude"),
                ...skillArtifactPaths("/home/testuser", "codex")
            ];
            s.files.set(unrelatedPath, "unrelated content");
            return { ...s, unrelatedPath, expectedDetectionPaths };
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the install command exactly"(_code, { errors }) {
                Assert.ok(errors.join("").includes("npx flanders install"));
            },
            "writes nothing to standard output"(_code, { written }) {
                Assert.strictEqual(written.length, 0);
            },
            "leaves the unrelated artifact untouched"(_code, { files, unrelatedPath }) {
                Assert.deepStrictEqual([...files], [[unrelatedPath, "unrelated content"]]);
            },
            "performs no filesystem mutations"(_code, { mutationPaths }) {
                Assert.deepStrictEqual(mutationPaths, []);
            },
            "checks exactly the published artifact paths at all four destinations"(_code, { allPaths, expectedDetectionPaths }) {
                Assert.deepStrictEqual(allPaths, expectedDetectionPaths);
            }
        }
    });

    test("does not treat a legacy Codex prompt as an installed skill destination", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set("/proj/.codex/prompts/flanders-spec.md", "legacy content");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "leaves the legacy prompt untouched"(_code, { files }) {
                Assert.deepStrictEqual([...files], [["/proj/.codex/prompts/flanders-spec.md", "legacy content"]]);
            },
            "performs no filesystem mutation"(_code, { mutationPaths }) {
                Assert.deepStrictEqual(mutationPaths, []);
            }
        }
    });
});

test.describe("Update argument validation", test => {
    test("rejects unexpected arguments with an exact diagnostic and exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            // An installation exists, proving the rejection happens before any refresh is attempted.
            s.files.set(PROJ_CLAUDE.spec, "old content");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update(["--bogus"], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exactly the no-arguments message"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "The update command takes no arguments.\n");
            },
            "refreshes nothing"(_code, { files }) {
                // The pre-existing artifact is untouched and no skill set is written.
                Assert.strictEqual(files.get(PROJ_CLAUDE.spec), "old content");
            },
            "writes nothing to standard output"(_code, { written }) {
                Assert.strictEqual(written.length, 0);
            }
        }
    });
});

test.describe("Update configuration is left untouched", test => {
    test("neither reads nor writes any .flanders/config.json at any scope", {
        ARRANGE() {
            const s = stubContexts();
            // Installations and stored configs at both the project and the home scope, so a refresh
            // touches every scope while the configuration at each must stay untouched.
            s.files.set(PROJ_CLAUDE.spec, "old content");
            s.files.set(HOME_CODEX.spec, "old content");
            s.files.set("/proj/.flanders/config.json", "PROJECT CONFIG");
            s.files.set("/home/testuser/.flanders/config.json", "HOME CONFIG");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "leaves the project configuration content unchanged"(_code, { files }) {
                Assert.strictEqual(files.get("/proj/.flanders/config.json"), "PROJECT CONFIG");
            },
            "leaves the home configuration content unchanged"(_code, { files }) {
                Assert.strictEqual(files.get("/home/testuser/.flanders/config.json"), "HOME CONFIG");
            },
            "invokes no filesystem method with any .flanders/config.json path at any scope"(_code, { allPaths }) {
                // allPaths records the path passed to every FsContext method (readFile, writeFile,
                // rename, readdir, stat, exists, mkdir, mkdtemp, rm), so this proves update never
                // reaches a config file through any access — read, write, or otherwise.
                Assert.deepStrictEqual(allPaths.filter(p => p.endsWith("/.flanders/config.json")), []);
            }
        }
    });
});

test.describe("Update filesystem errors", test => {
    test("a write failure surfaces the path diagnostic and exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            (s.contexts.fs as { writeFile:(p:string, c:string) => Promise<void> }).writeFile = (p:string) => {
                return Promise.reject(new Error(`EACCES: ${p}`));
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exactly the Cannot write file message for the offending path"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), `Cannot write file: ${PROJ_CLAUDE.spec}\n`);
            }
        }
    });

    test("a mkdir failure surfaces the Cannot create destination diagnostic and exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            (s.contexts.fs as { mkdir:(p:string) => Promise<void> }).mkdir = (p:string) => {
                return Promise.reject(new Error(`EACCES: ${p}`));
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exactly the Cannot create destination message for the offending folder"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), `Cannot create destination: ${PROJ_CLAUDE_DIR}/flanders-spec\n`);
            }
        }
    });

    test("an exists failure is reported through the outer catch handler", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts.fs as { exists:(p:string) => Promise<boolean> }).exists = () => {
                return Promise.reject(new Error("disk gremlins"));
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the error message is written exactly"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "disk gremlins\n");
            }
        }
    });

    test("a non-Error throw is stringified through the outer catch handler", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts.fs as { exists:(p:string) => Promise<boolean> }).exists = () => {
                return Promise.reject("string failure value");
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the stringified value is written exactly"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "string failure value\n");
            }
        }
    });
});

test.describe("Update dispose", test => {
    test("dispose is idempotent", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            await cmd.result();
            await cmd.dispose();
            await cmd.dispose();
        },
        ASSERT() {}
    });

    test("a true detection result settled before disposal starts no artifact controller", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            let resolveDetection:(() => void)|null = null;
            (s.contexts.fs as { exists:typeof s.contexts.fs.exists }).exists = () => new Promise<boolean>(resolve => {
                resolveDetection = () => resolve(true);
            });
            return { ...s, getResolveDetection: () => resolveDetection };
        },
        async ACT({ contexts, getResolveDetection }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            while (!getResolveDetection()) {
                await new Promise(resolve => setTimeout(resolve, 1));
            }
            const disposePromise = cmd.dispose();
            getResolveDetection()!();
            await disposePromise;
            return await cmd.result();
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "leaves the detected artifact unchanged"(_code, { files }) {
                Assert.deepStrictEqual([...files], [[PROJ_CLAUDE.spec, "old content"]]);
            },
            "performs no filesystem mutation"(_code, { mutationPaths }) {
                Assert.deepStrictEqual(mutationPaths, []);
            },
            "prints no success paths"(_code, { written }) {
                Assert.deepStrictEqual(written, []);
            },
            "prints no diagnostic"(_code, { errors }) {
                Assert.deepStrictEqual(errors, []);
            }
        }
    });

    test("disposal after detection settles but before the scan observer resumes starts no artifact controller", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            let cmdRef:Update|null = null;
            (s.contexts.fs as { exists:typeof s.contexts.fs.exists }).exists = () =>
                settleThenSchedule(true, () => {
                    if (cmdRef !== null) {
                        void cmdRef.dispose();
                    }
                });
            return { ...s, setCmdRef: (cmd:Update) => { cmdRef = cmd; } };
        },
        async ACT({ contexts, setCmdRef }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            setCmdRef(cmd);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "leaves the detected artifact unchanged"(_code, { files }) {
                Assert.deepStrictEqual([...files], [[PROJ_CLAUDE.spec, "old content"]]);
            },
            "performs no filesystem mutation"(_code, { mutationPaths }) {
                Assert.deepStrictEqual(mutationPaths, []);
            },
            "prints no success paths"(_code, { written }) {
                Assert.deepStrictEqual(written, []);
            },
            "prints no diagnostic"(_code, { errors }) {
                Assert.deepStrictEqual(errors, []);
            }
        }
    });

    test("a settled successful emission cannot publish success after disposal", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            s.dirs.add("/proj/.claude");
            s.dirs.add(PROJ_CLAUDE_DIR);
            s.dirs.add(`${PROJ_CLAUDE_DIR}/flanders-spec`);
            return s;
        },
        async ACT({ contexts }) {
            let cmd:Update|null = null;
            const restoreAbortController = interceptAbortListenerRemoval(() => {
                if (cmd !== null) {
                    void cmd.dispose();
                }
            });
            try {
                cmd = new Update([], { projectRoot: PROJ }, contexts);
                return await cmd.result();
            } finally {
                if (cmd !== null) {
                    await cmd.dispose();
                }
                restoreAbortController();
            }
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "keeps the already-settled full skill set"(_code, { files }) {
                Assert.strictEqual(files.size, 4);
            },
            "prints no success paths"(_code, { written }) {
                Assert.deepStrictEqual(written, []);
            },
            "prints no diagnostic"(_code, { errors }) {
                Assert.deepStrictEqual(errors, []);
            }
        }
    });

    test("a settled emission failure is silent when disposal wins the await race", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            (s.contexts.fs as { mkdir:typeof s.contexts.fs.mkdir }).mkdir = () => Promise.reject(new Error("pathless failure"));
            return s;
        },
        async ACT({ contexts }) {
            let cmd:Update|null = null;
            const restoreAbortController = interceptAbortListenerRemoval(() => {
                if (cmd !== null) {
                    void cmd.dispose();
                }
            });
            try {
                cmd = new Update([], { projectRoot: PROJ }, contexts);
                return await cmd.result();
            } finally {
                if (cmd !== null) {
                    await cmd.dispose();
                }
                restoreAbortController();
            }
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "leaves the pre-existing artifact unchanged"(_code, { files }) {
                Assert.deepStrictEqual([...files], [[PROJ_CLAUDE.spec, "old content"]]);
            },
            "prints no filesystem diagnostic"(_code, { errors }) {
                Assert.deepStrictEqual(errors, []);
            },
            "prints no success paths"(_code, { written }) {
                Assert.deepStrictEqual(written, []);
            }
        }
    });

    test("disposed mid-write stops further writes and exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            s.dirs.add("/proj/.claude");
            s.dirs.add(PROJ_CLAUDE_DIR);
            s.dirs.add(`${PROJ_CLAUDE_DIR}/flanders-spec`);
            let writeCount = 0;
            let cmdRef:Update | null = null;
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = async (p, content) => {
                await origWriteFile(p, content);
                writeCount++;
                if (writeCount === 1 && cmdRef) {
                    void cmdRef.dispose();
                }
            };
            return { ...s, setCmdRef: (cmd:Update) => { cmdRef = cmd; } };
        },
        async ACT({ contexts, setCmdRef }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            setCmdRef(cmd);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "restores the overwritten first artifact"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.spec), "old content");
            },
            "preserves the destination directories that existed before emission"(_code, { dirs }) {
                Assert.deepStrictEqual([...dirs], ["/proj/.claude", PROJ_CLAUDE_DIR, `${PROJ_CLAUDE_DIR}/flanders-spec`]);
            },
            "the second artifact is not written"(_code, { files }) {
                Assert.ok(!files.has(PROJ_CLAUDE.plan));
            },
            "no diagnostic is written for a disposal"(_code, { errors }) {
                Assert.strictEqual(errors.length, 0);
            }
        }
    });

    test("disposed as the final write completes exits non-zero with no success output", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(HOME_CODEX.spec, "old content");
            s.dirs.add("/home/testuser/.agents");
            s.dirs.add(HOME_CODEX_DIR);
            s.dirs.add(`${HOME_CODEX_DIR}/flanders-spec`);
            let writeCount = 0;
            let cmdRef:Update | null = null;
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = async (p, content) => {
                await origWriteFile(p, content);
                writeCount++;
                if (writeCount === 4 && cmdRef) {
                    void cmdRef.dispose();
                }
            };
            return { ...s, setCmdRef: (cmd:Update) => { cmdRef = cmd; } };
        },
        async ACT({ contexts, setCmdRef }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            setCmdRef(cmd);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "restores the destination to its pre-emission state"(_code, { files }) {
                Assert.deepStrictEqual([...files], [[HOME_CODEX.spec, "old content"]]);
            },
            "restores the original destination directory set"(_code, { dirs }) {
                Assert.deepStrictEqual([...dirs], ["/home/testuser/.agents", HOME_CODEX_DIR, `${HOME_CODEX_DIR}/flanders-spec`]);
            },
            "prints nothing to standard output"(_code, { written }) {
                Assert.strictEqual(written.length, 0);
            },
            "writes no diagnostic for a disposal"(_code, { errors }) {
                Assert.strictEqual(errors.length, 0);
            }
        }
    });

    test("disposed between destinations stops the scan and exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            let resolveFirst:(() => void) | null = null;
            let callCount = 0;
            (s.contexts.fs as { exists:(p:string) => Promise<boolean> }).exists = (p:string) => {
                callCount++;
                if (callCount === 1) {
                    return new Promise<boolean>(resolve => { resolveFirst = () => resolve(false); });
                }
                return Promise.resolve(s.files.has(p) || s.dirs.has(p));
            };
            return { ...s, getResolveFirst: () => resolveFirst };
        },
        async ACT({ contexts, getResolveFirst }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            while (!getResolveFirst()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolveFirst()!();
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "writes no artifacts after disposal"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            },
            "prints no no-install diagnostic"(_code, { errors }) {
                Assert.deepStrictEqual(errors, []);
            },
            "prints no success paths"(_code, { written }) {
                Assert.deepStrictEqual(written, []);
            }
        }
    });

    test("an exception during a disposed run is silent", {
        ARRANGE() {
            const s = stubContexts();
            let rejectFirst:(() => void) | null = null;
            let callCount = 0;
            (s.contexts.fs as { exists:(p:string) => Promise<boolean> }).exists = () => {
                callCount++;
                if (callCount === 1) {
                    return new Promise<boolean>((_resolve, reject) => { rejectFirst = () => reject(new Error("late failure")); });
                }
                /* coverage ignore next */ // — Defensive: the run is disposed after the first existence check, so no later check runs.
                return Promise.resolve(false);
            };
            return { ...s, getRejectFirst: () => rejectFirst };
        },
        async ACT({ contexts, getRejectFirst }) {
            const cmd = new Update([], { projectRoot: PROJ }, contexts);
            while (!getRejectFirst()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            // Reject the first existence check — _run enters the catch block with _disposed already set.
            getRejectFirst()!();
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no error is written when disposed"(_code, { errors }) {
                Assert.strictEqual(errors.length, 0);
            }
        }
    });
});
