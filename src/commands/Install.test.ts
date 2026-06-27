import * as Assert from "assert";

import test from "arrange-act-assert";

import { Install, parseInstallFlags } from "./Install";
import type { InstallContexts } from "./Install";
import { stripYamlFrontmatter } from "./skillArtifacts";
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
    const askedQuestions:string[] = [];
    const askedOptions:{ label:string; description?:string }[][] = [];
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
                    askedQuestions.push(q.question);
                    askedOptions.push(q.options.map(o => ({ label: o.label, description: o.description })));
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
    return { contexts, written, errors, files, dirs, askResponses, askedHeaders, askedQuestions, askedOptions, askedTextPrompts, askTextResponses };
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
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exactly the Cannot create destination message for the offending folder"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Cannot create destination: /proj/.claude/skills/flanders-spec\n");
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
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exactly the Cannot write file message for the offending SKILL.md path"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Cannot write file: /proj/.claude/skills/flanders-spec/SKILL.md\n");
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

    test("a non-AbortError from a single-select prompt is rethrown to the outer catch handler", {
        ARRANGE() {
            // --skills-tool is flag-supplied so the multi-select is skipped and the scope question
            // (a single-select going through promptChoice) is the first interactive prompt; its
            // non-AbortError rejection must propagate through promptChoice's rethrow to _run's catch.
            const s = stubContexts();
            (s.contexts.ask as { askChoices:typeof s.contexts.ask.askChoices }).askChoices = () => {
                throw new Error("scope prompt failure");
            };
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "error message includes the rethrown failure"(_code, { errors }) {
                Assert.ok(errors.join("").includes("scope prompt failure"));
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
                    "--skills-tool=claude,codex",
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
                    skillsTools: ["claude", "codex"],
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
                diagnostic: "Invalid value for --skills-tool: \"cursor\". Expected a comma-separated list of distinct names from: claude, codex.\n"
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

test.describe("parseInstallFlags weighted-review flags", test => {
    test("--reviewer-optional and --reviewer-2-optional record indices 1 and 2 (deferred without tool/model/effort flags)", {
        ARRANGE() {
            return { args: ["--reviewer-optional", "--reviewer-2-optional"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { optionalReviewerIndices: [1, 2] }
            });
        }
    });

    test("optional indices are deduplicated and sorted ascending regardless of argv order", {
        ARRANGE() {
            return { args: ["--reviewer-2-optional", "--reviewer-optional", "--reviewer-2-optional"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { optionalReviewerIndices: [1, 2] }
            });
        }
    });

    test("--reviewer-minimum=2 records the integer 2 (deferred without tool/model/effort flags)", {
        ARRANGE() {
            return { args: ["--reviewer-minimum=2"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { reviewerMinimum: 2 }
            });
        }
    });

    test("--reviewer-5-optional with no tool/model/effort flags is returned without a range error (deferred)", {
        ARRANGE() {
            return { args: ["--reviewer-5-optional"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: { optionalReviewerIndices: [5] }
            });
        }
    });

    test("--reviewer-minimum=abc is rejected naming the flag and value", {
        ARRANGE() {
            return { args: ["--reviewer-minimum=abc"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid value for --reviewer-minimum: \"abc\". Expected a non-negative integer.\n"
            });
        }
    });

    test("--reviewer-minimum=-1 (negative) is rejected naming the flag and value", {
        ARRANGE() {
            return { args: ["--reviewer-minimum=-1"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid value for --reviewer-minimum: \"-1\". Expected a non-negative integer.\n"
            });
        }
    });

    test("--reviewer-0-optional (N < 2) is rejected naming the flag", {
        ARRANGE() {
            return { args: ["--reviewer-0-optional"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid reviewer flag: \"--reviewer-0-optional\". Reviewer 1 uses --reviewer-optional; --reviewer-N-optional requires N >= 2.\n"
            });
        }
    });

    test("--reviewer-1-optional is a usage error: reviewer 1 uses the unindexed --reviewer-optional", {
        ARRANGE() {
            return { args: ["--reviewer-1-optional"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid reviewer flag: \"--reviewer-1-optional\". Reviewer 1 uses --reviewer-optional; --reviewer-N-optional requires N >= 2.\n"
            });
        }
    });

    test("flag-fixed two-reviewer list: --reviewer-minimum=3 is rejected as out of range", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-tool=codex", "--reviewer-minimum=3"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid value for --reviewer-minimum: \"3\". Must be an integer between 1 and 2.\n"
            });
        }
    });

    test("flag-fixed two-reviewer list: --reviewer-minimum=0 is rejected as out of range", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-tool=codex", "--reviewer-minimum=0"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid value for --reviewer-minimum: \"0\". Must be an integer between 1 and 2.\n"
            });
        }
    });

    test("flag-fixed two-reviewer list: --reviewer-3-optional is rejected as an index beyond the list", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-tool=codex", "--reviewer-3-optional"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid reviewer flag: --reviewer-3-optional references reviewer 3, beyond the configured reviewer list of 2.\n"
            });
        }
    });

    test("flag-fixed single-reviewer list: --reviewer-minimum=1 is a single-reviewer usage error", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-minimum=1"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid flag for a single-reviewer configuration: --reviewer-minimum. Weighted-review flags require two or more reviewers.\n"
            });
        }
    });

    test("flag-fixed single-reviewer list: --reviewer-optional is a single-reviewer usage error", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-optional"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid flag for a single-reviewer configuration: --reviewer-optional. Weighted-review flags require two or more reviewers.\n"
            });
        }
    });

    test("flag-fixed two-reviewer list: a below-count minimum and an in-range optional index are accepted", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-tool=codex", "--reviewer-minimum=1", "--reviewer-2-optional"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: {
                    reviewers: [{ tool: "claude" }, { tool: "codex" }],
                    optionalReviewerIndices: [2],
                    reviewerMinimum: 1
                }
            });
        }
    });

    test("flag-fixed two-reviewer list: --reviewer-minimum equal to the count combined with --reviewer-2-optional is a usage error", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-tool=codex", "--reviewer-minimum=2", "--reviewer-2-optional"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid flag combination: --reviewer-minimum equal to the reviewer count (2) leaves no reviewer that can be optional, so it cannot be combined with --reviewer[-N]-optional.\n"
            });
        }
    });

    test("flag-fixed two-reviewer list: an in-range minimum without any optional flag is accepted", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-tool=codex", "--reviewer-minimum=2"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: {
                    reviewers: [{ tool: "claude" }, { tool: "codex" }],
                    reviewerMinimum: 2
                }
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
                Assert.strictEqual(errors.join(""), "Invalid value for --skills-tool: \"cursor\". Expected a comma-separated list of distinct names from: claude, codex.\n");
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
            const cmd = new Install(["--project", "--skills-tool=claude,codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
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
                Assert.deepStrictEqual(askedHeaders, ["Skills tool", "Install destination", "Worker tool, neighborino", "Worker model", "Worker effort", "Reviewer tool", "Reviewer model", "Reviewer effort", "Configure another reviewer?"]);
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

test.describe("Install Flanders voice", test => {
    test("an occasional, varied soft Flanders touch seasons the interactive prompts", {
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
            "the skills tool question carries a soft touch"(_code, { askedQuestions }) {
                Assert.ok(askedQuestions.includes("Which AI tool(s) should the skills be installed for, neighbor?"));
            },
            "the worker tool header carries a soft touch"(_code, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Worker tool, neighborino"));
            },
            "the configure-another-reviewer question carries a soft touch"(_code, { askedQuestions }) {
                Assert.ok(askedQuestions.includes("Okely-dokely — care to configure another reviewer?"));
            },
            "the touch stays occasional: the worker model question is plain"(_code, { askedQuestions }) {
                Assert.ok(askedQuestions.includes("Which model should the worker use?"));
            },
            "the touch stays occasional: the worker effort question is plain"(_code, { askedQuestions }) {
                Assert.ok(askedQuestions.includes("What effort level should the worker use?"));
            }
        }
    });

    test("the invalid-minimum re-prompt status carries a soft touch while the minimum question stays plain", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // skills tool
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
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // Configure another? -> two reviewers
            s.askTextResponses.push("0"); // invalid -> re-prompt with the flavored status notice
            s.askTextResponses.push("2"); // valid (== T) -> every reviewer required, no optional prompts
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
            "the invalid-entry re-prompt status carries a soft touch"(_code, { written }) {
                Assert.ok(written.includes("Whoopsie — enter an integer between 1 and 2, or leave empty for 2.\n"));
            },
            "the touch stays occasional: the minimum-reviews question is plain"(_code, { askedTextPrompts }) {
                Assert.ok(askedTextPrompts.includes("Minimum reviewers that must run to a verdict in each review round (1-2, empty for 2): "));
            }
        }
    });

    test("printed file-path lines are exactly the paths, untouched by the voice", {
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
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "stdout is exactly the four path lines, each a bare path with no added prose"(_code, { written }) {
                Assert.deepStrictEqual(written, [
                    "/proj/.claude/skills/flanders-spec/SKILL.md\n",
                    "/proj/.claude/skills/flanders-plan/SKILL.md\n",
                    "/proj/.claude/skills/flanders-work/SKILL.md\n",
                    "/proj/.flanders/config.json\n"
                ]);
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
            s.askResponses.push([{ picked: [{ label: "claude" }, { label: "codex" }] }]); // skills tool (multi-select)
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
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // worker fast (Opus 4.8 supports fast mode) -> off
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
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // worker fast (Latest Opus supports fast mode) -> off
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // reviewer model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Latest Opus [1m context]" }] }]); // reviewer submenu -> Latest Opus 1M alias
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer fast (Latest Opus 1M supports fast mode) -> off
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
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // worker fast (Opus 4.8 1M supports fast mode) -> off
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
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // worker fast (Latest Opus supports fast mode) -> off
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // reviewer model -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Opus 4.6" }] }]); // reviewer submenu -> Opus 4.6 (no fast mode)
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
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // worker fast (Latest Opus supports fast mode) -> off
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

// Seeds a well-formed `.flanders/config.json` at the project scope so `install`'s pre-selection read
// (`readScope`) finds it. Mirrors the writer's serialization (two-space indent, trailing newline).
function seedProjectConfig(s:ReturnType<typeof stubContexts>, config:FlandersConfig) {
    s.files.set("/proj/.flanders/config.json", JSON.stringify(config, null, 2) + "\n");
}

// Captures every `askChoices` question together with its `defaultIndex` so a test can assert which
// option `install` pre-selected (the default Enter would accept) for each rendered prompt. Selection
// still flows through the existing `askResponses` queue. Lookups are keyed by the question text, which
// is unique per prompt (the claude family submenu differs from the top level by its question).
function captureChoiceDefaults(s:ReturnType<typeof stubContexts>) {
    const snapshots:{ question:string; options:readonly string[]; defaultIndex:number|undefined }[] = [];
    const origAsk = s.contexts.ask.askChoices;
    (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
        for (const q of questions) {
            s.askedHeaders.push(q.header);
            snapshots.push({ question: q.question, options: q.options.map(o => o.label), defaultIndex: q.defaultIndex });
        }
        const response = s.askResponses.shift();
        return Promise.resolve(response ?? []);
    };
    const labelOf = (sn:{ options:readonly string[]; defaultIndex:number|undefined }):string|undefined =>
        sn.defaultIndex !== undefined ? sn.options[sn.defaultIndex] : undefined;
    return {
        // The raw `defaultIndex` of the first question matching `question` (undefined when no default).
        defaultIndexFor: (question:string):number|undefined => snapshots.find(x => x.question === question)?.defaultIndex,
        // The label of the pre-selected option for the first question matching `question`, or
        // undefined when that question carried no forced default.
        defaultLabelFor: (question:string):string|undefined => {
            const sn = snapshots.find(x => x.question === question);
            return sn !== undefined ? labelOf(sn) : undefined;
        },
        // The pre-selected option label of every occurrence of `question`, in ask order. Lets a test
        // distinguish repeated prompts (e.g. the "Configure another reviewer?" question asked once per
        // reviewer) that a first-match lookup would collapse.
        allDefaultLabelsFor: (question:string):(string|undefined)[] =>
            snapshots.filter(x => x.question === question).map(labelOf),
        // The full option-label list offered for the first question matching `question`, in order, or
        // undefined when that question was not asked. Lets a test assert a prompt's exact option set
        // (e.g. that a yes/no prompt offers exactly `no` then `yes`).
        optionsFor: (question:string):readonly string[]|undefined => snapshots.find(x => x.question === question)?.options
    };
}

test.describe("Install worker pre-selection from an existing configuration (4.1)", test => {
    test("claude worker: tool, model family then submenu entry, and effort each default to the stored value", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "claude-opus-4-8", effort: "high", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // worker model top-level -> Opus family submenu
            s.askResponses.push([{ picked: [{ label: "Opus 4.8" }] }]); // worker model submenu
            s.askResponses.push([{ picked: [{ label: "high" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker tool prompt defaults to the stored tool claude"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which AI tool should the worker use?"), "claude");
            },
            "the worker model top-level menu defaults to the Opus family"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which model should the worker use?"), "Opus");
            },
            "the Opus submenu defaults to the Opus 4.8 entry"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which Opus model should the worker use?"), "Opus 4.8");
            },
            "the worker effort prompt defaults to the stored level high"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("What effort level should the worker use?"), "high");
            }
        }
    });

    test("claude worker model and effort default to the synthetic default entries when the stored values are the empty string", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker model menu defaults to the default configured model entry"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which model should the worker use?"), "default configured model");
            },
            "the worker effort list defaults to the default configured effort entry"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("What effort level should the worker use?"), "default configured effort");
            }
        }
    });

    test("claude worker model defaults to the cross-family alias entry when the stored model is the alias best", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "best", effort: "low", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "Best (auto-pick)" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "low" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker model menu defaults to the Best (auto-pick) cross-family alias entry"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which model should the worker use?"), "Best (auto-pick)");
            }
        }
    });

    test("claude worker model defaults to the custom entry pre-filled with the stored model when it is not catalogued", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "my-private-model", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // worker model -> custom
            // askTextResponses left empty -> the custom free-text input returns "" -> the default applies
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the worker model menu defaults to the custom entry"(_result, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which model should the worker use?"), "enter a custom value…");
            },
            "accepting the empty custom free-text reproduces the stored model verbatim"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "my-private-model");
            }
        }
    });

    test("claude worker effort defaults to the custom entry pre-filled with the stored effort when it is outside the curated set", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "", effort: "turbo", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "enter a custom value…" }] }]); // worker effort -> custom
            // askTextResponses left empty -> the custom free-text input returns "" -> the default applies
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the worker effort list defaults to the custom entry"(_result, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("What effort level should the worker use?"), "enter a custom value…");
            },
            "accepting the empty custom free-text reproduces the stored effort verbatim"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.effort, "turbo");
            }
        }
    });

    test("codex worker model defaults to the stored model when the probe still returns it", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[{"slug":"gpt-5-codex","visibility":"list"},{"slug":"gpt-4.1","visibility":"list"}]}',
                probeExitCode: 0
            });
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "codex", model: "gpt-5-codex", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "gpt-5-codex" }] }]); // worker model
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker model list defaults to the stored gpt-5-codex entry"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which model should the worker use?"), "gpt-5-codex");
            }
        }
    });

    test("codex worker model carries no forced default when the probe no longer returns the stored model", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[{"slug":"gpt-4.1","visibility":"list"}]}',
                probeExitCode: 0
            });
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "codex", model: "gpt-5-codex", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "gpt-4.1" }] }]); // worker model (answered actively)
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker model list has no forced default (defaultIndex undefined)"(_code, { cap }) {
                Assert.strictEqual(cap.defaultIndexFor("Which model should the worker use?"), undefined);
            }
        }
    });

    test("codex worker model defaults to the synthetic default entry for the empty stored model", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({
                probeStdout: '{"models":[{"slug":"gpt-5-codex","visibility":"list"},{"slug":"gpt-4.1","visibility":"list"}]}',
                probeExitCode: 0
            });
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "codex", model: "", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker model list defaults to the default configured model entry"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which model should the worker use?"), "default configured model");
            }
        }
    });

    test("codex worker effort defaults to the stored level", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "codex", model: "", effort: "high", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "high" }] }]); // worker effort
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=codex", "--worker-model=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker effort list defaults to the stored high level"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("What effort level should the worker use?"), "high");
            }
        }
    });

    test("codex worker effort defaults to the synthetic default entry for the empty stored effort", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "codex", model: "", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=codex", "--worker-model=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker effort list defaults to the default configured effort entry"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("What effort level should the worker use?"), "default configured effort");
            }
        }
    });

    test("codex worker model free-text fallback pre-fills the stored model when the probe yields no list", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({ probeExitCode: 1 });
            seedProjectConfig(s, {
                worker: { tool: "codex", model: "legacy-codex-model", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            // The probe yields no list -> the worker model question is a free-text input. With no
            // askText response queued, the input returns "" so the pre-fill default takes effect.
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "accepting the empty free-text reproduces the stored model verbatim"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "legacy-codex-model");
            }
        }
    });

    test("codex worker model free-text fallback resolves to the empty string for an empty stored model", {
        ARRANGE() {
            const s = stubContexts();
            (s.contexts as { script:ScriptContext }).script = makeModelScript({ probeExitCode: 1 });
            seedProjectConfig(s, {
                worker: { tool: "codex", model: "", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            // The probe yields no list -> free-text input. With no askText response queued the input
            // returns "" and, because the stored model is "", the resolved model stays "".
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=codex", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the resolved worker model is exactly the empty string"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "");
            }
        }
    });

    test("a null configuration (no file) leaves every worker prompt at its fresh-install default", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            // No config seeded -> readScope returns null.
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the worker tool prompt has no forced default"(_code, { cap }) {
                Assert.strictEqual(cap.defaultIndexFor("Which AI tool should the worker use?"), undefined);
            },
            "the worker model menu has no forced default"(_code, { cap }) {
                Assert.strictEqual(cap.defaultIndexFor("Which model should the worker use?"), undefined);
            },
            "the worker effort list has no forced default"(_code, { cap }) {
                Assert.strictEqual(cap.defaultIndexFor("What effort level should the worker use?"), undefined);
            }
        }
    });

    test("a flag-supplied worker tool, model, and effort skip their prompts and take the flag values regardless of the stored configuration", {
        ARRANGE() {
            const s = stubContexts();
            // Stored configuration disagrees with every flag below.
            seedProjectConfig(s, {
                worker: { tool: "codex", model: "gpt-5-codex", effort: "high", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=  flag-model  ", "--worker-effort=max", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "config worker.tool is the flag value claude, not the stored codex"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.tool, "claude");
            },
            "config worker.model is the flag value verbatim, not the stored gpt-5-codex"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.model, "  flag-model  ");
            },
            "config worker.effort is the flag value max, not the stored high"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.effort, "max");
            },
            "the worker tool prompt is never rendered"(_result, { askedHeaders }) {
                Assert.ok(!askedHeaders.includes("Worker tool, neighborino"));
            },
            "the worker model prompt is never rendered"(_result, { askedHeaders }) {
                Assert.ok(!askedHeaders.includes("Worker model"));
            },
            "the worker effort prompt is never rendered"(_result, { askedHeaders }) {
                Assert.ok(!askedHeaders.includes("Worker effort"));
            }
        }
    });

    test("the configuration is read exactly once per run and reused across the worker and reviewer questions", {
        ARRANGE() {
            const s = stubContexts();
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            let configReads = 0;
            const origReadFile = s.contexts.fs.readFile.bind(s.contexts.fs);
            (s.contexts.fs as { readFile:typeof s.contexts.fs.readFile }).readFile = (p) => {
                if (p === "/proj/.flanders/config.json") {
                    configReads++;
                }
                return origReadFile(p);
            };
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another reviewer?
            return { ...s, getConfigReads: () => configReads };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the configuration file is read exactly once"(_code, { getConfigReads }) {
                Assert.strictEqual(getConfigReads(), 1);
            }
        }
    });

    test("disposed during the configuration pre-selection read returns 1 without emitting any artifact on a fully flag-supplied run", {
        ARRANGE() {
            // Every worker/reviewer answer is supplied by flags, so no interactive prompt's disposed
            // guard can stop the run — only the unconditional guard right after readScope can. codex
            // skills are used because writeSkillArtifacts mkdirs the codex prompts root before its own
            // disposed check, so a missing guard would create that directory.
            const s = stubContexts();
            let resolveRead:(() => void) | null = null;
            const origReadFile = s.contexts.fs.readFile.bind(s.contexts.fs);
            (s.contexts.fs as { readFile:typeof s.contexts.fs.readFile }).readFile = (p) => {
                if (p === "/proj/.flanders/config.json") {
                    return new Promise<string>(resolve => { resolveRead = () => resolve("{}"); });
                }
                return origReadFile(p);
            };
            return { ...s, getResolveRead: () => resolveRead };
        },
        async ACT({ contexts, getResolveRead }) {
            const cmd = new Install(["--project", "--skills-tool=codex", "--worker-tool=codex", "--worker-model=", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            // Wait for the pre-selection read to be in flight.
            while (!getResolveRead()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolveRead()!();
            await disposePromise;
            return await cmd.result();
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no directory is created (writeSkillArtifacts never ran)"(_code, { dirs }) {
                Assert.strictEqual(dirs.size, 0);
            },
            "no file is written (no skills, no config)"(_code, { files }) {
                Assert.strictEqual(files.size, 0);
            }
        }
    });
});

