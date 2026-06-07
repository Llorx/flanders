import * as Assert from "assert";

import test from "arrange-act-assert";

import { TASK_LINE } from "./PlanFile";
import { planSkillBody, specSkillBody } from "./skills";

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
            "does not cite shared/spec-folder-write-authority.md"(body) {
                Assert.ok(!body.includes("shared/spec-folder-write-authority.md"), "must not cite spec-folder-write-authority path");
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
            "launches validator as fresh subagent via the AI tool's subagent mechanism"(body) {
                Assert.ok(body.includes("Launch the validator as a fresh subagent via the AI tool's subagent mechanism"), "must launch validator as a fresh subagent via the AI tool's subagent mechanism");
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
            "permits inline fallback when the subagent mechanism is unavailable"(body) {
                Assert.ok(body.includes("subagent mechanism is unavailable in the current environment"), "must permit inline fallback when the subagent mechanism is unavailable");
            },
            "permits inline fallback on unrecoverable subagent error"(body) {
                Assert.ok(body.includes("unrecoverable error (spawn failure, transport error, environment refusal)"), "must permit inline fallback on unrecoverable subagent error");
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

    test("Final validation enumerates the five mandatory validator checks", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "lists Format and shape check"(body) {
                Assert.ok(body.includes("1. Format and shape"), "must list Format and shape check");
            },
            "lists Semantic dependency order check"(body) {
                Assert.ok(body.includes("2. Semantic dependency order"), "must list Semantic dependency order check");
            },
            "lists Spec-folder write boundary check"(body) {
                Assert.ok(body.includes("3. Spec-folder write boundary"), "must list Spec-folder write boundary check");
            },
            "lists Plan content rules check"(body) {
                Assert.ok(body.includes("4. Plan content rules"), "must list Plan content rules check");
            },
            "lists Active application of referenced contracts and rules check"(body) {
                Assert.ok(body.includes("5. Active application of referenced contracts and rules"), "must list Active application of referenced contracts and rules check");
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
            },
            "passes the leaf-task count as a single non-negative integer"(body) {
                const inputsSection = body.slice(body.indexOf("### Validator inputs"), body.indexOf("### Validator checks"));
                Assert.ok(inputsSection.includes("- The number of leaf task lines you generated (a single non-negative integer)."), "Validator inputs must include the leaf-task count bullet verbatim");
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

    test("Final validation pins the bounded triage-then-fix loop and on-terminal-FAIL surface", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "describes the triage step"(body) {
                Assert.ok(body.includes("Triage each issue"), "must describe the triage step");
            },
            "describes the re-clarify branch"(body) {
                Assert.ok(body.includes("re-enter the clarification phase"), "must describe the re-clarify branch");
            },
            "describes the silent-fix branch"(body) {
                Assert.ok(body.includes("apply in place without asking"), "must describe the silent-fix branch");
            },
            "rewrites plan in place addressing every enumerated issue"(body) {
                Assert.ok(body.includes("Rewrite the plan file in place, addressing every enumerated issue"), "must rewrite the plan in place addressing every issue");
            },
            "re-launches the validator in a fresh subagent session"(body) {
                Assert.ok(body.includes("Re-launch the validator (a new subagent in a fresh session when the subagent host is available)"), "must re-launch a fresh subagent session");
            },
            "caps the loop at FIVE triage-then-fix passes"(body) {
                Assert.ok(body.includes("at most FIVE triage-then-fix passes per /flanders-plan invocation"), "must cap the triage-then-fix loop at FIVE passes per invocation");
            },
            "does not declare complete on terminal FAIL"(body) {
                Assert.ok(body.includes("do not declare complete: surface the last FAIL report and the plan file path to the user in chat, then stop"), "must surface the terminal FAIL and stop rather than declaring complete");
            },
            "forbids end-of-run summary on terminal FAIL"(body) {
                Assert.ok(body.includes("Do not print the end-of-run summary as if the plan were valid"), "must forbid the end-of-run summary on terminal FAIL");
            }
        }
    });

    test("Final validation does not cite flanders-internal rule paths", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "does not cite the final-validator rule path"(body) {
                Assert.ok(!body.includes("rules/ai/skills/plan/final-validator.md"), "must not cite the final-validator rule path");
            },
            "does not cite the final-validator-host rule path"(body) {
                Assert.ok(!body.includes("rules/ai/skills/final-validator-host.md"), "must not cite the final-validator-host rule path");
            },
            "does not cite the no-git-writes rule path"(body) {
                Assert.ok(!body.includes("rules/ai/agents/no-git-writes.md"), "must not cite the no-git-writes rule path");
            },
            "does not cite the validator-detects-expected-task-count rule path"(body) {
                Assert.ok(!body.includes("rules/ai/skills/plan/validator-detects-expected-task-count.md"), "must not cite the validator-detects-expected-task-count rule path");
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

    test("self-contained body: no flanders-internal citations and all obligations inline", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "no path under contracts/, rules/, or plans/ names a specific .md file"(body) {
                Assert.strictEqual(
                    /(contracts|rules|plans)\/[A-Za-z][A-Za-z0-9_/\-]*\.md/.test(body),
                    false
                );
            },
            "inlines the narrower clarification-scope criteria"(body) {
                Assert.ok(body.includes("implementation choice in the code the tasks will produce that the request does not specify, or a task-scope ambiguity"), "must inline the narrower clarification-scope criteria");
            },
            "inlines the scope-driven rule-selection heuristic"(body) {
                Assert.ok(body.includes("Rule selection per task is scope-driven, not topic-driven"), "must inline the scope-driven rule-selection heuristic");
            },
            "inlines that under-linking is penalized"(body) {
                Assert.ok(body.includes("Under-linking is costly"), "must state that under-linking is penalized");
            },
            "inlines the plan-file format: checkbox shape"(body) {
                Assert.ok(body.includes("`[ ]` — open"), "must inline the open checkbox shape");
            },
            "inlines the plan-file format: metrics object byte-exact"(body) {
                Assert.ok(body.includes("byte-exact"), "must inline the byte-exact metrics check");
            },
            "inlines the plan-file format: hierarchical numbering"(body) {
                Assert.ok(body.includes("numbered hierarchically"), "must inline hierarchical numbering");
            },
            "inlines the plan-file format: leaf/parent distinction"(body) {
                Assert.ok(body.includes("does NOT carry its own checkbox"), "must inline the leaf/parent distinction");
            },
            "inlines the spec-folder write boundary for tasks"(body) {
                Assert.ok(body.includes("No task may describe work that creates, modifies, deletes, or renames files inside contracts/, inside rules/, or inside plans/"), "must inline the spec-folder write boundary");
            },
            "On FAIL triage step"(body) {
                Assert.ok(body.includes("Triage each issue"), "must describe the triage step");
            },
            "On FAIL re-clarify branch"(body) {
                Assert.ok(body.includes("re-enter the clarification phase for that specific ambiguity"), "must describe the re-clarify branch");
            },
            "On FAIL silent-fix branch"(body) {
                Assert.ok(body.includes("apply in place without asking"), "must describe the silent-fix branch");
            },
            "On FAIL bounded five-pass loop"(body) {
                Assert.ok(body.includes("at most FIVE triage-then-fix passes"), "must cap the loop at five passes");
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

    test("covers internal self-consistency obligation", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "states the plan-content self-consistency rule"(body) {
                Assert.ok(body.includes("internally self-consistent: its narrative"), "must state the plan-content self-consistency rule");
            },
            "lists the validator self-consistency check"(body) {
                Assert.ok(body.includes("Internally self-consistent — no contradiction between the plan's narrative and its tasks"), "must list the validator self-consistency check");
            },
            "plan-content bullet appears verbatim immediately after the placeholders bullet"(body) {
                const placeholdersBullet = "- The persisted plan is free of placeholders, contradictions with existing contracts or rules, ambiguous task wording, missing acceptance criteria on leaf tasks, and missing contract or rule links on leaf tasks.";
                const selfConsistencyBullet = "- The persisted plan is internally self-consistent: its narrative — context, rationale, and any explanatory prose — does not contradict the obligations, verification approach, or any other statement made in its task bodies, and no task contradicts that narrative. Where the prose describes how something is tested or built, it matches what the tasks prescribe.";
                const lines = body.split("\n");
                const placeholdersIndex = lines.indexOf(placeholdersBullet);
                Assert.ok(placeholdersIndex !== -1, "placeholders bullet must appear verbatim");
                Assert.ok(lines[placeholdersIndex + 1] === selfConsistencyBullet, "self-consistency bullet must follow the placeholders bullet exactly");
            },
            "validator category-4 item appears verbatim and indented like its siblings immediately after the contradictions item"(body) {
                const contradictionsItem = "   - Free of contradictions with existing contracts or rules. No task pins behavior the canonical listings forbid.";
                const selfConsistencyItem = "   - Internally self-consistent — no contradiction between the plan's narrative and its tasks. The plan's context, rationale, and explanatory prose do not contradict the obligations, verification approach, or any other statement in its task bodies, and no task contradicts that narrative. Where the prose describes how something is tested or built, it matches what the tasks prescribe.";
                const lines = body.split("\n");
                const contradictionsIndex = lines.indexOf(contradictionsItem);
                Assert.ok(contradictionsIndex !== -1, "contradictions item must appear verbatim at sibling indentation");
                Assert.ok(lines[contradictionsIndex + 1] === selfConsistencyItem, "validator self-consistency item must follow the contradictions item exactly and share its indentation");
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

    test("does not cite plan-specific rule paths", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "does not cite clarification-scope rule path"(body) {
                Assert.ok(!body.includes("rules/ai/skills/plan/clarification-scope.md"), "must not cite clarification-scope rule path");
            },
            "does not cite scope-driven-rule-selection rule path"(body) {
                Assert.ok(!body.includes("rules/ai/skills/plan/scope-driven-rule-selection.md"), "must not cite scope-driven-rule-selection rule path");
            }
        }
    });

    test("references /flanders-spec and not /flanders-rule", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "references /flanders-spec"(body) {
                Assert.ok(body.includes("/flanders-spec"), "must reference /flanders-spec");
            },
            "does not contain /flanders-rule"(body) {
                Assert.ok(!body.includes("/flanders-rule"), "must not contain /flanders-rule");
            }
        }
    });

    test("task-line section requires the leading markdown list marker", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "example shape shows the leading marker"(body) {
                Assert.ok(body.includes('    - [ ]{"it":0,"ot":0,"t":0} 1.1 TITLE'), "example must show the leading - marker");
            },
            "states the marker is mandatory"(body) {
                Assert.ok(body.includes("This marker is mandatory"), "must state the marker is mandatory");
            },
            "states unmarked lines are not task lines"(body) {
                Assert.ok(body.includes("not a task line and is not detected as one"), "must state unmarked lines are not detected as task lines");
            }
        }
    });

    test("validator Format and shape contains the canonical recognizer regex from TASK_LINE", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "contains the TASK_LINE source pattern in Format and shape"(body) {
                const formatSection = body.slice(body.indexOf("1. Format and shape"));
                Assert.ok(formatSection.includes(TASK_LINE.source), "Format and shape must include the TASK_LINE source pattern");
            },
            "states marker-less task lines are FAIL"(body) {
                const formatSection = body.slice(body.indexOf("1. Format and shape"));
                Assert.ok(formatSection.includes("`[ ]{...}` without the leading list marker — is FAIL"), "must state that lines without the leading marker are FAIL");
            }
        }
    });

    test("validator Format and shape cross-checks the detected task-line count against the host-supplied leaf-task count", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "states the validator counts task lines via the canonical recognizer regex"(body) {
                const formatSection = body.slice(body.indexOf("1. Format and shape"), body.indexOf("2. Semantic dependency order"));
                Assert.ok(formatSection.includes("the number of task lines the validator detects via the canonical recognizer regex above"), "Format and shape must state the validator counts canonical-recognizer matches");
            },
            "states the detected count must equal the host-supplied leaf-task count exactly"(body) {
                const formatSection = body.slice(body.indexOf("1. Format and shape"), body.indexOf("2. Semantic dependency order"));
                Assert.ok(formatSection.includes("equals the leaf-task count the host supplied above exactly"), "Format and shape must require the detected count equals the supplied count exactly");
            },
            "names an inequality in either direction as FAIL"(body) {
                const formatSection = body.slice(body.indexOf("1. Format and shape"), body.indexOf("2. Semantic dependency order"));
                Assert.ok(formatSection.includes("differs from the supplied count in either direction — a generated task lost to a recognition failure, or a non-task line counted as a task — is FAIL"), "Format and shape must name a bidirectional count discrepancy as FAIL via the full literal consequence");
            },
            "enumerates both directions of the count discrepancy"(body) {
                const formatSection = body.slice(body.indexOf("1. Format and shape"), body.indexOf("2. Semantic dependency order"));
                Assert.ok(formatSection.includes("a generated task lost to a recognition failure, or a non-task line counted as a task"), "Format and shape must enumerate both directions (under-count and over-count) of the discrepancy");
            },
            "instructs the validator to enumerate the recognized task lines"(body) {
                const formatSection = body.slice(body.indexOf("1. Format and shape"), body.indexOf("2. Semantic dependency order"));
                Assert.ok(formatSection.includes("The validator enumerates the recognized task lines"), "Format and shape must instruct the validator to enumerate the recognized task lines");
            },
            "instructs the validator to report the detected count"(body) {
                const formatSection = body.slice(body.indexOf("1. Format and shape"), body.indexOf("2. Semantic dependency order"));
                Assert.ok(formatSection.includes("reports the detected count"), "Format and shape must instruct the validator to report the detected count");
            },
            "instructs the validator to name the discrepancy as expected versus detected on inequality"(body) {
                const formatSection = body.slice(body.indexOf("1. Format and shape"), body.indexOf("2. Semantic dependency order"));
                Assert.ok(formatSection.includes("on inequality names the discrepancy as the expected count versus the detected count"), "Format and shape must instruct the validator to name the discrepancy as expected versus detected count on inequality");
            }
        }
    });
});

