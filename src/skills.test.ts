import * as Assert from "assert";

import test from "arrange-act-assert";

import { contractSkillBody, planSkillBody, ruleSkillBody } from "./skills";

test.describe("skills – contractSkillBody", test => {
    test("is a non-empty string", {
        ARRANGE() {},
        ACT() { return contractSkillBody; },
        ASSERT(body) {
            Assert.strictEqual(typeof body, "string");
            Assert.ok(body.length > 0);
        }
    });

    test("covers clarification phase", {
        ARRANGE() {},
        ACT() { return contractSkillBody; },
        ASSERTS: {
            "mentions clarification phase"(body) {
                Assert.ok(body.includes("clarification"), "must mention clarification phase");
            },
            "enforces sequential questions"(body) {
                Assert.ok(body.includes("one question per turn"), "must enforce sequential questions");
            }
        }
    });

    test("covers drafting phase with approval", {
        ARRANGE() {},
        ACT() { return contractSkillBody; },
        ASSERTS: {
            "mentions drafting phase"(body) {
                Assert.ok(body.includes("drafting phase"), "must mention drafting phase");
            },
            "requires user approval"(body) {
                Assert.ok(body.includes("approval"), "must require user approval");
            },
            "persists every file in a single batch after layout approval"(body) {
                Assert.ok(body.includes("single batch without"), "must persist files in a single batch after layout approval");
            }
        }
    });

    test("covers self-review pass", {
        ARRANGE() {},
        ACT() { return contractSkillBody; },
        ASSERTS: {
            "mentions self-review pass"(body) {
                Assert.ok(body.includes("self-review"), "must mention self-review pass");
            },
            "self-review checks for placeholders"(body) {
                Assert.ok(body.includes("placeholders"), "self-review must check for placeholders");
            },
            "self-review checks for contradictions"(body) {
                Assert.ok(body.includes("contradictions"), "self-review must check for contradictions");
            }
        }
    });

    test("covers file layout and descriptive filenames", {
        ARRANGE() {},
        ACT() { return contractSkillBody; },
        ASSERTS: {
            "mentions file layout presentation"(body) {
                Assert.ok(body.includes("file layout"), "must mention file layout presentation");
            },
            "requires descriptive filenames"(body) {
                Assert.ok(body.includes("Filenames must be descriptive"), "must require descriptive filenames");
            }
        }
    });

    test("covers output language obligation", {
        ARRANGE() {},
        ACT() { return contractSkillBody; },
        ASSERTS: {
            "has output language section"(body) {
                Assert.ok(body.includes("Output language"), "must have output language section");
            },
            "matches input language"(body) {
                Assert.ok(body.includes("same natural language as the input"), "must match input language");
            }
        }
    });

    test("covers idempotency and overwrites", {
        ARRANGE() {},
        ACT() { return contractSkillBody; },
        ASSERTS: {
            "mentions idempotency"(body) {
                Assert.ok(body.includes("Idempotency"), "must mention idempotency");
            },
            "describes in-place updates"(body) {
                Assert.ok(body.includes("update related files in place"), "must describe in-place updates");
            }
        }
    });

    test("restricts writes to contracts/ only", {
        ARRANGE() {},
        ACT() { return contractSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes("must not write, modify, or delete any source code or any file outside contracts/"), "must restrict to contracts/");
        }
    });

    test("has no unresolved placeholders or TODOs", {
        ARRANGE() {},
        ACT() { return contractSkillBody; },
        ASSERTS: {
            "does not contain TODO"(body) {
                Assert.ok(!body.includes("TODO"), "must not contain TODO");
            },
            "does not contain {{ placeholders"(body) {
                Assert.ok(!body.includes("{{"), "must not contain {{ placeholders");
            },
            "does not contain }} placeholders"(body) {
                Assert.ok(!body.includes("}}"), "must not contain }} placeholders");
            }
        }
    });
});

