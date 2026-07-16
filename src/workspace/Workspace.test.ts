import * as Assert from "assert";

import test from "arrange-act-assert";

import { Workspace } from "./Workspace";
import type { PlatformContext } from "./Workspace";
import type { FsContext } from "../contexts";

type RmCall = { path:string; options:Readonly<{ recursive?:boolean; force?:boolean }> | undefined };

function stubFs():FsContext & { rmCalls:RmCall[]; mkdtempDirs:string[]; mkdtempPrefixes:string[] } {
    const dirs:string[] = [];
    const rmCalls:RmCall[] = [];
    const mkdtempPrefixes:string[] = [];
    return {
        readFile() { return Promise.reject(new Error("unexpected readFile")); },
        writeFile() { return Promise.resolve(); },
        rename() { return Promise.resolve(); },
        readdir() { return Promise.resolve([]); },
        stat() { return Promise.reject(new Error("unexpected stat")); },
        exists() { return Promise.resolve(false); },
        mkdir() { return Promise.resolve(); },
        mkdtemp(prefix:string) {
            mkdtempPrefixes.push(prefix);
            const suffix = dirs.length === 0 ? "abc123" : `rev${dirs.length}`;
            const dir = prefix + suffix;
            dirs.push(dir);
            return Promise.resolve(dir);
        },
        rm(path:string, options?:Readonly<{ recursive?:boolean; force?:boolean }>) { rmCalls.push({ path, options }); return Promise.resolve(); },
        rmCalls,
        mkdtempDirs: dirs,
        mkdtempPrefixes
    };
}

function stubPlatform(windows:boolean):PlatformContext {
    return {
        isWindows() { return windows; },
        tmpdir() { return windows ? "C:/tmp" : "/tmp"; },
        homedir() { return windows ? "C:/Users/test" : "/home/test"; }
    };
}

test.describe("WorkspacePaths per-iteration log paths", test => {
    test("workerLog returns unique path per iteration", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            const paths = await ws.setup(0);
            return paths;
        },
        ASSERTS: {
            "iteration 1 path"(paths) {
                Assert.strictEqual(paths.workerLog(1), paths.root + "/worker.1.log");
            },
            "iteration 2 path"(paths) {
                Assert.strictEqual(paths.workerLog(2), paths.root + "/worker.2.log");
            },
            "iteration 1 differs from iteration 2"(paths) {
                Assert.notStrictEqual(paths.workerLog(1), paths.workerLog(2));
            }
        }
    });

    test("buildLog returns unique path per iteration", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERTS: {
            "iteration 1 path"(paths) {
                Assert.strictEqual(paths.buildLog(1), paths.root + "/build.1.log");
            },
            "iteration 3 path"(paths) {
                Assert.strictEqual(paths.buildLog(3), paths.root + "/build.3.log");
            }
        }
    });

    test("testLog returns unique path per iteration", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERTS: {
            "iteration 1 path"(paths) {
                Assert.strictEqual(paths.testLog(1), paths.root + "/test.1.log");
            },
            "iteration 4 path"(paths) {
                Assert.strictEqual(paths.testLog(4), paths.root + "/test.4.log");
            }
        }
    });

    test("reviewerLog returns unique path per iteration", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERTS: {
            "iteration 1 path"(paths) {
                Assert.strictEqual(paths.reviewerLog(1), paths.root + "/reviewer.1.log");
            },
            "iteration 5 path"(paths) {
                Assert.strictEqual(paths.reviewerLog(5), paths.root + "/reviewer.5.log");
            }
        }
    });

    test("errorLog remains a fixed path inside the main root (not per-iteration)", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERT(paths) {
            Assert.strictEqual(paths.errorLog, paths.root + "/error.log");
        }
    });

    test("per-iteration paths are stable across multiple calls", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            const paths = await ws.setup(0);
            return { first: paths.workerLog(1), second: paths.workerLog(1) };
        },
        ASSERT({ first, second }) {
            Assert.strictEqual(first, second);
        }
    });

    test("prepLog returns path with joinPath(root, prep.<taskIndex>.log)", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERTS: {
            "task 0 path"(paths) {
                Assert.strictEqual(paths.prepLog(0), paths.root + "/prep.0.log");
            },
            "task 3 path"(paths) {
                Assert.strictEqual(paths.prepLog(3), paths.root + "/prep.3.log");
            }
        }
    });

    test("prepLog is stable across multiple calls", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            const paths = await ws.setup(0);
            return { first: paths.prepLog(1), second: paths.prepLog(1) };
        },
        ASSERT({ first, second }) {
            Assert.strictEqual(first, second);
        }
    });

    test("all log paths for one task produce zero collisions (Set size 6)", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERT(paths) {
            const taskIndex = 1;
            const all = [
                paths.prepLog(taskIndex),
                paths.workerLog(taskIndex),
                paths.buildLog(taskIndex),
                paths.testLog(taskIndex),
                paths.reviewerLog(taskIndex),
                paths.errorLog
            ];
            Assert.strictEqual(new Set(all).size, 6);
        }
    });

    test("different stages produce different paths for same iteration", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERT(paths) {
            const iter = 1;
            const all = [
                paths.workerLog(iter),
                paths.buildLog(iter),
                paths.testLog(iter),
                paths.reviewerLog(iter)
            ];
            Assert.strictEqual(new Set(all).size, 4);
        }
    });

    test("paths() also exposes per-iteration log methods", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            await ws.setup(0);
            return ws.paths();
        },
        ASSERTS: {
            "prepLog path"(paths) {
                Assert.strictEqual(paths.prepLog(2), paths.root + "/prep.2.log");
            },
            "workerLog path"(paths) {
                Assert.strictEqual(paths.workerLog(2), paths.root + "/worker.2.log");
            },
            "buildLog path"(paths) {
                Assert.strictEqual(paths.buildLog(2), paths.root + "/build.2.log");
            },
            "testLog path"(paths) {
                Assert.strictEqual(paths.testLog(2), paths.root + "/test.2.log");
            },
            "reviewerLog path"(paths) {
                Assert.strictEqual(paths.reviewerLog(2), paths.root + "/reviewer.2.log");
            }
        }
    });
});

