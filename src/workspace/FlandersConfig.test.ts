import * as Assert from "assert";

import test from "arrange-act-assert";

import { read, readScope, write } from "./FlandersConfig";
import type { FlandersConfig } from "./FlandersConfig";
import type { FsContext } from "../contexts";

function stubFs() {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const renames:Array<{ oldPath:string; newPath:string }> = [];
    const reads:string[] = [];
    const unreadable = new Set<string>();
    const fs:FsContext = {
        readFile(p) { reads.push(p); if (unreadable.has(p)) { return Promise.reject(new Error("EACCES: permission denied: " + p)); } return files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error("not found: " + p)); },
        writeFile(p, content) { files.set(p, content); return Promise.resolve(); },
        rename(oldP, newP) { renames.push({ oldPath: oldP, newPath: newP }); const c = files.get(oldP); if (c !== undefined) { files.delete(oldP); files.set(newP, c); } return Promise.resolve(); },
        readdir() { return Promise.resolve([]); },
        stat() { return Promise.reject(new Error("unexpected stat")); },
        exists(p) { return Promise.resolve(files.has(p) || dirs.has(p)); },
        mkdir(p) { dirs.add(p); return Promise.resolve(); },
        mkdtemp() { return Promise.reject(new Error("unexpected mkdtemp")); },
        rm() { return Promise.reject(new Error("unexpected rm")); }
    };
    return { fs, files, dirs, renames, reads, unreadable };
}

const VALID_CONFIG:FlandersConfig = {
    worker: { tool: "claude", model: "claude-opus-4-6", effort: "high", fast: false },
    reviewers: [{ tool: "codex", model: "gpt-5-codex", effort: "", fast: false, optional: false }],
    minimumReviews: 1
};

const SECOND_CONFIG:FlandersConfig = {
    worker: { tool: "codex", model: "", effort: "", fast: false },
    reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
    minimumReviews: 1
};

