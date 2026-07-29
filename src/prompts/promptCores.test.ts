import * as Assert from "assert";
import { createHash } from "crypto";

import test from "arrange-act-assert";

import { detectBuildAndTestPromptCore, hardStopDiagnosisCore, prompts, workerPromptCore } from "./prompts";
import { hardStopReviewSkillBody } from "./skills";

const FLANDERS_INTERNAL_SPEC_CITATION = /(?:\.spec[\\/](?:contracts|rules|flanders)|plans)[\\/][A-Za-z0-9]|(?:rules[\\/]ai[\\/]agents[\\/](?:no-git-writes|no-background-commands)|shared[\\/]spec-folder-write-authority)\.md/i;
const PLAN_SPECIFIC_REFERENCE = /<PLAN_PATH>|\bplan\b/i;

function sha256(value:string):string {
    return createHash("sha256").update(value).digest("hex");
}

test.describe("citation-free prompt cores", test => {
    test("preserves the existing command and hard-stop-review outputs byte for byte", {
        ARRANGE() {
            return {
                workerDigest: "6c91263ac47f149b5ade0ba788308a4b2f8cb520771c346c423665da0850b43e",
                detectionDigest: "863088173249cfd8c35d6c8756a1056503d4a41d9dc799f556410c7c5cdd856f",
                hardStopReviewDigest: "db0040833f34bd835e0cdacf7a72f5d77b2bd5d2f0ef2a87792dee7576ecceb4"
            };
        },
        ACT() {
            return {
                workerDigest: sha256(prompts.worker),
                detectionDigest: sha256(prompts.detectBuildAndTest),
                hardStopReviewDigest: sha256(hardStopReviewSkillBody)
            };
        },
        ASSERTS: {
            "prompts.worker remains byte-identical"({ workerDigest }, expected) {
                Assert.strictEqual(workerDigest, expected.workerDigest);
            },
            "prompts.detectBuildAndTest remains byte-identical"({ detectionDigest }, expected) {
                Assert.strictEqual(detectionDigest, expected.detectionDigest);
            },
            "hardStopReviewSkillBody remains byte-identical"({ hardStopReviewDigest }, expected) {
                Assert.strictEqual(hardStopReviewDigest, expected.hardStopReviewDigest);
            }
        }
    });

    test("exports three non-empty cores without internal file paths or plan-specific framing", {
        ARRANGE() {},
        ACT() {
            return {
                worker: workerPromptCore,
                detection: detectBuildAndTestPromptCore,
                diagnosis: hardStopDiagnosisCore
            };
        },
        ASSERTS: {
            "the worker core is non-empty"({ worker }) {
                Assert.ok(worker.length > 0);
            },
            "the detection core is non-empty"({ detection }) {
                Assert.ok(detection.length > 0);
            },
            "the diagnosis core is non-empty"({ diagnosis }) {
                Assert.ok(diagnosis.length > 0);
            },
            "the worker core carries no Flanders-internal spec citation"({ worker }) {
                Assert.strictEqual(FLANDERS_INTERNAL_SPEC_CITATION.test(worker), false);
            },
            "the detection core carries no Flanders-internal spec citation"({ detection }) {
                Assert.strictEqual(FLANDERS_INTERNAL_SPEC_CITATION.test(detection), false);
            },
            "the diagnosis core carries no Flanders-internal spec citation"({ diagnosis }) {
                Assert.strictEqual(FLANDERS_INTERNAL_SPEC_CITATION.test(diagnosis), false);
            },
            "the worker core carries no plan-file or plan-task framing"({ worker }) {
                Assert.strictEqual(PLAN_SPECIFIC_REFERENCE.test(worker), false);
            },
            "the detection core carries no plan-file or plan-task framing"({ detection }) {
                Assert.strictEqual(PLAN_SPECIFIC_REFERENCE.test(detection), false);
            },
            "the diagnosis core carries no plan-file or plan-task framing"({ diagnosis }) {
                Assert.strictEqual(PLAN_SPECIFIC_REFERENCE.test(diagnosis), false);
            }
        }
    });
});

