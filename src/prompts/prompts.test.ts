import * as Assert from "assert";

import test from "arrange-act-assert";

import { prompts, reviewerMethodologyCore, linkedReferenceDirective } from "./prompts";
import { REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH, TEST_GUARDED_COVERAGE_SENTENCE } from "./reviewerMethodology.fixtures";

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

// The citation-free core the shared reviewer-methodology core embeds: the canonical core with
// its single flanders-internal citation removed.
const EXPECTED_CLAIM_CLASSIFICATION_CORE_CITATION_FREE = EXPECTED_CLAIM_CLASSIFICATION_CORE.replace(
    " per `rules/testing/assert-via-public-surface.md`",
    ""
);

// The surface-neutral build/test prohibition every Flanders adversarial reviewer carries.
const EXPECTED_REVIEWER_BUILD_TEST_PROHIBITION = "You do not run the build command or the test command to establish any of this — not directly, not through the project's package manager, and not through any wrapper. By the time you review, the build and test gates have already passed against the changes under review, so you rely on that already-green result instead of producing it again: you confirm a toolchain-guarded claim by naming the automated failure — a build, type, link, lint, or runtime failure — that a regression would trigger, and you confirm a test-guarded claim by naming the asserting test whose assertion a regression would trip. The only commands you run are the read-only git operations that derive the change set.";

const EXPECTED_WORKER_RULE_CLAIMS_PARAGRAPH = "For every in-scope rule, one entry. A rule is in scope when it is either (a) explicitly linked by the task, or (b) triggered by your diff per `rules/ai/agents/evidence/scope-driven-self-audit.md`. The two sets are unioned; the diff-driven scope is additive on top of the link list, never a replacement. Each entry carries the rule's namespace (its path relative to the project root), the trigger (which part of the diff or which task link brought it into scope), and the evidence of compliance classified by the same regression-signal question. Rule obligations of the absence-of-a-pattern shape are classified by observability: a test-observable absence needs a search-based or recorded-call assertion that confirms zero matches over the observable surface, while a source-text structural absence or semantic-judgment absence is review-adjudicated and must not be guarded by a test that reads source as text. A rule whose obligation enumerates N distinct prohibited or required patterns expands into N independent entries per `rules/ai/agents/evidence/enumerated-claim-coverage.md`.";

// The Flanders-voice tone instruction the worker and reviewer prompts carry. Composed exactly
// as the production helper composes it: a shared prose head, a shared tail, and — for the
// reviewer only — the violation-entry exclusion spliced in before the tail and the verdict
// reminder appended after it.
const EXPECTED_TONE_PROSE_HEAD =
`## Voice

Season your user-facing narration — the prose you stream as you work — with a soft Ned-Flanders touch in every message: a gentle note of the character's warm, folksy, good-natured manner, so the voice is a steady, recognizable presence across the whole run rather than a rare flourish, the one exception being a message you address to the user in a language other than English, which is delivered plainly with no touch. Keep it light — typically a single touch per message, never on every line and never exaggerated — and never let the flavor change the substance, structure, or accuracy of anything you say. Apply the flavor only while the language you are narrating in is English, the character's original language; in any other language, apply no flavor and deliver the message plainly. The flavor lives only in flowing prose: it never appears in code, file paths, directory names, command lines, flag or option tokens, the factual content of a diagnostic or error message (the problem described, the path, the line number, and every other datum needed to act on it), any token another part of the tool reads programmatically, git commit messages`;

const EXPECTED_TONE_TAIL = " — all of which stay exact and as actionable as before.";

const EXPECTED_WORKER_TONE = `${EXPECTED_TONE_PROSE_HEAD}${EXPECTED_TONE_TAIL}`;

const EXPECTED_REVIEWER_TONE = `${EXPECTED_TONE_PROSE_HEAD}, or the violation entries you record in your error-log file${EXPECTED_TONE_TAIL} The flavor never changes how you record your verdict: you still append every violation to your error-log file, an empty file still means a clean pass, and your verdict is never carried by your streamed output or your exit code.`;

function claimClassificationBlock(template: string, endMarker: string) {
    const start = template.indexOf("Classify every claim by ONE question:");
    const end = template.indexOf(endMarker, start);
    return template.substring(start, end);
}