test.describe("Install reviewer and weighted-review pre-selection from an existing configuration (4.2)", test => {
    test("each interactively-asked reviewer's tool, model, and effort defaults to the stored reviewer at that position, and Configure another reviewer? rebuilds the stored 2-reviewer length", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [
                    { tool: "claude", model: "claude-opus-4-8", effort: "high", fast: false, optional: false },
                    { tool: "claude", model: "best", effort: "low", fast: false, optional: false }
                ],
                minimumReviews: 2
            });
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
            s.askResponses.push([{ picked: [{ label: "Opus" }] }]); // reviewer 1 model -> Opus family
            s.askResponses.push([{ picked: [{ label: "Opus 4.8" }] }]); // reviewer 1 submenu
            s.askResponses.push([{ picked: [{ label: "high" }] }]); // reviewer 1 effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 1 fast (Opus 4.8 supports fast mode) -> off
            s.askResponses.push([{ picked: [{ label: "yes" }] }]); // configure another? -> reviewer 2
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 2 tool
            s.askResponses.push([{ picked: [{ label: "Best (auto-pick)" }] }]); // reviewer 2 model
            s.askResponses.push([{ picked: [{ label: "low" }] }]); // reviewer 2 effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another? -> stop at two
            // minimum: no askText queued -> empty accepts the default 2 (== count), so no optional prompts.
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "reviewer 1 tool defaults to the stored claude"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which AI tool should reviewer use?"), "claude");
            },
            "reviewer 1 model top-level defaults to the Opus family"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which model should reviewer use?"), "Opus");
            },
            "reviewer 1 Opus submenu defaults to Opus 4.8"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which Opus model should reviewer use?"), "Opus 4.8");
            },
            "reviewer 1 effort defaults to the stored high"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("What effort level should reviewer use?"), "high");
            },
            "reviewer 2 tool defaults to the stored claude"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which AI tool should reviewer 2 use?"), "claude");
            },
            "reviewer 2 model defaults to the stored cross-family alias Best (auto-pick)"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which model should reviewer 2 use?"), "Best (auto-pick)");
            },
            "reviewer 2 effort defaults to the stored low"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("What effort level should reviewer 2 use?"), "low");
            },
            "Configure another reviewer? defaults to yes then no, rebuilding the stored two-reviewer length"(_code, { cap }) {
                Assert.deepStrictEqual(cap.allDefaultLabelsFor("Okely-dokely — care to configure another reviewer?"), ["yes", "no"]);
            }
        }
    });

    test("Configure another reviewer? defaults to no after the only reviewer, reproducing a stored single-reviewer length", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 1 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 1 effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another? -> single reviewer
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "Configure another reviewer? is asked once and defaults to no"(_code, { cap }) {
                Assert.deepStrictEqual(cap.allDefaultLabelsFor("Okely-dokely — care to configure another reviewer?"), ["no"]);
            }
        }
    });

    test("the minimum free-text defaults to the stored minimumReviews and each per-reviewer optional question defaults to the stored optional flag", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [
                    { tool: "claude", model: "", effort: "", fast: false, optional: true },
                    { tool: "claude", model: "", effort: "", fast: false, optional: false }
                ],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 1 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 1 effort
            s.askResponses.push([{ picked: [{ label: "yes" }] }]); // configure another? -> reviewer 2
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 2 tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 2 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 2 effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another? -> stop at two
            // minimum: no askText queued -> empty accepts the stored default 1 (< count 2), so optional prompts are asked.
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 1 optional? (active pick)
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 2 optional? (active pick)
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the minimum prompt shows the stored default 1, not the reviewer count 2"(_result, { askedTextPrompts }) {
                Assert.ok(askedTextPrompts.includes("Minimum reviewers that must run to a verdict in each review round (1-2, empty for 1): "));
            },
            "accepting the empty minimum persists the stored minimumReviews 1"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.minimumReviews, 1);
            },
            "reviewer 1 optional defaults to yes (stored optional true)"(_result, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Is reviewer 1 (claude · default configured model · default configured effort) optional?"), "yes");
            },
            "reviewer 2 optional defaults to no (stored optional false)"(_result, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Is reviewer 2 (claude · default configured model · default configured effort) optional?"), "no");
            }
        }
    });

    test("the minimum default is clamped to the current reviewer count when the stored minimum exceeds it", {
        ARRANGE() {
            const s = stubContexts();
            // Stored minimum 3 (a valid 3-reviewer config), but only 2 reviewers are supplied by flags,
            // so the offered default must clamp down to 2.
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [
                    { tool: "claude", model: "", effort: "", fast: false, optional: false },
                    { tool: "claude", model: "", effort: "", fast: false, optional: false },
                    { tool: "claude", model: "", effort: "", fast: false, optional: false }
                ],
                minimumReviews: 3
            });
            s.askTextResponses.push("2"); // explicit minimum (== count) so the run completes without optional prompts
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([
                "--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=",
                "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort=",
                "--reviewer-2-tool=claude", "--reviewer-2-model=", "--reviewer-2-effort="
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
            "the minimum prompt shows the clamped default 2, not the stored 3"(_result, { askedTextPrompts }) {
                Assert.ok(askedTextPrompts.includes("Minimum reviewers that must run to a verdict in each review round (1-2, empty for 2): "));
            },
            "the persisted minimum is the entered value 2"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.minimumReviews, 2);
            }
        }
    });

    test("with no stored configuration each per-reviewer optional question still defaults to required (no)", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            // No config seeded -> readScope returns null.
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 1 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 1 effort
            s.askResponses.push([{ picked: [{ label: "yes" }] }]); // configure another?
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 2 tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 2 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 2 effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another? -> two reviewers
            s.askTextResponses.push("1"); // minimum 1 (< count 2) so optional prompts are asked
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 1 optional?
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 2 optional?
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "reviewer 1 optional defaults to no"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Is reviewer 1 (claude · default configured model · default configured effort) optional?"), "no");
            },
            "reviewer 2 optional defaults to no"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Is reviewer 2 (claude · default configured model · default configured effort) optional?"), "no");
            }
        }
    });

    test("a reviewer position beyond the stored list keeps fresh-install defaults", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            seedProjectConfig(s, {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "best", effort: "high", fast: false, optional: false }],
                minimumReviews: 1
            });
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // worker model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // worker effort
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
            s.askResponses.push([{ picked: [{ label: "Best (auto-pick)" }] }]); // reviewer 1 model
            s.askResponses.push([{ picked: [{ label: "high" }] }]); // reviewer 1 effort
            s.askResponses.push([{ picked: [{ label: "yes" }] }]); // configure another? (default no, user deviates to add a 2nd)
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 2 tool (no stored -> no default)
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 2 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 2 effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another? -> stop at two
            s.askTextResponses.push("2"); // minimum (== count) so no optional prompts
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "stored reviewer 1 model defaults to the cross-family alias Best (auto-pick)"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Which model should reviewer use?"), "Best (auto-pick)");
            },
            "stored reviewer 1 effort defaults to high"(_code, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("What effort level should reviewer use?"), "high");
            },
            "the beyond-list reviewer 2 tool carries no forced default"(_code, { cap }) {
                Assert.strictEqual(cap.defaultIndexFor("Which AI tool should reviewer 2 use?"), undefined);
            },
            "the beyond-list reviewer 2 model carries no forced default"(_code, { cap }) {
                Assert.strictEqual(cap.defaultIndexFor("Which model should reviewer 2 use?"), undefined);
            },
            "the beyond-list reviewer 2 effort carries no forced default"(_code, { cap }) {
                Assert.strictEqual(cap.defaultIndexFor("What effort level should reviewer 2 use?"), undefined);
            }
        }
    });

    test("accepting every pre-selected default across worker, reviewer, and weighted-review questions writes back a config equal to the one read", {
        ARRANGE() {
            const s = stubContexts();
            const stored:FlandersConfig = {
                worker: { tool: "claude", model: "claude-opus-4-8", effort: "high", fast: false },
                reviewers: [
                    { tool: "claude", model: "best", effort: "low", fast: false, optional: true },
                    { tool: "claude", model: "", effort: "max", fast: false, optional: false }
                ],
                minimumReviews: 1
            };
            seedProjectConfig(s, stored);
            // Simulate the user accepting every prompt's pre-selected default: pick the option at
            // defaultIndex for each single-select (failing loudly if a prompt offered no default), and
            // return "" for each free-text so the shared helper applies its default. This reproduces
            // "press Enter through every question".
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                const answers = questions.map(q => {
                    s.askedHeaders.push(q.header);
                    if (q.defaultIndex === undefined) {
                        throw new Error(`pre-selection gap: question "${q.question}" offered no default`);
                    }
                    return { picked: [q.options[q.defaultIndex]!] };
                });
                return Promise.resolve(answers);
            };
            return { ...s, stored };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the written configuration equals the one read"({ config }, { stored }) {
                Assert.deepStrictEqual(config, stored);
            }
        }
    });

    test("flag-supplied reviewer and weighted-review answers are unaffected by a conflicting stored configuration", {
        ARRANGE() {
            const s = stubContexts();
            // Every flag below disagrees with the stored configuration.
            seedProjectConfig(s, {
                worker: { tool: "codex", model: "stored-w", effort: "stored-we", fast: false },
                reviewers: [{ tool: "codex", model: "stored-r", effort: "stored-re", fast: false, optional: true }],
                minimumReviews: 1
            });
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([
                "--project", "--skills-tool=claude",
                "--worker-tool=claude", "--worker-model=W", "--worker-effort=E",
                "--reviewer-tool=claude", "--reviewer-model=R1", "--reviewer-effort=E1",
                "--reviewer-2-tool=claude", "--reviewer-2-model=R2", "--reviewer-2-effort=E2",
                "--reviewer-minimum=1", "--reviewer-2-optional"
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
            "no interactive prompt is shown"(_result, { askedHeaders, askedTextPrompts }) {
                Assert.deepStrictEqual(askedHeaders, []);
                Assert.deepStrictEqual(askedTextPrompts, []);
            },
            "the written configuration is the flag values, not the stored ones"({ config }) {
                Assert.deepStrictEqual(config, {
                    worker: { tool: "claude", model: "W", effort: "E", fast: false },
                    reviewers: [
                        { tool: "claude", model: "R1", effort: "E1", fast: false, optional: false },
                        { tool: "claude", model: "R2", effort: "E2", fast: false, optional: true }
                    ],
                    minimumReviews: 1
                });
            }
        }
    });
});