test.describe("workerPromptCore", test => {
    test("retains every adversarial FAIL condition", {
        ARRANGE() {},
        ACT() { return workerPromptCore; },
        ASSERTS: {
            "fails when the task spec is unsatisfied"(core) {
                Assert.ok(core.includes("1. The task spec is not satisfied."));
            },
            "fails when a referenced contract is not honored"(core) {
                Assert.ok(core.includes("2. A contract referenced by the task is not honored."));
            },
            "fails when a referenced rule is not actively applied"(core) {
                Assert.ok(core.includes("3. A rule referenced by the task is not actively applied"));
            },
            "fails when an applicable global contract or rule is not applied"(core) {
                Assert.ok(core.includes("4. A contract or rule from the global lists below that the reviewer determines should have been applied but was not"));
            },
            "fails when an enclosing behavior rule is not honored"(core) {
                Assert.ok(core.includes("5. A behavior rule from the behavior-rule list below whose `.spec/flanders` scope encloses the files your changes touch is not honored"));
            }
        }
    });

    test("retains the implementation and Evidence Report procedure", {
        ARRANGE() {},
        ACT() { return workerPromptCore; },
        ASSERTS: {
            "instructs implementation of the task"(core) {
                Assert.ok(core.includes("2. Implement the task."));
            },
            "requires tests for the new behavior"(core) {
                Assert.ok(core.includes("Update or extend tests so the new behavior is covered."));
            },
            "names the build script path supplied by the orchestrator"(core) {
                Assert.ok(core.includes("Build script: <BUILD_SCRIPT_PATH>"));
            },
            "names the test script path supplied by the orchestrator"(core) {
                Assert.ok(core.includes("Test script: <TEST_SCRIPT_PATH>"));
            },
            "retains the structural-impossibility hard-stop procedure"(core) {
                Assert.ok(core.includes("write a `hard-stop.log` file at <HARD_STOP_LOG_PATH> stating the structural cause"));
            },
            "requires the Acceptance-criterion claims section"(core) {
                Assert.ok(core.includes("**Acceptance-criterion claims**"));
            },
            "requires the Rule claims section"(core) {
                Assert.ok(core.includes("**Rule claims**"));
            },
            "requires the Contract claims section"(core) {
                Assert.ok(core.includes("**Contract claims**"));
            },
            "keeps the three Evidence Report sections ordered"(core) {
                Assert.ok(core.indexOf("**Acceptance-criterion claims**") < core.indexOf("**Rule claims**")
                    && core.indexOf("**Rule claims**") < core.indexOf("**Contract claims**"));
            }
        }
    });

    test("retains code-comment economy and its reporting channel", {
        ARRANGE() {},
        ACT() { return workerPromptCore; },
        ASSERTS: {
            "tries to express meaning in code before writing a comment"(core) {
                Assert.ok(core.includes("before you write a comment explaining the code, try to make the code itself say it"));
            },
            "writes a comment only where code cannot express the meaning"(core) {
                Assert.ok(core.includes("comment only where none of those expresses it"));
            },
            "routes the correctness justification to the Evidence Report"(core) {
                Assert.ok(core.includes("The argument that your change is correct"));
            },
            "names the Evidence Report as the reporting channel"(core) {
                Assert.ok(core.includes("belong in your Evidence Report, never in the source"));
            },
            "routes the supporting obligation to the Evidence Report"(core) {
                Assert.ok(core.includes("the criterion, contract, rule, behavior rule, task, or review finding behind it"));
            },
            "routes the inspection file:line to the Evidence Report"(core) {
                Assert.ok(core.includes("the `file:line` you want an inspection to target"));
            }
        }
    });

    test("retains the three worker boundaries", {
        ARRANGE() {},
        ACT() { return workerPromptCore; },
        ASSERTS: {
            "forbids git writes"(core) {
                Assert.ok(core.includes("Git boundary: you must not execute any git command that modifies repository state"));
            },
            "permits only the listed read-only git commands"(core) {
                Assert.ok(core.includes("Read-only git commands (`git status`, `git diff`, `git log`, `git show`, `git blame`, `git ls-files`) are allowed"));
            },
            "forbids writes inside .spec/contracts"(core) {
                Assert.ok(core.includes("inside any `.spec/contracts` folder"));
            },
            "forbids writes inside .spec/rules"(core) {
                Assert.ok(core.includes("any `.spec/rules` folder"));
            },
            "forbids writes inside .spec/flanders"(core) {
                Assert.ok(core.includes("any `.spec/flanders` folder"));
            },
            "forbids writes inside plans/"(core) {
                Assert.ok(core.includes("or the `plans/` folder"));
            },
            "runs every command in the foreground"(core) {
                Assert.ok(core.includes("you run every command you execute in the foreground"));
            },
            "keeps the turn active until each command finishes"(core) {
                Assert.ok(core.includes("keep your turn active until that command finishes and its result is in hand"));
            }
        }
    });
});

