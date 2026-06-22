import * as Assert from "assert";

import test from "arrange-act-assert";

import { Update } from "./Update";
import type { UpdateContexts } from "./Update";
import { stripYamlFrontmatter } from "./skillArtifacts";
import { planSkillBody, specSkillBody, workSkillBody } from "../prompts/skills";

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
            rm(p) { allPaths.push(p); mutationPaths.push(p); return Promise.reject(new Error("unexpected rm")); }
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
const PROJ_CODEX_DIR = "/proj/.codex/prompts";
const HOME_CLAUDE_DIR = "/home/testuser/.claude/skills";
const HOME_CODEX_DIR = "/home/testuser/.codex/prompts";

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
    work: "/proj/.claude/skills/flanders-work/SKILL.md"
};
const PROJ_CODEX = {
    spec: "/proj/.codex/prompts/flanders-spec.md",
    plan: "/proj/.codex/prompts/flanders-plan.md",
    work: "/proj/.codex/prompts/flanders-work.md"
};
const HOME_CLAUDE = {
    spec: "/home/testuser/.claude/skills/flanders-spec/SKILL.md",
    plan: "/home/testuser/.claude/skills/flanders-plan/SKILL.md",
    work: "/home/testuser/.claude/skills/flanders-work/SKILL.md"
};
const HOME_CODEX = {
    spec: "/home/testuser/.codex/prompts/flanders-spec.md",
    plan: "/home/testuser/.codex/prompts/flanders-plan.md",
    work: "/home/testuser/.codex/prompts/flanders-work.md"
};

test.describe("Update refresh by scope and tool", test => {
    test("refreshes a project-scope Claude installation to the full trio", {
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
            "rewrites the work skill with the current body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.work), workSkillBody);
            },
            "writes exactly the three Claude artifacts"(_code, { files }) {
                Assert.strictEqual(files.size, 3);
            },
            "prints exactly the three written paths, one per line, with no blank lines"(_code, { written }) {
                Assert.strictEqual(written.join(""), [PROJ_CLAUDE.spec, PROJ_CLAUDE.plan, PROJ_CLAUDE.work].map(p => `${p}\n`).join(""));
            },
            "produces no errors"(_code, { errors }) {
                Assert.strictEqual(errors.length, 0);
            },
            "confines every filesystem mutation to the installed project Claude destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CLAUDE_DIR]);
            }
        }
    });

    test("refreshes a project-scope Codex installation with frontmatter stripped", {
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
            "rewrites the spec prompt with the stripped body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.spec), stripYamlFrontmatter(specSkillBody));
            },
            "rewrites the plan prompt with the stripped body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.plan), stripYamlFrontmatter(planSkillBody));
            },
            "rewrites the work prompt with the stripped body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.work), stripYamlFrontmatter(workSkillBody));
            },
            "writes exactly the three Codex artifacts"(_code, { files }) {
                Assert.strictEqual(files.size, 3);
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
            "rewrites the work skill under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CLAUDE.work), workSkillBody);
            },
            "writes exactly the three global Claude artifacts"(_code, { files }) {
                Assert.strictEqual(files.size, 3);
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
            "rewrites the spec prompt under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CODEX.spec), stripYamlFrontmatter(specSkillBody));
            },
            "rewrites the plan prompt under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CODEX.plan), stripYamlFrontmatter(planSkillBody));
            },
            "rewrites the work prompt under the home directory"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CODEX.work), stripYamlFrontmatter(workSkillBody));
            },
            "writes exactly the three global Codex artifacts"(_code, { files }) {
                Assert.strictEqual(files.size, 3);
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
            "rewrites the Claude trio"(_code, { files }) {
                Assert.ok(files.has(PROJ_CLAUDE.spec) && files.has(PROJ_CLAUDE.plan) && files.has(PROJ_CLAUDE.work));
            },
            "rewrites the Codex trio"(_code, { files }) {
                Assert.ok(files.has(PROJ_CODEX.spec) && files.has(PROJ_CODEX.plan) && files.has(PROJ_CODEX.work));
            },
            "writes exactly the six artifacts across both tools"(_code, { files }) {
                Assert.strictEqual(files.size, 6);
            },
            "prints exactly every written path across both tools, one per line, in order, with no blank lines"(_code, { written }) {
                Assert.strictEqual(written.join(""), [
                    PROJ_CLAUDE.spec, PROJ_CLAUDE.plan, PROJ_CLAUDE.work,
                    PROJ_CODEX.spec, PROJ_CODEX.plan, PROJ_CODEX.work
                ].map(p => `${p}\n`).join(""));
            },
            "confines every filesystem mutation to the two installed project destinations"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CLAUDE_DIR, PROJ_CODEX_DIR]);
            }
        }
    });

    test("completes a Claude installation detected via the plan artifact", {
        ARRANGE() {
            const s = stubContexts();
            // Only the plan artifact is present — detection must still find the installation.
            s.files.set(PROJ_CLAUDE.plan, "old content");
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
            "adds the missing spec artifact"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.spec), specSkillBody);
            },
            "rewrites the pre-existing plan artifact rather than leaving it stale"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.plan), planSkillBody);
            },
            "adds the missing work artifact"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.work), workSkillBody);
            },
            "ends holding the complete trio"(_code, { files }) {
                Assert.strictEqual(files.size, 3);
            },
            "confines every filesystem mutation to the installed project Claude destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CLAUDE_DIR]);
            }
        }
    });

    test("completes a Claude installation detected via the work artifact", {
        ARRANGE() {
            const s = stubContexts();
            // Only the last artifact is present — detection must still find the installation.
            s.files.set(PROJ_CLAUDE.work, "old content");
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
            "adds the missing spec artifact"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.spec), specSkillBody);
            },
            "adds the missing plan artifact"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.plan), planSkillBody);
            },
            "rewrites the pre-existing work artifact rather than leaving it stale"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.work), workSkillBody);
            },
            "ends holding the complete trio"(_code, { files }) {
                Assert.strictEqual(files.size, 3);
            },
            "confines every filesystem mutation to the installed project Claude destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CLAUDE_DIR]);
            }
        }
    });

    test("completes a Codex installation detected via the plan artifact", {
        ARRANGE() {
            const s = stubContexts();
            // Only the middle Codex artifact is present — detection must still find the installation.
            s.files.set(PROJ_CODEX.plan, "old content");
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
            "adds the missing spec prompt with the stripped body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.spec), stripYamlFrontmatter(specSkillBody));
            },
            "rewrites the pre-existing plan prompt rather than leaving it stale"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.plan), stripYamlFrontmatter(planSkillBody));
            },
            "adds the missing work prompt with the stripped body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.work), stripYamlFrontmatter(workSkillBody));
            },
            "ends holding the complete Codex trio"(_code, { files }) {
                Assert.strictEqual(files.size, 3);
            },
            "confines every filesystem mutation to the installed project Codex destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CODEX_DIR]);
            }
        }
    });

    test("completes a Codex installation detected via the work artifact", {
        ARRANGE() {
            const s = stubContexts();
            // Only the last Codex artifact is present — detection must still find the installation.
            s.files.set(PROJ_CODEX.work, "old content");
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
            "adds the missing spec prompt with the stripped body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.spec), stripYamlFrontmatter(specSkillBody));
            },
            "adds the missing plan prompt with the stripped body"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.plan), stripYamlFrontmatter(planSkillBody));
            },
            "rewrites the pre-existing work prompt rather than leaving it stale"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CODEX.work), stripYamlFrontmatter(workSkillBody));
            },
            "ends holding the complete Codex trio"(_code, { files }) {
                Assert.strictEqual(files.size, 3);
            },
            "confines every filesystem mutation to the installed project Codex destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CODEX_DIR]);
            }
        }
    });

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
                Assert.strictEqual(files.get(PROJ_CLAUDE.work), workSkillBody);
            },
            "refreshes the installed global Codex destination"(_code, { files }) {
                Assert.strictEqual(files.get(HOME_CODEX.work), stripYamlFrontmatter(workSkillBody));
            },
            "leaves the uninstalled project Codex destination untouched"(_code, { files }) {
                Assert.ok(!files.has(PROJ_CODEX.spec) && !files.has(PROJ_CODEX.plan) && !files.has(PROJ_CODEX.work));
            },
            "leaves the uninstalled global Claude destination untouched"(_code, { files }) {
                Assert.ok(!files.has(HOME_CLAUDE.spec) && !files.has(HOME_CLAUDE.plan) && !files.has(HOME_CLAUDE.work));
            },
            "performs no filesystem mutation on either uninstalled destination"(_code, { mutationPaths }) {
                assertMutationsConfinedTo(mutationPaths, [PROJ_CLAUDE_DIR, HOME_CODEX_DIR]);
            },
            "writes exactly the six artifacts of the two installed destinations"(_code, { files }) {
                Assert.strictEqual(files.size, 6);
            },
            "prints exactly every written path across both refreshed destinations, one per line, in order, with no blank lines"(_code, { written }) {
                Assert.strictEqual(written.join(""), [
                    PROJ_CLAUDE.spec, PROJ_CLAUDE.plan, PROJ_CLAUDE.work,
                    HOME_CODEX.spec, HOME_CODEX.plan, HOME_CODEX.work
                ].map(p => `${p}\n`).join(""));
            }
        }
    });
});