test.describe("WorkspacePaths hard-stop per-iteration error-log paths", test => {
    test("buildErrorLog returns build.<iter>.error.log inside the main root", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERTS: {
            "iteration 1 path"(paths) {
                Assert.strictEqual(paths.buildErrorLog(1), paths.root + "/build.1.error.log");
            },
            "iteration 3 path"(paths) {
                Assert.strictEqual(paths.buildErrorLog(3), paths.root + "/build.3.error.log");
            }
        }
    });

    test("testErrorLog returns test.<iter>.error.log inside the main root", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERTS: {
            "iteration 2 path"(paths) {
                Assert.strictEqual(paths.testErrorLog(2), paths.root + "/test.2.error.log");
            },
            "iteration 5 path"(paths) {
                Assert.strictEqual(paths.testErrorLog(5), paths.root + "/test.5.error.log");
            }
        }
    });

    test("commitErrorLog returns commit.<iter>.error.log inside the main root", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERTS: {
            "iteration 1 path"(paths) {
                Assert.strictEqual(paths.commitErrorLog(1), paths.root + "/commit.1.error.log");
            },
            "iteration 4 path"(paths) {
                Assert.strictEqual(paths.commitErrorLog(4), paths.root + "/commit.4.error.log");
            }
        }
    });

    test("reviewerErrorLogFor returns reviewer.<iter>.<position>.error.log inside the main root", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(3);
        },
        ASSERTS: {
            "iter 1 position 1 path"(paths) {
                Assert.strictEqual(paths.reviewerErrorLogFor(1, 1), paths.root + "/reviewer.1.1.error.log");
            },
            "iter 3 position 2 path"(paths) {
                Assert.strictEqual(paths.reviewerErrorLogFor(3, 2), paths.root + "/reviewer.3.2.error.log");
            },
            "different (iter,position) combinations produce different paths"(paths) {
                const all = new Set([
                    paths.reviewerErrorLogFor(1, 1),
                    paths.reviewerErrorLogFor(1, 2),
                    paths.reviewerErrorLogFor(2, 1),
                    paths.reviewerErrorLogFor(2, 2)
                ]);
                Assert.strictEqual(all.size, 4);
            }
        }
    });

    test("materialized error-log paths do not collide with the streamed-output log paths for the same iteration", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(1);
        },
        ASSERTS: {
            "buildErrorLog differs from buildLog"(paths) {
                Assert.notStrictEqual(paths.buildErrorLog(1), paths.buildLog(1));
            },
            "testErrorLog differs from testLog"(paths) {
                Assert.notStrictEqual(paths.testErrorLog(1), paths.testLog(1));
            },
            "reviewerErrorLogFor differs from reviewerOutputLog"(paths) {
                Assert.notStrictEqual(paths.reviewerErrorLogFor(1, 1), paths.reviewerOutputLog(1, 1));
            },
            "all eight (four streamed + four materialized) one-iteration paths are distinct"(paths) {
                const all = [
                    paths.workerLog(1),
                    paths.buildLog(1),
                    paths.testLog(1),
                    paths.reviewerOutputLog(1, 1),
                    paths.buildErrorLog(1),
                    paths.testErrorLog(1),
                    paths.commitErrorLog(1),
                    paths.reviewerErrorLogFor(1, 1)
                ];
                Assert.strictEqual(new Set(all).size, 8);
            }
        }
    });

    test("paths() also exposes the materialized error-log path methods", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            await ws.setup(2);
            return ws.paths();
        },
        ASSERTS: {
            "buildErrorLog path"(paths) {
                Assert.strictEqual(paths.buildErrorLog(2), paths.root + "/build.2.error.log");
            },
            "testErrorLog path"(paths) {
                Assert.strictEqual(paths.testErrorLog(2), paths.root + "/test.2.error.log");
            },
            "commitErrorLog path"(paths) {
                Assert.strictEqual(paths.commitErrorLog(2), paths.root + "/commit.2.error.log");
            },
            "reviewerErrorLogFor path"(paths) {
                Assert.strictEqual(paths.reviewerErrorLogFor(2, 1), paths.root + "/reviewer.2.1.error.log");
            }
        }
    });
});

