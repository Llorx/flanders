import * as Assert from "assert";

import test from "arrange-act-assert";

import { prompts, reviewerMethodologyCore, linkedReferenceDirective } from "./prompts";
import { COMMENT_ADJUDICATION_PARAGRAPH, expectedCodeCommentEconomy, expectedReviewerFailConditions, NO_OWN_TEST_STANDARD_SENTENCE, NON_EXECUTION_PARAGRAPH, REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH, reviewerFailConditionsBlock } from "./reviewerMethodology.fixtures";

const INTERNAL_SPEC_PATH_CITATION = /(contracts|rules|plans)\/[A-Za-z][A-Za-z0-9_/\-]*\.md/;

// The spec-folder write boundary the detect, worker, and reviewer prompts share, byte-exact.
// Independent literal — pinned here so a regression in the prompt's enumeration (a dropped or
// reordered folder, or a missing `.spec/flanders` clause) trips these assertions. It names the
// four governed folders in order: `.spec/contracts`, `.spec/rules`, `.spec/flanders`, `plans/`.
const EXPECTED_SPEC_FOLDER_WRITE_BOUNDARY = "Spec-folder write boundary: you must not create, modify, delete, or rename any file inside any `.spec/contracts` folder, any `.spec/rules` folder, any `.spec/flanders` folder, or the `plans/` folder. These folders are governed by dedicated skills and the implement command's bounded checkpoint updates; no other agent may write to them. See shared/spec-folder-write-authority.md for the full obligation.";

const EXPECTED_CLAIM_CLASSIFICATION_CORE =
`Classify every claim by ONE question: what kind of signal would soundly observe a plausible regression of the claim? Place the claim in exactly one of these three branches, and name the concrete observer the branch requires — an automated failure, an asserting test, or reviewer inspection.

- **Toolchain-guarded** — a plausible regression triggers an automated failure signal WITHOUT any new test being added: a build error, a type error, a linker error, a linter or other static-analysis error from a checker the project actually runs, an existing test failing, or a runtime crash on a code path the test suite already exercises. The evidence is a \`file:line\` citation in the change plus the name of the automated failure a regression would trigger. A linter signal qualifies only when the project actually runs that linter as part of its build or test flow.
- **Test-guarded** — no toolchain signal observes the regression, but the property is observable through the public behavioral surface a test may inspect per \`rules/testing/assert-via-public-surface.md\`: return values, fired callbacks, side effects recorded on injected dependencies, externally observable state, or an artifact the test legitimately constructs and reads back. The evidence is the test's \`file:line\`, the asserting call, and a one-sentence regression argument. "The behavior is correct in the current code" is never sufficient on its own here.
- **Review-adjudicated** — no toolchain signal observes the regression AND the property cannot be observed through the test surface without reading the subject's source as text or piercing its encapsulation. Source-text structural invariants and semantic-judgment properties are verified by the adversarial reviewer's per-iteration inspection of the working tree. The evidence is a \`file:line\` citation plus the explicit statement that the reviewer verifies the property by inspection because it has neither an automated signal nor a test-surface observation. Do not fabricate a test that reads the module's own source as text to guard such a claim.

Literal content, absence of a pattern, order, and count are classified by observability. When the property is observable through the public surface, it is test-guarded and needs an exact-match, zero-match or recorded-call, positional, or counting assertion that would fail under the regression. When the property is observable only by reading the subject's source as text, it is review-adjudicated. Semantic-judgment properties are always review-adjudicated.

A claim that enumerates N independent facts ("X AND Y AND Z", "items A, B, C, D") needs N independent guards; evidence covering only K of N facts (K < N) leaves the uncovered facts unguarded even when they currently hold. An enumerated-minimum guard list is a floor, never a ceiling.`;

const EXPECTED_WORKER_TOOLCHAIN_RERUN_STEP =
`When a test-guarded regression argument cannot be soundly constructed — the asserting call would still pass under a regression the claim forbids — the assertion is too weak: strengthen it (typically by replacing substring, prefix, or inclusion checks with exact-match comparisons on literal values), re-run the toolchain, and update the report.`;

// The full worker-facing taxonomy is the core followed by the worker-only step. The reviewer
// prohibition split leaves the worker text unchanged, so this still matches it verbatim.
const EXPECTED_CLAIM_CLASSIFICATION = `${EXPECTED_CLAIM_CLASSIFICATION_CORE}

${EXPECTED_WORKER_TOOLCHAIN_RERUN_STEP}`;

const EXPECTED_WORKER_RULE_CLAIMS_PARAGRAPH = "For every in-scope rule, one entry. A rule is in scope when it is either (a) explicitly linked by the task, or (b) triggered by your diff per `rules/ai/agents/evidence/scope-driven-self-audit.md`. The two sets are unioned; the diff-driven scope is additive on top of the link list, never a replacement. Each entry carries the rule's namespace (its path relative to the project root), the trigger (which part of the diff or which task link brought it into scope), and the evidence of compliance classified by the same regression-signal question. Rule obligations of the absence-of-a-pattern shape are classified by observability: a test-observable absence needs a search-based or recorded-call assertion that confirms zero matches over the observable surface, while a source-text structural absence or semantic-judgment absence is review-adjudicated and must not be guarded by a test that reads source as text. A rule whose obligation enumerates N distinct prohibited or required patterns expands into N independent entries per `rules/ai/agents/evidence/enumerated-claim-coverage.md`.";

// The structural-impossibility hard-stop declaration the worker prompt carries, byte-exact. It
// names the file path through the `<HARD_STOP_LOG_PATH>` placeholder (wired by the orchestrator),
// carries both qualifying conditions, the three file-content parts, the end-the-turn order, and
// the disqualifications. Pinned here so a regression in any part trips the byte-equal assertion.
const EXPECTED_HARD_STOP_DECLARATION = "If you establish the task cannot reach a clean iteration through any implementation it authorizes — its acceptance criteria cannot be satisfied while honoring a contract or rule the task references or the design the plan prescribes, or closing the recorded review findings requires design decisions or work outside the task's scope — write a `hard-stop.log` file at <HARD_STOP_LOG_PATH> stating the structural cause, the evidence (the criterion and the obligation or design statement in conflict), and the plan or spec change that would unblock the task, then end your turn without further implementation work. Ordinary difficulty, a failing gate, or findings you can still address within the task's scope never qualify.";

// The Flanders-voice tone instruction the worker and reviewer prompts carry. Composed exactly
// as the production helper composes it: a shared terse head, plus — for the reviewer only — the
// violation-entry exclusion spliced in before the closing period.
const EXPECTED_TONE_PROSE_HEAD =
`## Voice

When the language you are narrating in is English, use a light Ned-Flanders touch in your user-facing narration — the prose you stream as you work; deliver any other language plainly. Keep it out of code, file paths, command lines, diagnostics, machine-read tokens, git commit messages`;

const EXPECTED_WORKER_TONE = `${EXPECTED_TONE_PROSE_HEAD}.`;

const EXPECTED_REVIEWER_TONE = `${EXPECTED_TONE_PROSE_HEAD}, and the violation entries you record in your error-log file.`;

function claimClassificationBlock(template: string, endMarker: string) {
    const start = template.indexOf("Classify every claim by ONE question:");
    const end = template.indexOf(endMarker, start);
    return template.substring(start, end);
}

function workerRuleClaimsParagraph(template: string) {
    const start = template.indexOf("For every in-scope rule");
    const end = template.indexOf("\n\n   **Contract claims**", start);
    return template.substring(start, end);
}

test.describe("prompts – prep prompt removed", test => {
    test("prompts no longer exposes a prep template", {
        ARRANGE() {},
        ACT() { return prompts; },
        ASSERT(p) {
            Assert.strictEqual((p as Record<string, unknown>).prep, undefined);
        }
    });
});

test.describe("prompts – detectBuildAndTest", test => {
    test("includes the spec-folder write boundary", {
        ARRANGE() {},
        ACT() { return prompts.detectBuildAndTest; },
        ASSERTS: {
            "names .spec/contracts folders"(template) {
                Assert.ok(template.includes(".spec/contracts"));
            },
            "names .spec/rules folders"(template) {
                Assert.ok(template.includes(".spec/rules"));
            },
            "names .spec/flanders folders"(template) {
                Assert.ok(template.includes(".spec/flanders"));
            },
            "references plans/"(template) {
                Assert.ok(template.includes("plans/"));
            },
            "names no bare root contracts/ rules/ folder pair"(template) {
                Assert.strictEqual(template.includes("`contracts/`, `rules/`"), false);
            },
            "references shared/spec-folder-write-authority.md"(template) {
                Assert.ok(template.includes("shared/spec-folder-write-authority.md"));
            }
        }
    });

    test("spec-folder write boundary block is byte-equal to the four-folder wording", {
        ARRANGE() {},
        ACT() { return prompts.detectBuildAndTest; },
        ASSERT(template) {
            const start = template.indexOf("Spec-folder write boundary:");
            const end = template.indexOf("\n\n", start);
            const specBoundary = template.substring(start, end === -1 ? undefined : end);
            Assert.strictEqual(specBoundary, EXPECTED_SPEC_FOLDER_WRITE_BOUNDARY);
        }
    });

    test("scope hint references testing/ and build/ subfolders of a .spec/rules folder", {
        ARRANGE() {},
        ACT() { return prompts.detectBuildAndTest; },
        ASSERTS: {
            "references the testing/ and build/ subfolder hint"(template) {
                Assert.ok(template.includes("any rule under a `testing/` or `build/` subfolder of a `.spec/rules` folder"));
            },
            "no longer globs rules/testing/*"(template) {
                Assert.strictEqual(template.includes("rules/testing/*"), false);
            },
            "no longer globs rules/build/*"(template) {
                Assert.strictEqual(template.includes("rules/build/*"), false);
            }
        }
    });

    test("does not carry the behavior-rule listing", {
        ARRANGE() {},
        ACT() { return prompts.detectBuildAndTest; },
        ASSERTS: {
            "does not contain the BEHAVIOR_RULE_LIST placeholder"(template) {
                Assert.strictEqual(template.includes("<BEHAVIOR_RULE_LIST>"), false);
            },
            "does not contain an Available behavior rules section"(template) {
                Assert.strictEqual(template.includes("## Available behavior rules"), false);
            }
        }
    });
});

