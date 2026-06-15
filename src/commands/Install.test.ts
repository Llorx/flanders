import * as Assert from "assert";

import test from "arrange-act-assert";

import { Install, parseInstallFlags, stripYamlFrontmatter } from "./Install";
import type { InstallContexts } from "./Install";
import type { AskAnswer, ScriptContext, SpawnedProcess } from "../contexts";
import { read as readConfig } from "../workspace/FlandersConfig";
import type { FlandersConfig } from "../workspace/FlandersConfig";
import { planSkillBody, specSkillBody, workSkillBody } from "../prompts/skills";

function stubContexts() {
    const written:string[] = [];
    const errors:string[] = [];
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const askResponses:AskAnswer[][] = [];
    const askedHeaders:string[] = [];
    const askedTextPrompts:string[] = [];
    const askTextResponses:string[] = [];
    const contexts:InstallContexts = {
        fs: {
            readFile(p) { return files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error("not found")); },
            writeFile(p, content) { files.set(p, content); return Promise.resolve(); },
            rename(oldPath, newPath) { if (files.has(oldPath)) { files.set(newPath, files.get(oldPath)!); files.delete(oldPath); } return Promise.resolve(); },
            readdir() { return Promise.resolve([]); },
            stat() { return Promise.reject(new Error("unexpected stat")); },
            exists(p) { return Promise.resolve(files.has(p) || dirs.has(p)); },
            mkdir(p) { dirs.add(p); return Promise.resolve(); },
            mkdtemp() { return Promise.reject(new Error("unexpected mkdtemp")); },
            rm() { return Promise.reject(new Error("unexpected rm")); }
        },
        ask: {
            askChoices(questions) {
                for (const q of questions) {
                    askedHeaders.push(q.header);
                }
                const response = askResponses.shift();
                return Promise.resolve(response ?? []);
            },
            askText(prompt) { askedTextPrompts.push(prompt); return Promise.resolve(askTextResponses.length > 0 ? askTextResponses.shift()! : ""); }
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
    return { contexts, written, errors, files, dirs, askResponses, askedHeaders, askedTextPrompts, askTextResponses };
}

test.describe("Install --project", test => {
    test("writes SKILL.md files under projectRoot/.claude/skills/<skill>/", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/myproject" }, contexts);
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
            "creates work skill file"(_code, { files }) {
                Assert.ok(files.has("/myproject/.claude/skills/flanders-work/SKILL.md"));
            },
            "spec skill file has correct body"(_code, { files }) {
                Assert.strictEqual(files.get("/myproject/.claude/skills/flanders-spec/SKILL.md"), specSkillBody);
            },
            "plan skill file has correct body"(_code, { files }) {
                Assert.strictEqual(files.get("/myproject/.claude/skills/flanders-plan/SKILL.md"), planSkillBody);
            },
            "work skill file has correct body"(_code, { files }) {
                Assert.strictEqual(files.get("/myproject/.claude/skills/flanders-work/SKILL.md"), workSkillBody);
            },
            "writes exactly 4 files"(_code, { files }) {
                Assert.strictEqual(files.size, 4);
            },
            "writes config.json"(_code, { files }) {
                Assert.ok(files.has("/myproject/.flanders/config.json"));
            },
            "stdout includes spec skill path"(_code, { written }) {
                Assert.ok(written.join("").includes("/myproject/.claude/skills/flanders-spec/SKILL.md"));
            },
            "stdout includes plan skill path"(_code, { written }) {
                Assert.ok(written.join("").includes("/myproject/.claude/skills/flanders-plan/SKILL.md"));
            },
            "stdout includes work skill path"(_code, { written }) {
                Assert.ok(written.join("").includes("/myproject/.claude/skills/flanders-work/SKILL.md"));
            },
            "stdout includes config path"(_code, { written }) {
                Assert.ok(written.join("").includes("/myproject/.flanders/config.json"));
            }
        }
    });

    test("prints one path per line in stdout", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            await cmd.result();
            await cmd.dispose();
        },
        ASSERTS: {
            "outputs exactly 4 lines"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.strictEqual(lines.length, 4);
            },
            "first line includes spec skill path"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.ok(lines[0]!.includes("flanders-spec/SKILL.md"));
            },
            "second line includes plan skill path"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.ok(lines[1]!.includes("flanders-plan/SKILL.md"));
            },
            "third line includes work skill path"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.ok(lines[2]!.includes("flanders-work/SKILL.md"));
            },
            "fourth line includes config path"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.ok(lines[3]!.includes(".flanders/config.json"));
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
            const cmd = new Install(["--global", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
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
            "creates work skill file"(_code, { files }) {
                Assert.ok(files.has("/home/testuser/.claude/skills/flanders-work/SKILL.md"));
            },
            "spec skill file has correct body"(_code, { files }) {
                Assert.strictEqual(files.get("/home/testuser/.claude/skills/flanders-spec/SKILL.md"), specSkillBody);
            },
            "work skill file has correct body"(_code, { files }) {
                Assert.strictEqual(files.get("/home/testuser/.claude/skills/flanders-work/SKILL.md"), workSkillBody);
            },
            "writes exactly 4 files"(_code, { files }) {
                Assert.strictEqual(files.size, 4);
            },
            "writes config.json under homedir"(_code, { files }) {
                Assert.ok(files.has("/home/testuser/.flanders/config.json"));
            },
            "stdout includes spec skill path"(_code, { written }) {
                Assert.ok(written.join("").includes("/home/testuser/.claude/skills/flanders-spec/SKILL.md"));
            },
            "stdout includes plan skill path"(_code, { written }) {
                Assert.ok(written.join("").includes("/home/testuser/.claude/skills/flanders-plan/SKILL.md"));
            },
            "stdout includes work skill path"(_code, { written }) {
                Assert.ok(written.join("").includes("/home/testuser/.claude/skills/flanders-work/SKILL.md"));
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
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // skills tool
            s.askResponses.push([{ picked: [{ label: "project" }] }]); // scope
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
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
            "creates work skill file under project"(_code, { files }) {
                Assert.ok(files.has("/proj/.claude/skills/flanders-work/SKILL.md"));
            },
            "writes exactly 4 files"(_code, { files }) {
                Assert.strictEqual(files.size, 4);
            }
        }
    });

    test("prompts when neither flag given and user picks global", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // skills tool
            s.askResponses.push([{ picked: [{ label: "global" }] }]); // scope
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
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
            "creates work skill file under homedir"(_code, { files }) {
                Assert.ok(files.has("/home/testuser/.claude/skills/flanders-work/SKILL.md"));
            },
            "writes exactly 4 files"(_code, { files }) {
                Assert.strictEqual(files.size, 4);
            }
        }
    });

    test("scope prompt offers exactly two options: project and global", {
        ARRANGE() {
            const s = stubContexts();
            let capturedOptions:readonly { label:string }[] = [];
            let callIndex = 0;
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions) => {
                callIndex++;
                if (callIndex === 2) {
                    capturedOptions = questions[0]!.options;
                }
                s.askResponses.push([{ picked: [{ label: questions[0]!.options[0]!.label }] }]);
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
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
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
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
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
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
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
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
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
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
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
                    reviewers: [{ tool: "claude", model: "opus", effort: "" }]
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
            const cmd = new Install(["--project", "--worker-model=", "--worker-effort=", "--reviewer-model=", "--reviewer-effort=", "--skills-tool=claude", "--worker-tool=claude", "--reviewer-tool=claude"], { projectRoot: "/proj" }, contexts);
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

test.describe("Install writes regardless of tool CLI availability", test => {
    test("flag-driven codex install writes all artifacts without probing for a CLI", {
        ARRANGE() {
            const s = stubContexts();
            const spawnedInvocations:{ command:string; args:readonly string[] }[] = [];
            (s.contexts as { script:ScriptContext }).script = {
                spawn(command:string, args:readonly string[]):SpawnedProcess {
                    spawnedInvocations.push({ command, args });
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
            return { ...s, spawnedInvocations };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=codex", "--worker-model=", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "writes the codex spec prompt"(_code, { files }) {
                Assert.ok(files.has("/proj/.codex/prompts/flanders-spec.md"));
            },
            "writes the codex plan prompt"(_code, { files }) {
                Assert.ok(files.has("/proj/.codex/prompts/flanders-plan.md"));
            },
            "writes the codex work prompt"(_code, { files }) {
                Assert.ok(files.has("/proj/.codex/prompts/flanders-work.md"));
            },
            "writes the flanders config"(_code, { files }) {
                Assert.ok(files.has("/proj/.flanders/config.json"));
            },
            "no codex --version availability probe occurred"(_code, { spawnedInvocations }) {
                Assert.strictEqual(
                    spawnedInvocations.some(inv => inv.command === "codex" && inv.args.length === 1 && inv.args[0] === "--version"),
                    false
                );
            }
        }
    });

    test("flag-driven both-tools install writes claude skills and codex prompts", {
        ARRANGE() {
            const s = stubContexts();
            const spawnedInvocations:{ command:string; args:readonly string[] }[] = [];
            (s.contexts as { script:ScriptContext }).script = {
                spawn(command:string, args:readonly string[]):SpawnedProcess {
                    spawnedInvocations.push({ command, args });
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
            return { ...s, spawnedInvocations };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=both", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "writes the claude spec skill"(_code, { files }) {
                Assert.ok(files.has("/proj/.claude/skills/flanders-spec/SKILL.md"));
            },
            "writes the codex spec prompt"(_code, { files }) {
                Assert.ok(files.has("/proj/.codex/prompts/flanders-spec.md"));
            },
            "no availability probe spawned anything"(_code, { spawnedInvocations }) {
                Assert.strictEqual(spawnedInvocations.length, 0);
            }
        }
    });
});

test.describe("Install prompt order", test => {
    test("with no flags, prompts are asked in canonical order", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // skills tool
            s.askResponses.push([{ picked: [{ label: "project" }] }]); // scope
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
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
            "headers are in canonical order"(_code, { askedHeaders }) {
                Assert.deepStrictEqual(askedHeaders, ["Skills tool", "Install destination", "Worker tool", "Worker model", "Worker effort", "Reviewer tool", "Reviewer model", "Reviewer effort", "Configure another reviewer?"]);
            }
        }
    });

    test("with --worker-tool and --reviewer-tool flags, only scope and skills tool are prompted", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]);
            s.askResponses.push([{ picked: [{ label: "project" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "headers are exactly skills tool then scope"(_code, { askedHeaders }) {
                Assert.deepStrictEqual(askedHeaders, ["Skills tool", "Install destination"]);
            }
        }
    });
});

test.describe("Install Ctrl+C during tool prompts", test => {
    test("Ctrl+C during skills tool prompt exits non-zero with no files", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [] }]);
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
                Assert.strictEqual(code, 1);
            },
            "no files are written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("Ctrl+C during worker tool prompt exits non-zero with no files", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
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

    test("Ctrl+C during reviewer tool prompt exits non-zero with no files", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort="], { projectRoot: "/proj" }, contexts);
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

    test("Ctrl+C during scope prompt (after skills tool answered) exits non-zero with no files", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]);
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
            "exits with non-zero code"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files are written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });
});

