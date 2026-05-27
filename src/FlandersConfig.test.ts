import * as Assert from "assert";

import test from "arrange-act-assert";

import { read, write } from "./FlandersConfig";
import type { FlandersConfig } from "./FlandersConfig";
import type { FsContext } from "./contexts";

function stubFs() {
    const files = new Map<string, string>();
    const dirs = new Set<string>();
    const renames:Array<{ oldPath:string; newPath:string }> = [];
    const fs:FsContext = {
        readFile(p) { return files.has(p) ? Promise.resolve(files.get(p)!) : Promise.reject(new Error("not found: " + p)); },
        writeFile(p, content) { files.set(p, content); return Promise.resolve(); },
        rename(oldP, newP) { renames.push({ oldPath: oldP, newPath: newP }); const c = files.get(oldP); if (c !== undefined) { files.delete(oldP); files.set(newP, c); } return Promise.resolve(); },
        readdir() { return Promise.resolve([]); },
        stat() { return Promise.reject(new Error("unexpected stat")); },
        exists(p) { return Promise.resolve(files.has(p) || dirs.has(p)); },
        mkdir(p) { dirs.add(p); return Promise.resolve(); },
        mkdtemp() { return Promise.reject(new Error("unexpected mkdtemp")); },
        rm() { return Promise.reject(new Error("unexpected rm")); }
    };
    return { fs, files, dirs, renames };
}

const VALID_CONFIG:FlandersConfig = {
    worker: { tool: "claude", model: "claude-opus-4-6", effort: "high" },
    reviewer: { tool: "codex", model: "gpt-5-codex", effort: "" }
};

const SECOND_CONFIG:FlandersConfig = {
    worker: { tool: "codex", model: "", effort: "" },
    reviewer: { tool: "claude", model: "", effort: "" }
};

test.describe("read", test => {
    test("returns project scope when both scopes exist", {
        ARRANGE() {
            const s = stubFs();
            const projectConfig:FlandersConfig = {
                worker: { tool: "claude", model: "project-sentinel", effort: "" },
                reviewer: { tool: "claude", model: "", effort: "" }
            };
            const globalConfig:FlandersConfig = {
                worker: { tool: "codex", model: "global-sentinel", effort: "" },
                reviewer: { tool: "codex", model: "", effort: "" }
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
                worker: { tool: "codex", model: "global-only", effort: "" },
                reviewer: { tool: "codex", model: "", effort: "" }
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
            s.files.set("/project/.flanders/config.json", JSON.stringify({ reviewer: { tool: "claude", model: "", effort: "" } }));
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

    test("throws when reviewer is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({ worker: { tool: "claude", model: "", effort: "" } }));
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
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewer"`);
        }
    });

    test("throws when worker.tool is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { model: "", effort: "" },
                reviewer: { tool: "claude", model: "", effort: "" }
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
                worker: { tool: "cursor", model: "", effort: "" },
                reviewer: { tool: "claude", model: "", effort: "" }
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
                worker: { tool: "claude", effort: "" },
                reviewer: { tool: "claude", model: "", effort: "" }
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
                reviewer: { tool: "claude", model: "", effort: "" }
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

    test("throws when reviewer.tool is invalid value", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "" },
                reviewer: { tool: "gemini", model: "", effort: "" }
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
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: invalid value for "reviewer.tool": "gemini"`);
        }
    });

    test("throws when reviewer.model is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "" },
                reviewer: { tool: "claude", effort: "" }
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
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewer.model"`);
        }
    });

    test("throws when reviewer.effort is missing", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "" },
                reviewer: { tool: "claude", model: "" }
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
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewer.effort"`);
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
                worker: { tool: "claude", model: "", effort: "" },
                reviewer: { tool: "codex", model: "", effort: "" }
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
            "reviewer.model is empty string"(result) {
                Assert.strictEqual(result!.reviewer.model, "");
            },
            "reviewer.effort is empty string"(result) {
                Assert.strictEqual(result!.reviewer.effort, "");
            }
        }
    });

    test("throws when worker is an array", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: [],
                reviewer: { tool: "claude", model: "", effort: "" }
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

    test("throws when reviewer is null", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: "claude", model: "", effort: "" },
                reviewer: null
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
            Assert.strictEqual(error!.message, `Malformed config at /project/.flanders/config.json: missing or invalid field "reviewer"`);
        }
    });

    test("throws when worker.tool is a number", {
        ARRANGE() {
            const s = stubFs();
            s.files.set("/project/.flanders/config.json", JSON.stringify({
                worker: { tool: 42, model: "", effort: "" },
                reviewer: { tool: "claude", model: "", effort: "" }
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
});

test.describe("no direct imports", test => {
    test("module source does not import fs, os, or path", {
        ARRANGE() {
            const nodeFs = require("fs") as typeof import("fs");
            const nodePath = require("path") as typeof import("path");
            const srcDir = nodePath.resolve(__dirname, "..", "src");
            const source = nodeFs.readFileSync(nodePath.join(srcDir, "FlandersConfig.ts"), "utf8");
            return source;
        },
        ACT(source) {
            return source;
        },
        ASSERTS: {
            "does not import fs"(source) {
                Assert.strictEqual(/^import .* from ["']fs["']/m.test(source), false);
            },
            "does not import fs/promises"(source) {
                Assert.strictEqual(/^import .* from ["']fs\/promises["']/m.test(source), false);
            },
            "does not import os"(source) {
                Assert.strictEqual(/^import .* from ["']os["']/m.test(source), false);
            },
            "does not import path"(source) {
                Assert.strictEqual(/^import .* from ["']path["']/m.test(source), false);
            }
        }
    });
});