test.describe("parseInstallFlags fast flags", test => {
    test("--worker-fast records workerFast true", {
        ARRANGE() {
            return { args: ["--worker-fast"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { ok: true, answers: { workerFast: true } });
        }
    });

    test("--reviewer-fast records reviewer index 1 as fast", {
        ARRANGE() {
            return { args: ["--reviewer-fast"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { ok: true, answers: { fastReviewerIndices: [1] } });
        }
    });

    test("--reviewer-2-fast records reviewer index 2 within a flag-fixed two-reviewer list", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-2-tool=claude", "--reviewer-2-fast"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: true,
                answers: {
                    reviewers: [{ tool: "claude" }, { tool: "claude" }],
                    fastReviewerIndices: [2]
                }
            });
        }
    });

    test("multiple fast reviewer indices are recorded sorted ascending", {
        ARRANGE() {
            return { args: ["--reviewer-2-fast", "--reviewer-fast"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, { ok: true, answers: { fastReviewerIndices: [1, 2] } });
        }
    });

    test("--reviewer-0-fast (N < 2) is a usage error naming the flag", {
        ARRANGE() {
            return { args: ["--reviewer-0-fast"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid reviewer flag: \"--reviewer-0-fast\". Reviewer 1 uses --reviewer-fast; --reviewer-N-fast requires N >= 2.\n"
            });
        }
    });

    test("--reviewer-1-fast is a usage error: reviewer 1 uses the unindexed --reviewer-fast", {
        ARRANGE() {
            return { args: ["--reviewer-1-fast"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid reviewer flag: \"--reviewer-1-fast\". Reviewer 1 uses --reviewer-fast; --reviewer-N-fast requires N >= 2.\n"
            });
        }
    });

    test("--reviewer-3-fast beyond a flag-fixed single-reviewer list is a usage error naming the index", {
        ARRANGE() {
            return { args: ["--reviewer-tool=claude", "--reviewer-3-fast"] };
        },
        ACT({ args }) {
            return parseInstallFlags(args);
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, {
                ok: false,
                diagnostic: "Invalid reviewer flag: --reviewer-3-fast references reviewer 3, beyond the configured reviewer list of 1.\n"
            });
        }
    });
});

