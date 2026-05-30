import * as Assert from "assert";

import test from "arrange-act-assert";

import { Install, parseInstallFlags } from "./Install";
import type { InstallContexts } from "./Install";
import type { AskAnswer, ScriptContext, SpawnedProcess } from "../contexts";
import { planSkillBody, specSkillBody } from "../skills";

function stubContexts() {
    const written:string[] = [];
    const errors:string[] = [];
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const askResponses:AskAnswer[][] = [];
    const contexts:InstallContexts = {
        fs: {
            readFile(p) { return files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error("not found")); },
            writeFile(p, content) { files.set(p, content); return Promise.resolve(); },
            rename() { return Promise.resolve(); },
            readdir() { return Promise.resolve([]); },
            stat() { return Promise.reject(new Error("unexpected stat")); },
            exists(p) { return Promise.resolve(files.has(p) || dirs.has(p)); },
            mkdir(p) { dirs.add(p); return Promise.resolve(); },
            mkdtemp() { return Promise.reject(new Error("unexpected mkdtemp")); },
            rm() { return Promise.reject(new Error("unexpected rm")); }
        },
        ask: {
            askChoices() {
                const response = askResponses.shift();
                return Promise.resolve(response ?? []);
            },
            askText() { return Promise.resolve(""); }
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
        },
        script: {
            spawn():SpawnedProcess {
                let exitListener:((code:number|null, signal:string|null) => void)|null = null;
                const proc:SpawnedProcess = {
                    on(event:"exit"|"error", listener:never) {
                        if (event === "exit") {
                            exitListener = listener;
                            Promise.resolve().then(() => exitListener?.(0, null));
                        }
                    },
                    kill() {},
                    stdout: { on() {} },
                    stderr: { on() {} }
                };
                return proc;
            }
        }
    };
    return { contexts, written, errors, files, dirs, askResponses };
}

test.describe("Install --project", test => {
    test("writes SKILL.md files under projectRoot/.claude/skills/<skill>/", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project"], { projectRoot: "/myproject" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "creates spec skill file"(_code, { files }) {
                Assert.ok(files.has("/myproject/.claude/skills/flanders-spec/SKILL.md"));
            },
            "creates plan skill file"(_code, { files }) {
                Assert.ok(files.has("/myproject/.claude/skills/flanders-plan/SKILL.md"));
            },
            "spec skill file has correct body"(_code, { files }) {
                Assert.strictEqual(files.get("/myproject/.claude/skills/flanders-spec/SKILL.md"), specSkillBody);
            },
            "plan skill file has correct body"(_code, { files }) {
                Assert.strictEqual(files.get("/myproject/.claude/skills/flanders-plan/SKILL.md"), planSkillBody);
            },
            "writes exactly 2 files"(_code, { files }) {
                Assert.strictEqual(files.size, 2);
            },
            "stdout includes spec skill path"(_code, { written }) {
                Assert.ok(written.join("").includes("/myproject/.claude/skills/flanders-spec/SKILL.md"));
            },
            "stdout includes plan skill path"(_code, { written }) {
                Assert.ok(written.join("").includes("/myproject/.claude/skills/flanders-plan/SKILL.md"));
            }
        }
    });

    test("prints one path per line in stdout", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project"], { projectRoot: "/proj" }, contexts);
            await cmd.result();
            await cmd.dispose();
        },
        ASSERTS: {
            "outputs exactly 2 lines"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.strictEqual(lines.length, 2);
            },
            "first line includes spec skill path"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.ok(lines[0]!.includes("flanders-spec/SKILL.md"));
            },
            "second line includes plan skill path"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.ok(lines[1]!.includes("flanders-plan/SKILL.md"));
            }
        }
    });
});

test.describe("Install --global", test => {
    test("writes SKILL.md files under homedir/.claude/skills/<skill>/", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--global"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "creates spec skill file"(_code, { files }) {
                Assert.ok(files.has("/home/testuser/.claude/skills/flanders-spec/SKILL.md"));
            },
            "creates plan skill file"(_code, { files }) {
                Assert.ok(files.has("/home/testuser/.claude/skills/flanders-plan/SKILL.md"));
            },
            "spec skill file has correct body"(_code, { files }) {
                Assert.strictEqual(files.get("/home/testuser/.claude/skills/flanders-spec/SKILL.md"), specSkillBody);
            },
            "writes exactly 2 files"(_code, { files }) {
                Assert.strictEqual(files.size, 2);
            },
            "stdout includes spec skill path"(_code, { written }) {
                Assert.ok(written.join("").includes("/home/testuser/.claude/skills/flanders-spec/SKILL.md"));
            },
            "stdout includes plan skill path"(_code, { written }) {
                Assert.ok(written.join("").includes("/home/testuser/.claude/skills/flanders-plan/SKILL.md"));
            }
        }
    });
});