test.describe("Install dispose during tool prompts", test => {
    test("disposed during skills tool prompt returns 1", {
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
            const cmd = new Install(["--project"], { projectRoot: "/proj" }, contexts);
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolvePrompt()!([{ picked: [{ label: "claude" }] }]);
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("disposed during worker tool prompt returns 1", {
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
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolvePrompt()!([{ picked: [{ label: "claude" }] }]);
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("disposed during reviewer tool prompt returns 1", {
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
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort="], { projectRoot: "/proj" }, contexts);
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolvePrompt()!([{ picked: [{ label: "claude" }] }]);
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("disposed during scope prompt (after skills tool answered) returns 1", {
        ARRANGE() {
            const s = stubContexts();
            let resolveScope:((v:readonly AskAnswer[]) => void) | null = null;
            let callIndex = 0;
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, output) => {
                callIndex++;
                if (callIndex === 2) {
                    return new Promise<readonly AskAnswer[]>(resolve => {
                        resolveScope = resolve;
                    });
                }
                return origAsk.call(s.contexts.ask, questions, output);
            };
            s.askResponses.push([{ picked: [{ label: "claude" }] }]);
            return { ...s, getResolveScope: () => resolveScope };
        },
        async ACT({ contexts, getResolveScope }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            while (!getResolveScope()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolveScope()!([{ picked: [{ label: "project" }] }]);
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });
});

test.describe("Install scope prompt descriptions derived from skills tool", test => {
    test("skills tool claude (interactive): scope descriptions name .claude/skills/ paths only", {
        ARRANGE() {
            const s = stubContexts();
            let scopeOptions:readonly { label:string; description?:string }[] = [];
            let callIndex = 0;
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, output) => {
                callIndex++;
                if (callIndex === 2) {
                    scopeOptions = questions[0]!.options;
                }
                return origAsk.call(s.contexts.ask, questions, output);
            };
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // skills tool
            s.askResponses.push([{ picked: [{ label: "project" }] }]); // scope
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
            return { ...s, getScopeOptions: () => scopeOptions };
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
            "scope prompt offered exactly two options"(_code, { getScopeOptions }) {
                Assert.strictEqual(getScopeOptions().length, 2);
            },
            "project option label is exactly 'project'"(_code, { getScopeOptions }) {
                Assert.strictEqual(getScopeOptions()[0]!.label, "project");
            },
            "global option label is exactly 'global'"(_code, { getScopeOptions }) {
                Assert.strictEqual(getScopeOptions()[1]!.label, "global");
            },
            "project description contains .claude/skills/"(_code, { getScopeOptions }) {
                Assert.ok(getScopeOptions()[0]!.description!.includes(".claude/skills/"));
            },
            "global description contains ~/.claude/skills/"(_code, { getScopeOptions }) {
                Assert.ok(getScopeOptions()[1]!.description!.includes("~/.claude/skills/"));
            },
            "project description does not contain .codex/prompts/"(_code, { getScopeOptions }) {
                Assert.ok(!getScopeOptions()[0]!.description!.includes(".codex/prompts/"));
            },
            "global description does not contain .codex/prompts/"(_code, { getScopeOptions }) {
                Assert.ok(!getScopeOptions()[1]!.description!.includes(".codex/prompts/"));
            }
        }
    });

    test("skills tool codex (--skills-tool flag): scope descriptions name .codex/prompts/ paths only", {
        ARRANGE() {
            const s = stubContexts();
            let scopeOptions:readonly { label:string; description?:string }[] = [];
            let callIndex = 0;
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, output) => {
                callIndex++;
                if (callIndex === 1) {
                    scopeOptions = questions[0]!.options;
                }
                return origAsk.call(s.contexts.ask, questions, output);
            };
            s.askResponses.push([{ picked: [{ label: "project" }] }]);
            return { ...s, getScopeOptions: () => scopeOptions };
        },
        async ACT({ contexts }) {
            const cmd = new Install([
                "--skills-tool=codex",
                "--worker-tool=codex",
                "--reviewer-tool=codex",
                "--worker-effort=",
                "--reviewer-effort="
            ], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "scope prompt offered exactly two options"(_code, { getScopeOptions }) {
                Assert.strictEqual(getScopeOptions().length, 2);
            },
            "project option label is exactly 'project'"(_code, { getScopeOptions }) {
                Assert.strictEqual(getScopeOptions()[0]!.label, "project");
            },
            "global option label is exactly 'global'"(_code, { getScopeOptions }) {
                Assert.strictEqual(getScopeOptions()[1]!.label, "global");
            },
            "project description contains .codex/prompts/"(_code, { getScopeOptions }) {
                Assert.ok(getScopeOptions()[0]!.description!.includes(".codex/prompts/"));
            },
            "global description contains ~/.codex/prompts/"(_code, { getScopeOptions }) {
                Assert.ok(getScopeOptions()[1]!.description!.includes("~/.codex/prompts/"));
            },
            "project description does not contain .claude/skills/"(_code, { getScopeOptions }) {
                Assert.ok(!getScopeOptions()[0]!.description!.includes(".claude/skills/"));
            },
            "global description does not contain .claude/skills/"(_code, { getScopeOptions }) {
                Assert.ok(!getScopeOptions()[1]!.description!.includes(".claude/skills/"));
            }
        }
    });

    test("skills tool both (interactive): scope descriptions name both .claude/skills/ and .codex/prompts/", {
        ARRANGE() {
            const s = stubContexts();
            let scopeOptions:readonly { label:string; description?:string }[] = [];
            let callIndex = 0;
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, output) => {
                callIndex++;
                if (callIndex === 2) {
                    scopeOptions = questions[0]!.options;
                }
                return origAsk.call(s.contexts.ask, questions, output);
            };
            s.askResponses.push([{ picked: [{ label: "both" }] }]); // skills tool
            s.askResponses.push([{ picked: [{ label: "project" }] }]); // scope
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
            return { ...s, getScopeOptions: () => scopeOptions };
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
            "scope prompt offered exactly two options"(_code, { getScopeOptions }) {
                Assert.strictEqual(getScopeOptions().length, 2);
            },
            "project option label is exactly 'project'"(_code, { getScopeOptions }) {
                Assert.strictEqual(getScopeOptions()[0]!.label, "project");
            },
            "global option label is exactly 'global'"(_code, { getScopeOptions }) {
                Assert.strictEqual(getScopeOptions()[1]!.label, "global");
            },
            "project description contains .claude/skills/"(_code, { getScopeOptions }) {
                Assert.ok(getScopeOptions()[0]!.description!.includes(".claude/skills/"));
            },
            "project description contains .codex/prompts/"(_code, { getScopeOptions }) {
                Assert.ok(getScopeOptions()[0]!.description!.includes(".codex/prompts/"));
            },
            "global description contains ~/.claude/skills/"(_code, { getScopeOptions }) {
                Assert.ok(getScopeOptions()[1]!.description!.includes("~/.claude/skills/"));
            },
            "global description contains ~/.codex/prompts/"(_code, { getScopeOptions }) {
                Assert.ok(getScopeOptions()[1]!.description!.includes("~/.codex/prompts/"));
            }
        }
    });
});

type DataListener = (chunk:Buffer|string) => void;

function makeModelScript(opts:{
    probeStdout?:string;
    probeStderr?:string;
    probeExitCode?:number;
    probeCallCounter?:{ count:number };
}):ScriptContext {
    return {
        spawn(_command:string, args:readonly string[]):SpawnedProcess {
            if (args[0] === "debug" && args[1] === "models") {
                if (opts.probeCallCounter) opts.probeCallCounter.count++;
                let exitListener:ExitListener|null = null;
                let stdoutListener:DataListener|null = null;
                let stderrListener:DataListener|null = null;
                return {
                    on(event:"exit"|"error", listener:never) {
                        if (event === "exit") {
                            exitListener = listener;
                            Promise.resolve().then(() => {
                                if (opts.probeStdout && stdoutListener) {
                                    stdoutListener(opts.probeStdout);
                                }
                            }).then(() => {
                                if (opts.probeStderr && stderrListener) {
                                    stderrListener(opts.probeStderr);
                                }
                            }).then(() => {
                                exitListener?.(opts.probeExitCode ?? 0, null);
                            });
                        }
                    },
                    kill() {},
                    stdout: { on(_e:"data", l:DataListener) { stdoutListener = l; } },
                    stderr: { on(_e:"data", l:DataListener) { stderrListener = l; } }
                };
            }
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
}

// Captures every askChoices question (header, question text, and option labels) so a test can
// assert the exact options a given prompt rendered, and how many times a prompt was re-rendered
// (used by the back-navigation tests). Selection still flows through the existing askResponses queue.
function captureModelMenu(s:ReturnType<typeof stubContexts>) {
    const snapshots:{ header:string; question:string; options:readonly string[] }[] = [];
    const origAsk = s.contexts.ask.askChoices;
    (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
        for (const q of questions) {
            s.askedHeaders.push(q.header);
            snapshots.push({ header: q.header, question: q.question, options: q.options.map(o => o.label) });
        }
        const response = s.askResponses.shift();
        return Promise.resolve(response ?? []);
    };
    return { optionsForQuestion: (question:string) => snapshots.filter(sn => sn.question === question).map(sn => sn.options) };
}

test.describe("Install model question", test => {
    test("claude tool renders the family-grouped top-level menu: families, the cross-family Best alias, the synthetic default, then the custom entry, in order", {
        ARRANGE() {
            const s = stubContexts();
            const capture = captureModelMenu(s);
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            return { ...s, capture };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "Worker model header is present"(_code, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Worker model"));
            },
            "top-level options are exactly the four families, the cross-family Best alias, the synthetic default, then the custom entry, in order"(_code, { capture }) {
                Assert.deepStrictEqual(
                    capture.optionsForQuestion("Which model should the worker use?")[0],
                    ["Opus", "Sonnet", "Haiku", "Fable", "Best (auto-pick)", "default configured model", "enter a custom value…"]
                );
            }
        }
    });

    test("claude model selection never runs the codex model probe", {
        ARRANGE() {
            const s = stubContexts();
            const spawnCalls:{ command:string; args:readonly string[] }[] = [];
            (s.contexts as { script:ScriptContext }).script = {
                spawn(command:string, args:readonly string[]):SpawnedProcess {
                    spawnCalls.push({ command, args });
                    let exitListener:ExitListener|null = null;
                    let dataListener:DataListener|null = null;
                    return {
                        on(event:"exit"|"error", listener:never) {
                            if (event === "exit") {
                                exitListener = listener;
                                Promise.resolve().then(() => {
                                    if (args[0] === "debug" && args[1] === "models" && dataListener) {
                                        dataListener('{"models":[]}');
                                    }
                                }).then(() => exitListener?.(0, null));
                            }
                        },
                        kill() {},
                        stdout: { on(_e:"data", l:DataListener) { dataListener = l; } },
                        stderr: { on() {} }
                    };
                }
            };
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // worker model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Opus 4.8" }] }]); // worker submenu -> Opus 4.8
            s.askResponses.push([{ picked: [{ label: "Sonnet" }] }]); // reviewer model -> Sonnet family submenu
            s.askResponses.push([{ picked: [{ label: "Latest Sonnet" }] }]); // reviewer submenu -> Latest Sonnet alias
            return { ...s, spawnCalls };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "no spawn invokes the codex model probe `codex debug models`"(_code, { spawnCalls }) {
                const probeCalls = spawnCalls.filter(c => c.command === "codex" && c.args.length === 2 && c.args[0] === "debug" && c.args[1] === "models");
                Assert.strictEqual(probeCalls.length, 0);
            }
        }
    });

    test("claude picking a family's Latest alias inside its submenu persists the alias string verbatim", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // worker model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Latest Opus" }] }]); // worker submenu -> Latest Opus alias
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // reviewer model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Latest Opus [1m context]" }] }]); // reviewer submenu -> Latest Opus 1M alias
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.model is the Latest Opus alias string verbatim"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "opus");
            },
            "config reviewer.model is the Latest Opus 1M alias string verbatim"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.model, "opus[1m]");
            }
        }
    });

    test("claude picking the synthetic default configured model persists as empty string", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.model is empty string"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "");
            }
        }
    });

    test("claude custom model entry opens a free-text input and persists the typed value verbatim", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // worker model -> custom
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askTextResponses.push("  Opus-Custom-1m  "); // worker model custom text
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.model is the typed custom value verbatim (surrounding whitespace and mixed case preserved, not trimmed or case-folded)"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "  Opus-Custom-1m  ");
            },
            "the custom free-text prompt is the worker model question with its placeholder"(_result, { askedTextPrompts }) {
                Assert.ok(askedTextPrompts.includes("Which model should the worker use? (leave empty for the default configured model): "));
            }
        }
    });

    test("claude custom model entry with an empty typed value persists the empty string", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // worker model -> custom
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            // askTextResponses left empty -> the custom free-text input returns ""
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.model is empty string"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "");
            }
        }
    });

    test("claude selecting the Opus family opens its submenu with exact options and persists a pinned version's full identifier", {
        ARRANGE() {
            const s = stubContexts();
            const capture = captureModelMenu(s);
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // worker model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Opus 4.8 [1m context]" }] }]); // submenu -> Opus 4.8 1M
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            return { ...s, capture };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the Opus submenu options are exactly the Opus catalog entries then back, in order"(_result, { capture }) {
                Assert.deepStrictEqual(
                    capture.optionsForQuestion("Which Opus model should the worker use?")[0],
                    ["Latest Opus", "Latest Opus [1m context]", "Opus 4.8", "Opus 4.8 [1m context]", "Opus 4.7", "Opus 4.7 [1m context]", "Opus 4.6", "Opus 4.6 [1m context]", "← back"]
                );
            },
            "config worker.model is the full Opus 4.8 1M identifier verbatim"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "claude-opus-4-8[1m]");
            }
        }
    });

    test("claude selecting the Sonnet family opens its submenu with exact options and persists a pinned version's full identifier", {
        ARRANGE() {
            const s = stubContexts();
            const capture = captureModelMenu(s);
            s.askResponses.push([{ picked: [{ label: "Sonnet" }] }]); // worker model -> Sonnet family submenu
            s.askResponses.push([{ picked: [{ label: "Sonnet 4.5" }] }]); // submenu -> Sonnet 4.5
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            return { ...s, capture };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the Sonnet submenu options are exactly the Sonnet catalog entries then back, in order"(_result, { capture }) {
                Assert.deepStrictEqual(
                    capture.optionsForQuestion("Which Sonnet model should the worker use?")[0],
                    ["Latest Sonnet", "Latest Sonnet [1m context]", "Sonnet 4.6", "Sonnet 4.6 [1m context]", "Sonnet 4.5", "Sonnet 4.5 [1m context]", "← back"]
                );
            },
            "config worker.model is the full Sonnet 4.5 identifier verbatim"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "claude-sonnet-4-5");
            }
        }
    });

    test("claude two-entry families Haiku and Fable each open a submenu of their Latest alias, one pinned version, and back", {
        ARRANGE() {
            const s = stubContexts();
            const capture = captureModelMenu(s);
            s.askResponses.push([{ picked: [{ label: "Haiku" }] }]); // worker model -> Haiku family submenu
            s.askResponses.push([{ picked: [{ label: "Haiku 4.5" }] }]); // worker submenu -> Haiku 4.5
            s.askResponses.push([{ picked: [{ label: "Fable" }] }]); // reviewer model -> Fable family submenu
            s.askResponses.push([{ picked: [{ label: "Fable 5" }] }]); // reviewer submenu -> Fable 5
            return { ...s, capture };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the Haiku submenu options are exactly Latest Haiku, Haiku 4.5, then back"(_result, { capture }) {
                Assert.deepStrictEqual(
                    capture.optionsForQuestion("Which Haiku model should the worker use?")[0],
                    ["Latest Haiku", "Haiku 4.5", "← back"]
                );
            },
            "the Fable submenu options are exactly Latest Fable, Fable 5, then back"(_result, { capture }) {
                Assert.deepStrictEqual(
                    capture.optionsForQuestion("Which Fable model should reviewer use?")[0],
                    ["Latest Fable", "Fable 5", "← back"]
                );
            },
            "config worker.model is the full Haiku identifier verbatim"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "claude-haiku-4-5-20251001");
            },
            "config reviewer.model is the full Fable identifier verbatim"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.model, "claude-fable-5");
            }
        }
    });

    test("claude back from a family submenu re-renders the top-level menu and a subsequent top-level selection persists", {
        ARRANGE() {
            const s = stubContexts();
            const capture = captureModelMenu(s);
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // worker model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "← back" }] }]); // family submenu -> back to top level
            s.askResponses.push([{ picked: [{ label: "Best (auto-pick)" }] }]); // top-level menu again -> Best
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            return { ...s, capture };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the worker top-level model menu is rendered exactly twice (initial, then again after back)"(_result, { capture }) {
                Assert.strictEqual(capture.optionsForQuestion("Which model should the worker use?").length, 2);
            },
            "config worker.model is the value chosen after returning to the top level"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "best");
            }
        }
    });

    test("claude selecting the cross-family Best alias persists best and opens no family submenu", {
        ARRANGE() {
            const s = stubContexts();
            const capture = captureModelMenu(s);
            s.askResponses.push([{ picked: [{ label: "Best (auto-pick)" }] }]); // worker model -> Best (direct)
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            return { ...s, capture };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.model is exactly best"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "best");
            },
            "selecting Best opens no family submenu for the worker"(_result, { capture }) {
                const submenusOpened = ["Opus", "Sonnet", "Haiku", "Fable"]
                    .filter(f => capture.optionsForQuestion(`Which ${f} model should the worker use?`).length > 0);
                Assert.deepStrictEqual(submenusOpened, []);
            }
        }
    });

    test("claude family submenu behaves identically for a reviewer model question as for the worker", {
        ARRANGE() {
            const s = stubContexts();
            const capture = captureModelMenu(s);
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // worker model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Latest Opus" }] }]); // worker submenu -> Latest Opus
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // reviewer model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Opus 4.6" }] }]); // reviewer submenu -> Opus 4.6
            return { ...s, capture };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the reviewer Opus submenu options match the worker Opus submenu options exactly"(_result, { capture }) {
                Assert.deepStrictEqual(
                    capture.optionsForQuestion("Which Opus model should reviewer use?")[0],
                    capture.optionsForQuestion("Which Opus model should the worker use?")[0]
                );
            },
            "config reviewer.model is the full identifier chosen through the reviewer submenu"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.model, "claude-opus-4-6");
            }
        }
    });

    test("Ctrl+C during the claude family submenu exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // worker model -> Opus family submenu
            s.askResponses.push([{ picked: [] }]); // family submenu -> Ctrl+C
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("disposed during the claude family submenu returns 1", {
        ARRANGE() {
            const s = stubContexts();
            let resolvePrompt:((v:readonly AskAnswer[]) => void) | null = null;
            let callCount = 0;
            (s.contexts.ask as { askChoices:typeof s.contexts.ask.askChoices }).askChoices = (questions) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                }
                callCount++;
                if (callCount === 1) {
                    return Promise.resolve([{ picked: [{ label: "Opus" }] }]);
                }
                return new Promise<readonly AskAnswer[]>(resolve => {
                    resolvePrompt = resolve;
                });
            };
            return { ...s, getResolvePrompt: () => resolvePrompt };
        },
        async ACT({ contexts, getResolvePrompt }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolvePrompt()!([{ picked: [{ label: "Opus 4.8" }] }]);
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("codex tool with successful probe uses askChoice with three options", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[{"slug":"gpt-5-codex","visibility":"list"},{"slug":"gpt-4.1","visibility":"list"}]}',
                probeExitCode: 0
            });
            let capturedOptions:readonly { label:string; description?:string }[] = [];
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                    if (q.header === "Worker model") {
                        capturedOptions = q.options;
                    }
                }
                const response = s.askResponses.shift();
                return Promise.resolve(response ?? []);
            };
            s.askResponses.push([{ picked: [{ label: "gpt-5-codex" }] }]);
            return { ...s, getCapturedOptions: () => capturedOptions };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "Worker model header is present"(_code, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Worker model"));
            },
            "presents exactly 3 options"(_code, { getCapturedOptions }) {
                Assert.strictEqual(getCapturedOptions().length, 3);
            },
            "first option is gpt-5-codex"(_code, { getCapturedOptions }) {
                Assert.strictEqual(getCapturedOptions()[0]!.label, "gpt-5-codex");
            },
            "second option is gpt-4.1"(_code, { getCapturedOptions }) {
                Assert.strictEqual(getCapturedOptions()[1]!.label, "gpt-4.1");
            },
            "third option is the synthetic entry"(_code, { getCapturedOptions }) {
                Assert.strictEqual(getCapturedOptions()[2]!.label, "default configured model");
            }
        }
    });

    test("both worker and reviewer codex probes once due to cache", {
        ARRANGE() {
            const s = stubContexts();
            const counter = { count: 0 };
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[{"slug":"m1","visibility":"list"}]}',
                probeExitCode: 0,
                probeCallCounter: counter
            });
            s.askResponses.push([{ picked: [{ label: "m1" }] }]);
            s.askResponses.push([{ picked: [{ label: "m1" }] }]);
            return { ...s, counter };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "probe invoked exactly once"(_code, { counter }) {
                Assert.strictEqual(counter.count, 1);
            }
        }
    });

    test("codex probe failure falls back to askText", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeExitCode: 1
            });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "askText was called for worker model"(_code, { askedTextPrompts }) {
                Assert.strictEqual(askedTextPrompts[0], "Which model should the worker use? (leave empty for the default configured model): ");
            },
            "no Worker model header in askChoices"(_code, { askedHeaders }) {
                Assert.ok(!askedHeaders.includes("Worker model"));
            }
        }
    });

    test("codex that cannot be started surfaces the captured reason then falls back to free-text", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStderr: "codex executable is missing from PATH",
                probeExitCode: 127
            });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the captured probe reason is written through writeError"(_code, { errors }) {
                Assert.ok(errors.join("").includes("codex executable is missing from PATH"));
            },
            "the diagnostic is not the bare exit code"(_code, { errors }) {
                Assert.strictEqual(errors.join("").includes("127"), false);
            },
            "falls back to the free-text worker model input"(_code, { askedTextPrompts }) {
                Assert.strictEqual(askedTextPrompts[0], "Which model should the worker use? (leave empty for the default configured model): ");
            },
            "no Worker model header in askChoices"(_code, { askedHeaders }) {
                Assert.ok(!askedHeaders.includes("Worker model"));
            }
        }
    });

    test("codex that started but exposed no list falls back to free-text silently (no diagnostic)", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[]}',
                probeExitCode: 0
            });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "falls back to the free-text worker model input"(_code, { askedTextPrompts }) {
                Assert.strictEqual(askedTextPrompts[0], "Which model should the worker use? (leave empty for the default configured model): ");
            },
            "no diagnostic is written"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "");
            }
        }
    });

    test("codex not-started reason is surfaced exactly once when both worker and reviewer are codex", {
        ARRANGE() {
            const s = stubContexts();
            const counter = { count: 0 };
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStderr: "codex executable is missing from PATH",
                probeExitCode: 127,
                probeCallCounter: counter
            });
            return { ...s, counter };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "probe invoked exactly once"(_code, { counter }) {
                Assert.strictEqual(counter.count, 1);
            },
            "the captured reason is surfaced exactly once across both codex model questions"(_code, { errors }) {
                const occurrences = errors.join("").split("codex executable is missing from PATH").length - 1;
                Assert.strictEqual(occurrences, 1);
            },
            "both the worker and reviewer model questions fall back to free-text"(_code, { askedTextPrompts }) {
                const modelPrompts = askedTextPrompts.filter(p =>
                    p === "Which model should the worker use? (leave empty for the default configured model): "
                    || p === "Which model should reviewer use? (leave empty for the default configured model): ");
                Assert.strictEqual(modelPrompts.length, 2);
            }
        }
    });

    test("picking synthetic default configured model persists as empty string", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[{"slug":"gpt-5-codex","visibility":"list"},{"slug":"gpt-4.1","visibility":"list"}]}',
                probeExitCode: 0
            });
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                }
                const response = s.askResponses.shift();
                return Promise.resolve(response ?? []);
            };
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config worker.model is empty string"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.worker.model, "");
            }
        }
    });

    test("codex probe failure then Ctrl+C during the free-text model input exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({ probeExitCode: 1 });
            (s.contexts.ask as { askText:typeof s.contexts.ask.askText }).askText = () => Promise.reject(new Error("readline closed"));
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--reviewer-tool=claude", "--reviewer-model="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("probe stdout is not forwarded to OutputContext", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: "probe-secret-data-should-not-appear",
                probeExitCode: 0
            });
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                }
                const response = s.askResponses.shift();
                return Promise.resolve(response ?? []);
            };
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "no write contains probe output"(_code, { written }) {
                Assert.ok(!written.join("").includes("probe-secret-data-should-not-appear"));
            },
            "no error contains probe output"(_code, { errors }) {
                Assert.ok(!errors.join("").includes("probe-secret-data-should-not-appear"));
            }
        }
    });

    test("--worker-model flag skips prompt and persists the value", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=  My-Model-X  ", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.model is the flag value verbatim (surrounding whitespace and mixed case preserved)"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "  My-Model-X  ");
            },
            "no askText called for worker model"(_result, { askedTextPrompts }) {
                const workerModelPrompts = askedTextPrompts.filter(p => p.includes("worker"));
                Assert.strictEqual(workerModelPrompts.length, 0);
            },
            "the interactive worker model menu is never rendered for the worker"(_result, { askedHeaders }) {
                Assert.ok(!askedHeaders.includes("Worker model"));
            }
        }
    });

    test("--worker-model= and --reviewer-model= (empty) skip the interactive model menu entirely and persist the empty string", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.model is the empty string"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "");
            },
            "config reviewer.model is the empty string"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.model, "");
            },
            "the interactive worker model menu is never rendered for the worker"(_result, { askedHeaders }) {
                Assert.ok(!askedHeaders.includes("Worker model"));
            },
            "the interactive reviewer model menu is never rendered for the reviewer"(_result, { askedHeaders }) {
                Assert.ok(!askedHeaders.includes("Reviewer model"));
            }
        }
    });

    test("Ctrl+C during the claude worker model choice exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [] }]); // worker model choice -> Ctrl+C
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("Ctrl+C during worker model askChoice exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[{"slug":"m1","visibility":"list"}]}',
                probeExitCode: 0
            });
            s.askResponses.push([{ picked: [] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--reviewer-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("Ctrl+C during the claude worker model custom free-text input exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // worker model -> custom
            (s.contexts.ask as { askText:typeof s.contexts.ask.askText }).askText = () => Promise.reject(new Error("readline closed"));
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("disposed during the claude worker model choice returns 1", {
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
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolvePrompt()!([{ picked: [{ label: "Opus" }] }]);
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("disposed during the claude worker model custom free-text input returns 1", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // worker model -> custom
            let resolveText:((v:string) => void) | null = null;
            (s.contexts.ask as { askText:typeof s.contexts.ask.askText }).askText = (prompt) => {
                s.askedTextPrompts.push(prompt);
                return new Promise<string>(resolve => {
                    resolveText = resolve;
                });
            };
            return { ...s, getResolveText: () => resolveText };
        },
        async ACT({ contexts, getResolveText }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            while (!getResolveText()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolveText()!("typed-after-dispose");
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("claude reviewer custom model entry persists the typed value verbatim", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // reviewer model -> custom
            s.askTextResponses.push("  Sonnet-Rev-Custom  "); // reviewer model custom text
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config reviewer.model is the typed custom value verbatim (surrounding whitespace and mixed case preserved, not trimmed or case-folded)"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.model, "  Sonnet-Rev-Custom  ");
            }
        }
    });

    test("disposed during model probe returns 1", {
        ARRANGE() {
            const s = stubContexts();
            let resolveExit:(() => void)|null = null;
            let cmdRef:Install|null = null;
            (s.contexts as { script:ScriptContext }).script = {
                spawn(_command:string, args:readonly string[]):SpawnedProcess {
                    if (args[0] === "debug" && args[1] === "models") {
                        let exitListener:ExitListener|null = null;
                        return {
                            on(event:"exit"|"error", listener:never) {
                                if (event === "exit") {
                                    exitListener = listener;
                                    resolveExit = () => exitListener?.(0, null);
                                }
                            },
                            kill() {},
                            stdout: { on() {} },
                            stderr: { on() {} }
                        };
                    }
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
            return { ...s, setCmdRef: (cmd:Install) => { cmdRef = cmd; }, getResolveExit: () => resolveExit, getCmdRef: () => cmdRef };
        },
        async ACT({ contexts, setCmdRef, getResolveExit }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--reviewer-tool=claude"], { projectRoot: "/proj" }, contexts);
            setCmdRef(cmd);
            while (!getResolveExit()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolveExit()!();
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("config persists both worker and reviewer model values", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[{"slug":"model-a","visibility":"list"},{"slug":"model-b","visibility":"list"}]}',
                probeExitCode: 0
            });
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                }
                const response = s.askResponses.shift();
                return Promise.resolve(response ?? []);
            };
            s.askResponses.push([{ picked: [{ label: "model-a" }] }]);
            s.askResponses.push([{ picked: [{ label: "model-b" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config worker.model is model-a"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.worker.model, "model-a");
            },
            "config reviewer.model is model-b"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.reviewers[0].model, "model-b");
            },
            "config worker.tool is codex"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.worker.tool, "codex");
            },
            "config reviewer.tool is codex"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.reviewers[0].tool, "codex");
            }
        }
    });

    test("Ctrl+C during reviewer model askChoice exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[{"slug":"m1","visibility":"list"}]}',
                probeExitCode: 0
            });
            s.askResponses.push([{ picked: [{ label: "m1" }] }]);
            s.askResponses.push([{ picked: [] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("reviewer picking default configured model persists as empty string", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[{"slug":"gpt-5-codex","visibility":"list"},{"slug":"gpt-4.1","visibility":"list"}]}',
                probeExitCode: 0
            });
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                }
                const response = s.askResponses.shift();
                return Promise.resolve(response ?? []);
            };
            s.askResponses.push([{ picked: [{ label: "gpt-5-codex" }] }]);
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config reviewer.model is empty string"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.reviewers[0].model, "");
            },
            "config worker.model is gpt-5-codex"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.worker.model, "gpt-5-codex");
            }
        }
    });
});