test.describe("Install fast mode (task 5)", test => {
    test("worker claude + fast-capable model: fast question defaults to no, answering yes persists fast true", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            s.askResponses.push([{ picked: [{ label: "yes" }] }]); // worker fast -> on
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=claude-opus-4-8", "--worker-effort=high", "--reviewer-tool=codex", "--reviewer-model=gpt-5", "--reviewer-effort=medium"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the worker fast question is asked"(_result, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Worker fast"));
            },
            "the fast question defaults to no"(_result, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Should the worker run with Claude Code's fast mode enabled, neighbor?"), "no");
            },
            "the worker fast question offers exactly the options no then yes"(_result, { cap }) {
                Assert.deepStrictEqual(cap.optionsFor("Should the worker run with Claude Code's fast mode enabled, neighbor?"), ["no", "yes"]);
            },
            "answering yes persists worker.fast true"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.fast, true);
            }
        }
    });

    test("worker claude + fast-capable model: answering no persists fast false", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // worker fast -> off
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=opus", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=gpt-5", "--reviewer-effort=medium"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "answering no persists worker.fast false"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.fast, false);
            }
        }
    });

    test("worker claude + model that does not support fast mode: no fast question, persists false", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=claude-sonnet-4-6", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=gpt-5", "--reviewer-effort=medium"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "no fast question is asked"(_result, { askedHeaders }) {
                Assert.strictEqual(askedHeaders.includes("Worker fast"), false);
            },
            "persists worker.fast false"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.fast, false);
            }
        }
    });

    test("worker tool is not claude: no fast question, persists false", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-model=gpt-5-codex", "--worker-effort=low", "--reviewer-tool=codex", "--reviewer-model=gpt-5", "--reviewer-effort=medium"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "no fast question is asked"(_result, { askedHeaders }) {
                Assert.strictEqual(askedHeaders.includes("Worker fast"), false);
            },
            "persists worker.fast false"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.fast, false);
            }
        }
    });

    test("reviewer claude + fast-capable model: fast question asked, answering yes persists reviewer fast true", {
        ARRANGE() {
            const s = stubContexts();
            const cap = captureChoiceDefaults(s);
            s.askResponses.push([{ picked: [{ label: "yes" }] }]); // reviewer 1 fast -> on
            return { ...s, cap };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=opus", "--reviewer-effort=low"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the reviewer fast question is asked"(_result, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Reviewer fast"));
            },
            "the reviewer fast question defaults to no"(_result, { cap }) {
                Assert.strictEqual(cap.defaultLabelFor("Should reviewer run with Claude Code's fast mode enabled, neighbor?"), "no");
            },
            "the reviewer fast question offers exactly the options no then yes"(_result, { cap }) {
                Assert.deepStrictEqual(cap.optionsFor("Should reviewer run with Claude Code's fast mode enabled, neighbor?"), ["no", "yes"]);
            },
            "answering yes persists the reviewer's fast true"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.fast, true);
            }
        }
    });

    test("reviewer claude + fast-capable model: answering no persists reviewer fast false", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 1 fast -> off
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=claude-opus-4-7", "--reviewer-effort=low"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "answering no persists the reviewer's fast false"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.fast, false);
            }
        }
    });

    test("reviewer claude + model that does not support fast mode: no fast question, persists false", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-model=gpt-5-codex", "--worker-effort=low", "--reviewer-tool=claude", "--reviewer-model=claude-sonnet-4-6", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "no reviewer fast question is asked"(_result, { askedHeaders }) {
                Assert.strictEqual(askedHeaders.includes("Reviewer fast"), false);
            },
            "persists the reviewer's fast false"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.fast, false);
            }
        }
    });

    test("--worker-fast on an eligible worker skips the fast question and persists fast true", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=opus", "--worker-effort=", "--worker-fast", "--reviewer-tool=codex", "--reviewer-model=gpt-5", "--reviewer-effort=medium"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the worker fast question is not asked"(_result, { askedHeaders }) {
                Assert.strictEqual(askedHeaders.includes("Worker fast"), false);
            },
            "persists worker.fast true"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.fast, true);
            }
        }
    });

    test("--reviewer-fast on an eligible reviewer 1 skips its fast question and persists fast true", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-model=gpt-5-codex", "--worker-effort=low", "--reviewer-tool=claude", "--reviewer-model=opus", "--reviewer-effort=", "--reviewer-fast"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the reviewer fast question is not asked"(_result, { askedHeaders }) {
                Assert.strictEqual(askedHeaders.includes("Reviewer fast"), false);
            },
            "persists reviewer fast true"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.fast, true);
            }
        }
    });

    test("--reviewer-2-fast on an eligible reviewer 2 persists its fast true while reviewer 1 stays false", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install([
                "--project", "--skills-tool=claude",
                "--worker-tool=claude", "--worker-model=", "--worker-effort=",
                "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort=",
                "--reviewer-2-tool=claude", "--reviewer-2-model=opus", "--reviewer-2-effort=", "--reviewer-2-fast"
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
            "reviewer 2 fast is true"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[1];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.fast, true);
            },
            "reviewer 1 fast stays false"({ config }) {
                Assert.ok(config);
                const reviewer = config.reviewers[0];
                Assert.ok(reviewer);
                Assert.strictEqual(reviewer.fast, false);
            }
        }
    });

    test("--worker-fast for a non-claude worker exits non-zero naming the flag", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=codex", "--worker-model=", "--worker-effort=", "--worker-fast", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the diagnostic names the offending flag"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --worker-fast: the codex tool has no fast mode.\n");
            },
            "no config is written"(_code, { files }) {
                Assert.strictEqual(files.has("/proj/.flanders/config.json"), false);
            }
        }
    });

    test("--worker-fast for a claude worker on a model without fast mode exits non-zero naming the flag", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=claude-sonnet-4-6", "--worker-effort=", "--worker-fast", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the diagnostic names the flag and the unsupported model"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --worker-fast: the model \"claude-sonnet-4-6\" does not support Claude Code fast mode.\n");
            }
        }
    });

    test("--worker-fast for a claude worker on the empty default model exits non-zero naming the flag", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--worker-fast", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the diagnostic names the flag and the empty default model"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --worker-fast: the model \"\" does not support Claude Code fast mode.\n");
            }
        }
    });

    test("--reviewer-fast for a non-claude reviewer exits non-zero naming the flag", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort=", "--reviewer-fast"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the diagnostic names the offending flag"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --reviewer-fast: the codex tool has no fast mode.\n");
            }
        }
    });

    test("--reviewer-2-fast for a non-claude reviewer 2 exits non-zero naming the indexed flag", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install([
                "--project", "--skills-tool=claude",
                "--worker-tool=claude", "--worker-model=", "--worker-effort=",
                "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort=",
                "--reviewer-2-tool=codex", "--reviewer-2-model=", "--reviewer-2-effort=", "--reviewer-2-fast"
            ], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the diagnostic names the offending indexed flag"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --reviewer-2-fast: the codex tool has no fast mode.\n");
            }
        }
    });

    test("--reviewer-fast for a claude reviewer on a model without fast mode exits non-zero naming the flag", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=claude-sonnet-4-6", "--reviewer-effort=", "--reviewer-fast"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the diagnostic names the flag and the unsupported model"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --reviewer-fast: the model \"claude-sonnet-4-6\" does not support Claude Code fast mode.\n");
            }
        }
    });

    test("--reviewer-2-fast for a claude reviewer 2 on a model without fast mode exits non-zero naming the indexed flag", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install([
                "--project", "--skills-tool=claude",
                "--worker-tool=claude", "--worker-model=", "--worker-effort=",
                "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort=",
                "--reviewer-2-tool=claude", "--reviewer-2-model=claude-sonnet-4-6", "--reviewer-2-effort=", "--reviewer-2-fast"
            ], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the diagnostic names the indexed flag and the unsupported model"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --reviewer-2-fast: the model \"claude-sonnet-4-6\" does not support Claude Code fast mode.\n");
            }
        }
    });

    test("--reviewer-fast for a claude reviewer on the empty default model exits non-zero naming the flag", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort=", "--reviewer-fast"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the diagnostic names the flag and the empty default model"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --reviewer-fast: the model \"\" does not support Claude Code fast mode.\n");
            }
        }
    });

    test("--reviewer-2-fast for a claude reviewer 2 on the empty default model exits non-zero naming the indexed flag", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install([
                "--project", "--skills-tool=claude",
                "--worker-tool=claude", "--worker-model=", "--worker-effort=",
                "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort=",
                "--reviewer-2-tool=claude", "--reviewer-2-model=", "--reviewer-2-effort=", "--reviewer-2-fast"
            ], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the diagnostic names the indexed flag and the empty default model"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --reviewer-2-fast: the model \"\" does not support Claude Code fast mode.\n");
            }
        }
    });

    test("--reviewer-3-fast beyond an interactively-built reviewer list exits non-zero naming the index", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 1 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 1 effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // configure another? -> stop at one
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-3-fast"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "the diagnostic names the offending index"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid reviewer flag: --reviewer-3-fast references reviewer 3, beyond the configured reviewer list of 1.\n");
            }
        }
    });

    test("--worker-fast for a flag-resolved non-claude worker is rejected before any interactive prompt", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            // --skills-tool is omitted, so it would be the first interactive question; the fast usage
            // error must fire at parse time, before that prompt is shown.
            const cmd = new Install(["--project", "--worker-tool=codex", "--worker-fast"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no interactive question was asked"(_code, { askedHeaders }) {
                Assert.deepStrictEqual(askedHeaders, []);
            },
            "the diagnostic names the offending flag"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --worker-fast: the codex tool has no fast mode.\n");
            }
        }
    });

    test("--worker-fast with an interactive worker tool defers eligibility and persists fast true when the resolved role is eligible", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool (no --worker-tool flag) -> claude
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-model=opus", "--worker-effort=", "--worker-fast", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the worker fast question is not asked"(_result, { askedHeaders }) {
                Assert.strictEqual(askedHeaders.includes("Worker fast"), false);
            },
            "persists worker.fast true"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.worker.fast, true);
            }
        }
    });

    test("--worker-fast with an interactive worker model resolving to a non-fast-capable model errors at resolution naming the flag", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "Sonnet" }] }]); // worker model -> Sonnet family submenu
            s.askResponses.push([{ picked: [{ label: "Sonnet 4.6" }] }]); // worker submenu -> Sonnet 4.6 (no fast mode)
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-effort=", "--worker-fast", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code };
        },
        ASSERTS: {
            "exits 1"({ code }) {
                Assert.strictEqual(code, 1);
            },
            "the worker model question was asked before the error"(_result, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Worker model"));
            },
            "the diagnostic names the flag and the resolved unsupported model"(_result, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --worker-fast: the model \"claude-sonnet-4-6\" does not support Claude Code fast mode.\n");
            }
        }
    });

    test("--reviewer-fast with an interactive reviewer model resolving to a non-fast-capable model errors at resolution naming the flag", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "Sonnet" }] }]); // reviewer 1 model -> Sonnet family submenu
            s.askResponses.push([{ picked: [{ label: "Sonnet 4.6" }] }]); // reviewer 1 submenu -> Sonnet 4.6 (no fast mode)
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-effort=", "--reviewer-fast"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return { code };
        },
        ASSERTS: {
            "exits 1"({ code }) {
                Assert.strictEqual(code, 1);
            },
            "the reviewer model question was asked before the error"(_result, { askedHeaders }) {
                Assert.ok(askedHeaders.includes("Reviewer model"));
            },
            "the diagnostic names the flag and the resolved unsupported model"(_result, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag --reviewer-fast: the model \"claude-sonnet-4-6\" does not support Claude Code fast mode.\n");
            }
        }
    });

    test("Ctrl+C during the worker fast question exits non-zero", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [] }]); // worker fast -> Ctrl+C
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=opus", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no config is written"(_code, { files }) {
                Assert.strictEqual(files.has("/proj/.flanders/config.json"), false);
            }
        }
    });

    test("disposed during the worker fast question returns 1", {
        ARRANGE() {
            const s = stubContexts();
            let resolvePrompt:((v:readonly AskAnswer[]) => void) | null = null;
            (s.contexts.ask as { askChoices:typeof s.contexts.ask.askChoices }).askChoices = (questions) => {
                for (const q of questions) {
                    s.askedHeaders.push(q.header);
                }
                return new Promise<readonly AskAnswer[]>(resolve => {
                    resolvePrompt = resolve;
                });
            };
            return { ...s, getResolvePrompt: () => resolvePrompt };
        },
        async ACT({ contexts, getResolvePrompt }) {
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=opus", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolvePrompt()!([{ picked: [{ label: "yes" }] }]);
            await disposePromise;
            return await cmd.result();
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("re-running install at a scope whose stored fast-capable role has fast true pre-selects yes and reproduces fast true", {
        ARRANGE() {
            const s = stubContexts();
            const stored:FlandersConfig = {
                worker: { tool: "claude", model: "claude-opus-4-8", effort: "high", fast: true },
                reviewers: [{ tool: "claude", model: "opus", effort: "low", fast: true, optional: false }],
                minimumReviews: 1
            };
            seedProjectConfig(s, stored);
            // Accept every pre-selected default: pick the option at defaultIndex for each single-select
            // (failing loudly when a prompt offered no default), recording the worker fast question's
            // default so the test can assert it pre-selects "yes".
            const fastDefaults:Record<string, string> = {};
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, _output) => {
                const answers = questions.map(q => {
                    s.askedHeaders.push(q.header);
                    if (q.defaultIndex === undefined) {
                        throw new Error(`pre-selection gap: question "${q.question}" offered no default`);
                    }
                    if (q.header === "Worker fast" || q.header === "Reviewer fast") {
                        fastDefaults[q.header] = q.options[q.defaultIndex]!.label;
                    }
                    return { picked: [q.options[q.defaultIndex]!] };
                });
                return Promise.resolve(answers);
            };
            return { ...s, stored, fastDefaults };
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the worker fast question pre-selects yes"(_result, { fastDefaults }) {
                Assert.strictEqual(fastDefaults["Worker fast"], "yes");
            },
            "the reviewer fast question pre-selects yes"(_result, { fastDefaults }) {
                Assert.strictEqual(fastDefaults["Reviewer fast"], "yes");
            },
            "accepting the defaults reproduces the stored configuration with fast true"({ config }, { stored }) {
                Assert.deepStrictEqual(config, stored);
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
            const cmd = new Install(["--project", "--skills-tool=claude,codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
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
            "stdout is exactly the three Codex prompt paths then the config path, one per line in order"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.deepStrictEqual(lines, [
                    "/proj/.codex/prompts/flanders-spec.md",
                    "/proj/.codex/prompts/flanders-plan.md",
                    "/proj/.codex/prompts/flanders-work.md",
                    "/proj/.flanders/config.json"
                ]);
            }
        }
    });

    test("with skills-tool=both, stdout includes all 6 skill paths plus config", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(["--project", "--skills-tool=claude,codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            await cmd.result();
            await cmd.dispose();
        },
        ASSERTS: {
            "stdout is exactly the three Claude skill paths, then the three Codex prompt paths, then the config path, one per line in order"(_, { written }) {
                const lines = written.join("").split("\n").filter(l => l.length > 0);
                Assert.deepStrictEqual(lines, [
                    "/proj/.claude/skills/flanders-spec/SKILL.md",
                    "/proj/.claude/skills/flanders-plan/SKILL.md",
                    "/proj/.claude/skills/flanders-work/SKILL.md",
                    "/proj/.codex/prompts/flanders-spec.md",
                    "/proj/.codex/prompts/flanders-plan.md",
                    "/proj/.codex/prompts/flanders-work.md",
                    "/proj/.flanders/config.json"
                ]);
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
            "diagnostic is exactly the Cannot create destination message for the codex prompts root"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Cannot create destination: /proj/.codex/prompts\n");
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
            "diagnostic is exactly the Cannot write file message for the offending codex prompt path"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Cannot write file: /proj/.codex/prompts/flanders-spec.md\n");
            }
        }
    });
});

test.describe("Install config persistence (3.7)", test => {
    test("config read back via FlandersConfig.read equals expected literal", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // worker fast (model opus supports fast mode) -> off
            return s;
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
                    worker: { tool: "claude", model: "opus", effort: "high", fast: false },
                    reviewers: [{ tool: "codex", model: "gpt-5", effort: "medium", fast: false, optional: false }],
                    minimumReviews: 1
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
                worker: { tool: "claude", model: "old-model", effort: "old", fast: false },
                reviewers: [{ tool: "claude", model: "old-rev", effort: "old", fast: false }]
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
                    worker: { tool: "codex", model: "  New-Model-X  ", effort: "high", fast: false },
                    reviewers: [{ tool: "claude", model: "  New-Rev-X  ", effort: "low", fast: false, optional: false }],
                    minimumReviews: 1
                });
            }
        }
    });

    test("persisted JSON contains only worker, reviewers, and minimumReviews keys", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const cmd = new Install(
                ["--project", "--skills-tool=claude,codex", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=codex", "--reviewer-effort="],
                { projectRoot: "/proj" },
                contexts
            );
            await cmd.result();
            await cmd.dispose();
        },
        ASSERT(_, { files }) {
            const content = files.get("/proj/.flanders/config.json")!;
            Assert.deepStrictEqual(Object.keys(JSON.parse(content)).sort(), ["minimumReviews", "reviewers", "worker"]);
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
            const s = stubContexts();
            // The flag-fixed two-reviewer list supplies no weighted-review flags. The minimum is asked as
            // a free-text entry; accepting the empty default fixes it to T = 2, and because the minimum
            // equals the reviewer count no per-reviewer optional question is asked.
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
            "every reviewer defaults to optional false"(_code, { files }) {
                const cfg = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.deepStrictEqual(cfg.reviewers.map((r:{ optional:boolean }) => r.optional), [false, false]);
            },
            "minimumReviews defaults to the reviewer count"(_code, { files }) {
                const cfg = JSON.parse(files.get("/proj/.flanders/config.json")!);
                Assert.strictEqual(cfg.minimumReviews, 2);
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
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 2 fast (Latest Opus supports fast mode) -> off
            // The minimum is asked as a free-text entry; the empty default fixes it to T = 2, so no
            // per-reviewer optional question is asked.
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
            // The minimum is asked as a free-text entry; the empty default fixes it to T = 2, so no
            // per-reviewer optional question is asked.
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

test.describe("Install weighted-review collection (2.2)", test => {
    function interactiveTwoReviewerBase() {
        // Worker and scope answered by flags; the reviewer list and the weighted-review section are
        // driven interactively. Returns the stub with the reviewer-list answers already queued.
        const s = stubContexts();
        s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
        s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 1 model
        s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 1 effort
        s.askResponses.push([{ picked: [{ label: "yes" }] }]); // Configure another?
        s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 2 tool
        s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 2 model
        s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 2 effort
        s.askResponses.push([{ picked: [{ label: "no" }] }]); // Configure another? -> two reviewers
        return s;
    }
    const baseFlags = ["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort="];

    test("two-reviewer interactive run with a below-count minimum persists it and the per-reviewer optional flags", {
        ARRANGE() {
            const s = interactiveTwoReviewerBase();
            s.askTextResponses.push("1"); // minimum reviews -> 1 (below T, so the optional questions are asked)
            s.askResponses.push([{ picked: [{ label: "yes" }] }]); // reviewer 1 optional? -> optional
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 2 optional? -> required
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(baseFlags, { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "minimumReviews is the chosen value 1"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.minimumReviews, 1);
            },
            "reviewer 1 is optional (answered yes)"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.reviewers[0]!.optional, true);
            },
            "reviewer 2 is required (answered no)"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.reviewers[1]!.optional, false);
            },
            "the per-reviewer optional questions are labelled by 1-based index in order"(_result, { askedHeaders }) {
                Assert.deepStrictEqual(
                    askedHeaders.filter(h => h === "Reviewer 1 optional" || h === "Reviewer 2 optional"),
                    ["Reviewer 1 optional", "Reviewer 2 optional"]
                );
            },
            "each optional question identifies the reviewer by position, tool, model, and effort (default wording when empty)"(_result, { askedQuestions }) {
                Assert.deepStrictEqual(
                    askedQuestions.filter(q => q.startsWith("Is reviewer ")),
                    [
                        "Is reviewer 1 (claude · default configured model · default configured effort) optional?",
                        "Is reviewer 2 (claude · default configured model · default configured effort) optional?"
                    ]
                );
            },
            "each optional question explains optionality as the rate-limit-wait abandonment and nothing more"(_result, { askedQuestions, askedOptions }) {
                const optionalOptionSets = askedOptions.filter((_o, i) => askedQuestions[i]!.startsWith("Is reviewer "));
                Assert.strictEqual(optionalOptionSets.length, 2);
                for (const options of optionalOptionSets) {
                    const required = options.find(o => o.label === "no")!;
                    const optional = options.find(o => o.label === "yes")!;
                    Assert.ok(required.description!.includes("rate-limit"));
                    Assert.ok(optional.description!.includes("rate-limit"));
                    Assert.ok(optional.description!.includes("like a required reviewer"));
                }
            },
            "the minimum is asked as a free-text entry, not a single-select"(_result, { askedHeaders, askedTextPrompts }) {
                Assert.strictEqual(askedHeaders.includes("Minimum reviews"), false);
                Assert.ok(askedTextPrompts.some(p => p.includes("Minimum reviewers that must run to a verdict")));
            }
        }
    });

    test("flag-fixed reviewers with concrete models and efforts: each optional question names the reviewer by position, tool, verbatim model, and verbatim effort", {
        ARRANGE() {
            const s = stubContexts();
            s.askTextResponses.push("1"); // minimum reviews -> 1 (below T = 2, so the optional questions are asked)
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 1 fast (claude-opus-4-8 supports fast mode) -> off
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 1 optional? -> required
            s.askResponses.push([{ picked: [{ label: "yes" }] }]); // reviewer 2 optional? -> optional
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
                "--reviewer-model=claude-opus-4-8",
                "--reviewer-effort=high",
                "--reviewer-2-tool=codex",
                "--reviewer-2-model=gpt-5-codex",
                "--reviewer-2-effort=medium"
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
            "each optional question names the reviewer by position, tool, verbatim model, and verbatim effort"(_result, { askedQuestions }) {
                Assert.deepStrictEqual(
                    askedQuestions.filter(q => q.startsWith("Is reviewer ")),
                    [
                        "Is reviewer 1 (claude · claude-opus-4-8 · high) optional?",
                        "Is reviewer 2 (codex · gpt-5-codex · medium) optional?"
                    ]
                );
            },
            "the answered optional flags persist in order"({ config }) {
                Assert.ok(config);
                Assert.deepStrictEqual(config.reviewers.map(r => r.optional), [false, true]);
            }
        }
    });

    test("two-reviewer interactive run accepting the default minimum persists minimum = reviewer count and asks no optional question", {
        ARRANGE() {
            // No askText response queued: the empty entry accepts the default minimum (T = 2).
            return interactiveTwoReviewerBase();
        },
        async ACT({ contexts }) {
            const cmd = new Install(baseFlags, { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "the minimum free-text prompt shows the 1..T range and the T default"(_result, { askedTextPrompts }) {
                Assert.ok(askedTextPrompts.some(p => p.includes("1-2, empty for 2")));
            },
            "minimumReviews equals the reviewer count"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.minimumReviews, 2);
            },
            "every reviewer is required"({ config }) {
                Assert.ok(config);
                Assert.deepStrictEqual(config.reviewers.map(r => r.optional), [false, false]);
            },
            "the section is presented directly with no gate question and no optional prompt when the minimum equals T"(_result, { askedHeaders }) {
                Assert.deepStrictEqual(askedHeaders, [
                    "Reviewer tool", "Reviewer model", "Reviewer effort", "Configure another reviewer?",
                    "Reviewer 2 tool", "Reviewer 2 model", "Reviewer 2 effort", "Configure another reviewer?"
                ]);
            }
        }
    });

    test("flag-driven --reviewer-minimum (below the count) and --reviewer-2-optional skip the weighted prompts and persist the flag values", {
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
                "--reviewer-2-tool=claude",
                "--reviewer-2-model=",
                "--reviewer-2-effort=",
                "--reviewer-minimum=1",
                "--reviewer-2-optional"
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
            "no interactive prompt is shown"(_result, { askedHeaders, askedTextPrompts }) {
                Assert.deepStrictEqual(askedHeaders, []);
                Assert.deepStrictEqual(askedTextPrompts, []);
            },
            "minimumReviews is the flag value 1"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.minimumReviews, 1);
            },
            "reviewer 1 is required (no optional flag)"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.reviewers[0]!.optional, false);
            },
            "reviewer 2 is optional (--reviewer-2-optional)"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.reviewers[1]!.optional, true);
            }
        }
    });

    test("interactive two-reviewer list with a deferred --reviewer-minimum equal to the count and a --reviewer-2-optional is a usage error", {
        ARRANGE() {
            return interactiveTwoReviewerBase();
        },
        async ACT({ contexts }) {
            const cmd = new Install([...baseFlags, "--reviewer-minimum=2", "--reviewer-2-optional"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the contradictory combination"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag combination: --reviewer-minimum equal to the reviewer count (2) leaves no reviewer that can be optional, so it cannot be combined with --reviewer[-N]-optional.\n");
            },
            "no config is written"(_code, { files }) {
                Assert.strictEqual(files.has("/proj/.flanders/config.json"), false);
            }
        }
    });

    test("an invalid minimum entry is re-prompted until a valid integer is given", {
        ARRANGE() {
            const s = interactiveTwoReviewerBase();
            s.askTextResponses.push("abc"); // not an integer -> re-prompt
            s.askTextResponses.push("5");   // above T = 2 -> re-prompt
            s.askTextResponses.push("1");   // valid -> minimum = 1 (below T, so the optional questions are asked)
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 1 optional?
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // reviewer 2 optional?
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(baseFlags, { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "minimumReviews is the first valid entry 1"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.minimumReviews, 1);
            },
            "the minimum prompt is shown three times (two invalid, then valid)"(_result, { askedTextPrompts }) {
                Assert.strictEqual(askedTextPrompts.filter(p => p.includes("Minimum reviewers that must run to a verdict")).length, 3);
            },
            "a range notice is written for each invalid entry"(_result, { written }) {
                Assert.strictEqual(written.filter(w => w === "Whoopsie — enter an integer between 1 and 2, or leave empty for 2.\n").length, 2);
            }
        }
    });

    test("single-reviewer interactive run shows no weighted-review prompt and persists minimum 1, reviewer required", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 1 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 1 effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // Configure another? -> single reviewer
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(baseFlags, { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            const config = await readConfig(contexts.fs, { projectRoot: "/proj", homeDir: "/home/testuser" });
            return { code, config };
        },
        ASSERTS: {
            "exits 0"({ code }) {
                Assert.strictEqual(code, 0);
            },
            "minimumReviews is 1"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.minimumReviews, 1);
            },
            "the single reviewer is required"({ config }) {
                Assert.ok(config);
                Assert.strictEqual(config.reviewers[0]!.optional, false);
            },
            "no minimum-reviews prompt is shown"(_result, { askedHeaders, askedTextPrompts }) {
                Assert.strictEqual(askedHeaders.includes("Minimum reviews"), false);
                Assert.ok(!askedTextPrompts.some(p => p.includes("Minimum reviewers that must run to a verdict")));
            },
            "no per-reviewer optional prompt is shown"(_result, { askedHeaders }) {
                Assert.strictEqual(askedHeaders.includes("Reviewer 1 optional"), false);
            }
        }
    });

    test("interactive single-reviewer list with a deferred --reviewer-2-optional flag is a usage error", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
            s.askResponses.push([{ picked: [{ label: "default configured model" }] }]); // reviewer 1 model
            s.askResponses.push([{ picked: [{ label: "default configured effort" }] }]); // reviewer 1 effort
            s.askResponses.push([{ picked: [{ label: "no" }] }]); // Configure another? -> single reviewer
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install([...baseFlags, "--reviewer-2-optional"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is the single-reviewer usage error naming the offending flag"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid flag for a single-reviewer configuration: --reviewer-2-optional. Weighted-review flags require two or more reviewers.\n");
            },
            "no config is written"(_code, { files }) {
                Assert.strictEqual(files.has("/proj/.flanders/config.json"), false);
            }
        }
    });

    test("interactive two-reviewer list with a deferred out-of-range --reviewer-minimum is a usage error", {
        ARRANGE() {
            return interactiveTwoReviewerBase();
        },
        async ACT({ contexts }) {
            const cmd = new Install([...baseFlags, "--reviewer-minimum=3"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the flag, the offending value, and the range"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid value for --reviewer-minimum: \"3\". Must be an integer between 1 and 2.\n");
            },
            "no config is written"(_code, { files }) {
                Assert.strictEqual(files.has("/proj/.flanders/config.json"), false);
            }
        }
    });

    test("interactive two-reviewer list with a deferred over-index --reviewer-3-optional is a usage error", {
        ARRANGE() {
            return interactiveTwoReviewerBase();
        },
        async ACT({ contexts }) {
            const cmd = new Install([...baseFlags, "--reviewer-3-optional"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the offending index"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid reviewer flag: --reviewer-3-optional references reviewer 3, beyond the configured reviewer list of 2.\n");
            },
            "no config is written"(_code, { files }) {
                Assert.strictEqual(files.has("/proj/.flanders/config.json"), false);
            }
        }
    });

    test("Ctrl+C during the minimum-reviews prompt exits non-zero with no config", {
        ARRANGE() {
            const s = interactiveTwoReviewerBase();
            // The minimum is a free-text prompt; Ctrl+C surfaces as a rejected askText.
            (s.contexts.ask as { askText:typeof s.contexts.ask.askText }).askText = () => Promise.reject(new Error("readline closed"));
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(baseFlags, { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no config is written"(_code, { files }) {
                Assert.strictEqual(files.has("/proj/.flanders/config.json"), false);
            }
        }
    });

    test("Ctrl+C during a per-reviewer optional prompt exits non-zero with no config", {
        ARRANGE() {
            const s = interactiveTwoReviewerBase();
            s.askTextResponses.push("1"); // minimum reviews -> 1 (below T, so the optional questions are asked)
            s.askResponses.push([{ picked: [] }]); // reviewer 1 optional? -> Ctrl+C
            return s;
        },
        async ACT({ contexts }) {
            const cmd = new Install(baseFlags, { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "no config is written"(_code, { files }) {
                Assert.strictEqual(files.has("/proj/.flanders/config.json"), false);
            }
        }
    });

    test("disposed during the minimum-reviews prompt returns 1", {
        ARRANGE() {
            const s = interactiveTwoReviewerBase();
            // The minimum is a free-text prompt; hang on the askText call so dispose lands mid-prompt.
            let resolveMinimum:((v:string) => void) | null = null;
            (s.contexts.ask as { askText:typeof s.contexts.ask.askText }).askText = () => {
                return new Promise<string>(resolve => {
                    resolveMinimum = resolve;
                });
            };
            return { ...s, getResolvePrompt: () => resolveMinimum };
        },
        async ACT({ contexts, getResolvePrompt }) {
            const cmd = new Install(baseFlags, { projectRoot: "/proj" }, contexts);
            while (!getResolvePrompt()) {
                await new Promise(r => setTimeout(r, 1));
            }
            const disposePromise = cmd.dispose();
            getResolvePrompt()!("2");
            await disposePromise;
            const code = await cmd.result();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 1);
        }
    });

    test("disposed during a per-reviewer optional prompt returns 1", {
        ARRANGE() {
            const s = interactiveTwoReviewerBase();
            s.askTextResponses.push("1"); // minimum reviews -> 1 (below T, so the optional questions are asked)
            let resolveOptional:((v:readonly AskAnswer[]) => void) | null = null;
            let callIndex = 0;
            const origAsk = s.contexts.ask.askChoices;
            (s.contexts.ask as { askChoices:typeof origAsk }).askChoices = (questions, output) => {
                callIndex++;
                if (callIndex === 9) { // the first per-reviewer optional prompt, after the 8 reviewer-list prompts
                    return new Promise<readonly AskAnswer[]>(resolve => {
                        resolveOptional = resolve;
                    });
                }
                return origAsk.call(s.contexts.ask, questions, output);
            };
            return { ...s, getResolvePrompt: () => resolveOptional };
        },
        async ACT({ contexts, getResolvePrompt }) {
            const cmd = new Install(baseFlags, { projectRoot: "/proj" }, contexts);
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

test.describe("Install codex effort re-validation after late tool resolution", test => {
    test("--worker-effort with a non-documented codex level is rejected once the worker tool resolves to codex interactively", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "codex" }] }]); // worker tool -> codex
            return s;
        },
        async ACT({ contexts }) {
            // --worker-effort carries a value codex does not document and --worker-tool is omitted, so
            // parse-time cannot validate it against codex; the worker tool resolves to codex interactively
            // and the re-validation rejects the effort before any worker model prompt.
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-effort=ultra"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the worker-effort flag and the offending value exactly"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid value for --worker-effort: \"ultra\". Allowed values: minimal, low, medium, high, xhigh.\n");
            }
        }
    });

    test("--reviewer-effort with a non-documented codex level is rejected once reviewer 1 resolves to codex interactively", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "codex" }] }]); // reviewer 1 tool -> codex
            return s;
        },
        async ACT({ contexts }) {
            // The worker is fully flag-supplied, so reviewer 1's tool is the first prompt. --reviewer-effort
            // carries a value codex does not document with --reviewer-tool omitted, so the re-validation
            // rejects it after the reviewer tool resolves to codex, before the reviewer model prompt.
            const cmd = new Install(["--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-effort=ultra"], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names the reviewer-effort flag and the offending value exactly"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "Invalid value for --reviewer-effort: \"ultra\". Allowed values: minimal, low, medium, high, xhigh.\n");
            }
        }
    });
});