test.describe("Workspace.preserveOnDispose", test => {
    test("dispose without preserveOnDispose removes the main folder (no reviewers)", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            const paths = await ws.setup(0);
            await ws.dispose();
            return paths.root;
        },
        ASSERTS: {
            "rm called exactly once"(_root, { fs }) {
                Assert.strictEqual(fs.rmCalls.length, 1);
            },
            "rm called with the main root path"(root, { fs }) {
                Assert.strictEqual(fs.rmCalls[0]!.path, root);
            },
            "rm called with recursive and force options"(_root, { fs }) {
                Assert.deepStrictEqual(fs.rmCalls[0]!.options, { recursive: true, force: true });
            }
        }
    });

    test("dispose without preserveOnDispose removes the main folder and every per-reviewer folder", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws, fs }) {
            const paths = await ws.setup(3);
            const reviewerErrorLogPaths = [
                paths.reviewerErrorLog(1),
                paths.reviewerErrorLog(2),
                paths.reviewerErrorLog(3)
            ];
            const allocated = [...fs.mkdtempDirs];
            await ws.dispose();
            return { root: paths.root, allocated, reviewerErrorLogPaths };
        },
        ASSERTS: {
            "rm called exactly four times (main + 3 reviewers)"(_, { fs }) {
                Assert.strictEqual(fs.rmCalls.length, 4);
            },
            "all rm calls use recursive and force options"(_, { fs }) {
                for (const call of fs.rmCalls) {
                    Assert.deepStrictEqual(call.options, { recursive: true, force: true });
                }
            },
            "rm called on every allocated folder (main + per-reviewer)"({ allocated }, { fs }) {
                const removed = new Set(fs.rmCalls.map(c => c.path));
                const expected = new Set(allocated);
                Assert.deepStrictEqual(removed, expected);
            },
            "rm called exactly once per allocated folder"(_, { fs }) {
                const counts = new Map<string, number>();
                for (const c of fs.rmCalls) counts.set(c.path, (counts.get(c.path) ?? 0) + 1);
                for (const count of counts.values()) {
                    Assert.strictEqual(count, 1);
                }
            },
            "per-reviewer folders are removed before the main folder"({ root }, { fs }) {
                const mainIdx = fs.rmCalls.findIndex(c => c.path === root);
                const reviewerIndices = fs.rmCalls
                    .map((c, i) => ({ path: c.path, i }))
                    .filter(e => e.path !== root)
                    .map(e => e.i);
                for (const ri of reviewerIndices) {
                    Assert.ok(ri < mainIdx, `reviewer folder rm at index ${ri} should come before main rm at ${mainIdx}`);
                }
            }
        }
    });

    test("dispose after preserveOnDispose does not remove the main folder nor any per-reviewer folder", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            await ws.setup(3);
            ws.preserveOnDispose();
            await ws.dispose();
        },
        ASSERTS: {
            "rm not called at all"(_result, { fs }) {
                Assert.deepStrictEqual(fs.rmCalls, []);
            },
            async "workspace is marked as disposed"(_result, { ws }) {
                await Assert.rejects(() => ws.setup(0), /Workspace disposed/);
            },
            "root is cleared"(_result, { ws }) {
                Assert.throws(() => ws.paths(), /Workspace not set up/);
            }
        }
    });

    test("idempotent dispose after preserveOnDispose does not error", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            await ws.setup(2);
            ws.preserveOnDispose();
            await ws.dispose();
            await ws.dispose();
        },
        ASSERT(_result, { fs }) {
            Assert.deepStrictEqual(fs.rmCalls, []);
        }
    });

    test("idempotent dispose without preserveOnDispose invokes rm exactly once per folder", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            const paths = await ws.setup(2);
            await ws.dispose();
            await ws.dispose();
            return paths.root;
        },
        ASSERTS: {
            "rm called exactly three times (main + 2 reviewers)"(_root, { fs }) {
                Assert.strictEqual(fs.rmCalls.length, 3);
            },
            "every rm uses recursive and force options"(_root, { fs }) {
                for (const call of fs.rmCalls) {
                    Assert.deepStrictEqual(call.options, { recursive: true, force: true });
                }
            }
        }
    });

    test("preserveOnDispose after dispose is a safe noop", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            const paths = await ws.setup(1);
            await ws.dispose();
            ws.preserveOnDispose();
            return paths.root;
        },
        ASSERT(root, { fs }) {
            Assert.strictEqual(fs.rmCalls.length, 2);
            Assert.ok(fs.rmCalls.some(c => c.path === root));
        }
    });
});

test.describe("Workspace.setup guards", test => {
    test("setup after dispose throws Workspace disposed", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            await ws.setup(0);
            await ws.dispose();
            try {
                await ws.setup(0);
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.strictEqual(message, "Workspace disposed");
        }
    });

    test("setup called twice throws Workspace already set up", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            await ws.setup(0);
            try {
                await ws.setup(0);
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.strictEqual(message, "Workspace already set up");
        }
    });
});

test.describe("Workspace paths on Windows platform", test => {
    test("setup with isWindows true returns .bat script names", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(true));
        },
        async ACT(ws) {
            return await ws.setup(0);
        },
        ASSERTS: {
            "buildScript ends with build.bat"(paths) {
                Assert.ok(paths.buildScript.endsWith("/build.bat"));
            },
            "testScript ends with test.bat"(paths) {
                Assert.ok(paths.testScript.endsWith("/test.bat"));
            }
        }
    });
});

