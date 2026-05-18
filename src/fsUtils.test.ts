import * as Assert from "assert";

import test from "arrange-act-assert";

import { fileSize } from "./fsUtils";
import type { FsContext } from "./contexts";

function stubFs():FsContext {
    return {
        readFile() { return Promise.reject(new Error("unexpected readFile")); },
        writeFile() { return Promise.resolve(); },
        readdir() { return Promise.resolve([]); },
        stat() { return Promise.resolve({ size: 42, isFile: true, isDirectory: false }); },
        exists() { return Promise.resolve(false); },
        mkdir() { return Promise.resolve(); },
        mkdtemp(prefix:string) { return Promise.resolve(prefix + "abc"); },
        rm() { return Promise.resolve(); }
    };
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