test.describe("read", test => {
    test("returns project scope when both scopes exist", {
        ARRANGE() {
            const s = stubFs();
            const projectConfig:FlandersConfig = {
                worker: { tool: "claude", model: "project-sentinel", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            const globalConfig:FlandersConfig = {
                worker: { tool: "codex", model: "global-sentinel", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            s.files.set("/project/.flanders/config.json", JSON.stringify(projectConfig, null, 2));
            s.files.set("/home/.flanders/config.json", JSON.stringify(globalConfig, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.worker.model, "project-sentinel");
        }
    });

    test("returns global scope when only global exists", {
        ARRANGE() {
            const s = stubFs();
            const globalConfig:FlandersConfig = {
                worker: { tool: "codex", model: "global-only", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            s.files.set("/home/.flanders/config.json", JSON.stringify(globalConfig, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.worker.model, "global-only");
        }
    });

    test("returns null when neither scope exists", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result, null);
        }
    });

    test("throws on invalid JSON", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", "not json{{{");
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERTS: {
            "error names the path"(error) {
                Assert.strictEqual(error!.message, "Malformed config at /project/.flanders/config.json: invalid JSON");
            }
        }
    });

    test("throws when worker is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({ reviewers: [{ tool: "claude", model: "", effort: "", fast: false }] }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "worker"`);
        }
    });

    test("throws when reviewers is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({ worker: { tool: "claude", model: "", effort: "", fast: false } }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers"`);
        }
    });

    test("throws when reviewers is not an array", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: { tool: "claude", model: "", effort: "", fast: false }
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers"`);
        }
    });

    test("throws when reviewers is an empty array", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: []
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: field "reviewers" must be a non-empty array`);
        }
    });

    test("throws when reviewers entry is not an object", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: ["not an object"]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers[0]"`);
        }
    });

    test("throws when reviewers[1] is missing tool", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [
                    { tool: "claude", model: "", effort: "", fast: false, optional: false },
                    { model: "", effort: "", fast: false }
                ],
                minimumReviews: 2
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers[1].tool"`);
        }
    });

    test("throws when worker.tool is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false }]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "worker.tool"`);
        }
    });

    test("throws when worker.tool is invalid value", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "cursor", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false }]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERTS: {
            "error names the field"(error) {
                Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: invalid value for "worker.tool": "cursor"`);
            }
        }
    });

    test("throws when worker.model is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false }]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "worker.model"`);
        }
    });

    test("throws when worker.effort is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "" },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false }]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "worker.effort"`);
        }
    });

    test("throws when worker.fast is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "" },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "worker.fast"`);
        }
    });

    test("throws when worker.fast is not a boolean", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: "yes" },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "worker.fast"`);
        }
    });

    test("throws when reviewers[0].tool is invalid value", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "gemini", model: "", effort: "", fast: false }]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: invalid value for "reviewers[0].tool": "gemini"`);
        }
    });

    test("throws when reviewers[0].model is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", effort: "", fast: false }]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers[0].model"`);
        }
    });

    test("throws when reviewers[0].effort is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "" }]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers[0].effort"`);
        }
    });

    test("throws when reviewers[0].fast is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers[0].fast"`);
        }
    });

    test("throws when reviewers[0].fast is not a boolean", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: "yes", optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers[0].fast"`);
        }
    });

    // The reader validates `fast`'s type only and does not enforce the cross-field eligibility
    // invariant (that `fast` is `true` only for a `claude` role on a fast-capable model). The
    // following tests pin that the reader accepts `fast:true` paired with a non-`claude` tool or a
    // non-fast-capable model — a regression that re-added reader-side eligibility enforcement would
    // make `read` throw and fail these assertions.
    test("accepts worker.fast true paired with a non-claude (codex) worker tool", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "codex", model: "gpt-5-codex", effort: "high", fast: true },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.worker.fast, true);
        }
    });

    test("accepts worker.fast true paired with a claude worker on a non-fast-capable model", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "claude-sonnet-4-6", effort: "", fast: true },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.worker.fast, true);
        }
    });

    test("accepts worker.fast true paired with a claude worker on the empty default model", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: true },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.worker.fast, true);
        }
    });

    test("accepts reviewers[0].fast true paired with a non-claude (antigravity) reviewer tool", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "antigravity", model: "Gemini 3.1 Pro (High)", effort: "", fast: true, optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.reviewers[0]!.fast, true);
        }
    });

    test("accepts reviewers[0].fast true paired with a claude reviewer on a non-fast-capable model", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "claude-opus-4-6", effort: "", fast: true, optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.reviewers[0]!.fast, true);
        }
    });

    test("accepts fast:true on a claude role whose model supports fast mode", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "claude-opus-4-8", effort: "high", fast: true },
                reviewers: [{ tool: "claude", model: "opus[1m]", effort: "", fast: true, optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "the worker fast:true validates"(result) {
                Assert.strictEqual(result!.worker.fast, true);
            },
            "the reviewer fast:true validates"(result) {
                Assert.strictEqual(result!.reviewers[0]!.fast, true);
            }
        }
    });

    test("throws on non-object JSON (array)", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", "[1,2,3]");
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, "Malformed config at /project/.flanders/config.json: expected a JSON object");
        }
    });

    test("throws on non-object JSON (string)", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", '"hello"');
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, "Malformed config at /project/.flanders/config.json: expected a JSON object");
        }
    });

    test("throws on invalid JSON in global scope", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/home/.flanders/config.json", "not json{{{");
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, "Malformed config at /home/.flanders/config.json: invalid JSON");
        }
    });

    test("accepts empty strings for model and effort", {
        ARRANGE() {
            const s = stubFs();
            const cfg:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            s.files.set("/project/.flanders/config.json", JSON.stringify(cfg));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "worker.model is empty string"(result) {
                Assert.strictEqual(result!.worker.model, "");
            },
            "worker.effort is empty string"(result) {
                Assert.strictEqual(result!.worker.effort, "");
            },
            "reviewers[0].model is empty string"(result) {
                Assert.strictEqual(result!.reviewers[0]!.model, "");
            },
            "reviewers[0].effort is empty string"(result) {
                Assert.strictEqual(result!.reviewers[0]!.effort, "");
            }
        }
    });

    test("throws when worker is an array", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: [],
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false }]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "worker"`);
        }
    });

    test("throws when reviewers entry is null", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [null]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers[0]"`);
        }
    });

    test("throws when reviewers entry is nested array", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [[]]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers[0]"`);
        }
    });

    test("throws when worker.tool is a number", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: 42, model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false }]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "worker.tool"`);
        }
    });

    test("accepts a multi-reviewer array", {
        ARRANGE() {
            const s = stubFs();
            const cfg:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [
                    { tool: "claude", model: "opus", effort: "high", fast: false, optional: false },
                    { tool: "codex", model: "gpt-5", effort: "medium", fast: false, optional: true },
                    { tool: "claude", model: "", effort: "", fast: false, optional: false }
                ],
                minimumReviews: 2
            };
            s.files.set("/project/.flanders/config.json", JSON.stringify(cfg));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "preserves three reviewers"(result) {
                Assert.strictEqual(result!.reviewers.length, 3);
            },
            "reviewers[0] equals first entry"(result) {
                Assert.deepStrictEqual(result!.reviewers[0], { tool: "claude", model: "opus", effort: "high", fast: false, optional: false });
            },
            "reviewers[1] equals second entry"(result) {
                Assert.deepStrictEqual(result!.reviewers[1], { tool: "codex", model: "gpt-5", effort: "medium", fast: false, optional: true });
            },
            "reviewers[2] equals third entry"(result) {
                Assert.deepStrictEqual(result!.reviewers[2], { tool: "claude", model: "", effort: "", fast: false, optional: false });
            }
        }
    });

    test("accepts an antigravity worker", {
        ARRANGE() {
            const s = stubFs();
            const cfg:FlandersConfig = {
                worker: { tool: "antigravity", model: "gemini-2.5-pro", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            s.files.set("/project/.flanders/config.json", JSON.stringify(cfg));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.worker.tool, "antigravity");
        }
    });

    test("accepts an antigravity reviewer", {
        ARRANGE() {
            const s = stubFs();
            const cfg:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "antigravity", model: "gemini-2.5-pro", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            s.files.set("/project/.flanders/config.json", JSON.stringify(cfg));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.reviewers[0]!.tool, "antigravity");
        }
    });

    test("accepts an antigravity role regardless of its effort string", {
        ARRANGE() {
            const s = stubFs();
            // The reader does not re-validate the empty-effort invariant antigravity
            // carries — that is enforced at write time by install. A non-empty effort
            // on an antigravity role is therefore still accepted by the reader.
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "antigravity", model: "gemini-2.5-pro", effort: "high", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "worker.tool is antigravity"(result) {
                Assert.strictEqual(result!.worker.tool, "antigravity");
            },
            "worker.effort is preserved verbatim"(result) {
                Assert.strictEqual(result!.worker.effort, "high");
            }
        }
    });

    test("accepts an antigravity role with the empty default-model marker", {
        ARRANGE() {
            const s = stubFs();
            // The empty string is the "default configured model" marker. Antigravity accepts any
            // model string, including this marker, so read must preserve "" rather than rejecting
            // or rewriting it — this guards the empty-model dimension specifically, since the other
            // antigravity acceptance tests use a non-empty model.
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "antigravity", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "worker.tool is antigravity"(result) {
                Assert.strictEqual(result!.worker.tool, "antigravity");
            },
            "worker.model is the empty default-model marker"(result) {
                Assert.strictEqual(result!.worker.model, "");
            }
        }
    });

    test("throws when reviewers[0].optional is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers[0].optional"`);
        }
    });

    test("throws when reviewers[0].optional is not a boolean", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: "yes" }],
                minimumReviews: 1
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewers[0].optional"`);
        }
    });

    test("throws when minimumReviews is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }]
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: field "minimumReviews" must be an integer in [1, 1]`);
        }
    });

    test("throws when minimumReviews is not an integer", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1.5
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: field "minimumReviews" must be an integer in [1, 1]`);
        }
    });

    test("throws when minimumReviews is below 1", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 0
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: field "minimumReviews" must be an integer in [1, 1]`);
        }
    });

    test("throws when minimumReviews exceeds the reviewer count", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [
                    { tool: "claude", model: "", effort: "", fast: false, optional: false },
                    { tool: "codex", model: "", effort: "", fast: false, optional: true }
                ],
                minimumReviews: 3
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: field "minimumReviews" must be an integer in [1, 2]`);
        }
    });

    test("throws on an unexpected top-level key", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1,
                extra: true
            }));
            return s;
        },
        async ACT({ fs }) {
            try {
                await read(fs, { projectRoot: "/project", homeDir: "/home" });
                return null;
            } catch (e) {
                return e as Error;
            }
        },
        ASSERT(error) {
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: unexpected top-level key "extra"`);
        }
    });
});

test.describe("readScope", test => {
    test("returns the validated config when the project scope file exists and is well-formed", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify(VALID_CONFIG, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "project", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, VALID_CONFIG);
        }
    });

    test("returns the validated config when the global scope file exists and is well-formed", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/home/.flanders/config.json", JSON.stringify(SECOND_CONFIG, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "global", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, SECOND_CONFIG);
        }
    });

    test("accepts an antigravity worker at the targeted scope", {
        ARRANGE() {
            const s = stubFs();
            const cfg:FlandersConfig = {
                worker: { tool: "antigravity", model: "gemini-2.5-pro", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            s.files.set("/project/.flanders/config.json", JSON.stringify(cfg, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "project", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.worker.tool, "antigravity");
        }
    });

    test("accepts an antigravity reviewer at the targeted scope", {
        ARRANGE() {
            const s = stubFs();
            const cfg:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "antigravity", model: "gemini-2.5-pro", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            s.files.set("/project/.flanders/config.json", JSON.stringify(cfg, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "project", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.strictEqual(result!.reviewers[0]!.tool, "antigravity");
        }
    });

    test("returns null when the targeted file is absent", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "project", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "returns null"(result) {
                Assert.strictEqual(result, null);
            },
            "reads only the requested project scope path"(_result, { reads }) {
                Assert.deepStrictEqual(reads, ["/project/.flanders/config.json"]);
            }
        }
    });

    test("returns null when the targeted file cannot be read", {
        ARRANGE() {
            const s = stubFs();
            s.unreadable.add("/project/.flanders/config.json");
            s.files.set("/home/.flanders/config.json", JSON.stringify(VALID_CONFIG, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "project", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "returns null"(result) {
                Assert.strictEqual(result, null);
            },
            "reads only the requested project scope path and never the valid global one"(_result, { reads }) {
                Assert.deepStrictEqual(reads, ["/project/.flanders/config.json"]);
            }
        }
    });

    test("returns null when the targeted file is not valid JSON", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", "not json{{{");
            s.files.set("/home/.flanders/config.json", JSON.stringify(VALID_CONFIG, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "project", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "returns null"(result) {
                Assert.strictEqual(result, null);
            },
            "reads only the requested project scope path and never the valid global one"(_result, { reads }) {
                Assert.deepStrictEqual(reads, ["/project/.flanders/config.json"]);
            }
        }
    });

    test("returns null when the targeted file is missing a required field", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            }));
            s.files.set("/home/.flanders/config.json", JSON.stringify(VALID_CONFIG, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "project", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "returns null"(result) {
                Assert.strictEqual(result, null);
            },
            "reads only the requested project scope path and never the valid global one"(_result, { reads }) {
                Assert.deepStrictEqual(reads, ["/project/.flanders/config.json"]);
            }
        }
    });

    test("returns null when the targeted file has an unexpected top-level key", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1,
                extra: true
            }));
            s.files.set("/home/.flanders/config.json", JSON.stringify(VALID_CONFIG, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "project", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "returns null"(result) {
                Assert.strictEqual(result, null);
            },
            "reads only the requested project scope path and never the valid global one"(_result, { reads }) {
                Assert.deepStrictEqual(reads, ["/project/.flanders/config.json"]);
            }
        }
    });

    test("a project call reads the project file and not the global file", {
        ARRANGE() {
            const s = stubFs();
            const projectConfig:FlandersConfig = {
                worker: { tool: "claude", model: "project-sentinel", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            const globalConfig:FlandersConfig = {
                worker: { tool: "codex", model: "global-sentinel", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            s.files.set("/project/.flanders/config.json", JSON.stringify(projectConfig));
            s.files.set("/home/.flanders/config.json", JSON.stringify(globalConfig));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "project", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "reads only the project scope path"(_result, { reads }) {
                Assert.deepStrictEqual(reads, ["/project/.flanders/config.json"]);
            },
            "returns the project scope's stored config"(result) {
                Assert.strictEqual(result!.worker.model, "project-sentinel");
            }
        }
    });

    test("a global call reads the global file and not the project file", {
        ARRANGE() {
            const s = stubFs();
            const projectConfig:FlandersConfig = {
                worker: { tool: "claude", model: "project-sentinel", effort: "", fast: false },
                reviewers: [{ tool: "claude", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            const globalConfig:FlandersConfig = {
                worker: { tool: "codex", model: "global-sentinel", effort: "", fast: false },
                reviewers: [{ tool: "codex", model: "", effort: "", fast: false, optional: false }],
                minimumReviews: 1
            };
            s.files.set("/project/.flanders/config.json", JSON.stringify(projectConfig));
            s.files.set("/home/.flanders/config.json", JSON.stringify(globalConfig));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "global", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "reads only the global scope path"(_result, { reads }) {
                Assert.deepStrictEqual(reads, ["/home/.flanders/config.json"]);
            },
            "returns the global scope's stored config"(result) {
                Assert.strictEqual(result!.worker.model, "global-sentinel");
            }
        }
    });

    test("a project call does not fall back to the global file", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/home/.flanders/config.json", JSON.stringify(VALID_CONFIG, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "project", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "returns null"(result) {
                Assert.strictEqual(result, null);
            },
            "reads only the project scope path and never the present global one"(_result, { reads }) {
                Assert.deepStrictEqual(reads, ["/project/.flanders/config.json"]);
            }
        }
    });

    test("a global call does not fall back to the project file", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify(VALID_CONFIG, null, 2));
            return s;
        },
        async ACT({ fs }) {
            return await readScope(fs, { scope: "global", projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "returns null"(result) {
                Assert.strictEqual(result, null);
            },
            "reads only the global scope path and never the present project one"(_result, { reads }) {
                Assert.deepStrictEqual(reads, ["/home/.flanders/config.json"]);
            }
        }
    });
});

test.describe("write", test => {
    test("round-trips through JSON.parse to exactly the input object", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: VALID_CONFIG });
            return fs;
        },
        ASSERT(_fs, { files }) {
            const content = files.get("/project/.flanders/config.json")!;
            Assert.deepStrictEqual(JSON.parse(content), VALID_CONFIG);
        }
    });

    test("top-level keys are exactly worker, reviewers, and minimumReviews", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: VALID_CONFIG });
            return fs;
        },
        ASSERT(_fs, { files }) {
            const content = files.get("/project/.flanders/config.json")!;
            Assert.deepStrictEqual(Object.keys(JSON.parse(content)).sort(), ["minimumReviews", "reviewers", "worker"]);
        }
    });

    test("creates .flanders directory when missing", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: VALID_CONFIG });
        },
        ASSERT(_, { dirs }) {
            Assert.ok(dirs.has("/project/.flanders"));
        }
    });

    test("writes to global scope when scope is global", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            return await write(fs, { scope: "global", projectRoot: "/project", homeDir: "/home", config: VALID_CONFIG });
        },
        ASSERTS: {
            "returns the global path"(path) {
                Assert.strictEqual(path, "/home/.flanders/config.json");
            },
            "file exists at global path"(_, { files }) {
                Assert.ok(files.has("/home/.flanders/config.json"));
            },
            "file does not exist at project path"(_, { files }) {
                Assert.ok(!files.has("/project/.flanders/config.json"));
            }
        }
    });

    test("overwrites silently on second write at same scope", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: VALID_CONFIG });
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: SECOND_CONFIG });
            return fs;
        },
        ASSERT(_fs, { files }) {
            const content = files.get("/project/.flanders/config.json")!;
            Assert.deepStrictEqual(JSON.parse(content), SECOND_CONFIG);
        }
    });

    test("uses temp-file-plus-rename mechanism", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: VALID_CONFIG });
        },
        ASSERTS: {
            "rename was called once"(_, { renames }) {
                Assert.strictEqual(renames.length, 1);
            },
            "rename source is .tmp"(_, { renames }) {
                Assert.strictEqual(renames[0]!.oldPath, "/project/.flanders/config.json.tmp");
            },
            "rename target is config.json"(_, { renames }) {
                Assert.strictEqual(renames[0]!.newPath, "/project/.flanders/config.json");
            },
            "temp file does not remain on disk"(_, { files }) {
                Assert.ok(!files.has("/project/.flanders/config.json.tmp"));
            }
        }
    });

    test("returns the path written", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            return await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: VALID_CONFIG });
        },
        ASSERT(path) {
            Assert.strictEqual(path, "/project/.flanders/config.json");
        }
    });

    test("serializes with 2-space indentation and trailing newline", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: VALID_CONFIG });
            return fs;
        },
        ASSERTS: {
            "content matches JSON.stringify with 2 spaces plus newline"(_fs, { files }) {
                const content = files.get("/project/.flanders/config.json")!;
                Assert.strictEqual(content, JSON.stringify(VALID_CONFIG, null, 2) + "\n");
            }
        }
    });
});

test.describe("read + write round-trip", test => {
    test("write then read returns exactly the written config", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: VALID_CONFIG });
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, VALID_CONFIG);
        }
    });

    test("write then read preserves a multi-reviewer ordered list", {
        ARRANGE() {
            return stubFs();
        },
        async ACT({ fs }) {
            const cfg:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [
                    { tool: "claude", model: "opus", effort: "high", fast: false, optional: false },
                    { tool: "codex", model: "gpt-5", effort: "medium", fast: false, optional: true }
                ],
                minimumReviews: 1
            };
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: cfg });
            return { result: await read(fs, { projectRoot: "/project", homeDir: "/home" }), expected: cfg };
        },
        ASSERT({ result, expected }) {
            Assert.deepStrictEqual(result, expected);
        }
    });

    test("write then read carries each reviewer's optional flag and minimumReviews", {
        ARRANGE() {
            const cfg:FlandersConfig = {
                worker: { tool: "claude", model: "", effort: "", fast: false },
                reviewers: [
                    { tool: "claude", model: "opus", effort: "high", fast: false, optional: false },
                    { tool: "codex", model: "gpt-5", effort: "medium", fast: false, optional: true }
                ],
                minimumReviews: 2
            };
            return { ...stubFs(), cfg };
        },
        async ACT({ fs, cfg }) {
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: cfg });
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "reviewers[0].optional round-trips as false"(result) {
                Assert.strictEqual(result!.reviewers[0]!.optional, false);
            },
            "reviewers[1].optional round-trips as true"(result) {
                Assert.strictEqual(result!.reviewers[1]!.optional, true);
            },
            "minimumReviews round-trips intact"(result) {
                Assert.strictEqual(result!.minimumReviews, 2);
            }
        }
    });

    test("write then read carries each role's fast flag", {
        ARRANGE() {
            const cfg:FlandersConfig = {
                worker: { tool: "claude", model: "opus", effort: "high", fast: true },
                reviewers: [
                    { tool: "claude", model: "opus", effort: "high", fast: true, optional: false },
                    { tool: "codex", model: "gpt-5", effort: "medium", fast: false, optional: true }
                ],
                minimumReviews: 2
            };
            return { ...stubFs(), cfg };
        },
        async ACT({ fs, cfg }) {
            await write(fs, { scope: "project", projectRoot: "/project", homeDir: "/home", config: cfg });
            return await read(fs, { projectRoot: "/project", homeDir: "/home" });
        },
        ASSERTS: {
            "worker.fast round-trips as true"(result) {
                Assert.strictEqual(result!.worker.fast, true);
            },
            "reviewers[0].fast round-trips as true"(result) {
                Assert.strictEqual(result!.reviewers[0]!.fast, true);
            },
            "reviewers[1].fast round-trips as false"(result) {
                Assert.strictEqual(result!.reviewers[1]!.fast, false);
            }
        }
    });
});