test.describe("Install --global --project conflict", test => {
    test("exits non-zero with diagnostic naming the conflict", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--global", "--project"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with non-zero code"(code) {
                Assert.notStrictEqual(code, 0);
            },
            "diagnostic names --global"(_code, { errors }) {
                Assert.ok(errors.join("").includes("--global"));
            },
            "diagnostic names --project"(_code, { errors }) {
                Assert.ok(errors.join("").includes("--project"));
            },
            "no files are written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });
});

test.describe("Install interactive prompt", test => {
    test("prompts when neither flag given and user picks project", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "project" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "creates spec skill file under project"(_code, { files }) {
                Assert.ok(files.has("/proj/.claude/skills/flanders-spec/SKILL.md"));
            },
            "creates plan skill file under project"(_code, { files }) {
                Assert.ok(files.has("/proj/.claude/skills/flanders-plan/SKILL.md"));
            },
            "writes exactly 2 files"(_code, { files }) {
                Assert.strictEqual(files.size, 2);
            }
        }
    });

    test("prompts when neither flag given and user picks global", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "global" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "creates spec skill file under homedir"(_code, { files }) {
                Assert.ok(files.has("/home/testuser/.claude/skills/flanders-spec/SKILL.md"));
            },
            "creates plan skill file under homedir"(_code, { files }) {
                Assert.ok(files.has("/home/testuser/.claude/skills/flanders-plan/SKILL.md"));
            },
            "writes exactly 2 files"(_code, { files }) {
                Assert.strictEqual(files.size, 2);
            }
        }
    });

    test("prompt offers exactly two options: project and global", {
        ARRANGE() {
            const s = stubContexts();
            let capturedOptions:readonly { label:string }[] = [];
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions) => {
                capturedOptions = questions[0]!.options;
                s.askResponses.push([{ picked: [{ label: "project" }] }]);
                return origAsk.call(s.contexts.ask, questions);
            };
            return { ...s, getCapturedOptions: () => capturedOptions };
        },
        async ACT({ contexts }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            await cmd.result();
            await cmd.dispose();
        },
        ASSERTS: {
            "offers exactly 2 options"(_, { getCapturedOptions }) {
                Assert.strictEqual(getCapturedOptions().length, 2);
            },
            "first option is project"(_, { getCapturedOptions }) {
                Assert.strictEqual(getCapturedOptions()[0]!.label, "project");
            },
            "second option is global"(_, { getCapturedOptions }) {
                Assert.strictEqual(getCapturedOptions()[1]!.label, "global");
            }
        }
    });
});

test.describe("Install filesystem errors", test => {
    test("mkdir failure exits non-zero with path in diagnostic", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts.fs as { mkdir:(p:string) => Promise<void> }).mkdir = (p:string) => {
                return Promise.reject(new Error(`EACCES: ${p}`));
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with non-zero code"(code) {
                Assert.notStrictEqual(code, 0);
            },
            "diagnostic names the path"(_code, { errors }) {
                Assert.ok(errors.join("").includes("/proj/.claude/skills/flanders-spec"));
            }
        }
    });

    test("writeFile failure exits non-zero with path in diagnostic", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts.fs as { writeFile:(p:string, c:string) => Promise<void> }).writeFile = (p:string) => {
                return Promise.reject(new Error(`EACCES: ${p}`));
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with non-zero code"(code) {
                Assert.notStrictEqual(code, 0);
            },
            "diagnostic names the file path"(_code, { errors }) {
                Assert.ok(errors.join("").includes("/SKILL.md"));
            }
        }
    });
});

test.describe("Install overwrites", test => {
    test("silently overwrites existing files", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set("/proj/.claude/skills/flanders-spec/SKILL.md", "old content");
            s.files.set("/proj/.claude/skills/flanders-plan/SKILL.md", "old content");
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "spec skill file is overwritten with correct body"(_code, { files }) {
                Assert.strictEqual(files.get("/proj/.claude/skills/flanders-spec/SKILL.md"), specSkillBody);
            },
            "plan skill file is overwritten with correct body"(_code, { files }) {
                Assert.strictEqual(files.get("/proj/.claude/skills/flanders-plan/SKILL.md"), planSkillBody);
            }
        }
    });
});