test.describe("prompts – worker", test => {
    test("includes the spec-folder write boundary", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "names .spec/contracts folders"(template) {
                Assert.ok(template.includes(".spec/contracts"));
            },
            "names .spec/rules folders"(template) {
                Assert.ok(template.includes(".spec/rules"));
            },
            "names .spec/flanders folders"(template) {
                Assert.ok(template.includes(".spec/flanders"));
            },
            "references plans/"(template) {
                Assert.ok(template.includes("plans/"));
            },
            "names no bare root contracts/ rules/ folder pair"(template) {
                Assert.strictEqual(template.includes("`contracts/`, `rules/`"), false);
            },
            "references shared/spec-folder-write-authority.md"(template) {
                Assert.ok(template.includes("shared/spec-folder-write-authority.md"));
            }
        }
    });

    test("worker namespace glosses read its path relative to the project root", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "rule-claim gloss reads its path relative to the project root"(template) {
                Assert.ok(template.includes("the rule's namespace (its path relative to the project root)"));
            },
            "contract-claim gloss reads its path relative to the project root"(template) {
                Assert.ok(template.includes("the contract's namespace (its path relative to the project root)"));
            }
        }
    });

    test("scope hint references testing/, disposables/, and ui/ subfolders", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "references the subfolder-based scope hint exactly"(template) {
                Assert.ok(template.includes("open the applicable rules under a `testing/` subfolder; if you touch timers, listeners, controllers, or any async lifecycle, open the rules under a `disposables/` subfolder; if you change terminal UI, open the rules under a `ui/` subfolder"));
            },
            "no longer globs rules/testing/*"(template) {
                Assert.strictEqual(template.includes("rules/testing/*"), false);
            },
            "no longer globs rules/disposables/*"(template) {
                Assert.strictEqual(template.includes("rules/disposables/*"), false);
            },
            "no longer globs rules/ui/*"(template) {
                Assert.strictEqual(template.includes("rules/ui/*"), false);
            }
        }
    });
});

test.describe("prompts – deterministic task-text injection", test => {
    test("worker presents the injected task text instead of the line/title framing", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "contains the <TASK_TEXT> placeholder"(template) {
                Assert.ok(template.includes("<TASK_TEXT>"));
            },
            "contains the '## Your task' heading"(template) {
                Assert.ok(template.includes("## Your task"));
            },
            "no longer contains the <TASK_LINE> placeholder"(template) {
                Assert.strictEqual(template.includes("<TASK_LINE>"), false);
            },
            "no longer contains the <TASK_TITLE> placeholder"(template) {
                Assert.strictEqual(template.includes("<TASK_TITLE>"), false);
            },
            "no longer instructs opening the plan file to find the task line"(template) {
                Assert.strictEqual(template.includes("Open the plan file and find that line"), false);
            },
            "no longer references the prep fork"(template) {
                Assert.strictEqual(template.includes("prep fork"), false);
            },
            "carries iteration-neutral framing to respect referenced obligations"(template) {
                Assert.ok(template.includes("respect the obligations of every contract and rule it references exactly"));
            },
            "no longer unconditionally claims the full task is in this prompt"(template) {
                Assert.strictEqual(template.includes("the full task is provided in this prompt"), false);
            },
            "no longer unconditionally claims the references are provided inline"(template) {
                Assert.strictEqual(template.includes("provided in full inline at the end of this prompt"), false);
            },
            "no longer unconditionally tells the worker it need not open the referenced files"(template) {
                Assert.strictEqual(template.includes("you are not required to open them"), false);
            }
        }
    });

    test("reviewer presents the injected task text instead of the line/title framing", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains the <TASK_TEXT> placeholder"(template) {
                Assert.ok(template.includes("<TASK_TEXT>"));
            },
            "contains the '## The task under review' heading"(template) {
                Assert.ok(template.includes("## The task under review"));
            },
            "no longer contains the <TASK_LINE> placeholder"(template) {
                Assert.strictEqual(template.includes("<TASK_LINE>"), false);
            },
            "no longer contains the <TASK_TITLE> placeholder"(template) {
                Assert.strictEqual(template.includes("<TASK_TITLE>"), false);
            },
            "no longer points the reviewer at the plan line to locate the task"(template) {
                Assert.strictEqual(template.includes("The current task is on line"), false);
            },
            "no longer states the referenced contracts and rules are injected inline"(template) {
                Assert.strictEqual(template.includes("injected inline at the end of this prompt"), false);
            },
            "no longer restates the consolidated-spec.md read in the task-intro line (the directive carries it)"(template) {
                Assert.strictEqual(template.includes("has been consolidated into a spec.md that you must read in full"), false);
            }
        }
    });
});

test.describe("prompts – reviewer – consolidated spec.md directive", test => {
    test("carries the Linked reference content directive naming the SPEC_PATH placeholder", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains the <SPEC_PATH> placeholder"(template) {
                Assert.ok(template.includes("<SPEC_PATH>"));
            },
            "carries the Linked reference content heading"(template) {
                Assert.ok(template.includes("## Linked reference content"));
            },
            "states the references are consolidated into the file at the spec path"(template) {
                Assert.ok(template.includes("has been consolidated into the file at <SPEC_PATH>"));
            },
            "directs a full beginning-to-end read in as few passes as possible"(template) {
                Assert.ok(template.includes("Read that file in full, from beginning to end, in as few passes as possible — ideally a single read — before you start."));
            },
            "no longer claims the references are injected inline"(template) {
                Assert.strictEqual(template.includes("injected inline at the end of this prompt"), false);
            }
        }
    });

    test("the worker template carries no <SPEC_PATH> placeholder — the worker directive is appended at runtime with the literal path", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.strictEqual(template.includes("<SPEC_PATH>"), false);
        }
    });
});

test.describe("prompts – linkedReferenceDirective", test => {
    test("renders the consolidated-reference directive naming the given path", {
        ARRANGE() {
            return "/tmp/flanders-ws/spec.md";
        },
        ACT(specPath) {
            return linkedReferenceDirective(specPath);
        },
        ASSERTS: {
            "opens with the Linked reference content heading"(out) {
                Assert.ok(out.startsWith("## Linked reference content"));
            },
            "states the references are consolidated into the file at the given path"(out, specPath) {
                Assert.ok(out.includes(`has been consolidated into the file at ${specPath}.`));
            },
            "directs a full, beginning-to-end read in as few passes as possible"(out) {
                Assert.ok(out.includes("Read that file in full, from beginning to end, in as few passes as possible — ideally a single read — before you start."));
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
                Assert.ok(p.worker.includes("every claim by ONE question"));
            },
            "claimClassification is not a member of the prompts export"(p) {
                Assert.strictEqual((p as Record<string, unknown>).claimClassification, undefined);
            }
        }
    });

    test("contains the three classification branches", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "regression-signal question"(template) {
                Assert.ok(template.includes("what kind of signal would soundly observe a plausible regression of the claim?"));
            },
            "toolchain-guarded branch is named"(template) {
                Assert.ok(template.includes("**Toolchain-guarded**"));
            },
            "toolchain-guarded branch includes linter signal"(template) {
                Assert.ok(template.includes("a linter or other static-analysis error from a checker the project actually runs"));
            },
            "test-guarded branch is named"(template) {
                Assert.ok(template.includes("**Test-guarded**"));
            },
            "test-guarded branch cites the public behavioral surface rule"(template) {
                Assert.ok(template.includes("public behavioral surface a test may inspect per `rules/testing/assert-via-public-surface.md`"));
            },
            "review-adjudicated branch is named"(template) {
                Assert.ok(template.includes("**Review-adjudicated**"));
            },
            "review-adjudicated branch covers source-text and semantic properties"(template) {
                Assert.ok(template.includes("Source-text structural invariants and semantic-judgment properties are verified by the adversarial reviewer's per-iteration inspection of the working tree."));
            },
            "review-adjudicated branch forbids source-reading tests"(template) {
                Assert.ok(template.includes("Do not fabricate a test that reads the module's own source as text to guard such a claim."));
            },
            "N-facts-need-N-guards rule"(template) {
                Assert.ok(template.includes("needs N independent guards"));
            },
            "test-guarded regression-argument soundness step"(template) {
                Assert.ok(template.includes("When a test-guarded regression argument cannot be soundly constructed"));
            }
        }
    });

    test("classification block is byte-equal to the canonical wording in the worker prompt", {
        ARRANGE() {},
        ACT() {
            return claimClassificationBlock(prompts.worker, "\n\n   **Rule claims**");
        },
        ASSERT(block) {
            Assert.strictEqual(block, EXPECTED_CLAIM_CLASSIFICATION);
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
            "no old automated-signal yes branch"(template) {
                Assert.strictEqual(template.includes("the toolchain already guards the claim"), false);
            },
            "no old no-implicit-guard no branch"(template) {
                Assert.strictEqual(template.includes("the claim has no implicit guard"), false);
            },
            "no old always-test-guard shapes sentence"(template) {
                Assert.strictEqual(template.includes("Four shapes that always fall in the no-implicit-guard branch"), false);
            },
            "no old verified-by-inspection-never-satisfies sentence"(template) {
                Assert.strictEqual(template.includes("\"verified by inspection\" never satisfies"), false);
            },
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

    test("does not contain old criterion-flavored distinctive text", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.strictEqual(template.includes("every acceptance criterion by ONE question"), false);
        }
    });

    test("special shape guidance is classified by observability", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "the four shape labels are named together"(template) {
                Assert.ok(template.includes("Literal content, absence of a pattern, order, and count are classified by observability."));
            },
            "public-surface shapes are test-guarded"(template) {
                Assert.ok(template.includes("When the property is observable through the public surface, it is test-guarded"));
            },
            "source-text shapes are review-adjudicated"(template) {
                Assert.ok(template.includes("When the property is observable only by reading the subject's source as text, it is review-adjudicated."));
            },
            "semantic-judgment properties are review-adjudicated"(template) {
                Assert.ok(template.includes("Semantic-judgment properties are always review-adjudicated."));
            }
        }
    });

    test("contains the test-guarded regression-argument-soundness conclusion", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.ok(template.includes("the assertion is too weak"));
        }
    });
});