test.describe("Install tool questions offer only the claude and codex closed set", test => {
    test("the interactive skills-tool, worker-tool, and reviewer-tool questions each offer exactly claude and codex", {
        ARRANGE() {
            const s = stubContexts();
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // skills tool (multi-select)
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // worker tool
            s.askResponses.push([{ picked: [{ label: "claude" }] }]); // reviewer 1 tool
            return s;
        },
        async ACT({ contexts }) {
            // Scope is flag-supplied and the model/effort answers are flag-supplied empties, so only the
            // three tool questions are prompted (the --reviewer-model/-effort flags fix the list at one
            // reviewer, skipping "configure another reviewer?"). Their offered labels are then asserted.
            const cmd = new Install(["--project", "--worker-model=", "--worker-effort=", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await cmd.result();
            await cmd.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "the skills-tool question offers exactly claude and codex in order"(_code, { askedQuestions, askedOptions }) {
                const i = askedQuestions.indexOf("Which AI tool(s) should the skills be installed for, neighbor?");
                Assert.deepStrictEqual(askedOptions[i]!.map(o => o.label), ["claude", "codex"]);
            },
            "the worker-tool question offers exactly claude and codex in order"(_code, { askedQuestions, askedOptions }) {
                const i = askedQuestions.indexOf("Which AI tool should the worker use?");
                Assert.deepStrictEqual(askedOptions[i]!.map(o => o.label), ["claude", "codex"]);
            },
            "the reviewer-tool question offers exactly claude and codex in order"(_code, { askedQuestions, askedOptions }) {
                const i = askedQuestions.indexOf("Which AI tool should reviewer use?");
                Assert.deepStrictEqual(askedOptions[i]!.map(o => o.label), ["claude", "codex"]);
            }
        }
    });
});