// Extract just the classification core (the three branches, the observability paragraph, and
// the N-independent-facts paragraph) from any prompt that embeds it, stopping at the shared
// closing sentence so neither the worker-only step nor the reviewer prohibition is included.
function claimClassificationCoreBlock(template: string) {
    const start = template.indexOf("Classify every claim by ONE question:");
    const endMarker = "An enumerated-minimum guard list is a floor, never a ceiling.";
    const end = template.indexOf(endMarker, start) + endMarker.length;
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

test.describe("prompts – reviewer – acceptance-criteria classification taxonomy", test => {
    test("contains the three classification branches", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
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
            }
        }
    });

    test("shares the classification core with the worker but carries it without the worker-only step", {
        ARRANGE() {},
        ACT() {
            return {
                workerCore: claimClassificationCoreBlock(prompts.worker),
                reviewerCore: claimClassificationCoreBlock(prompts.reviewer),
                methodologyCore: claimClassificationCoreBlock(reviewerMethodologyCore)
            };
        },
        ASSERTS: {
            "worker core is byte-equal to the canonical citation-bearing core"(cores) {
                Assert.strictEqual(cores.workerCore, EXPECTED_CLAIM_CLASSIFICATION_CORE);
            },
            "reviewer core is byte-equal to the canonical citation-bearing core"(cores) {
                Assert.strictEqual(cores.reviewerCore, EXPECTED_CLAIM_CLASSIFICATION_CORE);
            },
            "methodology core is the canonical core with the citation stripped"(cores) {
                Assert.strictEqual(cores.methodologyCore, EXPECTED_CLAIM_CLASSIFICATION_CORE_CITATION_FREE);
            },
            "reviewer core matches the worker core"(cores) {
                Assert.strictEqual(cores.reviewerCore, cores.workerCore);
            }
        }
    });

    test("old reviewer category list is removed", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
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

    test("contains the claim-flavored distinctive text", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("every claim by ONE question"));
        }
    });

    test("does not contain old criterion-flavored distinctive text", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.strictEqual(template.includes("every acceptance criterion by ONE question"), false);
        }
    });

    test("special shape guidance is classified by observability", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
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

    test("references rules/ai/agents/evidence-report.md", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("rules/ai/agents/evidence-report.md"));
        }
    });

    test("references rules/ai/agents/evidence/claim-evidence-classification.md", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("rules/ai/agents/evidence/claim-evidence-classification.md"));
        }
    });

    test("references rules/ai/agents/evidence/enumerated-claim-coverage.md", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("rules/ai/agents/evidence/enumerated-claim-coverage.md"));
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
            "states evidence is drawn per each criterion's classification"(template) {
                Assert.ok(template.includes("drawing the evidence each criterion's classification requires"));
            },
            "names the toolchain-guarded HEAD evidence source"(template) {
                Assert.ok(template.includes("for a toolchain-guarded criterion, the automated signal the project already runs"));
            },
            "names the test-guarded HEAD evidence source"(template) {
                Assert.ok(template.includes("for a test-guarded criterion, an existing passing test whose assertion a regression would trip"));
            },
            "names the review-adjudicated HEAD evidence source"(template) {
                Assert.ok(template.includes("for a review-adjudicated criterion, your inspection of the full working tree at `HEAD`"));
            },
            "forbids requiring evidence to originate from an uncommitted diff"(template) {
                Assert.ok(template.includes("You must not require a criterion's evidence to originate from an uncommitted diff"));
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
                Assert.ok(template.includes("record a violation only for an acceptance criterion, contract, or rule that is genuinely unsatisfied at `HEAD`"));
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
        ASSERTS: {
            "still cites no-git-writes"(template) {
                Assert.ok(template.includes("rules/ai/agents/no-git-writes.md"));
            },
            "still cites the evidence-report checklist rule"(template) {
                Assert.ok(template.includes("rules/ai/agents/evidence-report.md"));
            },
            "still cites the claim-evidence-classification rule"(template) {
                Assert.ok(template.includes("rules/ai/agents/evidence/claim-evidence-classification.md"));
            },
            "still cites the enumerated-claim-coverage rule"(template) {
                Assert.ok(template.includes("rules/ai/agents/evidence/enumerated-claim-coverage.md"));
            },
            "still cites assert-via-public-surface inside the implement claim taxonomy"(template) {
                Assert.ok(template.includes("rules/testing/assert-via-public-surface.md"));
            }
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
            "classifies each element by the regression-signal question"(core) {
                Assert.ok(core.includes("what kind of signal would soundly observe a plausible regression of the claim?"));
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

test.describe("prompts – reviewer – test-guarded coverage requirement", test => {
    test("the implement reviewer carries the test-guarded coverage sentence verbatim", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(reviewer) {
            Assert.ok(reviewer.includes(TEST_GUARDED_COVERAGE_SENTENCE));
        }
    });

    test("the citation-free core carries the same test-guarded coverage sentence verbatim", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERT(core) {
            Assert.ok(core.includes(TEST_GUARDED_COVERAGE_SENTENCE));
        }
    });

    test("the implement reviewer enumerates each discrete test-guarded coverage fact", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "requires the named test's assertions to cover every case and every fact"(reviewer) {
                Assert.ok(reviewer.includes("classified test-guarded is confirmed satisfied only when the named test's assertions cover every case and every fact the element requires"));
            },
            "states the existence of a test is not enough"(reviewer) {
                Assert.ok(reviewer.includes("the existence of a test for the element is not enough"));
            },
            "treats a left-unguarded required case as a violation never waved through by inspection"(reviewer) {
                Assert.ok(reviewer.includes("while leaving a required case unguarded does not satisfy it — the uncovered case is a violation, never waved through as holding \"by inspection\"."));
            }
        }
    });

    test("the test-guarded coverage sentence sits inside the verification protocol, before the classification taxonomy", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "appears after the acceptance-criteria verification protocol heading"(reviewer) {
                Assert.ok(reviewer.indexOf("A spec element classified test-guarded is confirmed satisfied only when") > reviewer.indexOf("Acceptance-criteria verification protocol (mandatory before deciding PASS on condition 1):"));
            },
            "appears before the classification taxonomy"(reviewer) {
                Assert.ok(reviewer.indexOf("A spec element classified test-guarded is confirmed satisfied only when") < reviewer.indexOf("Classify every claim by ONE question:"));
            }
        }
    });

    test("the worker prompt does not carry the reviewer-only test-guarded coverage sentence", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(worker) {
            Assert.strictEqual(worker.includes("classified test-guarded is confirmed satisfied only when the named test's assertions"), false);
        }
    });
});