test.describe("Install effort question", test => {
    test("codex tool uses askChoice with exactly six options in listed order", {
        ARRANGE() {
            const s = stubContexts();
            let capturedOptions:readonly { label:string; description?:string }[] = [];
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                    if (q.header === "Worker effort") {
                        capturedOptions = q.options;
                    }
                }
                const response = s.askResponses.shift();
                return Promise.resolve(response ?? []);
            };
            s.askResponses.push([{ picked: [{ label: "high" }] }]);
            return { ...s, getCapturedOptions: () => capturedOptions };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "Worker effort header is present"(_code, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Worker effort"));
            },
            "option labels are exactly the six expected values in order"(_code, { getCapturedOptions }) {
                Assert.deepStrictEqual(
                    getCapturedOptions().map(o => o.label),
                    ["minimal", "low", "medium", "high", "xhigh", "default configured effort"]
                );
            }
        }
    });

    test("claude tool renders a curated effort list ending with the synthetic default then the custom entry for worker effort", {
        ARRANGE() {
            const s = stubContexts();
            let capturedOptions:readonly { label:string; description?:string }[] = [];
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                    if (q.header === "Worker effort") {
                        capturedOptions = q.options;
                    }
                }
                const response = s.askResponses.shift();
                return Promise.resolve(response ?? []);
            };
            s.askResponses.push([{ picked: [{ label: "high" }] }]); // worker effort
            return { ...s, getCapturedOptions: () => capturedOptions };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "Worker effort header is present"(_code, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Worker effort"));
            },
            "options are exactly the curated levels, then the synthetic default, then the custom entry, in order"(_code, { getCapturedOptions }) {
                Assert.deepStrictEqual(
                    getCapturedOptions().map(o => o.label),
                    ["low", "medium", "high", "xhigh", "max", "default configured effort", "enter a custom value…"]
                );
            }
        }
    });

    test("claude effort list is not pre-filtered by the chosen model — all five levels are always offered", {
        ARRANGE() {
            const s = stubContexts();
            let capturedEffortOptions:readonly { label:string; description?:string }[] = [];
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                    if (q.header === "Worker effort") {
                        capturedEffortOptions = q.options;
                    }
                }
                const response = s.askResponses.shift();
                return Promise.resolve(response ?? []);
            };
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // worker model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Latest Opus" }] }]); // worker submenu -> a specific curated model
            s.askResponses.push([{ picked: [{ label: "max" }] }]); // worker effort
            return { ...s, getCapturedEffortOptions: () => capturedEffortOptions };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "all five curated effort levels (plus default and custom) are offered regardless of the chosen model"(_code, { getCapturedEffortOptions }) {
                Assert.deepStrictEqual(
                    getCapturedEffortOptions().map(o => o.label),
                    ["low", "medium", "high", "xhigh", "max", "default configured effort", "enter a custom value…"]
                );
            }
        }
    });

    test("claude picking a curated effort level persists that level verbatim", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "xhigh" }] }]); // worker effort
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.effort is exactly the picked level"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.effort, "xhigh");
            }
        }
    });

    test("claude picking the synthetic default configured effort persists as empty string", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.effort is empty string"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.effort, "");
            }
        }
    });

    test("claude custom effort entry opens a free-text input and persists the typed value verbatim", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // worker effort -> custom
            s.askTextResponses.push("  Ultra-Effort-9  "); // worker effort custom text
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.effort is the typed custom value verbatim (surrounding whitespace and mixed case preserved, not trimmed or case-folded)"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.effort, "  Ultra-Effort-9  ");
            },
            "the custom free-text prompt is the worker effort question with its placeholder"(_result, { askedTextPrompts }) {
                Assert.ok(askedTextPrompts.includes("What effort level should the worker use? (leave empty for the default configured effort): "));
            }
        }
    });

    test("claude custom effort entry with an empty typed value persists the empty string", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // worker effort -> custom
            // askTextResponses left empty -> the custom free-text input returns ""
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.effort is empty string"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.effort, "");
            }
        }
    });

    test("claude reviewer custom effort entry persists the typed value verbatim", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // reviewer effort -> custom
            s.askTextResponses.push("  Rev-Effort-Custom  "); // reviewer effort custom text
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config reviewer.effort is the typed custom value verbatim (surrounding whitespace and mixed case preserved, not trimmed or case-folded)"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.effort, "  Rev-Effort-Custom  ");
            }
        }
    });

    test("picking default configured effort from codex list persists as empty string", {
        ARRANGE() {
            const s = stubContexts();
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                }
                const response = s.askResponses.shift();
                return Promise.resolve(response ?? []);
            };
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config worker.effort is empty string"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.worker.effort, "");
            }
        }
    });

    test("picking high from codex list persists exactly high", {
        ARRANGE() {
            const s = stubContexts();
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                }
                const response = s.askResponses.shift();
                return Promise.resolve(response ?? []);
            };
            s.askResponses.push([{ picked: [{ label: "high" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config worker.effort is exactly high"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.worker.effort, "high");
            }
        }
    });

    test("--worker-effort=high skips prompt and persists high", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=high", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config worker.effort is high"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.worker.effort, "high");
            },
            "no askText called for worker effort"(_code, { askedTextPrompts }) {
                const effortPrompts = askedTextPrompts.filter(p => p.includes("effort"));
                Assert.strictEqual(effortPrompts.length, 0);
            }
        }
    });

    test("--worker-effort= (empty) skips prompt and persists empty string", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config worker.effort is empty string"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.worker.effort, "");
            },
            "no askText called for worker effort"(_code, { askedTextPrompts }) {
                const effortPrompts = askedTextPrompts.filter(p => p.includes("effort"));
                Assert.strictEqual(effortPrompts.length, 0);
            }
        }
    });

    test("--worker-effort=ludicrous with --worker-tool=codex is rejected at flag validation", {
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
            const cmd = new Install(["--worker-effort=ludicrous", "--worker-tool=codex"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exact"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid value for --worker-effort: \"ludicrous\". Allowed values: minimal, low, medium, high, xhigh.\n");
            },
            "no interactive prompt was called"(_code, { wasAskCalled }) {
                Assert.strictEqual(wasAskCalled(), false);
            }
        }
    });

    test("--reviewer-effort=ludicrous with --reviewer-tool=codex is rejected at flag validation", {
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
            const cmd = new Install(["--reviewer-effort=ludicrous", "--reviewer-tool=codex"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exact"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid value for --reviewer-effort: \"ludicrous\". Allowed values: minimal, low, medium, high, xhigh.\n");
            },
            "no interactive prompt was called"(_code, { wasAskCalled }) {
                Assert.strictEqual(wasAskCalled(), false);
            }
        }
    });

    test("--worker-effort=ludicrous with --worker-tool=claude is accepted (free-text for claude)", {
        ARRANGE() {
            return {};
        },
        ACT() {
            return parseInstallFlags(["--worker-effort=ludicrous", "--worker-tool=claude"]);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { workerTool: "claude", workerEffort: "ludicrous" }
            });
        }
    });

    test("--worker-effort= with --worker-tool=codex is accepted (empty means default)", {
        ARRANGE() {
            return {};
        },
        ACT() {
            return parseInstallFlags(["--worker-effort=", "--worker-tool=codex"]);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { workerTool: "codex", workerEffort: "" }
            });
        }
    });

    test("Ctrl+C during worker effort askChoice exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-model="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("Ctrl+C during the claude worker effort choice exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [] }]); // worker effort choice -> Ctrl+C
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("Ctrl+C during the claude worker effort custom free-text input exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // worker effort -> custom
            (s.contexts.ask as { askText:typeof s.contexts.ask.askText }).askText = () => Promise.reject(new Error("readline closed"));
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("disposed during the claude worker effort choice returns 1", {
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
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolvePrompt()!([{ picked: [{ label: "high" }] }]);
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("disposed during the claude worker effort custom free-text input returns 1", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // worker effort -> custom
            let resolveText:((v:string) => void) | null = null;
            (s.contexts.ask as { askText:typeof s.contexts.ask.askText }).askText = (prompt) => {
                s.askedTextPrompts.push(prompt);
                return new Promise<string>(resolve => {
                    resolveText = resolve;
                });
            };
            return { ...s, getResolveText: () => resolveText };
        },
        async ACT({ contexts, getResolveText }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            while (!getResolveText()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolveText()!("typed-after-dispose");
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("reviewer effort codex uses askChoice and persists selection", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "medium" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config reviewer.effort is medium"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.reviewers[0].effort, "medium");
            },
            "Reviewer effort header present"(_code, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Reviewer effort"));
            }
        }
    });

    test("Ctrl+C during reviewer effort askChoice exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });

    test("reviewer effort codex picking default configured effort persists empty string", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]);
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config reviewer.effort is empty string"(_code, { files }) {
                const config = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(config.reviewers[0].effort, "");
            }
        }
    });

    test("Ctrl+C during the claude reviewer effort choice exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [] }]); // reviewer effort choice -> Ctrl+C
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no files written"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });
});