test.describe("prompts – worker – three-section Evidence Report", test => {
    test("Acceptance-criterion claims appears exactly once", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            const matchCount = (template.match(/Acceptance-criterion claims/g) ?? []).length;
            Assert.strictEqual(matchCount, 1);
        }
    });

    test("Rule claims appears exactly once", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            const matchCount = (template.match(/Rule claims/g) ?? []).length;
            Assert.strictEqual(matchCount, 1);
        }
    });

    test("Contract claims appears exactly once", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            const matchCount = (template.match(/Contract claims/g) ?? []).length;
            Assert.strictEqual(matchCount, 1);
        }
    });

    test("three section labels appear in order", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            const positions = [
                template.indexOf("Acceptance-criterion claims"),
                template.indexOf("Rule claims"),
                template.indexOf("Contract claims")
            ];
            Assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b));
        }
    });

    test("references rules/ai/agents/evidence-report.md", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.ok(template.includes("rules/ai/agents/evidence-report.md"));
        }
    });

    test("references rules/ai/agents/evidence/scope-driven-self-audit.md", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.ok(template.includes("rules/ai/agents/evidence/scope-driven-self-audit.md"));
        }
    });

    test("references rules/ai/agents/evidence/claim-evidence-classification.md", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.ok(template.includes("rules/ai/agents/evidence/claim-evidence-classification.md"));
        }
    });

    test("references rules/ai/agents/evidence/enumerated-claim-coverage.md", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.ok(template.includes("rules/ai/agents/evidence/enumerated-claim-coverage.md"));
        }
    });

    test("contains the union-semantics verbatim substring", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.ok(template.includes("additive on top of the link list, never a replacement"));
        }
    });

    test("contains the lightweight-vs-heavyweight asymmetry", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "contains lightweight"(template) {
                Assert.ok(template.includes("lightweight"));
            },
            "contains reviewer audits the full working tree"(template) {
                Assert.ok(template.includes("the reviewer audits the full working tree"));
            }
        }
    });

    test("does not reference deleted criterion-evidence-classification path", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.strictEqual(template.includes("acceptance-criteria/criterion-evidence-classification"), false);
        }
    });

    test("does not reference deleted enumerated-criterion-coverage path", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.strictEqual(template.includes("acceptance-criteria/enumerated-criterion-coverage"), false);
        }
    });

    test("introduces AC section with For every acceptance criterion in the task", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.ok(template.includes("For every acceptance criterion in the task"));
        }
    });

    test("introduces rule section with For every in-scope rule", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.ok(template.includes("For every in-scope rule"));
        }
    });

    test("rule section routes absence claims by observability", {
        ARRANGE() {},
        ACT() { return workerRuleClaimsParagraph(prompts.worker); },
        ASSERT(paragraph) {
            Assert.strictEqual(paragraph, EXPECTED_WORKER_RULE_CLAIMS_PARAGRAPH);
        }
    });

    test("introduces contract section with For every in-scope contract", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            Assert.ok(template.includes("For every in-scope contract"));
        }
    });

    test("git boundary block is byte-equal to the previous version", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            const start = template.indexOf("Git boundary:");
            const end = template.indexOf("\n\n", start);
            const gitBoundary = template.substring(start, end);
            Assert.strictEqual(gitBoundary, "Git boundary: you must not execute any git command that modifies repository state — no `git add`, `git commit`, `git stash`, `git reset`, `git restore`, `git checkout -b`, `git branch`, `git tag`, `git rebase`, `git merge`, `git cherry-pick`, no edits under `.git/`, and no remote git operations (`fetch`, `pull`, `push`). Read-only git commands (`git status`, `git diff`, `git log`, `git show`, `git blame`, `git ls-files`) are allowed when you need to inspect the repo. Leave your implementation as a dirty working tree — Flanders performs the commit itself once your changes pass build, test, and review. If your task seems to require a git write, stop and explain it in your final message instead of doing it. The full obligation lives in rules/ai/agents/no-git-writes.md.");
        }
    });

    test("spec-folder write boundary block is byte-equal to the four-folder wording", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            const start = template.indexOf("Spec-folder write boundary:");
            const end = template.indexOf("\n\n", start);
            const specBoundary = template.substring(start, end);
            Assert.strictEqual(specBoundary, EXPECTED_SPEC_FOLDER_WRITE_BOUNDARY);
        }
    });

    test("Adversarial review awaits block lists exactly five FAIL conditions", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "lists exactly five numbered conditions"(template) {
                const blockStart = template.indexOf("The reviewer is instructed to FAIL on ANY of:");
                const blockEnd = template.indexOf("Condition 4 causes most rejections", blockStart);
                const block = template.substring(blockStart, blockEnd);
                const count = (block.match(/\n\d+\. /g) ?? []).length;
                Assert.strictEqual(count, 5);
            },
            "the fifth condition makes an un-honored in-scope behavior rule a FAIL"(template) {
                const blockStart = template.indexOf("The reviewer is instructed to FAIL on ANY of:");
                const blockEnd = template.indexOf("Condition 4 causes most rejections", blockStart);
                const block = template.substring(blockStart, blockEnd);
                Assert.ok(block.includes("A behavior rule from the behavior-rule list below whose `.spec/flanders` scope encloses the files your changes touch is not honored by the changes"));
            }
        }
    });

    test("includes the Available behavior rules section", {
        ARRANGE() {},
        ACT() {
            const start = prompts.worker.indexOf("## Available behavior rules");
            return prompts.worker.substring(start);
        },
        ASSERTS: {
            "section opens with the Available behavior rules heading"(section) {
                Assert.ok(section.startsWith("## Available behavior rules"));
            },
            "section renders the BEHAVIOR_RULE_LIST placeholder"(section) {
                Assert.ok(section.includes("<BEHAVIOR_RULE_LIST>"));
            },
            "section instructs honoring every in-scope behavior rule"(section) {
                Assert.ok(section.includes("You must honor every behavior rule whose `.spec/flanders` scope encloses the files your changes touch"));
            },
            "section states in-scope behavior rules are mandatory whether or not the task links them"(section) {
                Assert.ok(section.includes("in-scope behavior rules are mandatory whether or not the task links them"));
            }
        }
    });

    test("the available-list sections state the FAIL consequence once via the conditions, not restated per list", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "the Available contracts section does not restate the global-list FAIL consequence"(template) {
                Assert.strictEqual(template.includes("The reviewer FAILS for any global-list contract"), false);
            },
            "the Available rules section does not restate the global-list FAIL consequence"(template) {
                Assert.strictEqual(template.includes("The reviewer FAILS for any global-list rule"), false);
            },
            "the Available behavior rules section does not restate the behavior-rule FAIL consequence"(template) {
                Assert.strictEqual(template.includes("the reviewer FAILS for any in-scope behavior rule"), false);
            },
            "condition 4 is still stated once and emphasized as the top rejection cause"(template) {
                Assert.ok(template.includes("Condition 4 causes most rejections in practice"));
                Assert.ok(template.includes("A contract or rule from the global lists below that the reviewer determines should have been applied but was not"));
            }
        }
    });
});

test.describe("prompts – worker – structural-impossibility hard-stop declaration", test => {
    test("the worker prompt carries the hard-stop declaration instruction byte-equal", {
        ARRANGE() {},
        ACT() {
            const start = prompts.worker.indexOf("If you establish the task cannot reach a clean iteration");
            const endMarker = "never qualify.";
            const end = prompts.worker.indexOf(endMarker, start) + endMarker.length;
            return prompts.worker.substring(start, end);
        },
        ASSERT(block) {
            Assert.strictEqual(block, EXPECTED_HARD_STOP_DECLARATION);
        }
    });

    test("the instruction states each of its parts", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "names the umbrella qualifying condition"(template) {
                Assert.ok(template.includes("If you establish the task cannot reach a clean iteration through any implementation it authorizes"));
            },
            "carries the unsatisfiable-acceptance-criteria qualifying condition"(template) {
                Assert.ok(template.includes("its acceptance criteria cannot be satisfied while honoring a contract or rule the task references or the design the plan prescribes"));
            },
            "carries the out-of-scope-review-findings qualifying condition"(template) {
                Assert.ok(template.includes("closing the recorded review findings requires design decisions or work outside the task's scope"));
            },
            "names the file path through the placeholder"(template) {
                Assert.ok(template.includes("write a `hard-stop.log` file at <HARD_STOP_LOG_PATH>"));
            },
            "requires the structural-cause file-content part"(template) {
                Assert.ok(template.includes("stating the structural cause"));
            },
            "requires the evidence file-content part"(template) {
                Assert.ok(template.includes("the evidence (the criterion and the obligation or design statement in conflict)"));
            },
            "requires the unblocking plan-or-spec-change file-content part"(template) {
                Assert.ok(template.includes("the plan or spec change that would unblock the task"));
            },
            "orders ending the turn without further implementation work"(template) {
                Assert.ok(template.includes("then end your turn without further implementation work"));
            },
            "carries the disqualifications"(template) {
                Assert.ok(template.includes("Ordinary difficulty, a failing gate, or findings you can still address within the task's scope never qualify."));
            }
        }
    });
});