test.describe("Workspace.clearErrorLog", test => {
    test("calls rm with force when error log exists", {
        ARRANGE() {
            const fs = stubFs();
            const origExists = fs.exists;
            fs.exists = (p:string) => {
                if (p.endsWith("/error.log")) {
                    return Promise.resolve(true);
                }
                return origExists(p);
            };
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            await ws.setup(0);
            await ws.clearErrorLog();
        },
        ASSERTS: {
            "rm called once"(_result, { fs }) {
                Assert.strictEqual(fs.rmCalls.length, 1);
            },
            "rm called on the main root error.log"(_result, { fs, ws }) {
                Assert.strictEqual(fs.rmCalls[0]!.path, ws.paths().errorLog);
            },
            "rm called with force option only"(_result, { fs }) {
                Assert.deepStrictEqual(fs.rmCalls[0]!.options, { force: true });
            }
        }
    });

    test("does not call rm when error log does not exist", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            await ws.setup(0);
            await ws.clearErrorLog();
        },
        ASSERT(_result, { fs }) {
            Assert.strictEqual(fs.rmCalls.length, 0);
        }
    });
});

test.describe("Workspace.errorLogExists", test => {
    test("returns true when error.log exists", {
        ARRANGE() {
            const fs = stubFs();
            fs.exists = (p:string) => Promise.resolve(p.endsWith("/error.log"));
            const ws = new Workspace(fs, stubPlatform(false));
            return { ws };
        },
        async ACT({ ws }) {
            await ws.setup(0);
            return await ws.errorLogExists();
        },
        ASSERT(result) {
            Assert.strictEqual(result, true);
        }
    });

    test("returns false when error.log does not exist", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { ws };
        },
        async ACT({ ws }) {
            await ws.setup(0);
            return await ws.errorLogExists();
        },
        ASSERT(result) {
            Assert.strictEqual(result, false);
        }
    });

    test("throws when workspace is not set up", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            try {
                await ws.errorLogExists();
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.strictEqual(message, "Workspace not set up");
        }
    });
});

test.describe("Workspace.writeErrorLog", test => {
    test("writes content to the error log path", {
        ARRANGE() {
            const fs = stubFs();
            const written:Record<string, string> = {};
            fs.writeFile = (p:string, content:string) => { written[p] = content; return Promise.resolve(); };
            const ws = new Workspace(fs, stubPlatform(false));
            return { ws, written };
        },
        async ACT({ ws }) {
            await ws.setup(0);
            await ws.writeErrorLog("something went wrong");
        },
        ASSERTS: {
            "writes exactly one file"(_, { written }) {
                Assert.strictEqual(Object.keys(written).length, 1);
            },
            "written path is the main root error.log"(_, { written, ws }) {
                const key = Object.keys(written)[0]!;
                Assert.strictEqual(key, ws.paths().errorLog);
            },
            "written content matches input"(_, { written }) {
                const content = Object.values(written)[0]!;
                Assert.strictEqual(content, "something went wrong");
            }
        }
    });
});

