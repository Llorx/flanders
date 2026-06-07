import * as Assert from "assert";

import test from "arrange-act-assert";

import { prompts } from "./prompts";

const EXPECTED_CLAIM_CLASSIFICATION =
`Classify every claim by ONE question: what kind of signal would soundly observe a plausible regression of the claim? Place the claim in exactly one of these three branches, and name the concrete observer the branch requires — an automated failure, an asserting test, or reviewer inspection.

- **Toolchain-guarded** — a plausible regression triggers an automated failure signal WITHOUT any new test being added: a build error, a type error, a linker error, a linter or other static-analysis error from a checker the project actually runs, an existing test failing, or a runtime crash on a code path the test suite already exercises. The evidence is a \`file:line\` citation in the change plus the name of the automated failure a regression would trigger. A linter signal qualifies only when the project actually runs that linter as part of its build or test flow.
- **Test-guarded** — no toolchain signal observes the regression, but the property is observable through the public behavioral surface a test may inspect per \`rules/testing/assert-via-public-surface.md\`: return values, fired callbacks, side effects recorded on injected dependencies, externally observable state, or an artifact the test legitimately constructs and reads back. The evidence is the test's \`file:line\`, the asserting call, and a one-sentence regression argument. "The behavior is correct in the current code" is never sufficient on its own here.
- **Review-adjudicated** — no toolchain signal observes the regression AND the property cannot be observed through the test surface without reading the subject's source as text or piercing its encapsulation. Source-text structural invariants and semantic-judgment properties are verified by the adversarial reviewer's per-iteration inspection of the working tree. The evidence is a \`file:line\` citation plus the explicit statement that the reviewer verifies the property by inspection because it has neither an automated signal nor a test-surface observation. Do not fabricate a test that reads the module's own source as text to guard such a claim.

Literal content, absence of a pattern, order, and count are classified by observability. When the property is observable through the public surface, it is test-guarded and needs an exact-match, zero-match or recorded-call, positional, or counting assertion that would fail under the regression. When the property is observable only by reading the subject's source as text, it is review-adjudicated. Semantic-judgment properties are always review-adjudicated.

A claim that enumerates N independent facts ("X AND Y AND Z", "items A, B, C, D") needs N independent guards; evidence covering only K of N facts (K < N) leaves the uncovered facts unguarded even when they currently hold. An enumerated-minimum guard list is a floor, never a ceiling.

When a test-guarded regression argument cannot be soundly constructed — the asserting call would still pass under a regression the claim forbids — the assertion is too weak: strengthen it (typically by replacing substring, prefix, or inclusion checks with exact-match comparisons on literal values), re-run the toolchain, and update the report.`;

const EXPECTED_WORKER_RULE_CLAIMS_PARAGRAPH = "For every in-scope rule, one entry. A rule is in scope when it is either (a) explicitly linked by the task, or (b) triggered by your diff per `rules/ai/agents/evidence/scope-driven-self-audit.md`. The two sets are unioned; the diff-driven scope is additive on top of the link list, never a replacement. Each entry carries the rule's namespace (relative path inside `rules/`), the trigger (which part of the diff or which task link brought it into scope), and the evidence of compliance classified by the same regression-signal question. Rule obligations of the absence-of-a-pattern shape are classified by observability: a test-observable absence needs a search-based or recorded-call assertion that confirms zero matches over the observable surface, while a source-text structural absence or semantic-judgment absence is review-adjudicated and must not be guarded by a test that reads source as text. A rule whose obligation enumerates N distinct prohibited or required patterns expands into N independent entries per `rules/ai/agents/evidence/enumerated-claim-coverage.md`.";

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

    test("spec-folder write boundary block is byte-equal to the previous version", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            const start = template.indexOf("Spec-folder write boundary:");
            const end = template.indexOf("\n\n", start);
            const specBoundary = template.substring(start, end);
            Assert.strictEqual(specBoundary, "Spec-folder write boundary: you must not create, modify, delete, or rename any file inside `contracts/`, `rules/`, or `plans/`. These folders are governed by dedicated skills and the implement command's bounded checkpoint updates; no other agent may write to them. See shared/spec-folder-write-authority.md for the full obligation.");
        }
    });

    test("Adversarial review awaits block lists exactly four FAIL conditions", {
        ARRANGE() {},
        ACT() { return prompts.worker; },
        ASSERT(template) {
            const blockStart = template.indexOf("The reviewer is instructed to FAIL on ANY of:");
            const blockEnd = template.indexOf("Condition 4 causes most rejections", blockStart);
            const block = template.substring(blockStart, blockEnd);
            const count = (block.match(/\n\d+\. /g) ?? []).length;
            Assert.strictEqual(count, 4);
        }
    });
});