test.describe("skills – planSkillBody", test => {
    test("is a non-empty string", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERT(body) {
            Assert.strictEqual(typeof body, "string");
            Assert.ok(body.length > 0);
        }
    });

    test("covers contracts/ listing as canonical reference", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "mentions canonical reference"(body) {
                Assert.ok(body.includes("canonical reference"), "must mention canonical reference");
            },
            "references contracts/ folder"(body) {
                Assert.ok(body.includes("contracts/ folder"), "must reference contracts/ folder");
            }
        }
    });

    test("covers single file in plans/", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "produces exactly one file"(body) {
                Assert.ok(body.includes("exactly one markdown"), "must produce exactly one file");
            },
            "targets plans/ folder"(body) {
                Assert.ok(body.includes("plans/"), "must target plans/ folder");
            }
        }
    });

    test("covers checkbox format from plan-file-format contract", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "defines open checkbox"(body) {
                Assert.ok(body.includes("[ ]"), "must define open checkbox");
            },
            "defines done checkbox"(body) {
                Assert.ok(body.includes("[x]"), "must define done checkbox");
            },
            "forbids malformed checkboxes"(body) {
                Assert.ok(body.includes("No malformed variants"), "must forbid malformed checkboxes");
            }
        }
    });

    test("covers hierarchy rules – leaf vs parent tasks", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "mentions leaf tasks"(body) {
                Assert.ok(body.includes("leaf task"), "must mention leaf tasks");
            },
            "mentions parent tasks"(body) {
                Assert.ok(body.includes("parent task"), "must mention parent tasks");
            },
            "parent must not have checkbox"(body) {
                Assert.ok(body.includes("does NOT carry its own checkbox"), "parent must not have checkbox");
            }
        }
    });

    test("covers hierarchical numbering", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "mentions hierarchical numbering"(body) {
                Assert.ok(body.includes("numbered hierarchically"), "must mention hierarchical numbering");
            },
            "shows dotted sub-task example"(body) {
                Assert.ok(body.includes("2.1, 2.2, 2.3"), "must show dotted sub-task example");
            }
        }
    });

    test("covers ordering by dependency", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "mentions implementation order"(body) {
                Assert.ok(body.includes("order they must be implemented"), "must mention implementation order");
            },
            "enforces dependency ordering"(body) {
                Assert.ok(body.includes("depends on another must appear after"), "must enforce dependency ordering");
            }
        }
    });

    test("covers acceptance criteria and contract references per task", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "requires acceptance criteria"(body) {
                Assert.ok(body.includes("acceptance criteria"), "must require acceptance criteria");
            },
            "requires contract references"(body) {
                Assert.ok(body.includes("link the relevant contract file"), "must require contract references");
            }
        }
    });

    test("covers post-write verification", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "re-reads and verifies"(body) {
                Assert.ok(body.includes("re-read it and verify"), "must re-read and verify");
            },
            "fixes and re-verifies on failure"(body) {
                Assert.ok(body.includes("fix the file and re-verify"), "must fix and re-verify on failure");
            }
        }
    });

    test("covers summary with path, size, lines, and task count", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "summary includes file path"(body) {
                Assert.ok(body.includes("plan file path"), "summary must include file path");
            },
            "summary includes character size"(body) {
                Assert.ok(body.includes("character size"), "summary must include character size");
            },
            "summary includes line count"(body) {
                Assert.ok(body.includes("line count"), "summary must include line count");
            },
            "summary includes task count"(body) {
                Assert.ok(body.includes("number of detected tasks"), "summary must include task count");
            }
        }
    });

    test("covers output language obligation", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "has output language section"(body) {
                Assert.ok(body.includes("Output language"), "must have output language section");
            },
            "matches input language"(body) {
                Assert.ok(body.includes("same natural language as the input"), "must match input language");
            }
        }
    });

    test("covers missing contracts or rules warning", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "has missing contracts or rules section"(body) {
                Assert.ok(body.includes("Missing contracts or rules"), "must have missing contracts or rules section");
            },
            "warns when contracts/ is missing or empty"(body) {
                Assert.ok(body.includes("contracts/ folder is missing or empty"), "must warn when contracts/ is missing or empty");
            },
            "warns when rules/ is missing or empty"(body) {
                Assert.ok(body.includes("rules/ folder is missing or empty"), "must warn when rules/ is missing or empty");
            }
        }
    });

    test("covers rules/ listing as canonical reference", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "references rules/ folder"(body) {
                Assert.ok(body.includes("rules/ folder"), "must reference rules/ folder in step 2");
            },
            "mentions canonical reference of rules"(body) {
                Assert.ok(body.includes("canonical reference of rules"), "must mention canonical reference of rules");
            }
        }
    });

    test("covers per-task rule references and mandatory reading", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "requires linking relevant rule files"(body) {
                Assert.ok(body.includes("link the relevant rule file"), "must require linking relevant rule files");
            },
            "enforces mandatory reading of relevant rules"(body) {
                Assert.ok(body.includes("MUST read every rule file"), "must enforce mandatory reading of relevant rules");
            }
        }
    });

    test("covers contract or rule compliance", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes("any contract or rule on the canonical lists"), "must enforce compliance with both contracts and rules");
        }
    });

    test("restricts writes to plans/ only", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes("must not write, modify, or delete any source code or any file outside plans/"), "must restrict to plans/");
        }
    });

    test("prohibits tasks from writing to spec folders", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "prohibits task content from touching contracts/"(body) {
                Assert.ok(body.includes("inside contracts/"), "must prohibit tasks from touching contracts/");
            },
            "prohibits task content from touching rules/"(body) {
                Assert.ok(body.includes("inside rules/"), "must prohibit tasks from touching rules/");
            },
            "prohibits task content from touching plans/"(body) {
                Assert.ok(body.includes("or inside plans/"), "must prohibit tasks from touching plans/");
            },
            "references shared/spec-folder-write-authority.md"(body) {
                Assert.ok(body.includes("shared/spec-folder-write-authority.md"), "must reference spec-folder-write-authority contract");
            }
        }
    });

    test("contains the literal zero-metrics object example", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes('{"it":0,"ot":0,"t":0}'), "must contain the literal zero-metrics JSON object");
        }
    });

    test("post-write verification mentions the metrics object requirement", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "has Post-write verification section"(body) {
                Assert.ok(body.indexOf("Post-write verification") !== -1, "must have Post-write verification section");
            },
            "verification requires the metrics object"(body) {
                const verificationSection = body.slice(body.indexOf("Post-write verification"));
                Assert.ok(verificationSection.includes('{"it":0,"ot":0,"t":0}'), "verification must require metrics object");
            },
            "verification mentions strict JSON"(body) {
                const verificationSection = body.slice(body.indexOf("Post-write verification"));
                Assert.ok(verificationSection.includes("strict JSON"), "verification must mention strict JSON parsing");
            },
            "verification mentions byte-exact check"(body) {
                const verificationSection = body.slice(body.indexOf("Post-write verification"));
                Assert.ok(verificationSection.includes("byte-exact"), "verification must mention byte-exact check");
            }
        }
    });

    test("task line shape includes spacing rules for metrics object", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "states no whitespace between ] and {"(body) {
                Assert.ok(body.includes("no whitespace between them, the metrics object"), "must state no whitespace between ] and {");
            },
            "states one space after }"(body) {
                Assert.ok(body.includes("A single space after the closing `}`"), "must state one space after }");
            }
        }
    });

    test("covers Final validation section with subagent host preference", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "has Final validation section"(body) {
                Assert.ok(body.includes("## Final validation"), "must have Final validation section");
            },
            "validator is the gate before declaring complete"(body) {
                Assert.ok(body.includes("only declare complete when it returns PASS"), "validator must be the completion gate");
            },
            "launches validator as fresh subagent via Agent tool"(body) {
                Assert.ok(body.includes("Launch the validator as a fresh subagent via the Agent tool"), "must launch validator as a subagent via Agent tool");
            },
            "fresh session is load-bearing"(body) {
                Assert.ok(body.includes("does not share context with this drafting session"), "validator session must not share context with the drafter");
            }
        }
    });

    test("Final validation pins inline fallback conditions and forbids ergonomic fallback", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "permits inline fallback when Agent tool is unavailable"(body) {
                Assert.ok(body.includes("Agent tool is unavailable in the current environment"), "must permit inline fallback when Agent tool is unavailable");
            },
            "permits inline fallback on unrecoverable Agent error"(body) {
                Assert.ok(body.includes("unrecoverable error (spawn failure, transport error, environment refusal)"), "must permit inline fallback on unrecoverable Agent error");
            },
            "forbids ergonomic inline fallback"(body) {
                Assert.ok(body.includes("Inline fallback for ergonomic reasons"), "must forbid inline fallback for ergonomic reasons");
                Assert.ok(body.includes("is forbidden"), "must state the ergonomic inline fallback is forbidden");
            },
            "requires stating the fallback reason in chat"(body) {
                Assert.ok(body.includes("state in chat that you are falling back and name the concrete reason"), "must require stating the fallback reason in chat");
            }
        }
    });

    test("Final validation enumerates the three mandatory validator checks", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "lists Format and shape check"(body) {
                Assert.ok(body.includes("1. Format and shape"), "must list Format and shape check");
            },
            "lists Semantic dependency order check"(body) {
                Assert.ok(body.includes("2. Semantic dependency order"), "must list Semantic dependency order check");
            },
            "lists Spec-folder write boundary and contract non-contradiction check"(body) {
                Assert.ok(body.includes("3. Spec-folder write boundary and contract non-contradiction"), "must list Spec-folder write boundary and contract non-contradiction check");
            },
            "states no exception for checkbox flips or metrics rewrites"(body) {
                Assert.ok(body.includes("no exception for flipping checkboxes or rewriting metrics"), "must state no exception for checkbox flips or metrics rewrites");
            },
            "puts reference-resolution explicitly out of scope"(body) {
                Assert.ok(body.includes("Out of scope: verifying that contract and rule paths referenced by tasks resolve to files that physically exist on disk"), "must put reference-resolution out of scope");
            }
        }
    });

    test("Final validation pins validator inputs", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "passes absolute plan file path"(body) {
                Assert.ok(body.includes("The absolute path to the plan file you just wrote"), "must pass absolute plan file path to the validator");
            },
            "passes canonical contract listing from step 2"(body) {
                Assert.ok(body.includes("The canonical contract listing captured in step 2 of the procedure"), "must pass canonical contract listing");
            },
            "passes canonical rule listing from step 2"(body) {
                Assert.ok(body.includes("The canonical rule listing captured in step 2 of the procedure"), "must pass canonical rule listing");
            }
        }
    });

    test("Final validation pins validator output shape (single verdict line, no Evidence Report)", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "verdict line ends the response with no trailing content"(body) {
                Assert.ok(body.includes("final response ends with a single verdict line"), "validator output must end with a single verdict line");
                Assert.ok(body.includes("no other multi-line content after it"), "no multi-line content may follow the verdict line");
            },
            "explicitly forbids appending an Evidence Report"(body) {
                Assert.ok(body.includes("no Evidence Report"), "must explicitly forbid an Evidence Report after the verdict");
            },
            "names the PASS verdict shape"(body) {
                Assert.ok(body.includes("`PASS`"), "must name the PASS verdict shape");
            },
            "names the FAIL verdict shape with enumerated issues"(body) {
                Assert.ok(body.includes("`FAIL <enumerated issues>`"), "must name the FAIL verdict shape with enumerated issues");
            }
        }
    });

    test("Final validation pins the bounded auto-fix loop and on-terminal-FAIL surface", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "rewrites plan in place addressing every enumerated issue"(body) {
                Assert.ok(body.includes("rewrite the plan file in place, addressing every enumerated issue"), "auto-fix must rewrite the plan in place addressing every issue");
            },
            "re-launches the validator in a fresh subagent session"(body) {
                Assert.ok(body.includes("Re-launch the validator (a new subagent in a fresh session when the subagent host is available)"), "auto-fix must re-launch a fresh subagent session");
            },
            "caps the loop at FIVE auto-fix passes"(body) {
                Assert.ok(body.includes("at most FIVE auto-fix passes per /flanders-plan invocation"), "must cap the auto-fix loop at FIVE passes per invocation");
            },
            "does not declare complete on terminal FAIL"(body) {
                Assert.ok(body.includes("do not declare complete: surface the last FAIL report and the plan file path to the user in chat, then stop"), "must surface the terminal FAIL and stop rather than declaring complete");
            },
            "forbids end-of-run summary on terminal FAIL"(body) {
                Assert.ok(body.includes("Do not print the end-of-run summary as if the plan were valid"), "must forbid the end-of-run summary on terminal FAIL");
            }
        }
    });

    test("Final validation references the governing rule files", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "points at the final-validator rule"(body) {
                Assert.ok(body.includes("rules/ai/skills/plan/final-validator.md"), "must point at the final-validator rule");
            },
            "subjects the validator subagent to no-git-writes"(body) {
                Assert.ok(body.includes("rules/ai/agents/no-git-writes.md"), "must subject the validator subagent to no-git-writes");
            }
        }
    });

    test("Summary section gates on the final validator PASS", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes("After the final validator returns PASS, print a summary in chat"), "summary intro must gate on the final validator returning PASS");
        }
    });

    test("has no unresolved placeholders or TODOs", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "does not contain TODO"(body) {
                Assert.ok(!body.includes("TODO"), "must not contain TODO");
            },
            "does not contain {{ placeholders"(body) {
                Assert.ok(!body.includes("{{"), "must not contain {{ placeholders");
            },
            "does not contain }} placeholders"(body) {
                Assert.ok(!body.includes("}}"), "must not contain }} placeholders");
            }
        }
    });

    test("covers clarification phase", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "has Clarification phase heading"(body) {
                Assert.ok(body.includes("Clarification phase"), "must have Clarification phase heading");
            },
            "enforces one question per turn"(body) {
                Assert.ok(body.includes("one question per turn"), "must enforce one question per turn");
            },
            "limits trigger to implementation choice"(body) {
                Assert.ok(body.includes("implementation choice"), "must mention implementation choice as trigger");
            },
            "limits trigger to task-scope ambiguity"(body) {
                Assert.ok(body.includes("task-scope ambiguity"), "must mention task-scope ambiguity as trigger");
            },
            "describes cross-cutting convention outcome"(body) {
                Assert.ok(body.includes("Cross-cutting convention"), "must describe cross-cutting convention outcome");
            },
            "describes plan-local outcome"(body) {
                Assert.ok(body.includes("Plan-local implementation choice"), "must describe plan-local outcome");
            },
            "prohibits writing to rules/ or contracts/"(body) {
                Assert.ok(body.includes("never writes to rules/ or contracts/"), "must prohibit writing to rules/ or contracts/");
            }
        }
    });

    test("covers drafting phase as direct write without approval", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "has Drafting phase heading"(body) {
                Assert.ok(body.includes("Drafting phase"), "must have Drafting phase heading");
            },
            "persists the plan file directly after clarification"(body) {
                Assert.ok(body.includes("persist the plan file directly"), "must persist the plan file directly after clarification");
            },
            "writes without presenting a layout summary"(body) {
                Assert.ok(body.includes("without presenting a layout summary"), "must write without presenting a layout summary");
            },
            "user reviews the plan after it is written"(body) {
                Assert.ok(body.includes("user reviews the written plan file after the fact"), "user must review the plan after it is written");
            }
        }
    });

    test("covers updated plan content rules", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "states plan is free of placeholders"(body) {
                Assert.ok(body.includes("free of placeholders"), "must state plan is free of placeholders");
            },
            "states plan is free of contradictions"(body) {
                Assert.ok(body.includes("contradictions with existing contracts or rules"), "must state plan is free of contradictions");
            },
            "limits references to canonical state"(body) {
                Assert.ok(body.includes("canonical state captured at invocation"), "must limit references to canonical state");
            },
            "embeds plan-local decisions in task description"(body) {
                Assert.ok(body.includes("embedded in the relevant task"), "must embed plan-local decisions in task description");
            },
            "forbids promoting plan-local decisions to rules"(body) {
                Assert.ok(body.includes("never promoted to a rule"), "must forbid promoting plan-local decisions to rules");
            }
        }
    });

    test("references the new plan-specific rules", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "references clarification-scope rule"(body) {
                Assert.ok(body.includes("rules/ai/skills/plan/clarification-scope.md"), "must reference clarification-scope rule");
            },
            "references scope-driven-rule-selection rule"(body) {
                Assert.ok(body.includes("rules/ai/skills/plan/scope-driven-rule-selection.md"), "must reference scope-driven-rule-selection rule");
            }
        }
    });
});

