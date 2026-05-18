import * as Assert from "assert";

import test from "arrange-act-assert";

import * as Public from "./index";

test("public exports include Flanders class and no dangling symbols", {
    ARRANGE() {
        return Object.keys(Public);
    },
    ACT(keys) {
        return keys;
    },
    ASSERTS: {
        "exports Flanders"(keys) {
            Assert.ok(keys.includes("Flanders"));
        },
        "has exactly one runtime export"(keys) {
            Assert.strictEqual(keys.length, 1);
        },
        "Flanders is a function"() {
            Assert.strictEqual(typeof Public.Flanders, "function");
        }
    }
});