test.describe("Update with no installation", test => {
    test("errors directing the user to install and exits non-zero", {
        ARRANGE() {
            return stubContexts();
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
            "writes no skill artifacts"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
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
                // The pre-existing artifact is untouched and no trio is written.
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

    test("disposed mid-write stops further writes and exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set(PROJ_CLAUDE.spec, "old content");
            let writeCount = 0;
            let cmdRef:Update | null = null;
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = async (p, content) => {
                await origWriteFile(p, content);
                writeCount++;
                if (writeCount === 1 && cmdRef) {
                    // Dispose but do NOT await — it waits on _runPromise which is currently executing.
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
            "the first artifact is written"(_code, { files }) {
                Assert.strictEqual(files.get(PROJ_CLAUDE.spec), specSkillBody);
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
            // Only the last destination (home Codex) is installed, so its three writes are the run's
            // last action; disposing after the third write lets writeSkillArtifacts return ok before
            // the post-write disposal guard runs.
            s.files.set(HOME_CODEX.spec, "old content");
            let writeCount = 0;
            let cmdRef:Update | null = null;
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = async (p, content) => {
                await origWriteFile(p, content);
                writeCount++;
                if (writeCount === 3 && cmdRef) {
                    // Dispose after the final artifact write completes but do NOT await it.
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
            "the full trio was written before disposal landed"(_code, { files }) {
                Assert.ok(files.has(HOME_CODEX.spec) && files.has(HOME_CODEX.plan) && files.has(HOME_CODEX.work));
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
            // Resolve the first existence check so the scan continues into the next destination's guard.
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