test.describe("prompts – reviewer", test => {
    test("includes the spec-folder write boundary", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "names .spec/contracts folders"(template) {
                Assert.ok(template.includes(".spec/contracts"));
            },
            "names .spec/rules folders"(template) {
                Assert.ok(template.includes(".spec/rules"));
            },
            "names .spec/flanders folders"(template) {
                Assert.ok(template.includes(".spec/flanders"));
            },
            "references plans/"(template) {
                Assert.ok(template.includes("plans/"));
            },
            "names no bare root contracts/ rules/ folder pair"(template) {
                Assert.strictEqual(template.includes("`contracts/`, `rules/`"), false);
            },
            "references shared/spec-folder-write-authority.md"(template) {
                Assert.ok(template.includes("shared/spec-folder-write-authority.md"));
            }
        }
    });

    test("contains ERROR_LOG_PATH placeholder", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("<ERROR_LOG_PATH>"));
        }
    });

    test("includes the Available behavior rules section", {
        ARRANGE() {},
        ACT() {
            const start = prompts.reviewer.indexOf("## Available behavior rules");
            const end = prompts.reviewer.indexOf("Your job is adversarial:", start);
            return prompts.reviewer.substring(start, end);
        },
        ASSERTS: {
            "section opens with the Available behavior rules heading"(section) {
                Assert.ok(section.startsWith("## Available behavior rules"));
            },
            "section renders the BEHAVIOR_RULE_LIST placeholder"(section) {
                Assert.ok(section.includes("<BEHAVIOR_RULE_LIST>"));
            },
            "section instructs verifying the changes honor every in-scope behavior rule"(section) {
                Assert.ok(section.includes("You must verify that the working-tree changes honor every behavior rule whose `.spec/flanders` scope encloses the files they touch"));
            },
            "section states in-scope behavior rules are mandatory whether or not the task links them"(section) {
                Assert.ok(section.includes("in-scope behavior rules are mandatory whether or not the task links them"));
            }
        }
    });

    test("contains locked substring: append every violation", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("append every violation"));
        }
    });

    test("create-empty-file paragraph is byte-equal to the required wording", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            const start = template.indexOf("When your audit finds no violation");
            const end = template.indexOf("\n\n", start);
            const paragraph = template.substring(start, end);
            Assert.strictEqual(paragraph, "When your audit finds no violation across every verification, you must still create `<ERROR_LOG_PATH>` as an empty file as your final act, so the file always exists once you have reached a verdict. Do not write a pass confirmation or any non-violation content into that file; any content there is read as a failure.");
        }
    });

    test("old writes-nothing wording is absent", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "no 'writes nothing'"(template) {
                Assert.strictEqual(template.includes("writes nothing"), false);
            },
            "no 'leave the file empty'"(template) {
                Assert.strictEqual(template.includes("leave the file empty"), false);
            }
        }
    });

    test("deleted PASS/FAIL protocol phrases are absent", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "no 'Do not append an Evidence Report or any other multi-line content after the final PASS/FAIL line'"(template) {
                Assert.strictEqual(template.includes("Do not append an Evidence Report or any other multi-line content after the final PASS/FAIL line"), false);
            },
            "no 'Reply with exactly one of the two following formats on that final line'"(template) {
                Assert.strictEqual(template.includes("Reply with exactly one of the two following formats on that final line"), false);
            },
            "no 'the final PASS/FAIL line that the orchestrator parses'"(template) {
                Assert.strictEqual(template.includes("the final PASS/FAIL line that the orchestrator parses"), false);
            },
            "no 'AC<n> (<short paraphrase>): <PASS|FAIL>'"(template) {
                Assert.strictEqual(template.includes("AC<n> (<short paraphrase>): <PASS|FAIL>"), false);
            },
            "no 'R<n> (<rules/.../...md>): <PASS|FAIL>'"(template) {
                Assert.strictEqual(template.includes("R<n> (<rules/.../...md>): <PASS|FAIL>"), false);
            },
            "no 'C<n> (<contracts/.../...md>): <PASS|FAIL>'"(template) {
                Assert.strictEqual(template.includes("C<n> (<contracts/.../...md>): <PASS|FAIL>"), false);
            },
            "no 'the entire reason lives on it (for example, as a numbered list with inline separators)'"(template) {
                Assert.strictEqual(template.includes("the entire reason lives on it (for example, as a numbered list with inline separators)"), false);
            }
        }
    });
});

test.describe("prompts – reviewer – test-methodology-agnostic verification", test => {
    test("carries no regression-signal claim taxonomy", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "no toolchain-guarded branch, in any casing"(template) {
                Assert.strictEqual(template.toLowerCase().includes("toolchain-guarded"), false);
            },
            "no test-guarded branch, in any casing"(template) {
                Assert.strictEqual(template.toLowerCase().includes("test-guarded"), false);
            },
            "no review-adjudicated branch, in any casing"(template) {
                Assert.strictEqual(template.toLowerCase().includes("review-adjudicated"), false);
            },
            "no classify-every-claim opener"(template) {
                Assert.strictEqual(template.includes("Classify every claim by ONE question"), false);
            },
            "no regression-signal question"(template) {
                Assert.strictEqual(template.includes("regression-signal question"), false);
            },
            "no classification-by-observability guidance"(template) {
                Assert.strictEqual(template.includes("classified by observability"), false);
            },
            "no evidence-type-by-classification step"(template) {
                Assert.strictEqual(template.includes("evidence of the type that classification requires"), false);
            }
        }
    });

    test("carries no test-adjudication methodology of its own", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "no test-coverage adequacy sentence"(template) {
                Assert.strictEqual(template.includes("cover every case and every fact"), false);
            },
            "no full test-body read paragraph"(template) {
                Assert.strictEqual(template.includes("Read the complete body of every test"), false);
            },
            "no counterfactual regression construction"(template) {
                Assert.strictEqual(template.includes("construct the simplest plausible regression"), false);
            }
        }
    });

    test("the verification protocol enumerates and confirms each criterion without classifying it", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "keeps the mandatory protocol heading"(template) {
                Assert.ok(template.includes("Acceptance-criteria verification protocol (mandatory before deciding PASS on condition 1):"));
            },
            "step a enumerates every criterion and expands N independent facts into N items"(template) {
                Assert.ok(template.includes("a. Enumerate every acceptance criterion in the task as a separate numbered item, explicitly in your reasoning; an item that enumerates N independent facts expands into N items."));
            },
            "step b confirms the working-tree changes satisfy each item and makes an unsatisfied item a violation"(template) {
                Assert.ok(template.includes("b. For each enumerated item, confirm the worker's working-tree changes actually satisfy it. An item left unsatisfied is a violation, never waved through on \"the code looks right\"."));
            }
        }
    });

    test("affirms the reviewer applies no test standard of its own", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "carries the no-own-test-standard sentence verbatim"(template) {
                Assert.ok(template.includes(NO_OWN_TEST_STANDARD_SENTENCE));
            },
            "requires a test, assertion, or regression guard only where a contract or rule in scope requires one"(template) {
                Assert.ok(template.includes("you require a test, a particular assertion, or a regression guard for an enumerated item only where a contract or rule in scope requires one"));
            },
            "then enforces that requirement as any other rule"(template) {
                Assert.ok(template.includes("you then enforce that requirement as you enforce any other rule under conditions 3 and 4."));
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

    test("contains no evidence-classification spec-path citations", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "no criterion-evidence-classification"(template) {
                Assert.strictEqual(template.includes("criterion-evidence-classification"), false);
            },
            "no claim-evidence-classification"(template) {
                Assert.strictEqual(template.includes("claim-evidence-classification"), false);
            },
            "no enumerated-criterion-coverage"(template) {
                Assert.strictEqual(template.includes("enumerated-criterion-coverage"), false);
            },
            "no assert-via-public-surface citation"(template) {
                Assert.strictEqual(template.includes("assert-via-public-surface"), false);
            }
        }
    });

    test("omits the worker-only too-weak/soundness conclusion — the reviewer never runs the toolchain", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.strictEqual(template.includes("the assertion is too weak"), false);
        }
    });
});