test.describe("stripYamlFrontmatter", test => {
    test("strips a leading YAML frontmatter block", {
        ARRANGE() {
            return { body: "---\ndescription: foo\n---\n\nBody content here." };
        },
        ACT({ body }) {
            return stripYamlFrontmatter(body);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "\nBody content here.");
        }
    });

    test("returns body unchanged when no leading ---", {
        ARRANGE() {
            return { body: "No frontmatter here.\nJust text." };
        },
        ACT({ body }) {
            return stripYamlFrontmatter(body);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "No frontmatter here.\nJust text.");
        }
    });

    test("returns body unchanged when no closing ---", {
        ARRANGE() {
            return { body: "---\nunclosed frontmatter\nmore text" };
        },
        ACT({ body }) {
            return stripYamlFrontmatter(body);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "---\nunclosed frontmatter\nmore text");
        }
    });

    test("handles CRLF line endings", {
        ARRANGE() {
            return { body: "---\r\nkey: value\r\n---\r\nBody after CRLF." };
        },
        ACT({ body }) {
            return stripYamlFrontmatter(body);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "Body after CRLF.");
        }
    });

    test("preserves body verbatim after frontmatter", {
        ARRANGE() {
            return { body: "---\nkey: value\n---\nLine 1\nLine 2\n---\nLine 3" };
        },
        ACT({ body }) {
            return stripYamlFrontmatter(body);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "Line 1\nLine 2\n---\nLine 3");
        }
    });
});

