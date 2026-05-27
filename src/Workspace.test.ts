import * as Assert from "assert";

import test from "arrange-act-assert";

import { Workspace } from "./Workspace";
import type { PlatformContext } from "./Workspace";
import type { FsContext } from "./contexts";

type RmCall = { path:string; options:Readonly<{ recursive?:boolean; force?:boolean }> | undefined };

function stubFs():FsContext & { rmCalls:RmCall[] } {
    const dirs:string[] = [];
    const rmCalls:RmCall[] = [];
    return {
        readFile() { return Promise.reject(new Error("unexpected readFile")); },
        writeFile() { return Promise.resolve(); },
        rename() { return Promise.resolve(); },
        readdir() { return Promise.resolve([]); },
        stat() { return Promise.reject(new Error("unexpected stat")); },
        exists() { return Promise.resolve(false); },
        mkdir() { return Promise.resolve(); },
        mkdtemp(prefix:string) {
            const dir = prefix + "abc123";
            dirs.push(dir);
            return Promise.resolve(dir);
        },
        rm(path:string, options?:Readonly<{ recursive?:boolean; force?:boolean }>) { rmCalls.push({ path, options }); return Promise.resolve(); },
        rmCalls
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
            const paths = await ws.setup();
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
            return await ws.setup();
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
            return await ws.setup();
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
            return await ws.setup();
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

    test("errorLog remains a fixed path (not per-iteration)", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            return await ws.setup();
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
            const paths = await ws.setup();
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
            return await ws.setup();
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
            const paths = await ws.setup();
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
            return await ws.setup();
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
            return await ws.setup();
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
            await ws.setup();
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

test.describe("Workspace.preserveOnDispose", test => {
    test("dispose without preserveOnDispose removes the root folder", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            const paths = await ws.setup();
            await ws.dispose();
            return paths.root;
        },
        ASSERTS: {
            "rm called with the root path"(root, { fs }) {
                Assert.strictEqual(fs.rmCalls.length, 1);
                Assert.strictEqual(fs.rmCalls[0]!.path, root);
            },
            "rm called with recursive and force options"(_root, { fs }) {
                Assert.deepStrictEqual(fs.rmCalls[0]!.options, { recursive: true, force: true });
            }
        }
    });

    test("dispose after preserveOnDispose does not remove the root folder", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            await ws.setup();
            ws.preserveOnDispose();
            await ws.dispose();
        },
        ASSERTS: {
            "rm not called"(_result, { fs }) {
                Assert.deepStrictEqual(fs.rmCalls, []);
            },
            async "workspace is marked as disposed"(_result, { ws }) {
                await Assert.rejects(() => ws.setup(), /Workspace disposed/);
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
            await ws.setup();
            ws.preserveOnDispose();
            await ws.dispose();
            await ws.dispose();
        },
        ASSERT(_result, { fs }) {
            Assert.deepStrictEqual(fs.rmCalls, []);
        }
    });

    test("idempotent dispose without preserveOnDispose invokes rm only once", {
        ARRANGE() {
            const fs = stubFs();
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            const paths = await ws.setup();
            await ws.dispose();
            await ws.dispose();
            return paths.root;
        },
        ASSERTS: {
            "rm called exactly once"(root, { fs }) {
                Assert.strictEqual(fs.rmCalls.length, 1);
                Assert.strictEqual(fs.rmCalls[0]!.path, root);
            },
            "rm called with recursive and force options"(_root, { fs }) {
                Assert.deepStrictEqual(fs.rmCalls[0]!.options, { recursive: true, force: true });
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
            const paths = await ws.setup();
            await ws.dispose();
            ws.preserveOnDispose();
            return paths.root;
        },
        ASSERT(root, { fs }) {
            Assert.strictEqual(fs.rmCalls.length, 1);
            Assert.strictEqual(fs.rmCalls[0]!.path, root);
        }
    });
});

test.describe("Workspace.setup guards", test => {
    test("setup after dispose throws Workspace disposed", {
        ARRANGE() {
            return new Workspace(stubFs(), stubPlatform(false));
        },
        async ACT(ws) {
            await ws.setup();
            await ws.dispose();
            try {
                await ws.setup();
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
            await ws.setup();
            try {
                await ws.setup();
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
            return await ws.setup();
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
                if (p.endsWith("error.log")) {
                    return Promise.resolve(true);
                }
                return origExists(p);
            };
            const ws = new Workspace(fs, stubPlatform(false));
            return { fs, ws };
        },
        async ACT({ ws }) {
            await ws.setup();
            await ws.clearErrorLog();
        },
        ASSERTS: {
            "rm called once"(_result, { fs }) {
                Assert.strictEqual(fs.rmCalls.length, 1);
            },
            "rm called on error.log"(_result, { fs }) {
                Assert.ok(fs.rmCalls[0]!.path.endsWith("/error.log"));
            },
            "rm called with force option"(_result, { fs }) {
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
            await ws.setup();
            await ws.clearErrorLog();
        },
        ASSERT(_result, { fs }) {
            Assert.strictEqual(fs.rmCalls.length, 0);
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
            await ws.setup();
            await ws.writeErrorLog("something went wrong");
        },
        ASSERTS: {
            "writes exactly one file"(_, { written }) {
                Assert.strictEqual(Object.keys(written).length, 1);
            },
            "written path ends with error.log"(_, { written }) {
                const key = Object.keys(written)[0]!;
                Assert.ok(key.endsWith("/error.log"));
            },
            "written content matches input"(_, { written }) {
                const content = Object.values(written)[0]!;
                Assert.strictEqual(content, "something went wrong");
            }
        }
    });
});

test.describe("Workspace.dispose rm failure", test => {
    test("rm throwing during dispose does not propagate the error", {
        ARRANGE() {
            const fs = stubFs();
            fs.rm = () => Promise.reject(new Error("disk failure"));
            const ws = new Workspace(fs, stubPlatform(false));
            return ws;
        },
        async ACT(ws) {
            await ws.setup();
            await ws.dispose();
            return "no error";
        },
        ASSERT(result) {
            Assert.strictEqual(result, "no error");
        }
    });
});