test.describe("prompts – reviewer – three-section claim checklist", test => {
    test("Acceptance-criterion claims appears exactly once", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            const matchCount = (template.match(/Acceptance-criterion claims/g) ?? []).length;
            Assert.strictEqual(matchCount, 1);
        }
    });

    test("Rule claims appears exactly once", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            const matchCount = (template.match(/Rule claims/g) ?? []).length;
            Assert.strictEqual(matchCount, 1);
        }
    });

    test("Contract claims appears exactly once", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            const matchCount = (template.match(/Contract claims/g) ?? []).length;
            Assert.strictEqual(matchCount, 1);
        }
    });

    test("three section labels appear in order", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            const positions = [
                template.indexOf("Acceptance-criterion claims"),
                template.indexOf("Rule claims"),
                template.indexOf("Contract claims")
            ];
            Assert.deepStrictEqual(positions, [...positions].sort((a, b) => a - b));
        }
    });

    test("contains audit the full working tree", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("audit the full working tree"));
        }
    });

    test("frames the checklist as an internal audit, not an emitted deliverable", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("The checklist is your internal audit framework for discovering violations; it is not a deliverable you emit as final output."));
        }
    });

    test("the acceptance-criterion section numbers each criterion and defers to the verification protocol", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("Number each acceptance criterion as AC<n> and confirm it per the acceptance-criteria verification protocol above."));
        }
    });

    test("the checklist is self-contained — cites no evidence rule path", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "no evidence-report rule citation"(template) {
                Assert.strictEqual(template.includes("rules/ai/agents/evidence-report.md"), false);
            },
            "no claim-evidence-classification rule citation"(template) {
                Assert.strictEqual(template.includes("rules/ai/agents/evidence/claim-evidence-classification.md"), false);
            },
            "no enumerated-claim-coverage rule citation"(template) {
                Assert.strictEqual(template.includes("rules/ai/agents/evidence/enumerated-claim-coverage.md"), false);
            }
        }
    });

    test("does not contain deleted acceptance-criteria/criterion-evidence-classification path", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.strictEqual(template.includes("acceptance-criteria/criterion-evidence-classification"), false);
        }
    });

    test("does not contain deleted acceptance-criteria/enumerated-criterion-coverage path", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.strictEqual(template.includes("acceptance-criteria/enumerated-criterion-coverage"), false);
        }
    });

    test("five-condition FAIL block survives", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains adversarial header"(template) {
                Assert.ok(template.includes("Your job is adversarial: find why the working-tree changes FAIL"));
            },
            "keeps the exhaustiveness instruction"(template) {
                Assert.ok(template.includes("Exhaustiveness: do not stop at the first violation."));
            },
            "contains five numbered conditions"(template) {
                const blockStart = template.indexOf("You MUST check all five conditions below");
                const blockEnd = template.indexOf("Exhaustiveness:", blockStart);
                const block = template.substring(blockStart, blockEnd);
                const count = (block.match(/\n\d+\. /g) ?? []).length;
                Assert.strictEqual(count, 5);
            },
            "the fifth condition makes an un-honored in-scope behavior rule a FAIL"(template) {
                const blockStart = template.indexOf("You MUST check all five conditions below");
                const blockEnd = template.indexOf("Exhaustiveness:", blockStart);
                const block = template.substring(blockStart, blockEnd);
                Assert.ok(block.includes("A behavior rule from the behavior-rule list above whose `.spec/flanders` scope encloses the files the working-tree changes touch is not honored by the changes"));
            }
        }
    });

    test("the five FAIL conditions are byte-equal to the expected task-framed block", {
        ARRANGE() {
            return { expected: expectedReviewerFailConditions("the task", "The task spec is not satisfied.") };
        },
        ACT() {
            return reviewerFailConditionsBlock(prompts.reviewer);
        },
        ASSERT(block, { expected }) {
            Assert.strictEqual(block, expected);
        }
    });

    test("git boundary block is byte-equal to the previous version", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            const start = template.indexOf("Git boundary:");
            const end = template.indexOf("\n\n", start);
            const gitBoundary = template.substring(start, end);
            Assert.strictEqual(gitBoundary, "Git boundary: you are an inspection-only agent. You must not execute any git command that modifies repository state — no `git add`, `git commit`, `git stash`, `git reset`, `git restore`, `git checkout -b`, `git branch`, `git tag`, no edits under `.git/`, and no remote git operations. Read-only git commands (`git status`, `git diff`, `git log`, `git show`, `git blame`, `git ls-files`) are allowed and are how you should inspect the worker's changes. The full obligation lives in rules/ai/agents/no-git-writes.md.");
        }
    });

    test("spec-folder write boundary block is byte-equal to the four-folder wording", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            const start = template.indexOf("Spec-folder write boundary:");
            const end = template.indexOf("\n\n", start);
            const specBoundary = template.substring(start, end === -1 ? undefined : end);
            Assert.strictEqual(specBoundary, EXPECTED_SPEC_FOLDER_WRITE_BOUNDARY);
        }
    });
});

test.describe("prompts – reviewer – git-status change-set enumeration", test => {
    test("contains the git status --porcelain command", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("git status --porcelain"));
        }
    });

    test("obliges enumeration from git status as authoritative over task-named files", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains authoritative enumeration wording"(template) {
                Assert.ok(template.includes("authoritative, complete enumeration"));
            },
            "contains not-the-task-list wording"(template) {
                Assert.ok(template.includes("not the list of files the task happens to name"));
            }
        }
    });

    test("obliges inspection of every file in the enumerated set", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains inspect-every-file wording"(template) {
                Assert.ok(template.includes("Inspect each file the enumeration reports"));
            },
            "contains do-not-narrow wording"(template) {
                Assert.ok(template.includes("Do not narrow your inspection to the files the task references"));
            }
        }
    });

    test("obliges reading untracked created files directly from disk", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains read-from-disk wording"(template) {
                Assert.ok(template.includes("read the file directly from disk"));
            },
            "contains git-diff-does-not-surface wording"(template) {
                Assert.ok(template.includes("which `git diff` does not surface"));
            }
        }
    });

    test("makes the change-set enumeration unconditional", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains no non-git work-tree conditional"(template) {
                Assert.strictEqual(template.includes("not a git work tree"), false);
            },
            "contains the unconditional enumeration intro sentence exactly"(template) {
                Assert.ok(template.includes("You must derive the worker's complete change set from git, not from the task description alone:"));
            }
        }
    });

    test("cites the rule and the read-only boundary", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "cites the full rule path"(template) {
                Assert.ok(template.includes("rules/ai/review/reviewer-derives-change-set-from-git.md"));
            },
            "states read-only consistency with no-git-writes"(template) {
                Assert.ok(template.includes("read-only git operations, permitted under and consistent with"));
            }
        }
    });
});

test.describe("prompts – reviewer – empty change set judged against HEAD", test => {
    test("contains the new guidance for an empty enumerated change set", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "states the empty change set is not on its own a failure"(template) {
                Assert.ok(template.includes("the empty change set is not, on its own, a failure"));
            },
            "explicitly forbids recording a violation solely because the worker produced no diff"(template) {
                Assert.ok(template.includes("You must not record a violation for the sole reason that the worker produced no diff this cycle"));
            },
            "instructs judging acceptance criteria against the committed working tree at HEAD"(template) {
                Assert.ok(template.includes("Judge each acceptance criterion against the committed working tree at `HEAD`"));
            },
            "names the HEAD evidence sources — already-passed gates, an existing test, or full-tree inspection"(template) {
                Assert.ok(template.includes("through the build and test gates that already passed before this review, an existing test whose assertion a regression would trip, or your own inspection of the full working tree at `HEAD`, as the criterion allows"));
            },
            "forbids requiring evidence to originate from an uncommitted diff"(template) {
                Assert.ok(template.includes("and do not require its evidence to originate from an uncommitted diff"));
            },
            "states the verdict follows from the criteria not from the diff's size"(template) {
                Assert.ok(template.includes("The verdict follows from the criteria, not from the diff's size"));
            },
            "ties pass + empty error file + satisfied-at-HEAD together in one sentence"(template) {
                Assert.ok(template.includes("pass the task — creating your per-reviewer `error.log` empty as your final act — when every acceptance criterion is satisfied at `HEAD`"));
            },
            "states a passing verdict creates the per-reviewer error file empty"(template) {
                Assert.ok(template.includes("creating your per-reviewer `error.log` empty as your final act"));
            },
            "conditions the pass on every acceptance criterion being satisfied at HEAD"(template) {
                Assert.ok(template.includes("when every acceptance criterion is satisfied at `HEAD`"));
            },
            "limits recorded violations to criteria genuinely unsatisfied at HEAD"(template) {
                Assert.ok(template.includes("record a violation only for a genuinely unsatisfied criterion, contract, or rule at `HEAD`"));
            },
            "cites the empty-change-set rule"(template) {
                Assert.ok(template.includes("rules/ai/review/reviewer-empty-change-set-judged-against-head.md"));
            }
        }
    });

    test("the new guidance lives inside the 'Determining the worker's change set' section", {
        ARRANGE() {},
        ACT() {
            const heading = "## Determining the worker's change set";
            const start = prompts.reviewer.indexOf(heading);
            const end = prompts.reviewer.indexOf("\n\n## ", start + heading.length);
            return prompts.reviewer.substring(start, end);
        },
        ASSERTS: {
            "section opens with the change-set heading"(section) {
                Assert.ok(section.startsWith("## Determining the worker's change set"));
            },
            "section contains the empty-change-set opener"(section) {
                Assert.ok(section.includes("When the enumerated change set is empty"));
            },
            "section contains the not-on-its-own-a-failure phrase"(section) {
                Assert.ok(section.includes("the empty change set is not, on its own, a failure"));
            },
            "section contains the no-sole-diff-violation sentence"(section) {
                Assert.ok(section.includes("You must not record a violation for the sole reason that the worker produced no diff this cycle"));
            },
            "section contains the judge-against-HEAD instruction"(section) {
                Assert.ok(section.includes("Judge each acceptance criterion against the committed working tree at `HEAD`"));
            },
            "section contains the verdict-follows-from-criteria sentence"(section) {
                Assert.ok(section.includes("The verdict follows from the criteria, not from the diff's size"));
            },
            "section contains the combined pass+empty+satisfied-at-HEAD sentence"(section) {
                Assert.ok(section.includes("pass the task — creating your per-reviewer `error.log` empty as your final act — when every acceptance criterion is satisfied at `HEAD`"));
            },
            "section cites the empty-change-set rule"(section) {
                Assert.ok(section.includes("rules/ai/review/reviewer-empty-change-set-judged-against-head.md"));
            },
            "section does not bleed into the next H2"(section) {
                Assert.strictEqual(section.includes("## Available contracts"), false);
            }
        }
    });
});