test.describe("Install skills-tool=codex", test => {
    test("writes exactly three Codex prompt files and zero Claude files", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/myproject" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "creates flanders-plan.md under .codex/prompts"(_code, { files }) {
                Assert.ok(files.has("/myproject/.codex/prompts/flanders-plan.md"));
            },
            "creates flanders-spec.md under .codex/prompts"(_code, { files }) {
                Assert.ok(files.has("/myproject/.codex/prompts/flanders-spec.md"));
            },
            "creates flanders-work.md under .codex/prompts"(_code, { files }) {
                Assert.ok(files.has("/myproject/.codex/prompts/flanders-work.md"));
            },
            "flanders-plan.md filename is exactly flanders-plan.md"(_code, { files }) {
                const paths = [...files.keys()].filter(p => p.includes(".codex/prompts/flanders-plan"));
                Assert.strictEqual(paths.length, 1);
                Assert.strictEqual(paths[0], "/myproject/.codex/prompts/flanders-plan.md");
            },
            "flanders-spec.md filename is exactly flanders-spec.md"(_code, { files }) {
                const paths = [...files.keys()].filter(p => p.includes(".codex/prompts/flanders-spec"));
                Assert.strictEqual(paths.length, 1);
                Assert.strictEqual(paths[0], "/myproject/.codex/prompts/flanders-spec.md");
            },
            "flanders-work.md filename is exactly flanders-work.md"(_code, { files }) {
                const paths = [...files.keys()].filter(p => p.includes(".codex/prompts/flanders-work"));
                Assert.strictEqual(paths.length, 1);
                Assert.strictEqual(paths[0], "/myproject/.codex/prompts/flanders-work.md");
            },
            "no files under .claude/skills"(_code, { files }) {
                const claudePaths = [...files.keys()].filter(p => p.includes(".claude/skills"));
                Assert.strictEqual(claudePaths.length, 0);
            },
            "writes exactly 4 files total (3 codex + 1 config)"(_code, { files }) {
                Assert.strictEqual(files.size, 4);
            }
        }
    });

    test("Codex artifacts have YAML frontmatter stripped", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            await cmd.result();
            await cmd.dispose();
        },
        ASSERTS: {
            "flanders-plan codex artifact does not start with ---"(_, { files }) {
                const content = files.get("/proj/.codex/prompts/flanders-plan.md")!;
                Assert.ok(!content.startsWith("---"), "codex artifact must not start with YAML frontmatter");
            },
            "flanders-spec codex artifact does not start with ---"(_, { files }) {
                const content = files.get("/proj/.codex/prompts/flanders-spec.md")!;
                Assert.ok(!content.startsWith("---"), "codex artifact must not start with YAML frontmatter");
            },
            "flanders-work codex artifact does not start with ---"(_, { files }) {
                const content = files.get("/proj/.codex/prompts/flanders-work.md")!;
                Assert.ok(!content.startsWith("---"), "codex artifact must not start with YAML frontmatter");
            },
            "flanders-plan codex artifact equals stripYamlFrontmatter(planSkillBody)"(_, { files }) {
                const content = files.get("/proj/.codex/prompts/flanders-plan.md")!;
                Assert.strictEqual(content, stripYamlFrontmatter(planSkillBody));
            },
            "flanders-spec codex artifact equals stripYamlFrontmatter(specSkillBody)"(_, { files }) {
                const content = files.get("/proj/.codex/prompts/flanders-spec.md")!;
                Assert.strictEqual(content, stripYamlFrontmatter(specSkillBody));
            },
            "flanders-work codex artifact equals stripYamlFrontmatter(workSkillBody)"(_, { files }) {
                const content = files.get("/proj/.codex/prompts/flanders-work.md")!;
                Assert.strictEqual(content, stripYamlFrontmatter(workSkillBody));
            }
        }
    });

    test("Codex artifacts with global scope write under homedir", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--global", "--skills-tool=codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "creates flanders-plan.md under homedir .codex/prompts"(_code, { files }) {
                Assert.ok(files.has("/home/testuser/.codex/prompts/flanders-plan.md"));
            },
            "creates flanders-spec.md under homedir .codex/prompts"(_code, { files }) {
                Assert.ok(files.has("/home/testuser/.codex/prompts/flanders-spec.md"));
            },
            "creates flanders-work.md under homedir .codex/prompts"(_code, { files }) {
                Assert.ok(files.has("/home/testuser/.codex/prompts/flanders-work.md"));
            }
        }
    });
});

