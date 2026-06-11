import * as Assert from "assert";

import test from "arrange-act-assert";

import { TASK_LINE } from "../plan/PlanFile";
import { planSkillBody, specSkillBody } from "./skills";

// A citation of a flanders-internal spec file: a path under contracts/, rules/, or plans/ that names a specific .md file. Skill bodies ship into arbitrary user projects where those files do not exist, so such a citation must never appear. Shared by the plan-skill and spec-skill self-containedness guards so the pattern has one source of truth.
const INTERNAL_SPEC_PATH_CITATION = /(contracts|rules|plans)\/[A-Za-z][A-Za-z0-9_/\-]*\.md/;

test.describe("skills – planSkillBody", test => {
    test("is a non-empty string", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERT(body) {
            Assert.strictEqual(typeof body, "string");
            Assert.ok(body.length > 0);
        }
    });

    test("covers .docs discovery as the canonical contracts reference", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "instructs recursive .docs discovery across the project tree"(body) {
                Assert.ok(body.includes("Discover every directory named \`.docs\` across the whole project tree at every depth"), "step 2 must instruct recursive .docs discovery at every depth");
            },
            "names the git-ignore exclusion"(body) {
                Assert.ok(body.includes("excluding every path the project's git ignore rules exclude"), "step 2 must exclude git-ignored paths");
            },
            ".docs/contracts subfolders form the canonical contracts listing"(body) {
                Assert.ok(body.includes("the files under each \`.docs/contracts\` subfolder form the canonical contracts listing"), "step 2 must build the contracts listing from .docs/contracts subfolders");
            }
        }
    });

    test("step 2 instructs no root contracts/ or rules/ folder listing", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "names no root contracts/ folder"(body) {
                Assert.ok(!body.includes("contracts/ folder"), "must not instruct listing a root contracts/ folder");
            },
            "names no root rules/ folder"(body) {
                Assert.ok(!body.includes("rules/ folder"), "must not instruct listing a root rules/ folder");
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
            "warns when no .docs/contracts folder contains any file"(body) {
                Assert.ok(body.includes("no \`.docs/contracts\` folder contains any file"), "must warn when no .docs/contracts folder contains any file");
            },
            "warns when no .docs/rules folder contains any file"(body) {
                Assert.ok(body.includes("no \`.docs/rules\` folder contains any file"), "must warn when no .docs/rules folder contains any file");
            }
        }
    });

    test("covers .docs discovery as the canonical rules reference", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            ".docs/rules subfolders form the canonical rules listing"(body) {
                Assert.ok(body.includes("the files under each \`.docs/rules\` subfolder form the canonical rules listing"), "step 2 must build the rules listing from .docs/rules subfolders");
            },
            "identifies each file by its namespace"(body) {
                Assert.ok(body.includes("each file is identified by its namespace"), "step 2 must identify each file by its namespace");
            },
            "defines the namespace as the path relative to the project root"(body) {
                Assert.ok(body.includes("its path relative to the project root"), "step 2 must define the namespace as the project-root-relative path");
            },
            "keeps same-leaf-filename specs distinct by namespace"(body) {
                Assert.ok(body.includes("files sharing a leaf filename in different \`.docs\` folders stay distinct"), "step 2 must keep same-leaf-filename specs in different .docs folders distinct");
            }
        }
    });

    test("step 2 builds the behavior-rule listing from .docs/flanders subfolders", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "the files under each .docs/flanders subfolder form the behavior-rule listing"(body) {
                Assert.ok(body.includes("the files under each \`.docs/flanders\` subfolder form the behavior-rule listing"), "step 2 must build the behavior-rule listing from .docs/flanders subfolders");
            },
            "treats every file inside a .docs/flanders folder at any depth as a behavior rule"(body) {
                Assert.ok(body.includes("treating every file inside a \`.docs/flanders\` folder at any depth as a behavior rule"), "step 2 must treat every file inside a .docs/flanders folder at any depth as a behavior rule");
            }
        }
    });

    test("carries the obligation to honor in-scope behavior rules before persisting the plan file", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "reads every in-scope behavior rule before persisting the plan file"(body) {
                Assert.ok(body.includes("Before persisting the plan file, read every behavior rule whose \`.docs/flanders\` scope encloses the plan file you are about to write"), "must read every in-scope behavior rule before persisting the plan file");
            },
            "scopes the read to the project-root .docs folder and any other enclosing .docs folder"(body) {
                Assert.ok(body.includes("the project-root \`.docs\` folder and any other \`.docs\` folder whose scope encloses the \`plans/\` target"), "must scope behavior-rule reading to the project-root .docs folder and any other .docs folder enclosing the plans/ target");
            },
            "behavior rules govern how the skill names and organizes the plan file it authors"(body) {
                Assert.ok(body.includes("Behavior rules govern how you name and organize the plan file you author"), "behavior rules must govern naming and organization of the authored plan file");
            },
            "treats an in-scope behavior rule as binding, not advisory"(body) {
                Assert.ok(body.includes("an in-scope behavior rule is binding on that work, not advisory"), "an in-scope behavior rule must be binding, not advisory");
            },
            "adds no new task-line link obligation"(body) {
                Assert.ok(body.includes("This adds no new task-line link obligation"), "must state it adds no new task-line link obligation");
            }
        }
    });

    test("scope-driven rule-selection bullet uses namespace-shape-neutral subfolder hints", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "walks the rules listing without a root rules/ path"(body) {
                Assert.ok(body.includes("walk the rules listing and ask"), "must instruct walking the rules listing");
            },
            "hints a testing/ subfolder"(body) {
                Assert.ok(body.includes("every applicable rule under a \`testing/\` subfolder"), "must hint a testing/ subfolder");
            },
            "hints a disposables/ subfolder"(body) {
                Assert.ok(body.includes("every applicable rule under a \`disposables/\` subfolder"), "must hint a disposables/ subfolder");
            },
            "hints a ui/ subfolder"(body) {
                Assert.ok(body.includes("every applicable rule under a \`ui/\` subfolder"), "must hint a ui/ subfolder");
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
            "prohibits task content from touching .docs/contracts folders"(body) {
                Assert.ok(body.includes("inside any \`.docs/contracts\` folder"), "must prohibit tasks from touching .docs/contracts folders");
            },
            "prohibits task content from touching .docs/rules folders"(body) {
                Assert.ok(body.includes("any \`.docs/rules\` folder"), "must prohibit tasks from touching .docs/rules folders");
            },
            "prohibits task content from touching the plans/ folder"(body) {
                Assert.ok(body.includes("or the \`plans/\` folder"), "must prohibit tasks from touching the plans/ folder");
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
            "category 3 names the .docs spec folders and plans/"(body) {
                const category3 = body.slice(body.indexOf("3. Spec-folder write boundary"), body.indexOf("4. Plan content rules"));
                Assert.ok(category3.includes("renames any file inside any \`.docs/contracts\` folder, any \`.docs/rules\` folder, or the \`plans/\` folder"), "validator category 3 must name the .docs/contracts, .docs/rules, and plans/ folders");
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
                    INTERNAL_SPEC_PATH_CITATION.test(body),
                    false
                );
            },
            "does not name the code-grounding rule file even without a path"(body) {
                Assert.ok(!body.includes("tasks-consistent-with-the-code-they-build-on.md"), "must not name the code-grounding rule file");
            },
            "does not name the runtime-premise rule file even without a path"(body) {
                Assert.ok(!body.includes("runtime-premise-backed-or-escalated.md"), "must not name the runtime-premise rule file");
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
                Assert.ok(body.includes("No task may describe work that creates, modifies, deletes, or renames files inside any \`.docs/contracts\` folder, any \`.docs/rules\` folder, or the \`plans/\` folder"), "must inline the spec-folder write boundary");
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
            "routes a cross-cutting convention to a .docs/rules folder"(body) {
                Assert.ok(body.includes("belongs in a \`.docs/rules\` folder"), "a cross-cutting convention must belong in a .docs/rules folder");
            },
            "describes plan-local outcome"(body) {
                Assert.ok(body.includes("Plan-local implementation choice"), "must describe plan-local outcome");
            },
            "prohibits writing to .docs/rules or .docs/contracts folders"(body) {
                Assert.ok(body.includes("never writes to any \`.docs/rules\` or \`.docs/contracts\` folder"), "must prohibit writing to .docs/rules or .docs/contracts folders");
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

    test("clarification phase names the runtime-premise third question trigger", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "frames the clarification triggers as three things"(body) {
                const step3 = body.slice(body.indexOf("3. **Clarification phase.**"), body.indexOf("4. **Drafting phase.**"));
                Assert.ok(step3.includes("targets one of three things"), "Procedure step 3 must frame its triggers as three things");
            },
            "names the load-bearing runtime-premise trigger"(body) {
                const step3 = body.slice(body.indexOf("3. **Clarification phase.**"), body.indexOf("4. **Drafting phase.**"));
                Assert.ok(step3.includes("a load-bearing runtime-behavior premise the plan would otherwise have to assert without backing"), "Procedure step 3 must name the runtime-premise third trigger");
            },
            "the validator-FAIL triage loop also carries the runtime-premise trigger"(body) {
                const triageLoop = body.slice(body.indexOf("### On FAIL: bounded triage-then-fix loop"));
                Assert.ok(triageLoop.includes("a load-bearing runtime-behavior premise the plan would otherwise have to assert without backing"), "the triage loop's clarification-scope restatement must also carry the runtime-premise trigger so a flagged unbacked premise is escalated, not silently rewritten");
            }
        }
    });

    test("plan content rules carry the code-grounding obligation", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "scopes the obligation to tasks that create, modify, or remove code"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Every task that creates, modifies, or removes code is grounded in the real state of the code it builds on"), "the Plan content rules list must scope the code-grounding obligation to tasks that create, modify, or remove code");
            },
            "grounds code-touching tasks in the real state of the code they build on"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("grounded in the real state of the code it builds on — the current source, plus the changes any earlier task it depends on prescribes"), "the Plan content rules list must require tasks be grounded in the real state of the code they build on, including earlier dependent tasks' changes");
            },
            "requires establishing that state before writing the task"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Before writing the task, establish that state"), "the Plan content rules list must require establishing the code state before writing the task");
            },
            "establishes existing code by reading the current source"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("read the current source for code that already exists"), "the Plan content rules list must establish existing code by reading the current source");
            },
            "establishes earlier-task code by consulting the producing task"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("consult the producing earlier task for code an earlier task in the plan creates or changes"), "the Plan content rules list must establish earlier-task code by consulting the producing earlier task");
            },
            "permits changing what the code does"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Changing what the code does is the task's purpose and is allowed"), "the Plan content rules list must permit changing the code's behavior");
            },
            "forbids misstating the code the task builds on"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("misstate the code it builds on — naming structure or behavior that code does not and will not have, or removing or rewriting code on a mistaken account of what it is for"), "the Plan content rules list must forbid misstating the starting code");
            }
        }
    });

    test("plan content rules carry the runtime-premise backed-or-escalated obligation", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "forbids asserting a runtime premise as settled fact"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("No task asserts, as settled fact, a runtime- or observable-behavior premise that its approach depends on and that cannot be confirmed by reading the source"), "the Plan content rules list must forbid asserting an unbacked runtime premise as settled fact");
            },
            "requires the premise be backed or escalated"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Such a premise is either backed — by an existing contract or rule, an existing test, or a preceding task in the plan that establishes it executably — or escalated to the user during the clarification phase"), "the Plan content rules list must require the premise be backed or escalated");
            },
            "forbids removing code on an unbacked, unescalated premise"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("A task does not remove, weaken, or replace existing code on the strength of an unbacked, unescalated runtime-behavior premise"), "the Plan content rules list must forbid removing code on an unbacked, unescalated premise");
            }
        }
    });

    test("validator inputs state the validator reads the source and audits each task against its baseline", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "reads the on-disk source the tasks build on"(body) {
                const inputsSection = body.slice(body.indexOf("### Validator inputs"), body.indexOf("### Validator checks"));
                Assert.ok(inputsSection.includes("the validator reads the on-disk source files the plan's tasks build on"), "Validator inputs must state the validator reads the on-disk source the tasks build on");
            },
            "audits each code-touching task against its baseline"(body) {
                const inputsSection = body.slice(body.indexOf("### Validator inputs"), body.indexOf("### Validator checks"));
                Assert.ok(inputsSection.includes("audits each code-touching task against its baseline: the current source, plus the changes earlier tasks in the plan it depends on prescribe"), "Validator inputs must state the validator audits each task against its baseline");
            }
        }
    });

    test("validator category 4 carries the accurate-claims-against-baseline check", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "requires each task's claims be accurate to its baseline"(body) {
                const category4 = body.slice(body.indexOf("4. Plan content rules"), body.indexOf("5. Active application of referenced contracts and rules"));
                Assert.ok(category4.includes("Each code-touching task's claims about the code it builds on are accurate to its baseline — the current on-disk source, plus the changes any earlier task in the plan it depends on prescribes"), "category 4 must require each task's claims be accurate to its baseline");
            },
            "FAILs a task naming structure neither source nor an earlier task provides"(body) {
                const category4 = body.slice(body.indexOf("4. Plan content rules"), body.indexOf("5. Active application of referenced contracts and rules"));
                Assert.ok(category4.includes("A task that names a function, type, field, file, or behavior that neither the source nor any earlier task in the plan provides, or that removes or rewrites code on a mistaken account of what it does, is FAIL"), "category 4 must FAIL a task that misstates the code it builds on");
            },
            "carves out code an earlier task introduces"(body) {
                const category4 = body.slice(body.indexOf("4. Plan content rules"), body.indexOf("5. Active application of referenced contracts and rules"));
                Assert.ok(category4.includes("Do NOT FAIL a task merely for describing code the current on-disk source lacks when an earlier task in the plan introduces it"), "category 4 must not FAIL a task for code an earlier ordered task introduces");
            },
            "ties the earlier-task carve-out to the depended-on task being ordered first"(body) {
                const category4 = body.slice(body.indexOf("4. Plan content rules"), body.indexOf("5. Active application of referenced contracts and rules"));
                Assert.ok(category4.includes("confirm instead that the depended-on task is ordered first"), "category 4 must require the depended-on task be ordered first for the carve-out to apply");
            },
            "carves out behavior change as not itself a violation"(body) {
                const category4 = body.slice(body.indexOf("4. Plan content rules"), body.indexOf("5. Active application of referenced contracts and rules"));
                Assert.ok(category4.includes("Changing the code's behavior is the task's purpose and is not itself a violation — only a false claim about the code the task builds on is"), "category 4 must state that changing behavior is not itself a violation");
            }
        }
    });

    test("validator category 4 carries the runtime-premise backed-or-escalated check", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "names the runtime-premise backed-or-escalated check"(body) {
                const category4 = body.slice(body.indexOf("4. Plan content rules"), body.indexOf("5. Active application of referenced contracts and rules"));
                Assert.ok(category4.includes("Runtime-behavior premises are backed or escalated"), "category 4 must name the runtime-premise backed-or-escalated check");
            },
            "qualifies the premise as a claim not confirmable from the source"(body) {
                const category4 = body.slice(body.indexOf("4. Plan content rules"), body.indexOf("5. Active application of referenced contracts and rules"));
                Assert.ok(category4.includes("a runtime- or observable-behavior claim not confirmable from the source"), "category 4 must qualify the premise as a runtime- or observable-behavior claim not confirmable from the source");
            },
            "FAILs an unbacked, unescalated runtime premise"(body) {
                const category4 = body.slice(body.indexOf("4. Plan content rules"), body.indexOf("5. Active application of referenced contracts and rules"));
                Assert.ok(category4.includes("that no contract, rule, existing test, or preceding task in the plan backs, and that was not escalated to the user — is FAIL"), "category 4 must FAIL an unbacked, unescalated runtime premise");
            },
            "includes code removal on the strength of such a premise"(body) {
                const category4 = body.slice(body.indexOf("4. Plan content rules"), body.indexOf("5. Active application of referenced contracts and rules"));
                Assert.ok(category4.includes("This explicitly includes a task that removes, weakens, or replaces existing code on the strength of such an unbacked claim"), "category 4 must include code removal on the strength of an unbacked premise");
            }
        }
    });

    test("Final validation carries the passing-gate certification-scope statement", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "certifies the run's written/updated files against the inspected corpus"(body) {
                const finalValidation = body.slice(body.indexOf("## Final validation"), body.indexOf("## Summary"));
                Assert.ok(finalValidation.includes("a pass certifies that the file(s) you wrote or updated in this run satisfy the validator's checks and do not contradict the corpus the validator inspected"), "Final validation must state a pass certifies the run's written/updated files against the inspected corpus");
            },
            "does not certify whole-corpus mutual consistency independent of the run"(body) {
                const finalValidation = body.slice(body.indexOf("## Final validation"), body.indexOf("## Summary"));
                Assert.ok(finalValidation.includes("It does not certify that the entire corpus is mutually consistent independent of this run's files"), "Final validation must state a pass does not certify whole-corpus mutual consistency");
            },
            "is reported only as a statement about the run's own output"(body) {
                const finalValidation = body.slice(body.indexOf("## Final validation"), body.indexOf("## Summary"));
                Assert.ok(finalValidation.includes("Report a pass as a statement about this run's own output, never as a statement that the whole spec is globally sound"), "Final validation must report a pass only as a statement about the run's own output");
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
            "has classification-and-placement section"(body) {
                Assert.ok(body.includes("## Contract vs rule: how the skill classifies and places"), "must have Contract vs rule classification-and-placement section");
            },
            "classification and placement are the skill's own decisions"(body) {
                Assert.ok(body.includes("The classification and placement are the skill's own decisions"), "classification and placement must be the skill's own decisions");
            }
        }
    });

    test("states the scope-relative classification and the lowest-enclosing-directory placement rule", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "classifies boundary behavior as a contract and internal guidance as a rule"(body) {
                Assert.ok(body.includes("public behavior across a scope's boundary is a contract, internal implementation guidance is a rule"), "must classify scope-boundary behavior as a contract and internal guidance as a rule");
            },
            "places a spec in the lowest enclosing directory's .docs folder"(body) {
                Assert.ok(body.includes("the spec lands in the \`.docs\` folder of the lowest directory that encloses all the code its obligation governs"), "must place a spec in the lowest enclosing directory's .docs folder");
            },
            "covers the one-directory placement case"(body) {
                Assert.ok(body.includes("an obligation governing one directory goes in that directory's \`.docs\` folder"), "must cover the one-directory placement case");
            },
            "covers the nearest-common-ancestor placement case"(body) {
                Assert.ok(body.includes("an obligation spanning sibling directories goes in their nearest common ancestor's \`.docs\` folder"), "must cover the sibling/nearest-common-ancestor placement case");
            },
            "covers the project-boundary placement case"(body) {
                Assert.ok(body.includes("an obligation about project-boundary behavior goes in the project-root \`.docs\` folder"), "must cover the project-boundary placement case");
            }
        }
    });

    test("step 2 instructs recursive .docs discovery with git-ignore exclusion and root-relative namespaces", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "instructs recursive .docs discovery at every depth"(body) {
                Assert.ok(body.includes("Discover every directory named \`.docs\` across the whole project tree at every depth"), "step 2 must instruct recursive .docs discovery at every depth");
            },
            "names the git-ignore exclusion"(body) {
                Assert.ok(body.includes("excluding every path the project's git ignore rules exclude"), "step 2 must exclude git-ignored paths");
            },
            "defines the namespace as the path relative to the project root"(body) {
                Assert.ok(body.includes("its path relative to the project root"), "step 2 must define the namespace as the project-root-relative path");
            },
            "states an empty discovery yields an empty canonical reference set"(body) {
                Assert.ok(body.includes("yields an empty canonical reference set"), "step 2 must state a missing or empty discovery yields an empty canonical reference set");
            }
        }
    });

    test("step 2 builds the behavior-rule listing from .docs/flanders subfolders", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "the files under each .docs/flanders subfolder form the behavior-rule listing"(body) {
                Assert.ok(body.includes("the files under each \`.docs/flanders\` subfolder form the behavior-rule listing"), "step 2 must build the behavior-rule listing from .docs/flanders subfolders");
            },
            "treats every file inside a .docs/flanders folder at any depth as a behavior rule"(body) {
                Assert.ok(body.includes("treating every file inside a \`.docs/flanders\` folder at any depth as a behavior rule"), "step 2 must treat every file inside a .docs/flanders folder at any depth as a behavior rule");
            }
        }
    });

    test("carries the obligation to honor in-scope behavior rules before persisting files", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "reads every in-scope behavior rule before persisting any file"(body) {
                Assert.ok(body.includes("Before persisting any file, read every behavior rule whose \`.docs/flanders\` scope encloses each file you are about to write"), "must read every in-scope behavior rule before persisting any file");
            },
            "scopes the read to the target's .docs folder and every parent .docs folder"(body) {
                Assert.ok(body.includes("the \`.docs\` folder you write the file into and every parent \`.docs\` folder"), "must scope behavior-rule reading to the target's .docs folder and every parent .docs folder");
            },
            "behavior rules govern how the skill names, places, and organizes the files it authors"(body) {
                Assert.ok(body.includes("Behavior rules govern how you name, place, and organize the files you author"), "behavior rules must govern naming, placement, and organization of the authored files");
            },
            "treats an in-scope behavior rule as binding, not advisory"(body) {
                Assert.ok(body.includes("an in-scope behavior rule is binding on that work, not advisory"), "an in-scope behavior rule must be binding, not advisory");
            }
        }
    });

    test("specSkillBody names no root contracts/ or rules/ folder pair", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "names no root contracts/ path"(body) {
                Assert.ok(!body.includes("contracts/"), "every contracts reference must be a .docs/contracts folder, never a root contracts/ path");
            },
            "names no root rules/ path"(body) {
                Assert.ok(!body.includes("rules/"), "every rules reference must be a .docs/rules folder, never a root rules/ path");
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

    test("restricts writes to .docs/contracts and .docs/rules folders only", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes("must not write, modify, or delete any source code or any file outside the project's \`.docs/contracts\` and \`.docs/rules\` folders"), "must restrict writes to the project's .docs/contracts and .docs/rules folders");
        }
    });

    test("covers output language obligation", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "has output language heading"(body) {
                Assert.ok(body.includes("## Output language"), "must have output language section");
            },
            "tier 1, first in priority: an explicitly requested language wins"(body) {
                Assert.ok(body.includes("1. When the request explicitly states a language to write in, write in that language."), "tier 1 (first) must write in the explicitly requested language");
            },
            "tier 2, second in priority: the language of existing spec files, determined from a single file"(body) {
                Assert.ok(body.includes("2. Otherwise, when at least one spec file already exists in the project, write in the language of those existing spec files, determined by inspecting a single existing spec file"), "tier 2 (second) must write in the existing spec files' language, determined by inspecting a single existing file");
            },
            "tier 3, last in priority: the language the request itself is written in"(body) {
                Assert.ok(body.includes("3. Otherwise — when the request names no language and no spec file exists yet — write in the language the request itself is written in."), "tier 3 (last) must write in the language the request itself is written in");
            },
            "keeps the non-translation clause"(body) {
                Assert.ok(body.includes("Do not translate already-written content; the resolved language governs only the content you author in this run."), "must keep the clause that already-written content is not translated and the resolved language governs only content authored in the run");
            }
        }
    });

    test("covers interaction language obligation", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "has interaction language heading"(body) {
                Assert.ok(body.includes("## Interaction language"), "must have interaction language section");
            },
            "user-facing messages follow the language of the user's most recent message"(body) {
                Assert.ok(body.includes("the natural language of the user's most recent message in the conversation"), "must state user-facing messages follow the language of the user's most recent message");
            },
            "follows a mid-conversation language switch"(body) {
                Assert.ok(body.includes("every subsequent message you address to the user follows the language of their latest message"), "must state the language follows a mid-conversation switch");
            },
            "resolved independently of the output language"(body) {
                Assert.ok(body.includes("resolved independently of the Output language above"), "must state the interaction language is resolved independently of the output language");
            },
            "never governs the language of the spec files written"(body) {
                Assert.ok(body.includes("never the language of the spec files you write"), "must state it never governs the language of the spec files written");
            }
        }
    });

    test("places the interaction-language section verbatim between Output language and Idempotency", {
        ARRANGE() {
            const section = `## Interaction language

Every message you address to the user during the run — your clarifying questions, the approach trade-off summaries, the drafting-phase layout summary, and any other text you print in chat — is written in the natural language of the user's most recent message in the conversation. When the user switches the language they write in partway through the interaction, every subsequent message you address to the user follows the language of their latest message. This is resolved independently of the Output language above: it governs only what you say to the user in the conversation, never the language of the spec files you write.`;
            return { section };
        },
        ACT() { return specSkillBody; },
        ASSERTS: {
            "contains the interaction-language section verbatim"(body, { section }) {
                Assert.ok(body.includes(section), "specSkillBody must contain the interaction-language section verbatim");
            },
            "section appears after the Output language section"(body) {
                Assert.ok(body.indexOf("## Interaction language") > body.indexOf("## Output language"), "the Interaction language section must appear after the Output language section");
            },
            "section appears before the Idempotency and overwrites section"(body) {
                Assert.ok(body.indexOf("## Interaction language") < body.indexOf("## Idempotency and overwrites"), "the Interaction language section must appear before the Idempotency and overwrites section");
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
                INTERNAL_SPEC_PATH_CITATION.test(body),
                false
            );
        }
    });

    test("Procedure carries the rename-sweep obligation", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "scopes the obligation to a renamed/relocated/removed recurring term"(body) {
                const procedure = body.slice(body.indexOf("## Procedure"), body.indexOf("## Final validation"));
                Assert.ok(procedure.includes("When the run renames, relocates, or removes a term that can recur across the corpus beyond the files it is editing — a folder name, a path segment, a flag, an identifier, a fixed string, or a namespace convention"), "Procedure must scope the rename sweep to a renamed/relocated/removed recurring term");
            },
            "requires a whole-corpus search for the old term"(body) {
                const procedure = body.slice(body.indexOf("## Procedure"), body.indexOf("## Final validation"));
                Assert.ok(procedure.includes("searching the whole corpus (every contract and every rule) for the old term and inspecting every occurrence the search returns"), "Procedure must require a whole-corpus search inspecting every occurrence");
            },
            "triages each occurrence into update-or-intentional-reference"(body) {
                const procedure = body.slice(body.indexOf("## Procedure"), body.indexOf("## Final validation"));
                Assert.ok(procedure.includes("an occurrence the rename must update, which the run edits; or an occurrence that is an intentional reference the rename leaves alone"), "Procedure must triage each occurrence into update-or-intentional-reference");
            },
            "drives coverage by the token, not a relevance judgment"(body) {
                const procedure = body.slice(body.indexOf("## Procedure"), body.indexOf("## Final validation"));
                Assert.ok(procedure.includes("Coverage is driven by the token, not by a judgment of which files are relevant"), "Procedure must drive coverage by the token rather than a relevance judgment");
            },
            "makes the edited-file set the union the sweep surfaces"(body) {
                const procedure = body.slice(body.indexOf("## Procedure"), body.indexOf("## Final validation"));
                Assert.ok(procedure.includes("the set of files the run edits is the union of the occurrences the sweep shows must be updated, and a file the sweep surfaces that you had not planned to touch is added to the run"), "Procedure must make the edited-file set the union the sweep surfaces");
            }
        }
    });

    test("Validator inputs pass the renamed-term list", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "passes the explicit list of renamed/relocated/removed term(s)"(body) {
                const inputsSection = body.slice(body.indexOf("### Validator inputs"), body.indexOf("### Validator checks"));
                Assert.ok(inputsSection.includes("When this run renamed, relocated, or removed a term that can recur across the corpus (per the Rename sweep obligation in the procedure above), the explicit list of those old term(s)."), "Validator inputs must pass the explicit list of renamed/relocated/removed terms");
            },
            "states the list is empty when no such term changed"(body) {
                const inputsSection = body.slice(body.indexOf("### Validator inputs"), body.indexOf("### Validator checks"));
                Assert.ok(inputsSection.includes("The list is empty when the run changed no such term."), "Validator inputs must state the term list is empty when no such term changed");
            }
        }
    });

    test("Category C carries the renamed-term sweep check", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "names the renamed-term sweep check inside category C"(body) {
                const categoryC = body.slice(body.indexOf("**C. Non-contradiction"), body.indexOf("### Validator output"));
                Assert.ok(categoryC.includes("**Renamed-term sweep.** For each old term the host passed (the terms this run renamed, relocated, or removed), the validator searches the whole corpus for that term and inspects every occurrence."), "category C must carry the per-term whole-corpus renamed-term sweep check");
            },
            "FAILs a stale un-updated occurrence"(body) {
                const categoryC = body.slice(body.indexOf("**C. Non-contradiction"), body.indexOf("### Validator output"));
                Assert.ok(categoryC.includes("An occurrence that is a stale, un-updated instance of the renamed term — a leftover that should have been changed in this run — is FAIL."), "category C must FAIL a stale un-updated occurrence");
            },
            "treats an intentional reference as not a violation"(body) {
                const categoryC = body.slice(body.indexOf("**C. Non-contradiction"), body.indexOf("### Validator output"));
                Assert.ok(categoryC.includes("An occurrence that is an intentional reference the rename correctly leaves alone is not a violation."), "category C must treat an intentional reference as not a violation");
            },
            "drives the check from the passed terms, not the validator's relevance judgment"(body) {
                const categoryC = body.slice(body.indexOf("**C. Non-contradiction"), body.indexOf("### Validator output"));
                Assert.ok(categoryC.includes("The validator drives this check from the passed term(s), not from its own judgment of which files are relevant"), "category C must drive the check from the passed terms rather than the validator's relevance judgment");
            },
            "is vacuously satisfied when the passed list is empty"(body) {
                const categoryC = body.slice(body.indexOf("**C. Non-contradiction"), body.indexOf("### Validator output"));
                Assert.ok(categoryC.includes("When the passed list is empty, this check is vacuously satisfied."), "category C must be vacuously satisfied when the passed list is empty");
            }
        }
    });

    test("Final validation carries the passing-gate certification-scope statement", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "certifies the run's written/updated files against the inspected corpus"(body) {
                const finalValidation = body.slice(body.indexOf("## Final validation"), body.indexOf("## Output language"));
                Assert.ok(finalValidation.includes("a pass certifies that the file(s) you wrote or updated in this run satisfy the validator's checks and do not contradict the corpus the validator inspected"), "Final validation must state a pass certifies the run's written/updated files against the inspected corpus");
            },
            "does not certify whole-corpus mutual consistency independent of the run"(body) {
                const finalValidation = body.slice(body.indexOf("## Final validation"), body.indexOf("## Output language"));
                Assert.ok(finalValidation.includes("It does not certify that the entire corpus is mutually consistent independent of this run's files"), "Final validation must state a pass does not certify whole-corpus mutual consistency");
            },
            "is reported only as a statement about the run's own output"(body) {
                const finalValidation = body.slice(body.indexOf("## Final validation"), body.indexOf("## Output language"));
                Assert.ok(finalValidation.includes("Report a pass as a statement about this run's own output, never as a statement that the whole spec is globally sound"), "Final validation must report a pass only as a statement about the run's own output");
            }
        }
    });
});