test.describe("prompts – foreground execution boundary", test => {
    test("each subagent prompt cites rules/ai/agents/no-background-commands.md", {
        ARRANGE() {},
        ACT() { return prompts; },
        ASSERTS: {
            "detectBuildAndTest cites the rule"(p) {
                Assert.ok(p.detectBuildAndTest.includes("rules/ai/agents/no-background-commands.md"));
            },
            "worker cites the rule"(p) {
                Assert.ok(p.worker.includes("rules/ai/agents/no-background-commands.md"));
            },
            "reviewer cites the rule"(p) {
                Assert.ok(p.reviewer.includes("rules/ai/agents/no-background-commands.md"));
            }
        }
    });

    test("each subagent prompt contains the foreground obligation phrase", {
        ARRANGE() {},
        ACT() { return prompts; },
        ASSERTS: {
            "detectBuildAndTest contains 'in the foreground'"(p) {
                Assert.ok(p.detectBuildAndTest.includes("in the foreground"));
            },
            "worker contains 'in the foreground'"(p) {
                Assert.ok(p.worker.includes("in the foreground"));
            },
            "reviewer contains 'in the foreground'"(p) {
                Assert.ok(p.reviewer.includes("in the foreground"));
            }
        }
    });

    test("each subagent prompt forbids the run_in_background flag", {
        ARRANGE() {},
        ACT() { return prompts; },
        ASSERTS: {
            "detectBuildAndTest forbids run_in_background"(p) {
                Assert.ok(p.detectBuildAndTest.includes("run_in_background"));
            },
            "worker forbids run_in_background"(p) {
                Assert.ok(p.worker.includes("run_in_background"));
            },
            "reviewer forbids run_in_background"(p) {
                Assert.ok(p.reviewer.includes("run_in_background"));
            }
        }
    });

    test("foregroundBoundary is not a member of the prompts export", {
        ARRANGE() {},
        ACT() { return prompts; },
        ASSERT(p) {
            Assert.strictEqual((p as Record<string, unknown>).foregroundBoundary, undefined);
        }
    });

    test("foreground boundary block is byte-equal to the canonical wording in the worker prompt", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            const start = template.indexOf("Foreground execution boundary:");
            const end = template.indexOf("\n\n", start);
            const foreground = template.substring(start, end);
            Assert.strictEqual(foreground, "Foreground execution boundary: you run every command you execute in the foreground and keep your turn active until that command finishes and its result is in hand. This binds every command without exception — build scripts, test scripts, linters, and any other shell command; give a long-running command a tool timeout large enough to finish in the foreground rather than detaching it. Forbidden mechanisms include a tool call made with a background flag (for example `run_in_background: true`), shell-level detachment (a trailing `&`, `nohup`, `setsid`, `disown`, `start`, `Start-Process`, `Start-Job`), converting a timed-out foreground command into a background task, and ending your turn with a message that a spawned command is still running. The full obligation lives in rules/ai/agents/no-background-commands.md.");
        }
    });

    test("foreground boundary block is byte-equal to the canonical wording in the reviewer prompt", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            const start = template.indexOf("Foreground execution boundary:");
            const end = template.indexOf("\n\n", start);
            const foreground = template.substring(start, end === -1 ? undefined : end);
            Assert.strictEqual(foreground, "Foreground execution boundary: you run every command you execute in the foreground and keep your turn active until that command finishes and its result is in hand. This binds every command without exception — build scripts, test scripts, linters, and any other shell command; give a long-running command a tool timeout large enough to finish in the foreground rather than detaching it. Forbidden mechanisms include a tool call made with a background flag (for example `run_in_background: true`), shell-level detachment (a trailing `&`, `nohup`, `setsid`, `disown`, `start`, `Start-Process`, `Start-Job`), converting a timed-out foreground command into a background task, and ending your turn with a message that a spawned command is still running. The full obligation lives in rules/ai/agents/no-background-commands.md.");
        }
    });
});

test.describe("prompts – reviewer – relocated reviewer citations", test => {
    test("cites the two relocated rules at their new rules/ai/review/ paths", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "cites the relocated empty-change-set rule at its new path"(template) {
                Assert.ok(template.includes("rules/ai/review/reviewer-empty-change-set-judged-against-head.md"));
            },
            "cites the relocated derives-change-set rule at its new path"(template) {
                Assert.ok(template.includes("rules/ai/review/reviewer-derives-change-set-from-git.md"));
            }
        }
    });

    test("no longer cites either relocated rule at its old rules/ai/agents/ path", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "drops the old empty-change-set path"(template) {
                Assert.strictEqual(template.includes("rules/ai/agents/reviewer-empty-change-set-judged-against-head.md"), false);
            },
            "drops the old reviewer-enumerates-worker-changes path"(template) {
                Assert.strictEqual(template.includes("rules/ai/agents/reviewer-enumerates-worker-changes-via-git.md"), false);
            }
        }
    });

    test("retains the implement-specific citations that were not relocated", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("rules/ai/agents/no-git-writes.md"));
        }
    });
});

test.describe("reviewerMethodologyCore", test => {
    test("is a non-empty string", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERTS: {
            "is a string"(core) {
                Assert.strictEqual(typeof core, "string");
            },
            "is non-empty"(core) {
                Assert.ok(core.length > 0);
            }
        }
    });

    test("is citation-free — names no flanders-internal spec file", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERTS: {
            "matches no internal spec-path citation pattern"(core) {
                Assert.strictEqual(INTERNAL_SPEC_PATH_CITATION.test(core), false);
            },
            "contains no .md path at all"(core) {
                Assert.strictEqual(core.includes(".md"), false);
            },
            "drops the assert-via-public-surface citation the taxonomy used to carry"(core) {
                Assert.strictEqual(core.includes("assert-via-public-surface"), false);
            }
        }
    });

    test("states the change-set-determination obligation", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERTS: {
            "enumerates the change set with git status --porcelain"(core) {
                Assert.ok(core.includes("git status --porcelain"));
            },
            "requires inspecting every file in the set"(core) {
                Assert.ok(core.includes("Inspect every file in the set"));
            },
            "requires reading content the right way per file kind"(core) {
                Assert.ok(core.includes("Read content the right way per file kind"));
            }
        }
    });

    test("states the empty-change-set-judged-against-HEAD obligation", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERTS: {
            "an empty change set is not on its own a failure"(core) {
                Assert.ok(core.includes("the empty change set is not, on its own, a failure"));
            },
            "judges the spec against the committed working tree at HEAD"(core) {
                Assert.ok(core.includes("against the committed working tree at `HEAD`"));
            }
        }
    });

    test("states the FAIL-conditions, exhaustiveness, pattern-enumeration, and verification protocol", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERTS: {
            "lists exactly five FAIL conditions"(core) {
                const blockStart = core.indexOf("You MUST check all five conditions below");
                const blockEnd = core.indexOf("Exhaustiveness:", blockStart);
                const block = core.substring(blockStart, blockEnd);
                const count = (block.match(/\n\d+\. /g) ?? []).length;
                Assert.strictEqual(count, 5);
            },
            "demands exhaustive enumeration"(core) {
                Assert.ok(core.includes("Exhaustiveness:"));
            },
            "demands pattern-occurrence enumeration"(core) {
                Assert.ok(core.includes("Pattern-based violations require occurrence enumeration"));
            },
            "enumerates every spec element as its own item, expanding N independent facts into N items"(core) {
                Assert.ok(core.includes("a. Enumerate every spec element in the spec under review as a separate numbered item, explicitly in your reasoning; an item that enumerates N independent facts expands into N items."));
            },
            "confirms each enumerated item is satisfied and makes an unsatisfied item a violation"(core) {
                Assert.ok(core.includes("b. For each enumerated item, confirm the changes under review actually satisfy it. An item left unsatisfied is a violation, never waved through on \"the code looks right\"."));
            }
        }
    });

    test("the five FAIL conditions are byte-equal to the expected spec-under-review block", {
        ARRANGE() {
            return { expected: expectedReviewerFailConditions("the spec under review", "The spec under review is not satisfied.") };
        },
        ACT() {
            return reviewerFailConditionsBlock(reviewerMethodologyCore);
        },
        ASSERT(block, { expected }) {
            Assert.strictEqual(block, expected);
        }
    });

    test("is test-methodology-agnostic — carries no claim taxonomy and no test-adjudication methodology", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERTS: {
            "no toolchain-guarded branch, in any casing"(core) {
                Assert.strictEqual(core.toLowerCase().includes("toolchain-guarded"), false);
            },
            "no test-guarded branch, in any casing"(core) {
                Assert.strictEqual(core.toLowerCase().includes("test-guarded"), false);
            },
            "no review-adjudicated branch, in any casing"(core) {
                Assert.strictEqual(core.toLowerCase().includes("review-adjudicated"), false);
            },
            "no classify-every-claim opener"(core) {
                Assert.strictEqual(core.includes("Classify every claim by ONE question"), false);
            },
            "no regression-signal question"(core) {
                Assert.strictEqual(core.includes("regression-signal question"), false);
            },
            "no evidence-type-by-classification step"(core) {
                Assert.strictEqual(core.includes("evidence of the type that classification requires"), false);
            },
            "no test-coverage adequacy sentence"(core) {
                Assert.strictEqual(core.includes("cover every case and every fact"), false);
            },
            "no full test-body read paragraph"(core) {
                Assert.strictEqual(core.includes("Read the complete body of every test"), false);
            },
            "no counterfactual regression construction"(core) {
                Assert.strictEqual(core.includes("construct the simplest plausible regression"), false);
            }
        }
    });

    test("states the verdict-via-error-log obligation", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERTS: {
            "appends each violation"(core) {
                Assert.ok(core.includes("append every violation"));
            },
            "creates the file empty when there is no violation"(core) {
                Assert.ok(core.includes("as an empty file as your final act"));
            },
            "never records the verdict via streamed output"(core) {
                Assert.ok(core.includes("does not parse your output for a verdict token"));
            }
        }
    });

    test("supplies the methodology the implement reviewer is assembled from", {
        ARRANGE() {},
        ACT() {
            return { core: reviewerMethodologyCore, reviewer: prompts.reviewer };
        },
        ASSERTS: {
            "both carry the change-set enumeration command"({ core, reviewer }) {
                Assert.ok(core.includes("git status --porcelain") && reviewer.includes("git status --porcelain"));
            },
            "both carry the five-condition FAIL gate"({ core, reviewer }) {
                Assert.ok(core.includes("You MUST check all five conditions below") && reviewer.includes("You MUST check all five conditions below"));
            },
            "both carry the pattern-occurrence-enumeration discipline"({ core, reviewer }) {
                Assert.ok(core.includes("Pattern-based violations require occurrence enumeration") && reviewer.includes("Pattern-based violations require occurrence enumeration"));
            },
            "both carry the verdict-recording obligation"({ core, reviewer }) {
                Assert.ok(core.includes("does not parse your output for a verdict token") && reviewer.includes("does not parse your output for a verdict token"));
            }
        }
    });
});

