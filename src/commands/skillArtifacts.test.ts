import * as Assert from "assert";

import test from "arrange-act-assert";

import { writeSkillArtifacts, stripYamlFrontmatter } from "./skillArtifacts";
import type { FsContext } from "../contexts";
import { planSkillBody, specSkillBody, workSkillBody } from "../prompts/skills";

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
        rm() { return Promise.reject(new Error("unexpected rm")); }
    };
    return { fs, files, dirs, ops };
}

test.describe("writeSkillArtifacts claude", test => {
    test("writes the claude trio under <scopeRoot>/.claude/skills/<name>/SKILL.md", {
        ARRANGE() {
            return stubFs();
        },
        ACT({ fs }) {
            return writeSkillArtifacts(fs, "/root", "claude", () => false);
        },
        ASSERTS: {
            "returns ok:true with the three SKILL.md paths in skill order"(result) {
                Assert.deepStrictEqual(result, {
                    ok: true,
                    writtenPaths: [
                        "/root/.claude/skills/flanders-spec/SKILL.md",
                        "/root/.claude/skills/flanders-plan/SKILL.md",
                        "/root/.claude/skills/flanders-work/SKILL.md"
                    ]
                });
            },
            "writes the spec body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.claude/skills/flanders-spec/SKILL.md"), specSkillBody);
            },
            "writes the plan body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.claude/skills/flanders-plan/SKILL.md"), planSkillBody);
            },
            "writes the work body verbatim"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.claude/skills/flanders-work/SKILL.md"), workSkillBody);
            },
            "writes exactly three files"(_result, { files }) {
                Assert.strictEqual(files.size, 3);
            },
            "creates each per-skill folder recursively, immediately before writing its SKILL.md, in order"(_result, { ops }) {
                Assert.deepStrictEqual(ops, [
                    "mkdir /root/.claude/skills/flanders-spec recursive=true",
                    "writeFile /root/.claude/skills/flanders-spec/SKILL.md",
                    "mkdir /root/.claude/skills/flanders-plan recursive=true",
                    "writeFile /root/.claude/skills/flanders-plan/SKILL.md",
                    "mkdir /root/.claude/skills/flanders-work recursive=true",
                    "writeFile /root/.claude/skills/flanders-work/SKILL.md"
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
            return writeSkillArtifacts(fs, "/root", "claude", () => false);
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
            return writeSkillArtifacts(fs, "/root", "claude", () => false);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Cannot write file: /root/.claude/skills/flanders-spec/SKILL.md\n"
            });
        }
    });

    test("disposal mid-write stops further writes and returns ok:false with a null diagnostic", {
        ARRANGE() {
            let calls = 0;
            const isDisposed = () => (++calls) > 1;
            return { ...stubFs(), isDisposed };
        },
        ACT({ fs, isDisposed }) {
            return writeSkillArtifacts(fs, "/root", "claude", isDisposed);
        },
        ASSERTS: {
            "returns ok:false with a null diagnostic"(result) {
                Assert.deepStrictEqual(result, { ok: false, diagnostic: null });
            },
            "writes the first skill before disposal"(_result, { files }) {
                Assert.ok(files.has("/root/.claude/skills/flanders-spec/SKILL.md"));
            },
            "does not write the second skill after disposal"(_result, { files }) {
                Assert.ok(!files.has("/root/.claude/skills/flanders-plan/SKILL.md"));
            }
        }
    });
});

test.describe("writeSkillArtifacts codex", test => {
    test("writes the codex trio under <scopeRoot>/.codex/prompts/<name>.md with frontmatter stripped", {
        ARRANGE() {
            return stubFs();
        },
        ACT({ fs }) {
            return writeSkillArtifacts(fs, "/root", "codex", () => false);
        },
        ASSERTS: {
            "returns ok:true with the three prompt paths in skill order"(result) {
                Assert.deepStrictEqual(result, {
                    ok: true,
                    writtenPaths: [
                        "/root/.codex/prompts/flanders-spec.md",
                        "/root/.codex/prompts/flanders-plan.md",
                        "/root/.codex/prompts/flanders-work.md"
                    ]
                });
            },
            "writes the spec body with frontmatter stripped"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.codex/prompts/flanders-spec.md"), stripYamlFrontmatter(specSkillBody));
            },
            "writes the plan body with frontmatter stripped"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.codex/prompts/flanders-plan.md"), stripYamlFrontmatter(planSkillBody));
            },
            "writes the work body with frontmatter stripped"(_result, { files }) {
                Assert.strictEqual(files.get("/root/.codex/prompts/flanders-work.md"), stripYamlFrontmatter(workSkillBody));
            },
            "writes exactly three files"(_result, { files }) {
                Assert.strictEqual(files.size, 3);
            },
            "creates the prompts root recursively before writing the three prompts, in order"(_result, { ops }) {
                Assert.deepStrictEqual(ops, [
                    "mkdir /root/.codex/prompts recursive=true",
                    "writeFile /root/.codex/prompts/flanders-spec.md",
                    "writeFile /root/.codex/prompts/flanders-plan.md",
                    "writeFile /root/.codex/prompts/flanders-work.md"
                ]);
            }
        }
    });

    test("a prompts-root mkdir failure returns the exact Cannot create destination diagnostic and writes nothing", {
        ARRANGE() {
            const s = stubFs();
            (s.fs as { mkdir:FsContext["mkdir"] }).mkdir = (p:string) => Promise.reject(new Error(`EACCES: ${p}`));
            return s;
        },
        ACT({ fs }) {
            return writeSkillArtifacts(fs, "/root", "codex", () => false);
        },
        ASSERTS: {
            "returns the exact offending-path diagnostic"(result) {
                Assert.deepStrictEqual(result, {
                    ok: false,
                    diagnostic: "Cannot create destination: /root/.codex/prompts\n"
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
            return writeSkillArtifacts(fs, "/root", "codex", () => false);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Cannot write file: /root/.codex/prompts/flanders-spec.md\n"
            });
        }
    });

    test("disposal mid-write stops further writes and returns ok:false with a null diagnostic", {
        ARRANGE() {
            let calls = 0;
            const isDisposed = () => (++calls) > 1;
            return { ...stubFs(), isDisposed };
        },
        ACT({ fs, isDisposed }) {
            return writeSkillArtifacts(fs, "/root", "codex", isDisposed);
        },
        ASSERTS: {
            "returns ok:false with a null diagnostic"(result) {
                Assert.deepStrictEqual(result, { ok: false, diagnostic: null });
            },
            "writes the first prompt before disposal"(_result, { files }) {
                Assert.ok(files.has("/root/.codex/prompts/flanders-spec.md"));
            },
            "does not write the second prompt after disposal"(_result, { files }) {
                Assert.ok(!files.has("/root/.codex/prompts/flanders-plan.md"));
            }
        }
    });
});