test.describe("Workspace setup allocates one independent folder per reviewer", test => {
    test("setup(0) allocates only the main folder (no per-reviewer folders)", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            return await ws.setup(0);
        },
        ASSERTS: {
            "mkdtemp called exactly once"(_paths, { fs }) {
                Assert.strictEqual(fs.mkdtempDirs.length, 1);
            },
            "the single allocated folder is paths.root"(paths, { fs }) {
                Assert.strictEqual(fs.mkdtempDirs[0], paths.root);
            }
        }
    });

    test("setup(N) allocates exactly N+1 folders (1 main + N per-reviewer)", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            return await ws.setup(3);
        },
        ASSERTS: {
            "mkdtemp called exactly four times"(_paths, { fs }) {
                Assert.strictEqual(fs.mkdtempDirs.length, 4);
            },
            "every mkdtemp call uses the same flanders- prefix"(_paths, { fs }) {
                const expected = "/tmp/flanders-";
                Assert.deepStrictEqual(fs.mkdtempPrefixes, [expected, expected, expected, expected]);
            },
            "all allocated paths are distinct"(_paths, { fs }) {
                Assert.strictEqual(new Set(fs.mkdtempDirs).size, fs.mkdtempDirs.length);
            },
            "the first allocated folder is paths.root"(paths, { fs }) {
                Assert.strictEqual(fs.mkdtempDirs[0], paths.root);
            }
        }
    });

    test("reviewerErrorLog(i) returns error.log inside the i-th reviewer's own folder", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            const paths = await ws.setup(3);
            return paths;
        },
        ASSERTS: {
            "reviewer 1 error.log lives inside the 2nd allocated folder"(paths, { fs }) {
                Assert.strictEqual(paths.reviewerErrorLog(1), fs.mkdtempDirs[1] + "/error.log");
            },
            "reviewer 2 error.log lives inside the 3rd allocated folder"(paths, { fs }) {
                Assert.strictEqual(paths.reviewerErrorLog(2), fs.mkdtempDirs[2] + "/error.log");
            },
            "reviewer 3 error.log lives inside the 4th allocated folder"(paths, { fs }) {
                Assert.strictEqual(paths.reviewerErrorLog(3), fs.mkdtempDirs[3] + "/error.log");
            },
            "reviewer 1 error.log basename is exactly error.log"(paths) {
                Assert.ok(paths.reviewerErrorLog(1).endsWith("/error.log"));
            },
            "reviewer 1 error.log is NOT a subpath of the main root"(paths) {
                Assert.ok(!paths.reviewerErrorLog(1).startsWith(paths.root + "/"));
            },
            "reviewer 2 error.log is NOT a subpath of the main root"(paths) {
                Assert.ok(!paths.reviewerErrorLog(2).startsWith(paths.root + "/"));
            },
            "reviewer 3 error.log is NOT a subpath of the main root"(paths) {
                Assert.ok(!paths.reviewerErrorLog(3).startsWith(paths.root + "/"));
            },
            "different reviewer indices produce distinct paths"(paths) {
                const set = new Set([
                    paths.reviewerErrorLog(1),
                    paths.reviewerErrorLog(2),
                    paths.reviewerErrorLog(3)
                ]);
                Assert.strictEqual(set.size, 3);
            },
            "reviewer 1 error.log differs from the briefing errorLog"(paths) {
                Assert.notStrictEqual(paths.reviewerErrorLog(1), paths.errorLog);
            },
            "no two reviewer folders are nested within each other"(paths) {
                const stripTail = (p:string) => p.slice(0, -"/error.log".length);
                const dir1 = stripTail(paths.reviewerErrorLog(1));
                const dir2 = stripTail(paths.reviewerErrorLog(2));
                const dir3 = stripTail(paths.reviewerErrorLog(3));
                Assert.ok(!dir1.startsWith(dir2 + "/") && !dir2.startsWith(dir1 + "/"));
                Assert.ok(!dir1.startsWith(dir3 + "/") && !dir3.startsWith(dir1 + "/"));
                Assert.ok(!dir2.startsWith(dir3 + "/") && !dir3.startsWith(dir2 + "/"));
            }
        }
    });

    test("the main root no longer holds any per-reviewer verdict file", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            return await ws.setup(2);
        },
        ASSERTS: {
            "reviewer 1 path does not start with the main root"(paths) {
                Assert.ok(!paths.reviewerErrorLog(1).startsWith(paths.root + "/"));
            },
            "reviewer 2 path does not start with the main root"(paths) {
                Assert.ok(!paths.reviewerErrorLog(2).startsWith(paths.root + "/"));
            },
            "reviewer 1 filename is exactly error.log (no per-index variant)"(paths) {
                const parts = paths.reviewerErrorLog(1).split("/");
                Assert.strictEqual(parts[parts.length - 1], "error.log");
            },
            "reviewer 2 filename is exactly error.log (no per-index variant)"(paths) {
                const parts = paths.reviewerErrorLog(2).split("/");
                Assert.strictEqual(parts[parts.length - 1], "error.log");
            }
        }
    });

    test("scripts, errorLog and per-iteration logs still resolve inside the main root", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            return await ws.setup(2);
        },
        ASSERTS: {
            "buildScript is inside main root"(paths) {
                Assert.strictEqual(paths.buildScript, paths.root + "/build.sh");
            },
            "testScript is inside main root"(paths) {
                Assert.strictEqual(paths.testScript, paths.root + "/test.sh");
            },
            "errorLog is inside main root"(paths) {
                Assert.strictEqual(paths.errorLog, paths.root + "/error.log");
            },
            "prepLog is inside main root"(paths) {
                Assert.strictEqual(paths.prepLog(0), paths.root + "/prep.0.log");
            },
            "workerLog is inside main root"(paths) {
                Assert.strictEqual(paths.workerLog(1), paths.root + "/worker.1.log");
            },
            "buildLog is inside main root"(paths) {
                Assert.strictEqual(paths.buildLog(1), paths.root + "/build.1.log");
            },
            "testLog is inside main root"(paths) {
                Assert.strictEqual(paths.testLog(1), paths.root + "/test.1.log");
            },
            "reviewerLog is inside main root"(paths) {
                Assert.strictEqual(paths.reviewerLog(1), paths.root + "/reviewer.1.log");
            },
            "reviewerOutputLog is inside main root"(paths) {
                Assert.strictEqual(paths.reviewerOutputLog(1, 1), paths.root + "/reviewer.1.1.log");
            }
        }
    });

    test("reviewerOutputLog returns reviewer.<iter>.<index>.log inside the main root", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(4);
        },
        ASSERTS: {
            "iter 1 reviewer 1 path"(paths) {
                Assert.strictEqual(paths.reviewerOutputLog(1, 1), paths.root + "/reviewer.1.1.log");
            },
            "iter 1 reviewer 2 path"(paths) {
                Assert.strictEqual(paths.reviewerOutputLog(1, 2), paths.root + "/reviewer.1.2.log");
            },
            "iter 3 reviewer 1 path"(paths) {
                Assert.strictEqual(paths.reviewerOutputLog(3, 1), paths.root + "/reviewer.3.1.log");
            },
            "iter 5 reviewer 4 path"(paths) {
                Assert.strictEqual(paths.reviewerOutputLog(5, 4), paths.root + "/reviewer.5.4.log");
            },
            "different (iter,index) combinations produce different paths"(paths) {
                const all = new Set([
                    paths.reviewerOutputLog(1, 1),
                    paths.reviewerOutputLog(1, 2),
                    paths.reviewerOutputLog(2, 1),
                    paths.reviewerOutputLog(2, 2)
                ]);
                Assert.strictEqual(all.size, 4);
            }
        }
    });

    test("paths() exposes both per-reviewer error.log and reviewer output log methods", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            await ws.setup(3);
            return ws.paths();
        },
        ASSERTS: {
            "reviewerErrorLog path matches the third reviewer's folder"(paths, { fs }) {
                Assert.strictEqual(paths.reviewerErrorLog(3), fs.mkdtempDirs[3] + "/error.log");
            },
            "reviewerOutputLog path"(paths) {
                Assert.strictEqual(paths.reviewerOutputLog(4, 2), paths.root + "/reviewer.4.2.log");
            }
        }
    });

    test("per-reviewer paths are stable across multiple paths() / setup result calls", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            const paths = await ws.setup(3);
            return {
                errA: paths.reviewerErrorLog(2),
                errB: paths.reviewerErrorLog(2),
                outA: paths.reviewerOutputLog(3, 2),
                outB: paths.reviewerOutputLog(3, 2)
            };
        },
        ASSERTS: {
            "reviewerErrorLog stable"({ errA, errB }) {
                Assert.strictEqual(errA, errB);
            },
            "reviewerOutputLog stable"({ outA, outB }) {
                Assert.strictEqual(outA, outB);
            }
        }
    });
});