test.describe("prompts – reviewer – referenced-obligation enumeration", test => {
    test("the implement reviewer carries the referenced-obligation enumeration paragraph verbatim", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(reviewer) {
            Assert.ok(reviewer.includes(REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH));
        }
    });

    test("the citation-free core carries the same referenced-obligation enumeration paragraph verbatim", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERT(core) {
            Assert.ok(core.includes(REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH));
        }
    });

    test("the implement reviewer enumerates each discrete obligation fact", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "requires enumerating discrete obligations before deciding conditions 2-5"(reviewer) {
                Assert.ok(reviewer.includes("Before deciding conditions 2, 3, 4, and 5 are met, enumerate the discrete obligations of each contract and rule in scope"));
            },
            "covers referenced contracts and rules plus corpus ones the reviewer judges should apply"(reviewer) {
                Assert.ok(reviewer.includes("every contract and rule the work references, plus every corpus contract, rule, or behavior rule you judge should have applied — as separate items, and confirm each obligation is actively applied in the changes"));
            },
            "forbids satisfying a multi-obligation contract or rule in general"(reviewer) {
                Assert.ok(reviewer.includes("is never satisfied by confirming the contract or rule \"in general\": each enumerated obligation is its own item with its own confirmation"));
            },
            "treats an unapplied or never-enumerated obligation as a violation"(reviewer) {
                Assert.ok(reviewer.includes("an obligation the changes leave unapplied, or that you never enumerated, is a violation"));
            },
            "expands an N-obligation reference into N items"(reviewer) {
                Assert.ok(reviewer.includes("A reference whose obligations enumerate N discrete facts expands into N items."));
            }
        }
    });

    test("the referenced-obligation paragraph sits with the exhaustiveness and pattern paragraphs, before the verification protocol", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "appears after the pattern-occurrence paragraph"(reviewer) {
                Assert.ok(reviewer.indexOf("Referenced-obligation enumeration.") > reviewer.indexOf("Pattern-based violations require occurrence enumeration"));
            },
            "appears before the acceptance-criteria verification protocol heading"(reviewer) {
                Assert.ok(reviewer.indexOf("Referenced-obligation enumeration.") < reviewer.indexOf("Acceptance-criteria verification protocol (mandatory before deciding PASS on condition 1):"));
            }
        }
    });

    test("the worker prompt does not carry the reviewer-only referenced-obligation paragraph", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(worker) {
            Assert.strictEqual(worker.includes("Referenced-obligation enumeration."), false);
        }
    });
});

test.describe("prompts – reviewer – every addition appears identically across surfaces and stays citation-free", test => {
    test("the referenced-obligation paragraph is surface-neutral — the same literal appears in both reviewer surfaces", {
        ARRANGE() {},
        ACT() { return { reviewer: prompts.reviewer, core: reviewerMethodologyCore }; },
        ASSERTS: {
            "the implement reviewer carries the exact fixture literal"({ reviewer }) {
                Assert.strictEqual(reviewer.includes(REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH), true);
            },
            "the citation-free core carries the exact same fixture literal"({ core }) {
                Assert.strictEqual(core.includes(REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH), true);
            },
            "neither surface carries a divergent surface-specific phrasing of the reference clause"({ reviewer, core }) {
                Assert.strictEqual(reviewer.includes("every contract and rule the task references") || reviewer.includes("every contract and rule the spec under review references") || core.includes("every contract and rule the task references") || core.includes("every contract and rule the spec under review references"), false);
            }
        }
    });

    test("the no-own-test-standard sentence is surface-neutral — the same literal appears in both reviewer surfaces", {
        ARRANGE() {},
        ACT() { return { reviewer: prompts.reviewer, core: reviewerMethodologyCore }; },
        ASSERTS: {
            "the implement reviewer carries the exact fixture literal"({ reviewer }) {
                Assert.strictEqual(reviewer.includes(NO_OWN_TEST_STANDARD_SENTENCE), true);
            },
            "the citation-free core carries the exact same fixture literal"({ core }) {
                Assert.strictEqual(core.includes(NO_OWN_TEST_STANDARD_SENTENCE), true);
            },
            "neither surface carries a divergent surface-specific phrasing of the standard clause"({ reviewer, core }) {
                Assert.strictEqual(reviewer.includes("for a criterion only where a contract or rule in scope") || core.includes("for a spec element only where a contract or rule in scope"), false);
            }
        }
    });

    test("the non-execution paragraph is surface-neutral — the same literal appears in both reviewer surfaces", {
        ARRANGE() {},
        ACT() { return { reviewer: prompts.reviewer, core: reviewerMethodologyCore }; },
        ASSERTS: {
            "the implement reviewer carries the exact fixture literal"({ reviewer }) {
                Assert.strictEqual(reviewer.includes(NON_EXECUTION_PARAGRAPH), true);
            },
            "the citation-free core carries the exact same fixture literal"({ core }) {
                Assert.strictEqual(core.includes(NON_EXECUTION_PARAGRAPH), true);
            },
            "neither surface carries a divergent surface-specific phrasing of the gates clause"({ reviewer, core }) {
                Assert.strictEqual(reviewer.includes("the worker's build and test gates") || core.includes("the session's build and test gates"), false);
            }
        }
    });

    test("the comment-adjudication paragraph is surface-neutral — the same literal appears in both reviewer surfaces", {
        ARRANGE() {},
        ACT() { return { reviewer: prompts.reviewer, core: reviewerMethodologyCore }; },
        ASSERTS: {
            "the implement reviewer carries the exact fixture literal"({ reviewer }) {
                Assert.strictEqual(reviewer.includes(COMMENT_ADJUDICATION_PARAGRAPH), true);
            },
            "the citation-free core carries the exact same fixture literal"({ core }) {
                Assert.strictEqual(core.includes(COMMENT_ADJUDICATION_PARAGRAPH), true);
            },
            "neither surface carries a divergent surface-specific phrasing of the change-set clause"({ reviewer, core }) {
                Assert.strictEqual(reviewer.includes("every comment the worker's changes add or modify") || reviewer.includes("every comment the changes under review add or modify") || core.includes("every comment the worker's changes add or modify") || core.includes("every comment the changes under review add or modify"), false);
            }
        }
    });

    test("all four additions carry no flanders-internal spec-path citation", {
        ARRANGE() {
            return {
                referenced: REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH,
                commentAdjudication: COMMENT_ADJUDICATION_PARAGRAPH,
                noOwnStandard: NO_OWN_TEST_STANDARD_SENTENCE,
                nonExecution: NON_EXECUTION_PARAGRAPH
            };
        },
        ACT(additions) { return additions; },
        ASSERTS: {
            "the referenced-obligation paragraph matches no internal spec-path citation"({ referenced }) {
                Assert.strictEqual(INTERNAL_SPEC_PATH_CITATION.test(referenced), false);
            },
            "the referenced-obligation paragraph contains no .md path at all"({ referenced }) {
                Assert.strictEqual(referenced.includes(".md"), false);
            },
            "the comment-adjudication paragraph matches no internal spec-path citation"({ commentAdjudication }) {
                Assert.strictEqual(INTERNAL_SPEC_PATH_CITATION.test(commentAdjudication), false);
            },
            "the comment-adjudication paragraph contains no .md path at all"({ commentAdjudication }) {
                Assert.strictEqual(commentAdjudication.includes(".md"), false);
            },
            "the no-own-test-standard sentence matches no internal spec-path citation"({ noOwnStandard }) {
                Assert.strictEqual(INTERNAL_SPEC_PATH_CITATION.test(noOwnStandard), false);
            },
            "the no-own-test-standard sentence contains no .md path at all"({ noOwnStandard }) {
                Assert.strictEqual(noOwnStandard.includes(".md"), false);
            },
            "the non-execution paragraph matches no internal spec-path citation"({ nonExecution }) {
                Assert.strictEqual(INTERNAL_SPEC_PATH_CITATION.test(nonExecution), false);
            },
            "the non-execution paragraph contains no .md path at all"({ nonExecution }) {
                Assert.strictEqual(nonExecution.includes(".md"), false);
            }
        }
    });
});

test.describe("prompts – code comment economy", test => {
    test("the worker prompt carries the code-comment discipline byte-equal, routed to the Evidence Report", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            const start = template.indexOf("Code comments:");
            const end = template.indexOf("\n\n", start);
            Assert.strictEqual(template.substring(start, end), expectedCodeCommentEconomy("your Evidence Report"));
        }
    });

    test("the code-comment discipline pins every obligation it carries", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "the code is tried before the comment is written"(template) {
                Assert.ok(template.includes("before you write a comment explaining the code, try to make the code itself say it"));
            },
            "the three ways of making the code say it are named"(template) {
                Assert.ok(template.includes("a clearer name, a type that carries the constraint, a construct extracted so its name replaces the explanation"));
            },
            "the comment is written only where none of those expresses it"(template) {
                Assert.ok(template.includes("and comment only where none of those expresses it,"));
            },
            "the attempt reaches no further than the code the change touches"(template) {
                Assert.ok(template.includes("reaching no further than the code your change already writes or modifies."));
            },
            "a comment states only what the code cannot show"(template) {
                Assert.ok(template.includes("A comment you write states only what the code cannot show — an external constraint, an invariant the code cannot enforce, or a consequence a competent reader of the code alone would get wrong"));
            },
            "the correctness argument is routed to the report"(template) {
                Assert.ok(template.includes("The argument that your change is correct,"));
            },
            "every citation target behind the change is routed to the report, behavior rules included"(template) {
                Assert.ok(template.includes("the criterion, contract, rule, behavior rule, task, or review finding behind it,"));
            },
            "the file:line an inspection should target is routed to the report"(template) {
                Assert.ok(template.includes("the `file:line` you want an inspection to target,"));
            },
            "history and pending migration are routed out of the source too"(template) {
                Assert.ok(template.includes("and what the code used to do or has yet to migrate belong in your Evidence Report, never in the source."));
            },
            "the content a project rule requires is written and the rest is held to the standard"(template) {
                Assert.ok(template.includes("Where a rule of the project requires a comment at a construct, you write the content it requires; the rest of that comment meets the same standard as any other."));
            }
        }
    });

    test("the code-comment discipline stays citation-free so the skill body can embed it", {
        ARRANGE() {},
        ACT() { return expectedCodeCommentEconomy("the report you give the user in chat"); },
        ASSERTS: {
            "it matches no internal spec-path citation"(block) {
                Assert.strictEqual(INTERNAL_SPEC_PATH_CITATION.test(block), false);
            },
            "it contains no .md path at all"(block) {
                Assert.strictEqual(block.includes(".md"), false);
            }
        }
    });

    test("no reviewer surface carries the code-authoring discipline, and no authoring surface carries the reviewer's adjudication", {
        ARRANGE() {},
        ACT() { return { worker: prompts.worker, reviewer: prompts.reviewer, core: reviewerMethodologyCore }; },
        ASSERTS: {
            "the implement reviewer does not instruct it to author comments"({ reviewer }) {
                Assert.strictEqual(reviewer.includes("Code comments:"), false);
            },
            "the citation-free reviewer core does not instruct it to author comments"({ core }) {
                Assert.strictEqual(core.includes("Code comments:"), false);
            },
            "the worker does not carry the reviewer's comment-adjudication paragraph"({ worker }) {
                Assert.strictEqual(worker.includes(COMMENT_ADJUDICATION_PARAGRAPH), false);
            },
            "the worker's discipline is not routed to a reviewer-facing channel"({ worker }) {
                Assert.strictEqual(worker.includes("belong in the report you give the user in chat"), false);
            }
        }
    });
});

