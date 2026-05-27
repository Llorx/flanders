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

test.describe("prompts – worker – acceptance-criteria classification taxonomy", test => {
    test("the classification taxonomy is used in the worker but not exported", {
        ARRANGE() {},
        ACT() { return prompts; },
        ASSERTS: {
            "worker contains the taxonomy's distinctive text"(p) {
                Assert.ok(p.worker.includes("Classify every acceptance criterion by ONE question"));
            },
            "acceptanceCriteriaClassification is not a member of the prompts export"(p) {
                Assert.strictEqual((p as Record<string, unknown>).acceptanceCriteriaClassification, undefined);
            }
        }
    });

    test("contains all six taxonomy elements", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "regression-signal question"(template) {
                Assert.ok(template.includes("would a plausible regression of the criterion trigger an automated failure signal"));
            },
            "toolchain-guarded yes branch"(template) {
                Assert.ok(template.includes("the toolchain already guards the criterion"));
            },
            "no-implicit-guard no branch"(template) {
                Assert.ok(template.includes("the criterion has no implicit guard"));
            },
            "four always-guard shapes"(template) {
                Assert.ok(template.includes("Four shapes that always fall in the no-implicit-guard branch"));
            },
            "N-facts-need-N-guards rule"(template) {
                Assert.ok(template.includes("needs N independent guards"));
            },
            "regression-argument soundness step"(template) {
                Assert.ok(template.includes("When a regression argument cannot be soundly constructed"));
            }
        }
    });

    test("preserves the Evidence Report instruction", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.ok(template.includes("write an Evidence Report as the final part of your output"));
        }
    });

    test("old category bullets are removed", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "no 'For behavioral or observable criteria'"(template) {
                Assert.strictEqual(template.includes("For behavioral or observable criteria"), false);
            },
            "no 'For negative-scope criteria'"(template) {
                Assert.strictEqual(template.includes("For negative-scope criteria"), false);
            },
            "no 'For criteria that prescribe a literal value, options object, or specific shape'"(template) {
                Assert.strictEqual(template.includes("For criteria that prescribe a literal value, options object, or specific shape"), false);
            }
        }
    });

    test("contains no spec-path citations", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "no criterion-evidence-classification"(template) {
                Assert.strictEqual(template.includes("criterion-evidence-classification"), false);
            },
            "no enumerated-criterion-coverage"(template) {
                Assert.strictEqual(template.includes("enumerated-criterion-coverage"), false);
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

test.describe("prompts – reviewer – acceptance-criteria classification taxonomy", test => {
    test("contains all six taxonomy elements", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "regression-signal question"(template) {
                Assert.ok(template.includes("would a plausible regression of the criterion trigger an automated failure signal"));
            },
            "toolchain-guarded yes branch"(template) {
                Assert.ok(template.includes("the toolchain already guards the criterion"));
            },
            "no-implicit-guard no branch"(template) {
                Assert.ok(template.includes("the criterion has no implicit guard"));
            },
            "four always-guard shapes"(template) {
                Assert.ok(template.includes("Four shapes that always fall in the no-implicit-guard branch"));
            },
            "N-facts-need-N-guards rule"(template) {
                Assert.ok(template.includes("needs N independent guards"));
            },
            "regression-argument soundness step"(template) {
                Assert.ok(template.includes("When a regression argument cannot be soundly constructed"));
            }
        }
    });

    test("shares the taxonomy constant with the worker prompt", {
        ARRANGE() {},
        ACT() { return prompts; },
        ASSERTS: {
            "distinctive taxonomy text in worker"(p) {
                Assert.ok(p.worker.includes("would a plausible regression of the criterion trigger an automated failure signal"));
            },
            "distinctive taxonomy text in reviewer"(p) {
                Assert.ok(p.reviewer.includes("would a plausible regression of the criterion trigger an automated failure signal"));
            }
        }
    });

    test("old reviewer category list is removed", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "no 'Observable behavior (e.g.,'"(template) {
                Assert.strictEqual(template.includes("Observable behavior (e.g.,"), false);
            },
            "no 'Structural / API surface'"(template) {
                Assert.strictEqual(template.includes("Structural / API surface"), false);
            },
            "no 'Negative scope (e.g.,'"(template) {
                Assert.strictEqual(template.includes("Negative scope (e.g.,"), false);
            }
        }
    });

    test("preserves the reviewer's terminal format", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "forbids appending content after the verdict"(template) {
                Assert.ok(template.includes("Do not append an Evidence Report or any other multi-line content after the final PASS/FAIL line"));
            },
            "contains the verdict instruction"(template) {
                Assert.ok(template.includes("Reply with exactly one of the two following formats on that final line"));
            }
        }
    });

    test("preserves and realigns the per-criterion checklist format", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains the AC<n> checklist marker"(template) {
                Assert.ok(template.includes("AC<n>"));
            },
            "no 'non-behavioral' label"(template) {
                Assert.strictEqual(template.includes("non-behavioral"), false);
            }
        }
    });

    test("contains no spec-path citations", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "no criterion-evidence-classification"(template) {
                Assert.strictEqual(template.includes("criterion-evidence-classification"), false);
            },
            "no enumerated-criterion-coverage"(template) {
                Assert.strictEqual(template.includes("enumerated-criterion-coverage"), false);
            }
        }
    });
});