test.describe("skills – specSkillBody", test => {
    test("is a non-empty string", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERT(body) {
            Assert.strictEqual(typeof body, "string");
            Assert.ok(body.length > 0);
        }
    });

    test("covers clarification phase", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "mentions clarification phase"(body) {
                Assert.ok(body.includes("Clarification phase"), "must mention clarification phase");
            },
            "enforces one question per turn"(body) {
                Assert.ok(body.includes("one question per turn"), "must enforce one question per turn");
            }
        }
    });

    test("covers drafting phase with approval and single-batch persist", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "mentions drafting phase"(body) {
                Assert.ok(body.includes("Drafting phase"), "must mention drafting phase");
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
        ACT() { return specSkillBody; },
        ASSERTS: {
            "mentions self-review pass"(body) {
                Assert.ok(body.includes("self-review"), "must mention self-review pass");
            },
            "self-review checks for placeholders"(body) {
                Assert.ok(body.includes("placeholders left behind"), "self-review must check for placeholders");
            },
            "self-review checks for contradictions"(body) {
                Assert.ok(body.includes("contradictions with the canonical reference set"), "self-review must check for contradictions");
            }
        }
    });

    test("covers contract-vs-rule classification", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "has What a contract is section"(body) {
                Assert.ok(body.includes("## What a contract is"), "must have What a contract is section");
            },
            "has What a rule is section"(body) {
                Assert.ok(body.includes("## What a rule is"), "must have What a rule is section");
            },
            "has classification section"(body) {
                Assert.ok(body.includes("## Contract vs rule"), "must have Contract vs rule classification section");
            },
            "classification is the skill's own decision"(body) {
                Assert.ok(body.includes("classification is the skill's own decision"), "classification must be the skill's own decision");
            }
        }
    });

    test("carries the active no-historical-content prohibition in drafting guidance", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERT(body) {
            const draftingStart = body.indexOf("Drafting phase");
            const finalValidationStart = body.indexOf("Final validation");
            Assert.ok(draftingStart !== -1, "must have Drafting phase section");
            Assert.ok(finalValidationStart !== -1, "must have Final validation section");
            const draftingSection = body.slice(draftingStart, finalValidationStart);
            Assert.ok(draftingSection.includes("Do not write historical, transitional, or migration content"), "the no-historical-content prohibition must appear in the drafting guidance");
        }
    });

    test("restricts writes to contracts/ and rules/ only", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes("must not write, modify, or delete any source code or any file outside contracts/ and rules/"), "must restrict writes to contracts/ and rules/");
        }
    });

    test("covers output language obligation", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "has output language section"(body) {
                Assert.ok(body.includes("## Output language"), "must have output language section");
            },
            "matches input language"(body) {
                Assert.ok(body.includes("same natural language as the input"), "must match input language");
            }
        }
    });

    test("covers idempotency and overwrites", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "mentions idempotency"(body) {
                Assert.ok(body.includes("## Idempotency"), "must mention idempotency");
            },
            "describes in-place updates"(body) {
                Assert.ok(body.includes("update related files in place"), "must describe in-place updates");
            }
        }
    });

    test("requires capturing canonical reference set and mandatory reading before drafting", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "captures canonical reference set"(body) {
                Assert.ok(body.includes("canonical reference set for the run"), "must capture canonical reference set");
            },
            "states reading is mandatory"(body) {
                Assert.ok(body.includes("Reading the relevant existing files is mandatory"), "must state reading is mandatory");
            },
            "states draft without reading is invalid"(body) {
                Assert.ok(body.includes("draft begun without having read them is invalid"), "must state draft without reading is invalid");
            }
        }
    });

    test("Final validation names the three folder-driven check categories and bounded loop", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "lists category A for contract artifacts"(body) {
                Assert.ok(body.includes("**A. Contract artifacts"), "must list category A for contract artifacts");
            },
            "lists category B for rule artifacts"(body) {
                Assert.ok(body.includes("**B. Rule artifacts"), "must list category B for rule artifacts");
            },
            "lists category C for non-contradiction"(body) {
                Assert.ok(body.includes("**C. Non-contradiction"), "must list category C for non-contradiction");
            },
            "selects category set by folder"(body) {
                Assert.ok(body.includes("category set is selected by the folder each file landed in"), "must select category set by folder");
            },
            "pins the bounded five-pass loop"(body) {
                Assert.ok(body.includes("at most FIVE triage-then-fix passes"), "must pin the bounded five-pass triage-then-fix loop");
            },
            "does not declare complete on exhaustion"(body) {
                Assert.ok(body.includes("do not declare complete"), "must not declare complete on exhaustion");
            },
            "surfaces the last FAIL report on exhaustion"(body) {
                Assert.ok(body.includes("surface the last FAIL report"), "must surface the last FAIL report on exhaustion");
            }
        }
    });

    test("Final validation pins validator host as subagent with inline-fallback conditions", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "launches validator as fresh subagent"(body) {
                Assert.ok(body.includes("Launch the validator as a fresh subagent via the AI tool's subagent mechanism"), "must launch validator as a fresh subagent");
            },
            "fresh session does not share context"(body) {
                Assert.ok(body.includes("does not share context with this drafting session"), "validator session must not share context with the drafter");
            },
            "permits inline fallback on unavailable mechanism"(body) {
                Assert.ok(body.includes("subagent mechanism is unavailable in the current environment"), "must permit inline fallback when mechanism is unavailable");
            },
            "permits inline fallback on unrecoverable error"(body) {
                Assert.ok(body.includes("unrecoverable error (spawn failure, transport error, environment refusal)"), "must permit inline fallback on unrecoverable error");
            },
            "forbids ergonomic inline fallback"(body) {
                Assert.ok(body.includes("Inline fallback for ergonomic reasons"), "must mention ergonomic fallback");
                Assert.ok(body.includes("is forbidden"), "must state the ergonomic inline fallback is forbidden");
            }
        }
    });

    test("Final validation pins validator inputs including both canonical listings", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "passes file paths partitioned by folder"(body) {
                Assert.ok(body.includes("partitioned by folder"), "must pass file paths partitioned by folder");
            },
            "passes canonical contracts listing"(body) {
                Assert.ok(body.includes("The canonical contracts listing captured in step 2"), "must pass canonical contracts listing");
            },
            "passes canonical rules listing"(body) {
                Assert.ok(body.includes("The canonical rules listing captured in step 2"), "must pass canonical rules listing");
            }
        }
    });

    test("Final validation pins single-verdict output with no Evidence Report", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "verdict is a single line"(body) {
                Assert.ok(body.includes("single verdict line"), "must state single verdict line");
            },
            "no Evidence Report"(body) {
                Assert.ok(body.includes("no Evidence Report"), "must forbid Evidence Report");
            },
            "names the PASS verdict"(body) {
                Assert.ok(body.includes("`PASS`"), "must name the PASS verdict");
            },
            "names the FAIL verdict with enumerated issues"(body) {
                Assert.ok(body.includes("`FAIL <enumerated issues>`"), "must name the FAIL verdict shape");
            }
        }
    });

    test("has no unresolved placeholders or TODOs", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
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

    test("contains no flanders-internal .md citations", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERT(body) {
            Assert.strictEqual(
                /(contracts|rules|plans)\/[A-Za-z][A-Za-z0-9_/\-]*\.md/.test(body),
                false
            );
        }
    });
});