test.describe("skills – ruleSkillBody", test => {
    test("is a non-empty string", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERT(body) {
            Assert.strictEqual(typeof body, "string");
            Assert.ok(body.length > 0);
        }
    });

    test("covers clarification phase", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERTS: {
            "mentions clarification phase"(body) {
                Assert.ok(body.includes("clarification"), "must mention clarification phase");
            },
            "enforces sequential questions"(body) {
                Assert.ok(body.includes("one question per turn"), "must enforce sequential questions");
            }
        }
    });

    test("covers drafting phase with approval", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERTS: {
            "mentions drafting phase"(body) {
                Assert.ok(body.includes("drafting phase"), "must mention drafting phase");
            },
            "requires user approval"(body) {
                Assert.ok(body.includes("approval"), "must require user approval");
            },
            "persists every file in a single batch after layout approval"(body) {
                Assert.ok(body.includes("single batch without"), "must persist files in a single batch after layout approval");
            }
        }
    });

    test("covers self-review pass", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERTS: {
            "mentions self-review pass"(body) {
                Assert.ok(body.includes("self-review"), "must mention self-review pass");
            },
            "self-review checks for placeholders"(body) {
                Assert.ok(body.includes("placeholders"), "self-review must check for placeholders");
            },
            "self-review checks for contradictions"(body) {
                Assert.ok(body.includes("contradictions"), "self-review must check for contradictions");
            }
        }
    });

    test("covers file layout and descriptive filenames", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERTS: {
            "mentions file layout presentation"(body) {
                Assert.ok(body.includes("file layout"), "must mention file layout presentation");
            },
            "requires descriptive filenames"(body) {
                Assert.ok(body.includes("Filenames must be descriptive"), "must require descriptive filenames");
            }
        }
    });

    test("covers output language obligation", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERTS: {
            "has output language section"(body) {
                Assert.ok(body.includes("Output language"), "must have output language section");
            },
            "matches input language"(body) {
                Assert.ok(body.includes("same natural language as the input"), "must match input language");
            }
        }
    });

    test("covers idempotency and overwrites", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERTS: {
            "mentions idempotency"(body) {
                Assert.ok(body.includes("Idempotency"), "must mention idempotency");
            },
            "describes in-place updates"(body) {
                Assert.ok(body.includes("update related files in place"), "must describe in-place updates");
            }
        }
    });

    test("restricts writes to rules/ only", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes("must not write, modify, or delete any source code or any file outside rules/"), "must restrict to rules/");
        }
    });

    test("covers one-rule-per-file granularity", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERTS: {
            "enforces one rule per file"(body) {
                Assert.ok(body.includes("Each rule file describes exactly one rule"), "must enforce one rule per file");
            },
            "bundles must be subfolders of atomic files"(body) {
                Assert.ok(body.includes("subfolder of single-rule files, never as one multi-rule file"), "bundles must be subfolders of atomic files");
            }
        }
    });

    test("covers namespace as relative path inside rules/", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes("namespace of a rule is its relative path inside rules/"), "must define namespace as relative path");
        }
    });

    test("has no unresolved placeholders or TODOs", {
        ARRANGE() {},
        ACT() { return ruleSkillBody; },
        ASSERTS: {
            "does not contain TODO"(body) {
                Assert.ok(!body.includes("TODO"), "must not contain TODO");
            },
            "does not contain {{ placeholders"(body) {
                Assert.ok(!body.includes("{{"), "must not contain {{ placeholders");
            },
            "does not contain }} placeholders"(body) {
                Assert.ok(!body.includes("}}"), "must not contain }} placeholders");
            }
        }
    });
});