test.describe("Workspace spec.md paths", test => {
    test("specFile resolves to spec.md inside the main root", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup(3);
        },
        ASSERTS: {
            "specFile equals the main root joined with spec.md"(paths) {
                Assert.strictEqual(paths.specFile, paths.root + "/spec.md");
            },
            "specFile is a subpath of the main root"(paths) {
                Assert.ok(paths.specFile.startsWith(paths.root + "/"));
            }
        }
    });

    test("reviewerSpecFile(i) returns spec.md inside the i-th reviewer's own folder beside its error.log", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            return await ws.setup(3);
        },
        ASSERTS: {
            "reviewer 1 spec.md lives inside the 2nd allocated folder"(paths, { fs }) {
                Assert.strictEqual(paths.reviewerSpecFile(1), fs.mkdtempDirs[1] + "/spec.md");
            },
            "reviewer 2 spec.md lives inside the 3rd allocated folder"(paths, { fs }) {
                Assert.strictEqual(paths.reviewerSpecFile(2), fs.mkdtempDirs[2] + "/spec.md");
            },
            "reviewer 3 spec.md lives inside the 4th allocated folder"(paths, { fs }) {
                Assert.strictEqual(paths.reviewerSpecFile(3), fs.mkdtempDirs[3] + "/spec.md");
            },
            "reviewer 1 spec.md sits in the same folder as reviewer 1's error.log"(paths) {
                const specDir = paths.reviewerSpecFile(1).slice(0, -"/spec.md".length);
                const errDir = paths.reviewerErrorLog(1).slice(0, -"/error.log".length);
                Assert.strictEqual(specDir, errDir);
            },
            "reviewer 2 spec.md sits in the same folder as reviewer 2's error.log"(paths) {
                const specDir = paths.reviewerSpecFile(2).slice(0, -"/spec.md".length);
                const errDir = paths.reviewerErrorLog(2).slice(0, -"/error.log".length);
                Assert.strictEqual(specDir, errDir);
            },
            "reviewer 3 spec.md sits in the same folder as reviewer 3's error.log"(paths) {
                const specDir = paths.reviewerSpecFile(3).slice(0, -"/spec.md".length);
                const errDir = paths.reviewerErrorLog(3).slice(0, -"/error.log".length);
                Assert.strictEqual(specDir, errDir);
            },
            "reviewer 1 spec.md is NOT a subpath of the main root"(paths) {
                Assert.ok(!paths.reviewerSpecFile(1).startsWith(paths.root + "/"));
            },
            "reviewer 2 spec.md is NOT a subpath of the main root"(paths) {
                Assert.ok(!paths.reviewerSpecFile(2).startsWith(paths.root + "/"));
            },
            "reviewer 3 spec.md is NOT a subpath of the main root"(paths) {
                Assert.ok(!paths.reviewerSpecFile(3).startsWith(paths.root + "/"));
            },
            "different reviewer indices produce distinct spec.md paths"(paths) {
                const set = new Set([
                    paths.reviewerSpecFile(1),
                    paths.reviewerSpecFile(2),
                    paths.reviewerSpecFile(3)
                ]);
                Assert.strictEqual(set.size, 3);
            },
            "no two reviewers share a spec.md folder"(paths) {
                const stripTail = (p:string) => p.slice(0, -"/spec.md".length);
                const dir1 = stripTail(paths.reviewerSpecFile(1));
                const dir2 = stripTail(paths.reviewerSpecFile(2));
                const dir3 = stripTail(paths.reviewerSpecFile(3));
                Assert.strictEqual(new Set([dir1, dir2, dir3]).size, 3);
            }
        }
    });

    test("paths() also exposes specFile and reviewerSpecFile after a multi-reviewer setup", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            await ws.setup(3);
            return ws.paths();
        },
        ASSERTS: {
            "specFile from paths() equals the main root joined with spec.md"(paths) {
                Assert.strictEqual(paths.specFile, paths.root + "/spec.md");
            },
            "reviewerSpecFile from paths() matches the third reviewer's own folder"(paths, { fs }) {
                Assert.strictEqual(paths.reviewerSpecFile(3), fs.mkdtempDirs[3] + "/spec.md");
            }
        }
    });
});