test.describe("Install skills-tool=both", test => {
    test("writes six skill files (3 Claude + 3 Codex) plus config", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=both", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "creates Claude flanders-spec SKILL.md"(_code, { files }) {
                Assert.ok(files.has("/proj/.claude/skills/flanders-spec/SKILL.md"));
            },
            "creates Claude flanders-plan SKILL.md"(_code, { files }) {
                Assert.ok(files.has("/proj/.claude/skills/flanders-plan/SKILL.md"));
            },
            "creates Claude flanders-work SKILL.md"(_code, { files }) {
                Assert.ok(files.has("/proj/.claude/skills/flanders-work/SKILL.md"));
            },
            "creates Codex flanders-spec.md"(_code, { files }) {
                Assert.ok(files.has("/proj/.codex/prompts/flanders-spec.md"));
            },
            "creates Codex flanders-plan.md"(_code, { files }) {
                Assert.ok(files.has("/proj/.codex/prompts/flanders-plan.md"));
            },
            "creates Codex flanders-work.md"(_code, { files }) {
                Assert.ok(files.has("/proj/.codex/prompts/flanders-work.md"));
            },
            "writes exactly 7 files total (6 skills + 1 config)"(_code, { files }) {
                Assert.strictEqual(files.size, 7);
            },
            "Claude artifact has frontmatter"(_code, { files }) {
                Assert.ok(files.get("/proj/.claude/skills/flanders-spec/SKILL.md")!.startsWith("---\n"));
            },
            "Codex artifact has no frontmatter"(_code, { files }) {
                Assert.ok(!files.get("/proj/.codex/prompts/flanders-spec.md")!.startsWith("---"));
            }
        }
    });
});