test.describe("Install dispose", test => {
    test("dispose is idempotent", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project"], { projectRoot: "/proj" }, contexts);
            await cmd.result();
            await cmd.dispose();
            await cmd.dispose();
        },
        ASSERT() {}
    });

    test("disposed during interactive prompt returns 1", {
        ARRANGE() {
            const s = stubContexts();
            let resolvePrompt:((v:readonly AskAnswer[]) => void) | null = null;
            (s.contexts.ask as { askChoices:typeof s.contexts.ask.askChoices }).askChoices = () => {
                return new Promise<readonly AskAnswer[]>(resolve => {
                    resolvePrompt = resolve;
                });
            };
            return { ...s, getResolvePrompt: () => resolvePrompt };
        },
        async ACT({ contexts, getResolvePrompt }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            // Wait for the prompt to be called
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            // Start dispose (sets _disposed = true) but do NOT await — it waits on _runPromise
            const disposePromise = cmd.dispose();
            // Resolve the prompt so _run can continue and hit the post-prompt disposed guard
            getResolvePrompt()!([{ picked: [{ label: "project" }] }]);
            // Now _run will return 1 due to disposed check, and dispose can finish
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("prompt returns empty picked array returns 1", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files are written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("prompt returns no answer returns 1", {
        ARRANGE() {
            const s = stubContexts();
            // askResponses is empty, so askChoices returns [] — answer will be undefined
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("disposed during install loop returns 1", {
        ARRANGE() {
            const s = stubContexts();
            let writeCount = 0;
            let cmdRef:Install | null = null;
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = async (p, content) => {
                await origWriteFile(p, content);
                writeCount++;
                if (writeCount === 1 && cmdRef) {
                    // Call dispose but do NOT await — it waits on _runPromise which is currently executing
                    void cmdRef.dispose();
                }
            };
            return { ...s, setCmdRef: (cmd:Install) => { cmdRef = cmd; } };
        },
        async ACT({ contexts, setCmdRef }) {
            const cmd = new Install(["--project"], { projectRoot: "/proj" }, contexts);
            setCmdRef(cmd);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "first skill file is written"(_code, { files }) {
                Assert.ok(files.has("/proj/.claude/skills/flanders-spec/SKILL.md"));
            },
            "second skill file is not written"(_code, { files }) {
                Assert.ok(!files.has("/proj/.claude/skills/flanders-plan/SKILL.md"));
            }
        }
    });

    test("unexpected Error throw in askChoices hits outer catch handler", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts.ask as { askChoices:typeof s.contexts.ask.askChoices }).askChoices = () => {
                throw new Error("unexpected failure");
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "error message is written"(_code, { errors }) {
                Assert.ok(errors.join("").includes("unexpected failure"));
            }
        }
    });

    test("non-Error throw in askChoices hits outer catch handler with String(e)", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts.ask as { askChoices:typeof s.contexts.ask.askChoices }).askChoices = () => {
                throw "string error value";
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "error message includes the string value"(_code, { errors }) {
                Assert.ok(errors.join("").includes("string error value"));
            }
        }
    });

    test("outer catch handler is silent when disposed", {
        ARRANGE() {
            const s = stubContexts();
            let resolvePrompt:((v:readonly AskAnswer[]) => void) | null = null;
            (s.contexts.ask as { askChoices:typeof s.contexts.ask.askChoices }).askChoices = () => {
                return new Promise<readonly AskAnswer[]>((_resolve, reject) => {
                    resolvePrompt = () => reject(new Error("late rejection"));
                });
            };
            return { ...s, getResolvePrompt: () => resolvePrompt };
        },
        async ACT({ contexts, getResolvePrompt }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            // Wait for the prompt to be called
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            // Start dispose (sets _disposed = true)
            const disposePromise = cmd.dispose();
            // Reject the prompt — _run will enter the catch block with _disposed = true
            getResolvePrompt()!([]);
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

    test("disposed during availability check returns 1", {
        ARRANGE() {
            const s = stubContexts();
            let cmdRef:Install|null = null;
            let resolveSpawn:(() => void)|null = null;
            (s.contexts as { script:ScriptContext }).script = {
                spawn():SpawnedProcess {
                    let exitListener:((code:number|null, signal:string|null) => void)|null = null;
                    const proc:SpawnedProcess = {
                        on(event:"exit"|"error", listener:never) {
                            if (event === "exit") {
                                exitListener = listener;
                                resolveSpawn = () => exitListener?.(0, null);
                            }
                        },
                        kill() {},
                        stdout: { on() {} },
                        stderr: { on() {} }
                    };
                    return proc;
                }
            };
            return { ...s, setCmdRef: (cmd:Install) => { cmdRef = cmd; }, getResolveSpawn: () => resolveSpawn, getCmdRef: () => cmdRef };
        },
        async ACT({ contexts, setCmdRef, getResolveSpawn }) {
            const cmd = new Install(["--project", "--worker-tool=claude"], { projectRoot: "/proj" }, contexts);
            setCmdRef(cmd);
            while (!getResolveSpawn()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolveSpawn()!();
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files are written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });
});

test.describe("parseInstallFlags", test => {
    test("recognizes every flag and returns ResolvedAnswers", {
        ARRANGE() {
            return {
                args: [
                    "--project",
                    "--skills-tool=both",
                    "--worker-tool=codex",
                    "--worker-model=gpt-4",
                    "--worker-effort=high",
                    "--reviewer-tool=claude",
                    "--reviewer-model=opus",
                    "--reviewer-effort="
                ]
            };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: {
                    scope: "project",
                    skillsTool: "both",
                    workerTool: "codex",
                    workerModel: "gpt-4",
                    workerEffort: "high",
                    reviewerTool: "claude",
                    reviewerModel: "opus",
                    reviewerEffort: ""
                }
            });
        }
    });

    test("--global --project conflict returns exact diagnostic", {
        ARRANGE() {
            return { args: ["--global", "--project"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Conflicting flags: --global and --project cannot be used together.\n"
            });
        }
    });

    test("--worker-tool=foo returns diagnostic naming flag and value", {
        ARRANGE() {
            return { args: ["--worker-tool=foo"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid value for --worker-tool: \"foo\". Allowed values: claude, codex.\n"
            });
        }
    });

    test("--worker-model= accepts empty string as resolved answer", {
        ARRANGE() {
            return { args: ["--worker-model="] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { workerModel: "" }
            });
        }
    });

    test("--skills-tool=cursor is a usage error", {
        ARRANGE() {
            return { args: ["--skills-tool=cursor"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid value for --skills-tool: \"cursor\". Allowed values: claude, codex, both.\n"
            });
        }
    });

    test("--worker-effort=high with --worker-tool=codex are both accepted", {
        ARRANGE() {
            return { args: ["--worker-effort=high", "--worker-tool=codex"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { workerTool: "codex", workerEffort: "high" }
            });
        }
    });

    test("--worker-effort=high with --worker-tool=claude are both accepted (install does not pre-reject)", {
        ARRANGE() {
            return { args: ["--worker-effort=high", "--worker-tool=claude"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { workerTool: "claude", workerEffort: "high" }
            });
        }
    });

    test("no flags returns empty answers", {
        ARRANGE() {
            return { args: [] as string[] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { ok: true, answers: {} });
        }
    });

    test("--global sets scope to global", {
        ARRANGE() {
            return { args: ["--global"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { ok: true, answers: { scope: "global" } });
        }
    });

    test("--reviewer-tool=bad returns diagnostic naming flag and value", {
        ARRANGE() {
            return { args: ["--reviewer-tool=bad"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid value for --reviewer-tool: \"bad\". Allowed values: claude, codex.\n"
            });
        }
    });
});

test.describe("Install flag validation integration", test => {
    test("--worker-tool=foo exits non-zero with diagnostic, no prompt called", {
        ARRANGE() {
            const s = stubContexts();
            let askCalled = false;
            (s.contexts as { ask:InstallContexts["ask"] }).ask = {
                askChoices() { askCalled = true; throw new Error("askChoices should not be called"); },
                askText() { askCalled = true; throw new Error("askText should not be called"); }
            };
            return { ...s, wasAskCalled: () => askCalled };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--worker-tool=foo"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exact"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid value for --worker-tool: \"foo\". Allowed values: claude, codex.\n");
            },
            "no interactive prompt was called"(_code, { wasAskCalled }) {
                Assert.strictEqual(wasAskCalled(), false);
            }
        }
    });

    test("--worker-model= with --project exits 0, no prompt called", {
        ARRANGE() {
            const s = stubContexts();
            let askCalled = false;
            (s.contexts as { ask:InstallContexts["ask"] }).ask = {
                askChoices() { askCalled = true; throw new Error("askChoices should not be called"); },
                askText() { askCalled = true; throw new Error("askText should not be called"); }
            };
            return { ...s, wasAskCalled: () => askCalled };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--worker-model="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "no interactive prompt was called"(_code, { wasAskCalled }) {
                Assert.strictEqual(wasAskCalled(), false);
            }
        }
    });

    test("--skills-tool=cursor exits non-zero with diagnostic, no prompt called", {
        ARRANGE() {
            const s = stubContexts();
            let askCalled = false;
            (s.contexts as { ask:InstallContexts["ask"] }).ask = {
                askChoices() { askCalled = true; throw new Error("askChoices should not be called"); },
                askText() { askCalled = true; throw new Error("askText should not be called"); }
            };
            return { ...s, wasAskCalled: () => askCalled };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--skills-tool=cursor"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exact"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid value for --skills-tool: \"cursor\". Allowed values: claude, codex, both.\n");
            },
            "no interactive prompt was called"(_code, { wasAskCalled }) {
                Assert.strictEqual(wasAskCalled(), false);
            }
        }
    });
});

