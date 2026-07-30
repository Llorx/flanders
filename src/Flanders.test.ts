import * as Assert from "assert";

import test, { monad } from "arrange-act-assert";

import { Implement } from "./commands/Implement";
import { Flanders } from "./Flanders";
import type { FlandersContexts } from "./Flanders";
import { unavailableTerminalKeyInputContext } from "./ui/TerminalKeyInputSource.fixtures";

function stubContexts() {
    const written:string[] = [];
    const errors:string[] = [];
    const contexts:FlandersContexts = {
        claude: { spawn() { throw new Error("unexpected claude spawn"); } },
        script: { spawn() { throw new Error("unexpected script spawn"); } },
        fs: {
            readFile() { return Promise.reject(new Error("unexpected readFile")); },
            writeFile() { return Promise.reject(new Error("unexpected writeFile")); },
            rename() { return Promise.reject(new Error("unexpected rename")); },
            readdir() { return Promise.reject(new Error("unexpected readdir")); },
            stat() { return Promise.reject(new Error("unexpected stat")); },
            exists() { return Promise.resolve(false); },
            mkdir() { return Promise.reject(new Error("unexpected mkdir")); },
            mkdtemp() { return Promise.reject(new Error("unexpected mkdtemp")); },
            rm() { return Promise.reject(new Error("unexpected rm")); }
        },
        time: {
            now() { return 0; },
            setTimeout(_handler, _ms) {
                return { cancel() {} };
            }
        },
        random: { random() { return 0; } },
        keyInput: unavailableTerminalKeyInputContext,
        platform: {
            isWindows() { return false; },
            tmpdir() { return "/tmp"; },
            homedir() { return "/home/testuser"; }
        },
        ask: {
            askChoices() { return Promise.resolve([]); },
            askText() { return Promise.resolve(""); }
        },
        output: {
            write(text) { written.push(text); },
            writeError(text) { errors.push(text); },
            columns() { return 80; },
            rows() { return 24; },
            onResize() { return () => {}; }
        }
    };
    return { contexts, written, errors };
}

function arrangeImplementRun() {
    const { contexts, written, errors } = stubContexts();
    const files:Record<string, string> = {};
    const configJson = JSON.stringify({ worker: { tool: "claude", model: "", effort: "", fast: false }, reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }], minimumReviews: 1 });
    contexts.fs.writeFile = async (p, content) => { files[p] = content; };
    contexts.fs.readFile = async (p) => {
        if (p === "/proj/plans/plan.md") {
            return '# Plan\n\n- [x]{"it":0,"ot":0,"t":0} Done task\n';
        }
        if (p === "/proj/.flanders/config.json") {
            return configJson;
        }
        throw new Error("not found: " + p);
    };
    contexts.fs.exists = async (p) => p === "/proj/plans/plan.md" || p === "/proj/.flanders/config.json";
    contexts.fs.mkdir = async () => {};
    contexts.fs.mkdtemp = async (prefix) => prefix + "ws123";
    contexts.fs.rm = async () => {};
    return { contexts, written, errors };
}

