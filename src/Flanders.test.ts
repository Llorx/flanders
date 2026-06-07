import * as Assert from "assert";

import test from "arrange-act-assert";

import { Flanders } from "./Flanders";
import type { FlandersContexts } from "./Flanders";

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
            const f = new Flanders(["install", "--project", "--skills-tool=claude", "--worker-tool=claude", "--worker-model=", "--reviewer-tool=claude", "--reviewer-model="], { projectRoot: "/proj" }, contexts);
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

    test("implement command dispatches to Implement", {
        ARRANGE() {
            const { contexts, written, errors } = stubContexts();
            const files:Record<string, string> = {};
            const configJson = JSON.stringify({ worker: { tool: "claude", model: "", effort: "" }, reviewers: [{ tool: "claude", model: "", effort: "" }] });
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