test.describe("detectBuildAndTestPromptCore", test => {
    test("retains independent command detection and script handling", {
        ARRANGE() {},
        ACT() { return detectBuildAndTestPromptCore; },
        ASSERTS: {
            "inspects the project without asking the user"(core) {
                Assert.ok(core.includes("Inspect the current project on your own — do not ask the user"));
            },
            "receives the build script path"(core) {
                Assert.ok(core.includes("Build script path: <BUILD_SCRIPT_PATH>"));
            },
            "receives the test script path"(core) {
                Assert.ok(core.includes("Test script path: <TEST_SCRIPT_PATH>"));
            },
            "leaves an undetermined build script absent or empty"(core) {
                Assert.ok(core.includes("leave the build script file absent or empty"));
            },
            "applies the absence rule independently to the test script"(core) {
                Assert.ok(core.includes("The same rule applies independently to the test script."));
            },
            "invents no fallback command"(core) {
                Assert.ok(core.includes("do not invent a fallback"));
            },
            "retains the Available rules heading"(core) {
                Assert.ok(core.includes("## Available rules"));
            },
            "retains the rules-list placeholder"(core) {
                Assert.ok(core.includes("<RULE_LIST>"));
            }
        }
    });

    test("retains the three detection-agent boundaries", {
        ARRANGE() {},
        ACT() { return detectBuildAndTestPromptCore; },
        ASSERTS: {
            "forbids git writes"(core) {
                Assert.ok(core.includes("Git boundary: you must not execute any git command that modifies repository state"));
            },
            "permits the listed read-only git commands"(core) {
                Assert.ok(core.includes("Read-only git commands (`git status`, `git log`, `git show`, `git diff`, `git blame`, `git ls-files`) are allowed"));
            },
            "forbids writes inside .spec/contracts"(core) {
                Assert.ok(core.includes("inside any `.spec/contracts` folder"));
            },
            "forbids writes inside .spec/rules"(core) {
                Assert.ok(core.includes("any `.spec/rules` folder"));
            },
            "forbids writes inside .spec/flanders"(core) {
                Assert.ok(core.includes("any `.spec/flanders` folder"));
            },
            "forbids writes inside plans/"(core) {
                Assert.ok(core.includes("or the `plans/` folder"));
            },
            "runs every command in the foreground"(core) {
                Assert.ok(core.includes("you run every command you execute in the foreground"));
            },
            "keeps the turn active until each command finishes"(core) {
                Assert.ok(core.includes("keep your turn active until that command finishes and its result is in hand"));
            }
        }
    });
});

test.describe("hardStopDiagnosisCore", test => {
    test("retains the four-step diagnosis and real-progress-versus-loop classification", {
        ARRANGE() {},
        ACT() { return hardStopDiagnosisCore; },
        ASSERTS: {
            "step 1 reads the preserved evidence"(core) {
                Assert.ok(core.includes("1. **Read the preserved evidence.**"));
            },
            "step 2 grounds the analysis in the project specs"(core) {
                Assert.ok(core.includes("2. **Ground the analysis in the project's specs.**"));
            },
            "step 3 classifies the hard stop"(core) {
                Assert.ok(core.includes("3. **Classify the hard stop.**"));
            },
            "step 4 maps the cause to the eliminating action"(core) {
                Assert.ok(core.includes("4. **Map the cause to the action that removes it:**"));
            },
            "contains exactly four numbered steps"(core) {
                Assert.strictEqual((core.match(/^\d+\. \*\*/gm) ?? []).length, 4);
            },
            "classifies real progress across iterations"(core) {
                Assert.ok(core.includes("made real progress across iterations"));
            },
            "classifies a repeated failure with no net progress as a loop"(core) {
                Assert.ok(core.includes("circled the same unresolved failure with no net progress — a loop"));
            },
            "treats a worker-declared cause as evidence rather than a conclusion"(core) {
                Assert.ok(core.includes("its declared cause is evidence, not a conclusion"));
            },
            "recommends an action that removes the identified cause"(core) {
                Assert.ok(core.includes("Narrow or correct the statement of work"));
            }
        }
    });
});