test.describe("prompts – reviewer", test => {
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

    test("contains ERROR_LOG_PATH placeholder", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("<ERROR_LOG_PATH>"));
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
            },
            "test-guarded regression-argument soundness step"(template) {
                Assert.ok(template.includes("When a test-guarded regression argument cannot be soundly constructed"));
            }
        }
    });

    test("shares the exact taxonomy block with the worker prompt", {
        ARRANGE() {},
        ACT() {
            const workerBlock = claimClassificationBlock(prompts.worker, "\n\n   **Rule claims**");
            const reviewerBlock = claimClassificationBlock(prompts.reviewer, "\n\n## Review protocol");
            return { workerBlock, reviewerBlock };
        },
        ASSERTS: {
            "worker block is byte-equal to the canonical wording"(blocks) {
                Assert.strictEqual(blocks.workerBlock, EXPECTED_CLAIM_CLASSIFICATION);
            },
            "reviewer block is byte-equal to the canonical wording"(blocks) {
                Assert.strictEqual(blocks.reviewerBlock, EXPECTED_CLAIM_CLASSIFICATION);
            },
            "reviewer block matches the worker block"(blocks) {
                Assert.strictEqual(blocks.reviewerBlock, blocks.workerBlock);
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

    test("contains the test-guarded regression-argument-soundness conclusion", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            Assert.ok(template.includes("the assertion is too weak"));
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

    test("four-condition FAIL block survives", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains adversarial header"(template) {
                Assert.ok(template.includes("Your job is adversarial: find why the working-tree changes FAIL"));
            },
            "contains four numbered conditions"(template) {
                const blockStart = template.indexOf("You MUST check all four conditions below");
                const blockEnd = template.indexOf("Exhaustiveness:", blockStart);
                const block = template.substring(blockStart, blockEnd);
                const count = (block.match(/\n\d+\. /g) ?? []).length;
                Assert.strictEqual(count, 4);
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

    test("spec-folder write boundary block is byte-equal to the previous version", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            const start = template.indexOf("Spec-folder write boundary:");
            const end = template.indexOf("\n\n", start);
            const specBoundary = template.substring(start, end === -1 ? undefined : end);
            Assert.strictEqual(specBoundary, "Spec-folder write boundary: you must not create, modify, delete, or rename any file inside `contracts/`, `rules/`, or `plans/`. These folders are governed by dedicated skills and the implement command's bounded checkpoint updates; no other agent may write to them. See shared/spec-folder-write-authority.md for the full obligation.");
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

    test("contains the non-git fallback statement", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "contains the imposes-nothing clause"(template) {
                Assert.ok(template.includes("When the project is not a git work tree, this obligation imposes nothing"));
            },
            "contains the fallback-to-task-files clause"(template) {
                Assert.ok(template.includes("you fall back to the files the task references"));
            }
        }
    });

    test("cites the rule and the read-only boundary", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERTS: {
            "cites the full rule path"(template) {
                Assert.ok(template.includes("rules/ai/agents/reviewer-enumerates-worker-changes-via-git.md"));
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
            "instructs judging acceptance criteria against the committed working tree at HEAD"(template) {
                Assert.ok(template.includes("Judge each acceptance criterion against the committed working tree at `HEAD`"));
            },
            "forbids requiring evidence to originate from an uncommitted diff"(template) {
                Assert.ok(template.includes("You must not require a criterion's evidence to originate from an uncommitted diff"));
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
                Assert.ok(template.includes("rules/ai/agents/reviewer-empty-change-set-judged-against-head.md"));
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
            },
            "prep cites the rule"(p) {
                Assert.ok(p.prep.includes("rules/ai/agents/no-background-commands.md"));
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
            },
            "prep contains 'in the foreground'"(p) {
                Assert.ok(p.prep.includes("in the foreground"));
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
            },
            "prep forbids run_in_background"(p) {
                Assert.ok(p.prep.includes("run_in_background"));
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
            Assert.strictEqual(foreground, "Foreground execution boundary: you run every command you execute in the foreground and keep your turn active until that command finishes and its result is in hand. You must not start any command in the background and must not end your turn while a command you spawned is still running. This binds every command without exception — build scripts, test scripts, linters, and any other shell command; give a long-running command a tool timeout large enough to finish in the foreground rather than detaching it. Forbidden mechanisms include a tool call made with a background flag (for example `run_in_background: true`), shell-level detachment (a trailing `&`, `nohup`, `setsid`, `disown`, `start`, `Start-Process`, `Start-Job`), converting a timed-out foreground command into a background task, and ending your turn with a message that a spawned command is still running. The full obligation lives in rules/ai/agents/no-background-commands.md.");
        }
    });

    test("foreground boundary block is byte-equal to the canonical wording in the reviewer prompt", {
        ARRANGE() {},
        ACT() { return prompts.reviewer; },
        ASSERT(template) {
            const start = template.indexOf("Foreground execution boundary:");
            const end = template.indexOf("\n\n", start);
            const foreground = template.substring(start, end === -1 ? undefined : end);
            Assert.strictEqual(foreground, "Foreground execution boundary: you run every command you execute in the foreground and keep your turn active until that command finishes and its result is in hand. You must not start any command in the background and must not end your turn while a command you spawned is still running. This binds every command without exception — build scripts, test scripts, linters, and any other shell command; give a long-running command a tool timeout large enough to finish in the foreground rather than detaching it. Forbidden mechanisms include a tool call made with a background flag (for example `run_in_background: true`), shell-level detachment (a trailing `&`, `nohup`, `setsid`, `disown`, `start`, `Start-Process`, `Start-Job`), converting a timed-out foreground command into a background task, and ending your turn with a message that a spawned command is still running. The full obligation lives in rules/ai/agents/no-background-commands.md.");
        }
    });
});