test.describe("Install skills-tool stdout enumeration", test => {
    test("with skills-tool=codex, stdout includes every Codex path", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            await cmd.result();
            await cmd.dispose();
        },
        ASSERTS: {
            "stdout includes flanders-spec.md path"(_, { written }) {
                Assert.ok(written.join("").includes("/proj/.codex/prompts/flanders-spec.md"));
            },
            "stdout includes flanders-plan.md path"(_, { written }) {
                Assert.ok(written.join("").includes("/proj/.codex/prompts/flanders-plan.md"));
            },
            "stdout includes flanders-work.md path"(_, { written }) {
                Assert.ok(written.join("").includes("/proj/.codex/prompts/flanders-work.md"));
            },
            "stdout includes config path"(_, { written }) {
                Assert.ok(written.join("").includes(".flanders/config.json"));
            },
            "outputs exactly 4 lines"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.strictEqual(lines.length, 4);
            }
        }
    });

    test("with skills-tool=both, stdout includes all 6 skill paths plus config", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=both", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            await cmd.result();
            await cmd.dispose();
        },
        ASSERTS: {
            "stdout includes Claude spec skill path"(_, { written }) {
                Assert.ok(written.join("").includes("/proj/.claude/skills/flanders-spec/SKILL.md"));
            },
            "stdout includes Claude plan skill path"(_, { written }) {
                Assert.ok(written.join("").includes("/proj/.claude/skills/flanders-plan/SKILL.md"));
            },
            "stdout includes Claude work skill path"(_, { written }) {
                Assert.ok(written.join("").includes("/proj/.claude/skills/flanders-work/SKILL.md"));
            },
            "stdout includes Codex spec prompt path"(_, { written }) {
                Assert.ok(written.join("").includes("/proj/.codex/prompts/flanders-spec.md"));
            },
            "stdout includes Codex plan prompt path"(_, { written }) {
                Assert.ok(written.join("").includes("/proj/.codex/prompts/flanders-plan.md"));
            },
            "stdout includes Codex work prompt path"(_, { written }) {
                Assert.ok(written.join("").includes("/proj/.codex/prompts/flanders-work.md"));
            },
            "stdout includes config path"(_, { written }) {
                Assert.ok(written.join("").includes(".flanders/config.json"));
            },
            "outputs exactly 7 lines"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.strictEqual(lines.length, 7);
            }
        }
    });
});

test.describe("Install validator-host wording preserved in skill bodies", test => {
    test("planSkillBody contains both required subagent-mechanism substrings", {
        ARRANGE() {},
        ACT() {
            return planSkillBody;
        },
        ASSERTS: {
            "contains 'via the AI tool\\'s subagent mechanism'"(body) {
                Assert.ok(body.includes("via the AI tool's subagent mechanism"));
            },
            "contains tool-specific subagent sentence"(body) {
                Assert.ok(body.includes("In Claude Code, the host spawns the validator through the Agent tool. In Codex CLI, the host spawns it through whatever Codex documents as its subagent surface at the time of the run."));
            }
        }
    });

    test("specSkillBody contains both required subagent-mechanism substrings", {
        ARRANGE() {},
        ACT() {
            return specSkillBody;
        },
        ASSERTS: {
            "contains 'via the AI tool\\'s subagent mechanism'"(body) {
                Assert.ok(body.includes("via the AI tool's subagent mechanism"));
            },
            "contains tool-specific subagent sentence"(body) {
                Assert.ok(body.includes("In Claude Code, the host spawns the validator through the Agent tool. In Codex CLI, the host spawns it through whatever Codex documents as its subagent surface at the time of the run."));
            }
        }
    });

    test("deprecated literal 'via the Agent tool' does not appear in either body", {
        ARRANGE() {},
        ACT() {
            return { plan: planSkillBody, spec: specSkillBody };
        },
        ASSERTS: {
            "planSkillBody does not contain deprecated literal"({ plan }) {
                const matches = plan.split("via the Agent tool").length - 1;
                Assert.strictEqual(matches, 0);
            },
            "specSkillBody does not contain deprecated literal"({ spec }) {
                const matches = spec.split("via the Agent tool").length - 1;
                Assert.strictEqual(matches, 0);
            }
        }
    });
});

test.describe("Install disposed during codex write", test => {
    test("disposed during codex skill write returns 1", {
        ARRANGE() {
            const s = stubContexts();
            let writeCount = 0;
            let cmdRef:Install | null = null;
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = async (p, content) => {
                await origWriteFile(p, content);
                writeCount++;
                if (writeCount === 1 && cmdRef) {
                    void cmdRef.dispose();
                }
            };
            return { ...s, setCmdRef: (cmd:Install) => { cmdRef = cmd; } };
        },
        async ACT({ contexts, setCmdRef }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            setCmdRef(cmd);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "first codex skill file is written"(_code, { files }) {
                Assert.ok(files.has("/proj/.codex/prompts/flanders-spec.md"));
            },
            "second codex skill file is not written"(_code, { files }) {
                Assert.ok(!files.has("/proj/.codex/prompts/flanders-plan.md"));
            }
        }
    });
});

test.describe("Install codex mkdir failure", test => {
    test("codex prompts mkdir failure exits non-zero with path in diagnostic", {
        ARRANGE() {
            const s = stubContexts();
            const origMkdir = s.contexts.fs.mkdir.bind(s.contexts.fs);
            (s.contexts.fs as { mkdir:typeof s.contexts.fs.mkdir }).mkdir = (p:string, o?:unknown) => {
                if (p.includes(".codex/prompts")) {
                    return Promise.reject(new Error(`EACCES: ${p}`));
                }
                return origMkdir(p, o as { recursive?:boolean });
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with non-zero code"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the codex prompts path"(_code, { errors }) {
                Assert.ok(errors.join("").includes(".codex/prompts"));
            }
        }
    });

    test("codex writeFile failure exits non-zero with path in diagnostic", {
        ARRANGE() {
            const s = stubContexts();
            const origWriteFile = s.contexts.fs.writeFile.bind(s.contexts.fs);
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p:string, content:string) => {
                if (p.includes(".codex/prompts")) {
                    return Promise.reject(new Error(`EACCES: ${p}`));
                }
                return origWriteFile(p, content);
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with non-zero code"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the file path"(_code, { errors }) {
                Assert.ok(errors.join("").includes(".codex/prompts/flanders-spec.md"));
            }
        }
    });
});

test.describe("Install config persistence (3.7)", test => {
    test("config read back via FlandersConfig.read equals expected literal", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(
                ["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=opus", "--worker-effort=high", "--reviewer-tool=codex", "--reviewer-model=gpt-5", "--reviewer-effort=medium"],
                { projectRoot: "/proj" },
                contexts
            );
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "read-back equals expected FlandersConfig literal"({ config }) {
                const expected:FlandersConfig = {
                    worker: { tool: "claude", model: "opus", effort: "high" },
                    reviewers: [{ tool: "codex", model: "gpt-5", effort: "medium" }]
                };
                Assert.deepStrictEqual(config, expected);
            }
        }
    });

    test("global scope writes config at homeDir not projectRoot", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(
                ["--global", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="],
                { projectRoot: "/proj" },
                contexts
            );
            await cmd.result();
            await cmd.dispose();
        },
        ASSERTS: {
            "config exists at homeDir"(_, { files }) {
                Assert.strictEqual(files.has("/home/testuser/.flanders/config.json"), true);
            },
            "config does NOT exist at projectRoot"(_, { files }) {
                Assert.strictEqual(files.has("/proj/.flanders/config.json"), false);
            }
        }
    });

    test("overwrites pre-existing config with exactly one writeFile", {
        ARRANGE() {
            const s = stubContexts();
            s.files.set("/proj/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "old-model", effort: "old" },
                reviewers: [{ tool: "claude", model: "old-rev", effort: "old" }]
            }, null, 2) + "\n");
            const writeCalls:Array<{ path:string; content:string }> = [];
            (s.contexts.fs as { writeFile:typeof s.contexts.fs.writeFile }).writeFile = (p, content) => {
                writeCalls.push({ path: p, content });
                s.files.set(p, content);
                return Promise.resolve();
            };
            return { ...s, writeCalls };
        },
        async ACT({ contexts }) {
            const cmd = new Install(
                ["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-model=  New-Model-X  ", "--worker-effort=high", "--reviewer-tool=claude", "--reviewer-model=  New-Rev-X  ", "--reviewer-effort=low"],
                { projectRoot: "/proj" },
                contexts
            );
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "exactly one writeFile to config path"(_result, { writeCalls }) {
                const configWrites = writeCalls.filter(c => c.path.includes(".flanders/config.json"));
                Assert.strictEqual(configWrites.length, 1);
            },
            "final content matches new answers"({ config }) {
                Assert.deepStrictEqual(config, {
                    worker: { tool: "codex", model: "  New-Model-X  ", effort: "high" },
                    reviewers: [{ tool: "claude", model: "  New-Rev-X  ", effort: "low" }]
                });
            }
        }
    });

    test("persisted JSON contains only worker and reviewers keys", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(
                ["--project", "--skills-tool=both", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-effort="],
                { projectRoot: "/proj" },
                contexts
            );
            await cmd.result();
            await cmd.dispose();
        },
        ASSERT(_, { files }) {
            const content = files.get("/proj/.flanders/config.json")!;
            Assert.deepStrictEqual(Object.keys(JSON.parse(content)).sort(), ["reviewers", "worker"]);
        }
    });

    test("stdout includes config path on its own line", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(
                ["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="],
                { projectRoot: "/proj" },
                contexts
            );
            await cmd.result();
            await cmd.dispose();
        },
        ASSERT(_, { written }) {
            const lines = written.join("").split("\n").filter(l => l.length > 0);
            const configLines = lines.filter(l => l === "/proj/.flanders/config.json");
            Assert.strictEqual(configLines.length, 1);
        }
    });
});