test.describe("Workspace.reviewerErrorLogExists", test => {
    test("returns true when the per-reviewer error.log exists", {
        ARRANGE() {
            const fs = stubFs();
            const existsCalls:string[] = [];
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws, existsCalls };
        },
        async ACT({ fs, ws, existsCalls }) {
            await ws.setup(3);
            const target = ws.paths().reviewerErrorLog(2);
            fs.exists = (p:string) => {
                existsCalls.push(p);
                return Promise.resolve(p === target);
            };
            return await ws.reviewerErrorLogExists(2);
        },
        ASSERTS: {
            "resolves true"(result) {
                Assert.strictEqual(result, true);
            },
            "exists called once"(_result, { existsCalls }) {
                Assert.strictEqual(existsCalls.length, 1);
            },
            "exists called on reviewer 2's error.log inside its own folder"(_result, { existsCalls, ws }) {
                Assert.strictEqual(existsCalls[0], ws.paths().reviewerErrorLog(2));
            }
        }
    });

    test("returns false when the per-reviewer error.log does not exist", {
        ARRANGE() {
            const fs = stubFs();
            const existsCalls:string[] = [];
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws, existsCalls };
        },
        async ACT({ fs, ws, existsCalls }) {
            await ws.setup(3);
            fs.exists = (p:string) => {
                existsCalls.push(p);
                return Promise.resolve(false);
            };
            return await ws.reviewerErrorLogExists(3);
        },
        ASSERTS: {
            "resolves false"(result) {
                Assert.strictEqual(result, false);
            },
            "exists called once"(_result, { existsCalls }) {
                Assert.strictEqual(existsCalls.length, 1);
            },
            "exists called on reviewer 3's error.log inside its own folder"(_result, { existsCalls, ws }) {
                Assert.strictEqual(existsCalls[0], ws.paths().reviewerErrorLog(3));
            }
        }
    });

    test("throws when workspace is not set up", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            try {
                await ws.reviewerErrorLogExists(1);
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.strictEqual(message, "Workspace not set up");
        }
    });
});

test.describe("Workspace.readReviewerErrorLog", test => {
    test("returns empty string when the per-reviewer error.log does not exist", {
        ARRANGE() {
            const fs = stubFs();
            const readFileCalls:string[] = [];
            const origReadFile = fs.readFile;
            fs.readFile = (p:string) => { readFileCalls.push(p); return origReadFile(p); };
            const ws = new Workspace(fs, stubPlatform(false));
            return { ws, readFileCalls };
        },
        async ACT({ ws }) {
            await ws.setup(1);
            return await ws.readReviewerErrorLog(1);
        },
        ASSERTS: {
            "resolves to the empty string"(result) {
                Assert.strictEqual(result, "");
            },
            "does not call readFile"(_result, { readFileCalls }) {
                Assert.strictEqual(readFileCalls.length, 0);
            }
        }
    });

    test("returns exact file contents when the per-reviewer error.log exists with content", {
        ARRANGE() {
            const fs = stubFs();
            const content = "violation X\nviolation Y\n";
            const readFileCalls:string[] = [];
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws, content, readFileCalls };
        },
        async ACT({ fs, ws, content, readFileCalls }) {
            await ws.setup(3);
            const target = ws.paths().reviewerErrorLog(2);
            fs.exists = (p:string) => Promise.resolve(p === target);
            fs.readFile = (p:string) => { readFileCalls.push(p); return Promise.resolve(content); };
            return await ws.readReviewerErrorLog(2);
        },
        ASSERTS: {
            "resolves to the exact file content including trailing whitespace"(result, { content }) {
                Assert.strictEqual(result, content);
            },
            "calls readFile exactly once"(_result, { readFileCalls }) {
                Assert.strictEqual(readFileCalls.length, 1);
            },
            "readFile called on reviewer 2's error.log inside its own folder"(_result, { readFileCalls, ws }) {
                Assert.strictEqual(readFileCalls[0], ws.paths().reviewerErrorLog(2));
            }
        }
    });

    test("returns empty string when the per-reviewer error.log exists but is empty", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ fs, ws }) {
            await ws.setup(1);
            const target = ws.paths().reviewerErrorLog(1);
            fs.exists = (p:string) => Promise.resolve(p === target);
            fs.readFile = () => Promise.resolve("");
            return await ws.readReviewerErrorLog(1);
        },
        ASSERT(result) {
            Assert.strictEqual(result, "");
        }
    });

    test("propagates readFile rejection", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ fs, ws }) {
            await ws.setup(1);
            const target = ws.paths().reviewerErrorLog(1);
            fs.exists = (p:string) => Promise.resolve(p === target);
            fs.readFile = () => Promise.reject(new Error("disk read failed"));
            try {
                await ws.readReviewerErrorLog(1);
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(result) {
            Assert.strictEqual(result, "disk read failed");
        }
    });

    test("rejects with Workspace not set up when called before setup", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            try {
                await ws.readReviewerErrorLog(1);
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.strictEqual(message, "Workspace not set up");
        }
    });
});

