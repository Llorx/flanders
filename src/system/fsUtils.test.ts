import * as Assert from "assert";

import test from "arrange-act-assert";

import { fileSize, listFilesRecursive } from "./fsUtils";
import type { FsContext } from "../contexts";

function stubFs():FsContext {
    return {
        readFile() { return Promise.reject(new Error("unexpected readFile")); },
        writeFile() { return Promise.resolve(); },
        rename() { return Promise.resolve(); },
        readdir() { return Promise.resolve([]); },
        stat() { return Promise.resolve({ size: 42, isFile: true, isDirectory: false }); },
        exists() { return Promise.resolve(false); },
        mkdir() { return Promise.resolve(); },
        mkdtemp(prefix:string) { return Promise.resolve(prefix + "abc"); },
        rm() { return Promise.resolve(); }
    };
}

// A stub fs backed by a directory tree: a path exists iff it is a key, and readdir
// returns that key's entries (an absent path reads as an empty directory).
function fsWithTree(tree:Record<string, Array<{name:string; isFile:boolean; isDirectory:boolean}>>):FsContext {
    const fs = stubFs();
    fs.exists = (p:string) => Promise.resolve(p in tree);
    fs.readdir = (p:string) => Promise.resolve(tree[p] ?? []);
    return fs;
}

test.describe("fileSize", test => {
    test("returns the size from stat", {
        ARRANGE() {
            const fs = stubFs();
            fs.stat = () => Promise.resolve({ size: 1234, isFile: true, isDirectory: false });
            return fs;
        },
        async ACT(fs) {
            return await fileSize(fs, "/some/file.txt");
        },
        ASSERT(size) {
            Assert.strictEqual(size, 1234);
        }
    });

    test("returns 0 for empty file", {
        ARRANGE() {
            const fs = stubFs();
            fs.stat = () => Promise.resolve({ size: 0, isFile: true, isDirectory: false });
            return fs;
        },
        async ACT(fs) {
            return await fileSize(fs, "/empty.txt");
        },
        ASSERT(size) {
            Assert.strictEqual(size, 0);
        }
    });
});

test.describe("listFilesRecursive", test => {
    test("returns an empty list when the root does not exist", {
        ARRANGE() {
            return fsWithTree({});
        },
        async ACT(fs) {
            return await listFilesRecursive(fs, "/missing");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, []);
        }
    });

    test("lists files directly under the root, sorted ascending", {
        ARRANGE() {
            return fsWithTree({
                "/root": [
                    { name: "b.md", isFile: true, isDirectory: false },
                    { name: "a.md", isFile: true, isDirectory: false }
                ]
            });
        },
        async ACT(fs) {
            return await listFilesRecursive(fs, "/root");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["a.md", "b.md"]);
        }
    });

    test("descends into subdirectories and namespaces nested files by their relative path", {
        ARRANGE() {
            return fsWithTree({
                "/root": [
                    { name: "top.md", isFile: true, isDirectory: false },
                    { name: "sub", isFile: false, isDirectory: true }
                ],
                "/root/sub": [
                    { name: "deep.md", isFile: true, isDirectory: false }
                ]
            });
        },
        async ACT(fs) {
            return await listFilesRecursive(fs, "/root");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["sub/deep.md", "top.md"]);
        }
    });

    test("skips entries that are neither a file nor a directory", {
        ARRANGE() {
            return fsWithTree({
                "/root": [
                    { name: "keep.md", isFile: true, isDirectory: false },
                    { name: "socket", isFile: false, isDirectory: false }
                ]
            });
        },
        async ACT(fs) {
            return await listFilesRecursive(fs, "/root");
        },
        ASSERT(result) {
            Assert.deepStrictEqual(result, ["keep.md"]);
        }
    });
});