type ExitListener = (code:number|null, signal:string|null) => void;
type ErrorListener = (e:unknown) => void;

function makeScriptStub(behaviors:Record<string, { event:"exit"; code:number|null; signal:string|null }|{ event:"error"; error:Error }>):ScriptContext {
    return {
        spawn(command:string):SpawnedProcess {
            const behavior = behaviors[command];
            let exitListener:ExitListener|null = null;
            let errorListener:ErrorListener|null = null;
            const proc:SpawnedProcess = {
                on(event:"exit"|"error", listener:never) {
                    if (event === "exit") {
                        exitListener = listener;
                    } else if (event === "error") {
                        errorListener = listener;
                    }
                    if (behavior) {
                        Promise.resolve().then(() => {
                            if (behavior.event === "exit" && exitListener) {
                                exitListener(behavior.code, behavior.signal);
                            } else if (behavior.event === "error" && errorListener) {
                                errorListener(behavior.error);
                            }
                        });
                    }
                },
                kill() {},
                stdout: { on() {} },
                stderr: { on() {} }
            };
            return proc;
        }
    };
}

function makeThrowingScript():ScriptContext {
    return {
        spawn(command:string):never {
            const err = new Error(`spawn ${command} ENOENT`) as Error & { code:string };
            err.code = "ENOENT";
            throw err;
        }
    };
}