test.describe("Install indexed reviewer flags (multiple reviewers)", test => {
    test("--reviewer-2-tool with no reviewer-1 flags is rejected as a gap", {
        ARRANGE() {
            return { args: ["--project", "--skills-tool=claude", "--worker-tool=claude", "--reviewer-2-tool=claude"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERTS: {
            "returns ok:false"(result) {
                Assert.strictEqual(result.ok, false);
            },
            "diagnostic names the gap"(result) {
                if (result.ok) {
                    throw new Error("expected failure");
                }
                Assert.ok(result.diagnostic.includes("missing reviewer 1"));
            }
        }
    });

    test("--reviewer-3-tool with --reviewer-tool but no reviewer-2 is rejected", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-3-tool=codex"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERTS: {
            "returns ok:false"(result) {
                Assert.strictEqual(result.ok, false);
            },
            "diagnostic names the missing reviewer 2"(result) {
                if (result.ok) {
                    throw new Error("expected failure");
                }
                Assert.ok(result.diagnostic.includes("missing reviewer 2"));
            }
        }
    });

    test("--reviewer-1-tool is rejected (reviewer 1 uses unindexed flags)", {
        ARRANGE() {
            return { args: ["--reviewer-1-tool=claude"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: `Invalid reviewer flag: "--reviewer-1-tool=claude". Reviewer 1 uses --reviewer-tool/-model/-effort; --reviewer-N-* requires N >= 2.\n`
            });
        }
    });

    test("--reviewer-2-tool=bad returns a closed-set diagnostic", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-tool=bad"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERTS: {
            "returns ok:false"(result) {
                Assert.strictEqual(result.ok, false);
            },
            "diagnostic names --reviewer-2-tool and the bad value"(result) {
                if (result.ok) {
                    throw new Error("expected failure");
                }
                Assert.strictEqual(result.diagnostic, `Invalid value for --reviewer-2-tool: "bad". Allowed values: claude, codex.\n`);
            }
        }
    });

    test("--reviewer-2-effort=ludicrous with --reviewer-2-tool=codex is rejected", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-tool=codex", "--reviewer-2-effort=ludicrous"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERTS: {
            "returns ok:false"(result) {
                Assert.strictEqual(result.ok, false);
            },
            "diagnostic names --reviewer-2-effort"(result) {
                if (result.ok) {
                    throw new Error("expected failure");
                }
                Assert.strictEqual(result.diagnostic, `Invalid value for --reviewer-2-effort: "ludicrous". Allowed values: minimal, low, medium, high, xhigh.\n`);
            }
        }
    });

    test("--reviewer-2-effort=ludicrous BEFORE --reviewer-2-tool=codex is still rejected (argv order independent)", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-effort=ludicrous", "--reviewer-2-tool=codex"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: `Invalid value for --reviewer-2-effort: "ludicrous". Allowed values: minimal, low, medium, high, xhigh.\n`
            });
        }
    });

    test("--reviewer-2-effort=high BEFORE --reviewer-2-tool=codex is still accepted (argv order independent)", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-effort=high", "--reviewer-2-tool=codex"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { reviewers: [{ tool: "claude" }, { tool: "codex", effort: "high" }] }
            });
        }
    });

    test("--reviewer-2-effort=high BEFORE --reviewer-2-tool=claude is accepted (claude takes free-text efforts)", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-effort=ludicrous", "--reviewer-2-tool=claude"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { reviewers: [{ tool: "claude" }, { tool: "claude", effort: "ludicrous" }] }
            });
        }
    });

    test("--reviewer-model alone (without --reviewer-tool) is accepted", {
        ARRANGE() {
            return { args: ["--reviewer-model=opus"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { reviewers: [{ model: "opus" }] }
            });
        }
    });

    test("--reviewer-effort alone (without --reviewer-tool) is accepted", {
        ARRANGE() {
            return { args: ["--reviewer-effort=high"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { reviewers: [{ effort: "high" }] }
            });
        }
    });

    test("contiguous --reviewer-tool and --reviewer-2-tool produces a 2-element reviewers list", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-tool=codex", "--reviewer-2-model=gpt-5", "--reviewer-2-effort=high"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { reviewers: [{ tool: "claude" }, { tool: "codex", model: "gpt-5", effort: "high" }] }
            });
        }
    });

    test("two reviewer flags via --reviewer-N-* produce both entries in order", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install([
                "--project",
                "--skills-tool=claude",
                "--worker-tool=claude",
                "--worker-model=",
                "--worker-effort=",
                "--reviewer-tool=claude",
                "--reviewer-model=",
                "--reviewer-effort=",
                "--reviewer-2-tool=codex",
                "--reviewer-2-effort="
            ], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config has two reviewers in configured order"(_code, { files }) {
                const cfg = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(cfg.reviewers.length, 2);
                Assert.strictEqual(cfg.reviewers[0].tool, "claude");
                Assert.strictEqual(cfg.reviewers[1].tool, "codex");
            },
            "Configure another reviewer? is NOT prompted when any reviewer flag is present"(_code, { askedHeaders }) {
                Assert.ok(!askedHeaders.includes("Configure another reviewer?"));
            }
        }
    });

    test("--reviewer-2-tool with no --reviewer-2-model still prompts reviewer 2 model as a curated choice", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // reviewer 2 model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Latest Opus" }] }]); // reviewer 2 submenu -> Latest Opus
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([
                "--project",
                "--skills-tool=claude",
                "--worker-tool=claude",
                "--worker-model=",
                "--worker-effort=",
                "--reviewer-tool=claude",
                "--reviewer-model=",
                "--reviewer-effort=",
                "--reviewer-2-tool=claude",
                "--reviewer-2-effort="
            ], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "reviewer 2 model is asked through askChoice"(_result, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Reviewer 2 model"));
            },
            "config has reviewer 2 model = opus"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[1];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.model, "opus");
            }
        }
    });

});

test.describe("Install interactive Configure another reviewer? loop", test => {
    test("yes on first ask configures reviewer 2 and persists both reviewers", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // skills
            s.askResponses.push([{ picked: [{ label: "project" }] }]); // scope
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 1 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 1 effort
            s.askResponses.push([{ picked: [{ label: "yes" }] }]); // Configure another?
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 2 tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 2 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 2 effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // Configure another?
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "config has two reviewers in configured order"(_code, { files }) {
                const cfg = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(cfg.reviewers.length, 2);
                Assert.strictEqual(cfg.reviewers[0].tool, "claude");
                Assert.strictEqual(cfg.reviewers[1].tool, "claude");
            },
            "Configure another reviewer? is asked exactly twice (yes then no)"(_code, { askedHeaders }) {
                const count = askedHeaders.filter(h => h === "Configure another reviewer?").length;
                Assert.strictEqual(count, 2);
            },
            "Reviewer tool headers include reviewer 1 and reviewer 2"(_code, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Reviewer tool"));
                Assert.ok(askedHeaders.includes("Reviewer 2 tool"));
            }
        }
    });

    test("Ctrl+C during Configure another reviewer? prompt exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // skills
            s.askResponses.push([{ picked: [{ label: "project" }] }]); // scope
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [] }]); // Configure another? -> Ctrl+C
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
            "no config is written"(_code, { files }) {
                Assert.strictEqual(files.has("/proj/.flanders/config.json"), false);
            }
        }
    });

    test("disposed during Configure another reviewer? prompt returns 1", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // skills
            s.askResponses.push([{ picked: [{ label: "project" }] }]); // scope
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            let resolveAnotherPrompt:((v:readonly AskAnswer[]) => void) | null = null;
            let callIndex = 0;
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, output) => {
                callIndex++;
                if (callIndex === 9) {
                    return new Promise<readonly AskAnswer[]>(resolve => {
                        resolveAnotherPrompt = resolve;
                    });
                }
                return origAsk.call(s.contexts.ask, questions, output);
            };
            return { ...s, getResolvePrompt: () => resolveAnotherPrompt };
        },
        async ACT({ contexts, getResolvePrompt }) {
            const cmd = new Install([], { projectRoot: "/proj" }, contexts);
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolvePrompt()!([{ picked: [{ label: "no" }] }]);
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });
});