test.describe("Workspace.clearReviewerErrorLog", test => {
    test("calls rm with force on the per-reviewer error.log when present, leaving the folder", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ fs, ws }) {
            await ws.setup(3);
            const target = ws.paths().reviewerErrorLog(3);
            fs.exists = (p:string) => Promise.resolve(p === target);
            await ws.clearReviewerErrorLog(3);
            return { target, reviewerFolder: target.slice(0, -"/error.log".length) };
        },
        ASSERTS: {
            "rm called exactly once"(_result, { fs }) {
                Assert.strictEqual(fs.rmCalls.length, 1);
            },
            "rm called on reviewer 3's error.log (the file, not the folder)"({ target }, { fs }) {
                Assert.strictEqual(fs.rmCalls[0]!.path, target);
            },
            "rm options pin force only (not recursive — file, not folder)"(_result, { fs }) {
                Assert.deepStrictEqual(fs.rmCalls[0]!.options, { force: true });
            },
            "rm is not called on the reviewer's folder itself"({ reviewerFolder }, { fs }) {
                Assert.ok(!fs.rmCalls.some(c => c.path === reviewerFolder));
            }
        }
    });

    test("does not call rm when the per-reviewer error.log does not exist", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            await ws.setup(1);
            await ws.clearReviewerErrorLog(1);
        },
        ASSERT(_result, { fs }) {
            Assert.strictEqual(fs.rmCalls.length, 0);
        }
    });

    test("throws when workspace is not set up", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            try {
                await ws.clearReviewerErrorLog(1);
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.strictEqual(message, "Workspace not set up");
        }
    });
});

test.describe("Workspace.readErrorLog", test => {
    test("returns empty string when error.log does not exist", {
        ARRANGE() {
            const fs = stubFs();
            const readFileCalls:string[] = [];
            const origReadFile = fs.readFile;
            fs.readFile = (p:string) => { readFileCalls.push(p); return origReadFile(p); };
            const ws = new Workspace(fs, stubPlatform(false));
            return { ws, readFileCalls };
        },
        async ACT({ ws }) {
            await ws.setup(0);
            return await ws.readErrorLog();
        },
        ASSERTS: {
            "resolves to the empty string"(result) {
                Assert.strictEqual(result, "");
            },
            "does not call readFile"(_result, { readFileCalls }) {
                Assert.strictEqual(readFileCalls.length, 0);
            }
        }
    });

    test("returns exact file contents when error.log exists with content", {
        ARRANGE() {
            const fs = stubFs();
            const content = "violation A\nviolation B\n";
            const readFileCalls:string[] = [];
            fs.exists = (p:string) => Promise.resolve(p.endsWith("/error.log"));
            fs.readFile = (p:string) => { readFileCalls.push(p); return Promise.resolve(content); };
            const ws = new Workspace(fs, stubPlatform(false));
            return { ws, content, readFileCalls };
        },
        async ACT({ ws }) {
            await ws.setup(0);
            return await ws.readErrorLog();
        },
        ASSERTS: {
            "resolves to the exact file content including trailing whitespace"(result, { content }) {
                Assert.strictEqual(result, content);
            },
            "calls readFile exactly once on the error.log path"(_result, { readFileCalls, ws }) {
                Assert.strictEqual(readFileCalls.length, 1);
                Assert.strictEqual(readFileCalls[0], ws.paths().errorLog);
            }
        }
    });

    test("rejects with Workspace not set up when called before setup", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            try {
                await ws.readErrorLog();
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.strictEqual(message, "Workspace not set up");
        }
    });

    test("propagates readFile rejection", {
        ARRANGE() {
            const fs = stubFs();
            fs.exists = (p:string) => Promise.resolve(p.endsWith("/error.log"));
            fs.readFile = () => Promise.reject(new Error("disk read failed"));
            const ws = new Workspace(fs, stubPlatform(false));
            return { ws };
        },
        async ACT({ ws }) {
            await ws.setup(0);
            try {
                await ws.readErrorLog();
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(result) {
            Assert.strictEqual(result, "disk read failed");
        }
    });

    test("returns empty string when error.log exists with empty content", {
        ARRANGE() {
            const fs = stubFs();
            fs.exists = (p:string) => Promise.resolve(p.endsWith("/error.log"));
            fs.readFile = () => Promise.resolve("");
            const ws = new Workspace(fs, stubPlatform(false));
            return { ws };
        },
        async ACT({ ws }) {
            await ws.setup(0);
            return await ws.readErrorLog();
        },
        ASSERT(result) {
            Assert.strictEqual(result, "");
        }
    });
});

test.describe("Workspace.dispose rm failure", test => {
    test("rm throwing during dispose does not propagate the error (main folder only)", {
        ARRANGE() {
            const fs = stubFs();
            fs.rm = () => Promise.reject(new Error("disk failure"));
            const ws = new Workspace(fs, stubPlatform(false));
            return ws;
        },
        async ACT(ws) {
            await ws.setup(0);
            await ws.dispose();
            return "no error";
        },
        ASSERT(result) {
            Assert.strictEqual(result, "no error");
        }
    });

    test("rm throwing during dispose does not propagate the error (with per-reviewer folders)", {
        ARRANGE() {
            const fs = stubFs();
            fs.rm = () => Promise.reject(new Error("disk failure"));
            const ws = new Workspace(fs, stubPlatform(false));
            return ws;
        },
        async ACT(ws) {
            await ws.setup(2);
            await ws.dispose();
            return "no error";
        },
        ASSERT(result) {
            Assert.strictEqual(result, "no error");
        }
    });
});
