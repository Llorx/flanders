import * as Assert from "assert";

import test from "arrange-act-assert";

import { prompts } from "./prompts";

test.describe("prompts – prep", test => {
    test("is a non-empty string", {
        ARRANGE() {},
        ACT() { return prompts.prep; },
        ASSERTS: {
            "is a string"(template) {
                Assert.strictEqual(typeof template, "string");
            },
            "is non-empty"(template) {
                Assert.ok(template.length > 0);
            }
        }
    });

    test("contains all required placeholders", {
        ARRANGE() {},
        ACT() { return prompts.prep; },
        ASSERTS: {
            "contains <PLAN_PATH>"(template) {
                Assert.ok(template.includes("<PLAN_PATH>"));
            },
            "contains <TASK_LINE>"(template) {
                Assert.ok(template.includes("<TASK_LINE>"));
            },
            "contains <TASK_TITLE>"(template) {
                Assert.ok(template.includes("<TASK_TITLE>"));
            },
            "contains <CONTRACT_LIST>"(template) {
                Assert.ok(template.includes("<CONTRACT_LIST>"));
            },
            "contains <RULE_LIST>"(template) {
                Assert.ok(template.includes("<RULE_LIST>"));
            }
        }
    });

    test("includes the read-only obligation", {
        ARRANGE() {},
        ACT() { return prompts.prep; },
        ASSERT(template) {
            Assert.ok(template.includes("You must not implement, modify, or write anything in the project."));
        }
    });

    test("includes the spec-folder write boundary", {
        ARRANGE() {},
        ACT() { return prompts.prep; },
        ASSERTS: {
            "references contracts/"(template) {
                Assert.ok(template.includes("contracts/"));
            },
            "references rules/"(template) {
                Assert.ok(template.includes("rules/"));
            },
            "references plans/"(template) {
                Assert.ok(template.includes("plans/"));
            },
            "references shared/spec-folder-write-authority.md"(template) {
                Assert.ok(template.includes("shared/spec-folder-write-authority.md"));
            }
        }
    });

    test("includes the git-write boundary", {
        ARRANGE() {},
        ACT() { return prompts.prep; },
        ASSERT(template) {
            Assert.ok(template.includes("rules/ai/agents/no-git-writes.md"));
        }
    });

    test("ends with the forkable-state acknowledgement token", {
        ARRANGE() {},
        ACT() { return prompts.prep; },
        ASSERT(template) {
            Assert.strictEqual(template.trimEnd().split("\n").pop(), "READY");
        }
    });

    test("contains zero project-specific tooling references", {
        ARRANGE() {},
        ACT() { return prompts.prep; },
        ASSERTS: {
            "no npm"(template) {
                Assert.strictEqual(template.includes("npm"), false);
            },
            "no aaa"(template) {
                Assert.strictEqual(template.includes("aaa"), false);
            },
            "no jest"(template) {
                Assert.strictEqual(template.includes("jest"), false);
            },
            "no cargo"(template) {
                Assert.strictEqual(template.includes("cargo"), false);
            },
            "no tsc"(template) {
                Assert.strictEqual(template.includes("tsc"), false);
            },
            "no node"(template) {
                Assert.strictEqual(template.includes("node"), false);
            },
            "no vitest"(template) {
                Assert.strictEqual(template.includes("vitest"), false);
            },
            "no mocha"(template) {
                Assert.strictEqual(template.includes("mocha"), false);
            }
        }
    });
});

test.describe("prompts – detectBuildAndTest", test => {
    test("includes the spec-folder write boundary", {
        ARRANGE() {},
        ACT() { return prompts.detectBuildAndTest; },
        ASSERTS: {
            "references contracts/"(template) {
                Assert.ok(template.includes("contracts/"));
            },
            "references rules/"(template) {
                Assert.ok(template.includes("rules/"));
            },
            "references plans/"(template) {
                Assert.ok(template.includes("plans/"));
            },
            "references shared/spec-folder-write-authority.md"(template) {
                Assert.ok(template.includes("shared/spec-folder-write-authority.md"));
            }
        }
    });
});

test.describe("prompts – worker", test => {
    test("includes the spec-folder write boundary", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "references contracts/"(template) {
                Assert.ok(template.includes("contracts/"));
            },
            "references rules/"(template) {
                Assert.ok(template.includes("rules/"));
            },
            "references plans/"(template) {
                Assert.ok(template.includes("plans/"));
            },
            "references shared/spec-folder-write-authority.md"(template) {
                Assert.ok(template.includes("shared/spec-folder-write-authority.md"));
            }
        }
    });
});

test.describe("prompts – worker – prep-fork context relaxation", test => {
    test("says the linked content is already in context and re-reading is not required", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "contains the relaxation sentence"(template) {
                Assert.ok(template.includes("You are not required to re-read the linked contracts and rules"));
            },
            "contains the prep fork explanation"(template) {
                Assert.ok(template.includes("on iteration 1 their content is already in context through the prep fork"));
            },
            "contains the session continuity explanation"(template) {
                Assert.ok(template.includes("on later iterations it is preserved by your own session continuity"));
            }
        }
    });

    test("no longer mandates re-reading every linked contract and rule", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "old step-2 mandate is absent"(template) {
                Assert.strictEqual(
                    template.includes("Read every linked contract file and every linked rule file and respect their obligations exactly"),
                    false
                );
            },
            "old step-1 mandate for 'every linked contract file AND every linked rule file' is absent"(template) {
                Assert.strictEqual(
                    template.includes("and every linked contract file AND every linked rule file"),
                    false
                );
            }
        }
    });
});

test.describe("prompts – reviewer", test => {
    test("explicitly forbids appending an Evidence Report after the PASS/FAIL line", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("Do not append an Evidence Report or any other multi-line content after the final PASS/FAIL line"));
        }
    });

    test("includes the spec-folder write boundary", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "references contracts/"(template) {
                Assert.ok(template.includes("contracts/"));
            },
            "references rules/"(template) {
                Assert.ok(template.includes("rules/"));
            },
            "references plans/"(template) {
                Assert.ok(template.includes("plans/"));
            },
            "references shared/spec-folder-write-authority.md"(template) {
                Assert.ok(template.includes("shared/spec-folder-write-authority.md"));
            }
        }
    });
});