test.describe("prompts – reviewer – both additions appear identically across surfaces and stay citation-free", test => {
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

    test("the test-guarded coverage sentence is surface-neutral — the same literal appears in both reviewer surfaces", {
        ARRANGE() {},
        ACT() { return { reviewer: prompts.reviewer, core: reviewerMethodologyCore }; },
        ASSERTS: {
            "the implement reviewer carries the exact fixture literal"({ reviewer }) {
                Assert.strictEqual(reviewer.includes(TEST_GUARDED_COVERAGE_SENTENCE), true);
            },
            "the citation-free core carries the exact same fixture literal"({ core }) {
                Assert.strictEqual(core.includes(TEST_GUARDED_COVERAGE_SENTENCE), true);
            },
            "neither surface carries a divergent surface-specific phrasing of the coverage clause"({ reviewer, core }) {
                Assert.strictEqual(reviewer.includes("the criterion requires") || core.includes("the criterion requires"), false);
            }
        }
    });

    test("both additions carry no flanders-internal spec-path citation", {
        ARRANGE() {
            return {
                referenced: REFERENCED_OBLIGATION_ENUMERATION_PARAGRAPH,
                coverage: TEST_GUARDED_COVERAGE_SENTENCE
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
            "the test-guarded coverage sentence matches no internal spec-path citation"({ coverage }) {
                Assert.strictEqual(INTERNAL_SPEC_PATH_CITATION.test(coverage), false);
            },
            "the test-guarded coverage sentence contains no .md path at all"({ coverage }) {
                Assert.strictEqual(coverage.includes(".md"), false);
            }
        }
    });
});

test.describe("prompts – reviewer does not run build or test", test => {
    test("prompts.reviewer carries the surface-neutral build/test prohibition", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains the prohibition paragraph verbatim"(reviewer) {
                Assert.ok(reviewer.includes(EXPECTED_REVIEWER_BUILD_TEST_PROHIBITION));
            },
            "states it runs no build or test command via any of the three channels"(reviewer) {
                Assert.ok(reviewer.includes("You do not run the build command or the test command to establish any of this — not directly, not through the project's package manager, and not through any wrapper."));
            },
            "confirms a toolchain-guarded claim by naming the automated failure"(reviewer) {
                Assert.ok(reviewer.includes("you confirm a toolchain-guarded claim by naming the automated failure"));
            },
            "confirms a test-guarded claim by naming the asserting test a regression would trip"(reviewer) {
                Assert.ok(reviewer.includes("you confirm a test-guarded claim by naming the asserting test whose assertion a regression would trip"));
            },
            "relies on the build and test gates that already passed before the review"(reviewer) {
                Assert.ok(reviewer.includes("the build and test gates have already passed against the changes under review, so you rely on that already-green result"));
            }
        }
    });

    test("reviewerMethodologyCore states the same prohibition, citation-free", {
        ARRANGE() {},
        ACT() { return reviewerMethodologyCore; },
        ASSERTS: {
            "contains the prohibition paragraph verbatim"(core) {
                Assert.ok(core.includes(EXPECTED_REVIEWER_BUILD_TEST_PROHIBITION));
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
    test("the worker prompt carries the soft, language-matched Flanders tone instruction", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERTS: {
            "carries the worker tone-instruction block verbatim"(template) {
                Assert.ok(template.includes(EXPECTED_WORKER_TONE));
            },
            "instructs a soft Ned-Flanders touch in every message, described only in the abstract"(template) {
                Assert.ok(template.includes("with a soft Ned-Flanders touch in every message: a gentle note of the character's warm, folksy, good-natured manner"));
            },
            "limits the flavor to a single touch per message"(template) {
                Assert.ok(template.includes("typically a single touch per message"));
            },
            "the lead sentence carries the single plain-delivery exception"(template) {
                Assert.ok(template.includes("rather than a rare flourish, the one exception being a message you address to the user in a language other than English, which is delivered plainly with no touch."));
            },
            "applies the flavor only in English and otherwise delivers plainly"(template) {
                Assert.ok(template.includes("Apply the flavor only while the language you are narrating in is English, the character's original language; in any other language, apply no flavor and deliver the message plainly."));
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
            "keeps the flavor light — never on every line and never exaggerated"(template) {
                Assert.ok(template.includes("never on every line and never exaggerated"));
            },
            "excludes code, file paths, directory names, command lines, and flag tokens"(template) {
                Assert.ok(template.includes("it never appears in code, file paths, directory names, command lines, flag or option tokens"));
            },
            "excludes the factual content of a diagnostic"(template) {
                Assert.ok(template.includes("the factual content of a diagnostic or error message (the problem described, the path, the line number, and every other datum needed to act on it)"));
            },
            "excludes machine-read tokens"(template) {
                Assert.ok(template.includes("any token another part of the tool reads programmatically"));
            },
            "excludes git commit messages"(template) {
                Assert.ok(template.includes("git commit messages"));
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

    test("the reviewer prompt carries the soft, language-matched Flanders tone instruction with the violation-entry carve-out", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "carries the reviewer tone-instruction block verbatim"(template) {
                Assert.ok(template.includes(EXPECTED_REVIEWER_TONE));
            },
            "instructs a soft Ned-Flanders touch in every message, described only in the abstract"(template) {
                Assert.ok(template.includes("with a soft Ned-Flanders touch in every message: a gentle note of the character's warm, folksy, good-natured manner"));
            },
            "limits the flavor to a single touch per message"(template) {
                Assert.ok(template.includes("typically a single touch per message"));
            },
            "applies the flavor only in English and otherwise delivers plainly"(template) {
                Assert.ok(template.includes("Apply the flavor only while the language you are narrating in is English, the character's original language; in any other language, apply no flavor and deliver the message plainly."));
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
                Assert.ok(template.includes("it never appears in code, file paths, directory names, command lines, flag or option tokens"));
                Assert.ok(template.includes("the factual content of a diagnostic or error message"));
                Assert.ok(template.includes("any token another part of the tool reads programmatically"));
            },
            "excludes the violation entries it records in its error-log file"(template) {
                Assert.ok(template.includes(", or the violation entries you record in your error-log file"));
            },
            "excludes git commit messages"(template) {
                Assert.ok(template.includes("git commit messages"));
            }
        }
    });

    test("the reviewer tone instruction leaves the error-log verdict mechanics intact and uncontradicted", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "the tone instruction reaffirms append-every-violation to the error-log file"(template) {
                Assert.ok(template.includes("you still append every violation to your error-log file"));
            },
            "the tone instruction reaffirms an empty file means a clean pass"(template) {
                Assert.ok(template.includes("an empty file still means a clean pass"));
            },
            "the tone instruction reaffirms the verdict is never carried by streamed output or exit code"(template) {
                Assert.ok(template.includes("your verdict is never carried by your streamed output or your exit code"));
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