test.describe("Flanders dispatch", test => {
    test("unknown command exits 1 and prints USAGE to stderr", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const f = new Flanders(["bogus"], { projectRoot: "/tmp" }, contexts);
            const code = await f.result();
            await f.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "names the unknown command"(_code, { errors }) {
                const stderr = errors.join("");
                Assert.ok(stderr.includes("Unknown command: bogus"));
            },
            "USAGE lists install"(_code, { errors }) {
                const stderr = errors.join("");
                Assert.ok(stderr.includes("install"));
            },
            "USAGE lists update"(_code, { errors }) {
                const stderr = errors.join("");
                Assert.ok(stderr.includes("update"));
            },
            "USAGE lists implement"(_code, { errors }) {
                const stderr = errors.join("");
                Assert.ok(stderr.includes("implement"));
            }
        }
    });

    test("no command exits 1 and prints USAGE to stderr", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const f = new Flanders([], { projectRoot: "/tmp" }, contexts);
            const code = await f.result();
            await f.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "indicates no command was given"(_code, { errors }) {
                const stderr = errors.join("");
                Assert.ok(stderr.includes("(none)"));
            },
            "USAGE lists install"(_code, { errors }) {
                const stderr = errors.join("");
                Assert.ok(stderr.includes("install"));
            },
            "USAGE lists implement"(_code, { errors }) {
                const stderr = errors.join("");
                Assert.ok(stderr.includes("implement"));
            }
        }
    });

    test("USAGE does not mention contract or plan as commands", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const f = new Flanders(["whatever"], { projectRoot: "/tmp" }, contexts);
            await f.result();
            await f.dispose();
        },
        ASSERTS: {
            "USAGE must not mention contract"(_, { errors }) {
                const stderr = errors.join("");
                const usagePart = stderr.substring(stderr.indexOf("usage:"));
                Assert.ok(!usagePart.includes("contract"));
            },
            "USAGE must not list plan as a command"(_, { errors }) {
                const stderr = errors.join("");
                const usagePart = stderr.substring(stderr.indexOf("usage:"));
                Assert.ok(!usagePart.includes("plan\n") && !usagePart.includes("plan "));
            }
        }
    });

    test("install command dispatches to Install and exits 0 with --project", {
        ARRANGE() {
            const { contexts, written, errors } = stubContexts();
            const files:Record<string, string> = {};
            contexts.fs.writeFile = async (p, content) => { files[p] = content; };
            contexts.fs.rename = async (oldPath, newPath) => { if (files[oldPath]) { files[newPath] = files[oldPath]; delete files[oldPath]; } };
            contexts.fs.mkdir = async () => {};
            contexts.script.spawn = () => {
                let exitListener:((code:number|null, signal:string|null) => void)|null = null;
                return {
                    on(event:string, listener:never) {
                        if (event === "exit") {
                            exitListener = listener;
                            Promise.resolve().then(() => exitListener?.(0, null));
                        }
                    },
                    kill() {}
                } as never;
            };
            return { contexts, written, errors, files };
        },
        async ACT({ contexts }) {
            const f = new Flanders(["install", "--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--worker-effort=", "--reviewer-tool=claude", "--reviewer-model=", "--reviewer-effort="], { projectRoot: "/proj" }, contexts);
            const code = await f.result();
            await f.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "produces no errors"(_code, { errors }) {
                Assert.strictEqual(errors.length, 0);
            },
            "output includes paths with flanders"(_code, { written }) {
                const output = written.join("");
                Assert.ok(output.includes("flanders"));
            },
            "writes at least 2 skill files"(_code, { files }) {
                Assert.ok(Object.keys(files).length >= 2);
            }
        }
    });

    test("install command exits 1 with conflicting flags", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const f = new Flanders(["install", "--global", "--project"], { projectRoot: "/proj" }, contexts);
            const code = await f.result();
            await f.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic names --global"(_code, { errors }) {
                const stderr = errors.join("");
                Assert.ok(stderr.includes("--global"));
            },
            "diagnostic names --project"(_code, { errors }) {
                const stderr = errors.join("");
                Assert.ok(stderr.includes("--project"));
            }
        }
    });

    test("update command dispatches to Update and refreshes installed skills", {
        ARRANGE() {
            const { contexts, written, errors } = stubContexts();
            const files:Record<string, string> = { "/proj/.claude/skills/flanders-spec/SKILL.md": "old content" };
            contexts.fs.exists = async (p) => p in files;
            contexts.fs.readFile = async (p) => {
                if (p in files) {
                    return files[p]!;
                }
                throw new Error(`not found: ${p}`);
            };
            contexts.fs.writeFile = async (p, content) => { files[p] = content; };
            contexts.fs.mkdir = async () => {};
            return { contexts, written, errors, files };
        },
        async ACT({ contexts }) {
            const f = new Flanders(["update"], { projectRoot: "/proj" }, contexts);
            const code = await f.result();
            await f.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 0"(code) {
                Assert.strictEqual(code, 0);
            },
            "produces no errors"(_code, { errors }) {
                Assert.strictEqual(errors.length, 0);
            },
            "rewrites the pre-existing spec skill"(_code, { files }) {
                Assert.notStrictEqual(files["/proj/.claude/skills/flanders-spec/SKILL.md"], "old content");
            },
            "completes the full Claude skill set"(_code, { files }) {
                Assert.ok("/proj/.claude/skills/flanders-plan/SKILL.md" in files && "/proj/.claude/skills/flanders-implement/SKILL.md" in files);
            }
        }
    });

    test("update command rejects unexpected arguments and exits non-zero", {
        ARRANGE() {
            const { contexts, written, errors } = stubContexts();
            const files:Record<string, string> = { "/proj/.claude/skills/flanders-spec/SKILL.md": "old content" };
            contexts.fs.exists = async (p) => p in files;
            contexts.fs.writeFile = async (p, content) => { files[p] = content; };
            contexts.fs.mkdir = async () => {};
            return { contexts, written, errors, files };
        },
        async ACT({ contexts }) {
            const f = new Flanders(["update", "--bogus"], { projectRoot: "/proj" }, contexts);
            const code = await f.result();
            await f.dispose();
            return code;
        },
        ASSERTS: {
            "exits with code 1"(code) {
                Assert.strictEqual(code, 1);
            },
            "diagnostic is exactly the no-arguments message"(_code, { errors }) {
                Assert.strictEqual(errors.join(""), "The update command takes no arguments.\n");
            },
            "does not refresh the pre-existing installation"(_code, { files }) {
                Assert.strictEqual(files["/proj/.claude/skills/flanders-spec/SKILL.md"], "old content");
            }
        }
    });

    test("implement command dispatches to Implement", {
        ARRANGE() {
            return arrangeImplementRun();
        },
        async ACT({ contexts }) {
            const f = new Flanders(["implement", "/proj/plans/plan.md"], { projectRoot: "/proj" }, contexts);
            const code = await f.result();
            await f.dispose();
            return code;
        },
        ASSERT(code) {
            Assert.strictEqual(code, 0);
        }
    });

    test("output() routes through the running command's own channel", {
        ARRANGE() {
            return arrangeImplementRun();
        },
        async ACT({ contexts }) {
            const f = new Flanders(["implement", "/proj/plans/plan.md"], { projectRoot: "/proj" }, contexts);
            await f.result();
            f.output().writeError("routed diagnostic\n");
            await f.dispose();
        },
        ASSERTS: {
            "the text reaches the command's output channel"(_result, { written }) {
                Assert.ok(written.join("").includes("routed diagnostic"), "the command's channel should carry the text");
            },
            "the text does not reach the injected channel directly"(_result, { errors }) {
                Assert.strictEqual(errors.join(""), "");
            }
        }
    });

    test("output() still routes through the command's channel when the command's disposal fails", {
        ARRANGE() {
            const arranged = arrangeImplementRun();
            const teardownFailure = new Error("command teardown blew up");
            const origDispose = Implement.prototype.dispose;
            Implement.prototype.dispose = function() {
                Implement.prototype.dispose = origDispose;
                return Promise.reject(teardownFailure);
            };
            return { ...arranged, teardownFailure, origDispose };
        },
        async ACT({ contexts, origDispose }) {
            try {
                const f = new Flanders(["implement", "/proj/plans/plan.md"], { projectRoot: "/proj" }, contexts);
                await f.result();
                const disposal = await monad(() => f.dispose());
                f.output().writeError("escaping teardown diagnostic\n");
                return disposal;
            } finally {
                Implement.prototype.dispose = origDispose;
            }
        },
        ASSERTS: {
            "the teardown failure escapes dispose"(disposal, { teardownFailure }) {
                disposal.should.error(teardownFailure);
            },
            "the diagnostic reaches the command's own output channel"(_disposal, { written }) {
                Assert.ok(written.join("").includes("escaping teardown diagnostic"), `the command's channel should carry the text, got: ${JSON.stringify(written.join(""))}`);
            },
            "the diagnostic does not fall back to the injected channel"(_disposal, { errors }) {
                Assert.strictEqual(errors.join(""), "");
            }
        }
    });

    test("output() falls back to the injected channel for a command that owns no live region", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const f = new Flanders(["update", "extra-arg"], { projectRoot: "/proj" }, contexts);
            await f.result();
            f.output().writeError("fallback diagnostic\n");
            await f.dispose();
        },
        ASSERT(_result, { errors }) {
            Assert.ok(errors.join("").includes("fallback diagnostic"), "the injected channel should carry the text");
        }
    });

    test("output() falls back to the injected channel when no command was dispatched", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const f = new Flanders(["bogus"], { projectRoot: "/proj" }, contexts);
            await f.result();
            f.output().writeError("no-command diagnostic\n");
            await f.dispose();
        },
        ASSERT(_result, { errors }) {
            Assert.ok(errors.join("").includes("no-command diagnostic"), "the injected channel should carry the text");
        }
    });

    test("dispose is idempotent", {
        ARRANGE() {
            return stubContexts();
        },
        async ACT({ contexts }) {
            const f = new Flanders(["unknown"], { projectRoot: "/tmp" }, contexts);
            await f.result();
            await f.dispose();
            await f.dispose();
        },
        ASSERT() {
            // no throw means success
        }
    });
});