test.describe("Install tool availability check", test => {
    test("proceeds when every selected tool exits 0", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeScriptStub({
                claude: { event: "exit", code: 0, signal: null },
                codex: { event: "exit", code: 0, signal: null }
            });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=both"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "skill files are written"(_code, { files }) {
                Assert.ok(files.has("/proj/.claude/skills/flanders-spec/SKILL.md"));
                Assert.ok(files.has("/proj/.claude/skills/flanders-plan/SKILL.md"));
            }
        }
    });

    test("ENOENT spawn failure exits non-zero with diagnostic naming binary", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeThrowingScript();
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--worker-tool=codex"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with non-zero code"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic contains exact binary name"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "codex: spawn failed (spawn codex ENOENT)\n");
            },
            "no files are written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("two missing tools diagnostic enumerates both", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeThrowingScript();
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--worker-tool=claude", "--reviewer-tool=codex"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with non-zero code"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic contains claude"(_code, { errors }) {
                Assert.ok(errors.join("").includes("claude"));
            },
            "diagnostic contains codex"(_code, { errors }) {
                Assert.ok(errors.join("").includes("codex"));
            },
            "no files are written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("non-zero exit code treats tool as unavailable", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeScriptStub({
                claude: { event: "exit", code: 2, signal: null }
            });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--worker-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with non-zero code"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the tool"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "claude: exited with code 2\n");
            }
        }
    });

    test("signal termination treats tool as unavailable", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeScriptStub({
                codex: { event: "exit", code: null, signal: "SIGTERM" }
            });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--reviewer-tool=codex"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with non-zero code"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the tool and signal"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "codex: terminated by signal SIGTERM\n");
            }
        }
    });

    test("--version does not forward stdout/stderr to OutputContext", {
        ARRANGE() {
            const s = stubContexts();
            let probePhase = true;
            const writeDuringProbe:string[] = [];
            const errorDuringProbe:string[] = [];
            const origWrite = s.contexts.output.write;
            const origWriteError = s.contexts.output.writeError;
            (s.contexts.output as { write:typeof origWrite }).write = (text) => {
                if (probePhase) writeDuringProbe.push(text);
                origWrite(text);
            };
            (s.contexts.output as { writeError:typeof origWriteError }).writeError = (text) => {
                if (probePhase) errorDuringProbe.push(text);
                origWriteError(text);
            };
            const origMkdir = s.contexts.fs.mkdir.bind(s.contexts.fs);
            (s.contexts.fs as { mkdir:typeof s.contexts.fs.mkdir }).mkdir = (p, o) => {
                probePhase = false;
                return origMkdir(p, o);
            };
            (s.contexts as { script:ScriptContext }).script = makeScriptStub({
                claude: { event: "exit", code: 0, signal: null }
            });
            return { ...s, writeDuringProbe, errorDuringProbe };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--worker-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "no write during probe"(_code, { writeDuringProbe }) {
                Assert.strictEqual(writeDuringProbe.length, 0);
            },
            "no writeError during probe"(_code, { errorDuringProbe }) {
                Assert.strictEqual(errorDuringProbe.length, 0);
            }
        }
    });

    test("no file written when tool unavailable — FsContext writeFile throws on call", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts.fs as { writeFile:(p:string, c:string) => Promise<void> }).writeFile = () => {
                throw new Error("writeFile should not be called");
            };
            (s.contexts.fs as { mkdir:(p:string, o?:unknown) => Promise<void> }).mkdir = () => {
                throw new Error("mkdir should not be called");
            };
            (s.contexts as { script:ScriptContext }).script = makeThrowingScript();
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--worker-tool=codex"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with non-zero code"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files are written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("skills-tool=both collects both claude and codex for probe", {
        ARRANGE() {
            const s = stubContexts();
            const spawnedCommands:string[] = [];
            (s.contexts as { script:ScriptContext }).script = {
                spawn(command:string):SpawnedProcess {
                    spawnedCommands.push(command);
                    let exitListener:ExitListener|null = null;
                    return {
                        on(event:"exit"|"error", listener:never) {
                            if (event === "exit") {
                                exitListener = listener;
                                Promise.resolve().then(() => exitListener?.(0, null));
                            }
                        },
                        kill() {},
                        stdout: { on() {} },
                        stderr: { on() {} }
                    };
                }
            };
            return { ...s, spawnedCommands };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=both"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "probed claude"(_code, { spawnedCommands }) {
                Assert.ok(spawnedCommands.includes("claude"));
            },
            "probed codex"(_code, { spawnedCommands }) {
                Assert.ok(spawnedCommands.includes("codex"));
            }
        }
    });

    test("deduplication — same tool used in skills, worker, and reviewer is probed once", {
        ARRANGE() {
            const s = stubContexts();
            const spawnedCommands:string[] = [];
            (s.contexts as { script:ScriptContext }).script = {
                spawn(command:string):SpawnedProcess {
                    spawnedCommands.push(command);
                    let exitListener:ExitListener|null = null;
                    return {
                        on(event:"exit"|"error", listener:never) {
                            if (event === "exit") {
                                exitListener = listener;
                                Promise.resolve().then(() => exitListener?.(0, null));
                            }
                        },
                        kill() {},
                        stdout: { on() {} },
                        stderr: { on() {} }
                    };
                }
            };
            return { ...s, spawnedCommands };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--reviewer-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "claude is probed exactly once"(_code, { spawnedCommands }) {
                Assert.strictEqual(spawnedCommands.filter(c => c === "claude").length, 1);
            }
        }
    });

    test("no tool flags means no availability check and install proceeds", {
        ARRANGE() {
            const s = stubContexts();
            let spawnCalled = false;
            (s.contexts as { script:ScriptContext }).script = {
                spawn():never {
                    spawnCalled = true;
                    throw new Error("spawn should not be called");
                }
            };
            return { ...s, wasSpawnCalled: () => spawnCalled };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "spawn was not called"(_code, { wasSpawnCalled }) {
                Assert.strictEqual(wasSpawnCalled(), false);
            }
        }
    });
});