test.describe("prompts – reviewer does not run build or test", test => {
    test("prompts.reviewer carries the surface-neutral non-execution paragraph", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains the non-execution paragraph verbatim"(reviewer) {
                Assert.ok(reviewer.includes(NON_EXECUTION_PARAGRAPH));
            },
            "states it makes no edit and runs no file-generating operation"(reviewer) {
                Assert.ok(reviewer.includes("You are inspection-only: you make no edit and run no operation that generates files."));
            },
            "states compiling and testing generate files, so it runs neither via any of the three channels"(reviewer) {
                Assert.ok(reviewer.includes("Compiling the project and running its tests both generate files, so you run neither the build command nor the test command — not directly, not through the project's package manager, and not through any wrapper."));
            },
            "assumes the build succeeded and the tests passed because the gates already ran against the changes"(reviewer) {
                Assert.ok(reviewer.includes("The build and test gates already passed against these changes before this review started, so you take the build as succeeding and the tests as passing without running them"));
            },
            "confirms a gate-catchable claim by naming the already-passed gate or test"(reviewer) {
                Assert.ok(reviewer.includes("you confirm a claim one of those gates would catch by naming that already-passed gate or test instead of executing it"));
            },
            "runs only the read-only git operations that derive the change set"(reviewer) {
                Assert.ok(reviewer.includes("The only commands you run are the read-only git operations that derive the change set."));
            }
        }
    });

    test("reviewerMethodologyCore states the same non-execution paragraph, citation-free", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERTS: {
            "contains the non-execution paragraph verbatim"(core) {
                Assert.ok(core.includes(NON_EXECUTION_PARAGRAPH));
            },
            "carries no flanders-internal spec-path citation"(core) {
                Assert.strictEqual(INTERNAL_SPEC_PATH_CITATION.test(core), false);
            },
            "carries no .md path at all"(core) {
                Assert.strictEqual(core.includes(".md"), false);
            }
        }
    });

    test("neither reviewer surface re-runs the toolchain or carries the worker-only step", {
        ARRANGE() {},
        ACT() { return { reviewer: prompts.reviewer, core: reviewerMethodologyCore }; },
        ASSERTS: {
            "prompts.reviewer omits the phrase re-run the toolchain"({ reviewer }) {
                Assert.strictEqual(reviewer.includes("re-run the toolchain"), false);
            },
            "reviewerMethodologyCore omits the phrase re-run the toolchain"({ core }) {
                Assert.strictEqual(core.includes("re-run the toolchain"), false);
            },
            "prompts.reviewer omits the worker-only step verbatim"({ reviewer }) {
                Assert.strictEqual(reviewer.includes(EXPECTED_WORKER_TOOLCHAIN_RERUN_STEP), false);
            },
            "reviewerMethodologyCore omits the worker-only step verbatim"({ core }) {
                Assert.strictEqual(core.includes(EXPECTED_WORKER_TOOLCHAIN_RERUN_STEP), false);
            },
            "prompts.reviewer omits the worker-only too-weak conclusion"({ reviewer }) {
                Assert.strictEqual(reviewer.includes("the assertion is too weak"), false);
            },
            "reviewerMethodologyCore omits the worker-only too-weak conclusion"({ core }) {
                Assert.strictEqual(core.includes("the assertion is too weak"), false);
            }
        }
    });

    test("prompts.worker keeps the worker-only toolchain-rerun step intact", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "contains the worker-only step verbatim"(worker) {
                Assert.ok(worker.includes(EXPECTED_WORKER_TOOLCHAIN_RERUN_STEP));
            },
            "the worker-only step ends with re-run the toolchain, and update the report."(worker) {
                Assert.ok(worker.includes("re-run the toolchain, and update the report."));
            }
        }
    });

    test("the prohibition is additive — five FAIL conditions and the verification protocol survive", {
        ARRANGE() {},
        ACT() { return { reviewer: prompts.reviewer, core: reviewerMethodologyCore }; },
        ASSERTS: {
            "reviewer retains the five-condition FAIL gate"({ reviewer }) {
                Assert.ok(reviewer.includes("You MUST check all five conditions below"));
            },
            "reviewer retains the acceptance-criteria verification protocol heading"({ reviewer }) {
                Assert.ok(reviewer.includes("Acceptance-criteria verification protocol"));
            },
            "core retains the five-condition FAIL gate"({ core }) {
                Assert.ok(core.includes("You MUST check all five conditions below"));
            },
            "core retains the spec-verification protocol heading"({ core }) {
                Assert.ok(core.includes("Spec-verification protocol"));
            }
        }
    });
});

test.describe("prompts – Flanders voice tone instruction", test => {
    test("the worker prompt carries the terse, English-only Flanders tone instruction", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "carries the worker tone-instruction block verbatim"(template) {
                Assert.ok(template.includes(EXPECTED_WORKER_TONE));
            },
            "instructs a light Ned-Flanders touch, described only in the abstract"(template) {
                Assert.ok(template.includes("use a light Ned-Flanders touch in your user-facing narration"));
            },
            "opens with the English-only language gate before introducing the flavor, and otherwise delivers plainly"(template) {
                Assert.ok(template.includes("When the language you are narrating in is English, use a light Ned-Flanders touch"));
                Assert.ok(template.includes("; deliver any other language plainly"));
            },
            "names no sample greeting exemplar"(template) {
                Assert.strictEqual(template.includes(`"neighbor"`), false);
            },
            "names no sample interjection exemplar"(template) {
                Assert.strictEqual(template.includes(`"okely-dokely"`), false);
            },
            "names no sample suffix exemplar"(template) {
                Assert.strictEqual(template.includes(`"-diddly-"`), false);
            },
            "keeps the flavor out of code, paths, command lines, diagnostics, machine-read tokens, and commit messages"(template) {
                Assert.ok(template.includes("Keep it out of code, file paths, command lines, diagnostics, machine-read tokens, git commit messages"));
            }
        }
    });

    test("the worker tone instruction omits the reviewer-only carve-out", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "does not exclude the reviewer's recorded violation entries"(template) {
                Assert.strictEqual(template.includes("the violation entries you record in your error-log file"), false);
            }
        }
    });

    test("the reviewer prompt carries the terse Flanders tone instruction with the violation-entry carve-out", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "carries the reviewer tone-instruction block verbatim"(template) {
                Assert.ok(template.includes(EXPECTED_REVIEWER_TONE));
            },
            "instructs a light Ned-Flanders touch, described only in the abstract"(template) {
                Assert.ok(template.includes("use a light Ned-Flanders touch in your user-facing narration"));
            },
            "opens with the English-only language gate before introducing the flavor, and otherwise delivers plainly"(template) {
                Assert.ok(template.includes("When the language you are narrating in is English, use a light Ned-Flanders touch"));
                Assert.ok(template.includes("; deliver any other language plainly"));
            },
            "names no sample greeting exemplar"(template) {
                Assert.strictEqual(template.includes(`"neighbor"`), false);
            },
            "names no sample interjection exemplar"(template) {
                Assert.strictEqual(template.includes(`"okely-dokely"`), false);
            },
            "names no sample suffix exemplar"(template) {
                Assert.strictEqual(template.includes(`"-diddly-"`), false);
            },
            "keeps the flavor out of the shared technical surfaces"(template) {
                Assert.ok(template.includes("Keep it out of code, file paths, command lines, diagnostics, machine-read tokens, git commit messages"));
            },
            "excludes the violation entries it records in its error-log file"(template) {
                Assert.ok(template.includes(", and the violation entries you record in your error-log file."));
            }
        }
    });

    test("the reviewer tone instruction leaves the error-log verdict mechanics to the methodology", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "the tone instruction no longer restates the verdict mechanics"(template) {
                Assert.strictEqual(template.includes("The flavor never changes how you record your verdict"), false);
            },
            "the canonical create-empty-file verdict paragraph still survives unchanged"(template) {
                const start = template.indexOf("When your audit finds no violation");
                const end = template.indexOf("\n\n", start);
                const paragraph = template.substring(start, end);
                Assert.strictEqual(paragraph, "When your audit finds no violation across every verification, you must still create `<ERROR_LOG_PATH>` as an empty file as your final act, so the file always exists once you have reached a verdict. Do not write a pass confirmation or any non-violation content into that file; any content there is read as a failure.");
            },
            "the canonical output-not-parsed verdict sentence still survives"(template) {
                Assert.ok(template.includes("The orchestrator does not parse your output for a verdict token."));
            }
        }
    });

    test("the tone instruction does not displace the shared reviewer methodology core", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERTS: {
            "the citation-free core does not carry the Voice heading"(core) {
                Assert.strictEqual(core.includes("## Voice"), false);
            },
            "the citation-free core does not carry the tone-instruction prose"(core) {
                Assert.strictEqual(core.includes("Ned-Flanders touch"), false);
            }
        }
    });
});
