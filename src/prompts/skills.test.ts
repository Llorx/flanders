import * as Assert from "assert";

import test from "arrange-act-assert";

import { TASK_LINE } from "../plan/PlanFile";
import {
    detectBuildAndTestPromptCore,
    flandersToneInstruction,
    hardStopDiagnosisCore,
    reviewerMethodologyCore,
    workerPromptCore
} from "./prompts";
import { FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH } from "./internalSpecPath.fixtures";
import { hardStopReviewSkillBody, planSkillBody, specSkillBody, implementSkillBody } from "./skills";

// The AI-tool host name that the skill bodies no longer name. Assembled from fragments so the literal token never appears contiguously in this test file, while still letting each describe block assert — case-insensitively, over the public generated body string — that no occurrence of it survives anywhere in that body.
const REMOVED_HOST_NAME = "Anti" + "gravity";

// The terse Flanders-voice section each skill body addresses to the user. Reproduced here as a literal
// — independently of the production helper — so any drift in the shipped wording is caught by an
// exact-match. The only per-skill difference is the authored-artifact exclusion.
const SKILL_VOICE_HEAD =
`## Voice

When the resolved interaction language you are addressing the user in is English, use a light Ned-Flanders touch in the messages you address to the user; deliver any other language plainly. Keep it out of code, file paths, command lines, diagnostics, machine-read tokens, git commit messages`;

// The user-facing Flanders-voice section a skill body must carry, with the authored-artifact
// exclusion the skill is responsible for keeping the flavor out of.
function expectedSkillVoice(authoredArtifactExclusion: string): string {
    return `${SKILL_VOICE_HEAD}, and ${authoredArtifactExclusion}.`;
}

// Slice out the user-facing voice section a skill body carries — from its unique opener to the end of
// the exclusion sentence — so its self-containment can be checked against the body as actually built.
function userFacingVoiceSection(body: string): string {
    const start = body.indexOf("## Voice\n\nWhen the resolved interaction language you are addressing the user in is English, use a light Ned-Flanders touch");
    const end = body.indexOf(".", body.indexOf("git commit messages", start)) + 1;
    return body.slice(start, end);
}

function sectionBetween(body: string, startMarker: string, endMarker: string): string {
    return body.slice(body.indexOf(startMarker), body.indexOf(endMarker));
}

function yamlFrontmatter(body: string): string {
    return sectionBetween(body, "---\n", "\n---\n");
}

// A skill body writes each paragraph as one continuous line however long, so a paragraph runs from its
// opening words to the next newline.
function paragraphAt(body: string, opening: string): string {
    const start = body.indexOf(opening);
    return body.slice(start, body.indexOf("\n", start));
}

function planValidatorCategory4(body: string): string {
    return sectionBetween(body, "4. Plan content rules", "5. Active application of referenced contracts and rules");
}

function validatorInputsSection(body: string): string {
    return sectionBetween(body, "### Validator inputs", "### Validator checks");
}

function specValidatorChecksSection(body: string): string {
    return sectionBetween(body, "### Validator checks", "### Validator output");
}

function specValidatorCategoryC(body: string): string {
    return sectionBetween(body, "**C. Non-contradiction", "### Validator output");
}

function sourceGroundedContradictionForm(body: string): string {
    return paragraphAt(body, "A contradiction also takes a source-grounded form:");
}

function jointSatisfiabilityProtocol(body: string): string {
    return paragraphAt(body, "The per-reference pass establishes only individual satisfiability.");
}

function interactionAndReasoningLanguageSection(body: string): string {
    return sectionBetween(body, "## Interaction and reasoning language", "## Voice");
}

test.describe("content-skill validator Flanders entry-point boundary", test => {
    test("puts the complete boundary only in each spawned validator prompt", {
        ARRANGE() {
            return [planSkillBody, specSkillBody];
        },
        ACT(bodies) {
            return bodies.map(body => ({ body, inputs: validatorInputsSection(body) }));
        },
        ASSERTS: {
            "each skill scopes the boundary to its validator and excludes its own session"(skills) {
                Assert.deepStrictEqual(
                    skills.map(({ inputs }) => inputs.includes("The following boundary applies only to the validator subagent, not this skill session")),
                    [true, true]
                );
            },
            "each skill carries the boundary exactly once and inside Validator inputs"(skills) {
                Assert.deepStrictEqual(
                    skills.map(({ body, inputs }) => [
                        body.split("Flanders entry-point boundary:").length - 1,
                        inputs.split("Flanders entry-point boundary:").length - 1
                    ]),
                    [[1, 1], [1, 1]]
                );
            },
            "each validator prompt bars every Flanders skill and CLI command"(skills) {
                Assert.deepStrictEqual(
                    skills.map(({ inputs }) =>
                        inputs.includes("do not invoke any Flanders skill in your AI tool or run any Flanders CLI command")
                    ),
                    [true, true]
                );
            },
            "each validator prompt bars every indirect path"(skills) {
                Assert.deepStrictEqual(
                    skills.map(({ inputs }) =>
                        inputs.includes("not as a slash command; not through a skill-invocation tool, package runner, script, or wrapper that reaches either entry point; and not by asking another agent or process to do so")
                    ),
                    [true, true]
                );
            },
            "each validator prompt carries the nested-cycle reason"(skills) {
                Assert.deepStrictEqual(
                    skills.map(({ inputs }) =>
                        inputs.includes("You already run inside a Flanders execution: invoking its implementation skill or implementation command would nest a new cycle inside the one you serve")
                    ),
                    [true, true]
                );
            },
            "each validator prompt carries the mid-flight rewrite reason"(skills) {
                Assert.deepStrictEqual(
                    skills.map(({ inputs }) =>
                        inputs.includes("installing or updating mid-flight would rewrite the skill artifacts this execution is running from")
                    ),
                    [true, true]
                );
            },
            "each validator reports through its own verdict"(skills) {
                Assert.deepStrictEqual(
                    skills.map(({ inputs }) => inputs.includes("report that need through your own verdict")),
                    [true, true]
                );
            },
            "each validator continues its role and leaves invocation to the user"(skills) {
                Assert.deepStrictEqual(
                    skills.map(({ inputs }) => inputs.includes("continue with what your role can do, and leave invocation to the user")),
                    [true, true]
                );
            },
            "the spec skill still launches the user's chosen next skill in its own session"() {
                Assert.ok(specSkillBody.includes("launch it by invoking it in the same session with no <data> argument"));
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

    test("frontmatter declares the flanders-plan name", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERT(body) {
            Assert.match(yamlFrontmatter(body), /^name: flanders-plan$/m);
        }
    });

    test("names no occurrence of the removed AI-tool host, case-insensitively", {
        ARRANGE() {
            return { removedHost: REMOVED_HOST_NAME };
        },
        ACT() { return planSkillBody; },
        ASSERT(body, { removedHost }) {
            Assert.strictEqual(body.toLowerCase().includes(removedHost.toLowerCase()), false);
        }
    });

    test("covers .spec discovery as the canonical contracts reference", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "instructs recursive .spec discovery across the project tree"(body) {
                Assert.ok(body.includes("Discover every directory named \`.spec\` across the whole project tree at every depth"), "step 2 must instruct recursive .spec discovery at every depth");
            },
            "names the git-ignore exclusion"(body) {
                Assert.ok(body.includes("excluding every path the project's git ignore rules exclude"), "step 2 must exclude git-ignored paths");
            },
            ".spec/contracts subfolders form the canonical contracts listing"(body) {
                Assert.ok(body.includes("the files under each \`.spec/contracts\` subfolder form the canonical contracts listing"), "step 2 must build the contracts listing from .spec/contracts subfolders");
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

    test("instructs the generation-timestamp filename prefix", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "pins the full filename shape"(body) {
                Assert.ok(body.includes("The filename is \`YYYY-MM-DD_HH.MM-<descriptive-subject>.md\`"), "must pin the full filename as the timestamp prefix followed by the descriptive subject");
            },
            "spells out the prefix components and separators"(body) {
                Assert.ok(body.includes("a four-digit year, a two-digit month, and a two-digit day joined by \`-\`, then a single \`_\`, then a two-digit hour on a 24-hour clock and a two-digit minute joined by \`.\`, then a single \`-\`"), "must spell out every prefix component and separator");
            },
            "stamps the machine's local time at generation"(body) {
                Assert.ok(body.includes("the machine's local date and time at the moment the plan file is generated"), "must draw the timestamp from the machine's local clock at generation time");
            },
            "zero-pads every numeric component for chronological sorting"(body) {
                Assert.ok(body.includes("every numeric component is zero-padded to its fixed width, so the prefix always has the same length and plan files sort chronologically by name"), "must require zero-padded fixed-width components so plans sort chronologically");
            },
            "keeps the descriptive-subject obligation"(body) {
                Assert.ok(body.includes("immediately followed by a subject descriptive of the plan's content"), "must keep the descriptive-subject obligation after the prefix");
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
            },
            "states the ordering obligation once, not duplicated as a separate content rule"(body) {
                const occurrences = body.split("depends on another must appear after the task it depends on").length - 1;
                Assert.strictEqual(occurrences, 1);
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

    test("covers interaction language obligation", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
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
            "never governs the language of the plan file written"(body) {
                Assert.ok(body.includes("never the language of the plan file you write"), "must state it never governs the language of the plan file written");
            }
        }
    });

    test("places the interaction-language section verbatim between Output language and Missing contracts or rules", {
        ARRANGE() {
            const section = `## Interaction language

Every message you address to the user during the run — your clarifying questions, the recommendation to create a rule via /flanders-spec, the warnings printed when the project has no contracts or no rules, the end-of-run summary, and any other text you print in chat — is written in the natural language of the user's most recent message in the conversation. When the user switches the language they write in partway through the interaction, every subsequent message you address to the user follows the language of their latest message. This is resolved independently of the Output language above: it governs only what you say to the user in the conversation, never the language of the plan file you write.`;
            return { section };
        },
        ACT() { return planSkillBody; },
        ASSERTS: {
            "contains the interaction-language section verbatim"(body, { section }) {
                Assert.ok(body.includes(section), "planSkillBody must contain the interaction-language section verbatim");
            },
            "section appears after the Output language section"(body) {
                Assert.ok(body.indexOf("## Interaction language") > body.indexOf("## Output language"), "the Interaction language section must appear after the Output language section");
            },
            "section appears before the Missing contracts or rules section"(body) {
                Assert.ok(body.indexOf("## Interaction language") < body.indexOf("## Missing contracts or rules"), "the Interaction language section must appear before the Missing contracts or rules section");
            }
        }
    });

    test("addresses the user in the soft Flanders voice excluding the plan file it authors", {
        ARRANGE() {
            return { voice: expectedSkillVoice("the plan file you author") };
        },
        ACT() { return planSkillBody; },
        ASSERTS: {
            "contains the user-facing tone instruction verbatim with the plan-file exclusion"(body, { voice }) {
                Assert.ok(body.includes(voice), "planSkillBody must contain the user-facing Flanders-voice section verbatim, excluding the plan file it authors");
            },
            "names no sample greeting exemplar anywhere in the body"(body) {
                Assert.strictEqual(body.includes(`"neighbor"`), false);
            },
            "names no sample interjection exemplar anywhere in the body"(body) {
                Assert.strictEqual(body.includes(`"okely-dokely"`), false);
            },
            "names no sample suffix exemplar anywhere in the body"(body) {
                Assert.strictEqual(body.includes(`"-diddly-"`), false);
            },
            "the tone instruction excludes machine-read tokens"(body) {
                Assert.ok(userFacingVoiceSection(body).includes("machine-read tokens"), "the tone instruction must keep the flavor out of machine-read tokens");
            },
            "the tone instruction excludes git commit messages"(body) {
                Assert.ok(userFacingVoiceSection(body).includes("git commit messages"), "the tone instruction must keep the flavor out of git commit messages");
            },
            "the tone instruction cites no flanders-internal spec path"(body) {
                Assert.strictEqual(FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH.test(userFacingVoiceSection(body)), false);
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
            "warns when no .spec/contracts folder contains any file"(body) {
                Assert.ok(body.includes("no \`.spec/contracts\` folder contains any file"), "must warn when no .spec/contracts folder contains any file");
            },
            "warns when no .spec/rules folder contains any file"(body) {
                Assert.ok(body.includes("no \`.spec/rules\` folder contains any file"), "must warn when no .spec/rules folder contains any file");
            }
        }
    });

    test("covers .spec discovery as the canonical rules reference", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            ".spec/rules subfolders form the canonical rules listing"(body) {
                Assert.ok(body.includes("the files under each \`.spec/rules\` subfolder form the canonical rules listing"), "step 2 must build the rules listing from .spec/rules subfolders");
            },
            "identifies each file by its namespace"(body) {
                Assert.ok(body.includes("each file is identified by its namespace"), "step 2 must identify each file by its namespace");
            },
            "defines the namespace as the path relative to the project root"(body) {
                Assert.ok(body.includes("its path relative to the project root"), "step 2 must define the namespace as the project-root-relative path");
            },
            "keeps same-leaf-filename specs distinct by namespace"(body) {
                Assert.ok(body.includes("files sharing a leaf filename in different \`.spec\` folders stay distinct"), "step 2 must keep same-leaf-filename specs in different .spec folders distinct");
            }
        }
    });

    test("step 2 builds the behavior-rule listing from .spec/flanders subfolders", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "the files under each .spec/flanders subfolder form the behavior-rule listing"(body) {
                Assert.ok(body.includes("the files under each \`.spec/flanders\` subfolder form the behavior-rule listing"), "step 2 must build the behavior-rule listing from .spec/flanders subfolders");
            },
            "treats every file inside a .spec/flanders folder at any depth as a behavior rule"(body) {
                Assert.ok(body.includes("treating every file inside a \`.spec/flanders\` folder at any depth as a behavior rule"), "step 2 must treat every file inside a .spec/flanders folder at any depth as a behavior rule");
            }
        }
    });

    test("carries the obligation to honor in-scope behavior rules before persisting the plan file", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "reads every in-scope behavior rule before persisting the plan file"(body) {
                Assert.ok(body.includes("Before persisting the plan file, read every behavior rule whose \`.spec/flanders\` scope encloses the plan file you are about to write"), "must read every in-scope behavior rule before persisting the plan file");
            },
            "scopes the read to the project-root .spec folder and any other enclosing .spec folder"(body) {
                Assert.ok(body.includes("the project-root \`.spec\` folder and any other \`.spec\` folder whose scope encloses the \`plans/\` target"), "must scope behavior-rule reading to the project-root .spec folder and any other .spec folder enclosing the plans/ target");
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

    test("covers project-root-relative namespace form for contract and rule links", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "states the link text carries the listed namespace with no leading slash"(body) {
                Assert.ok(body.includes("with no leading slash"), "must state the link text is the listed namespace with no leading slash");
            },
            "states the link target is prefixed with a single leading slash"(body) {
                Assert.ok(body.includes("prefixed with a single leading slash"), "must state the link target is prefixed with a single leading slash");
            },
            "forbids a path computed relative to the plan file"(body) {
                Assert.ok(body.includes("never as a path computed relative to the plan file's own location"), "must forbid a path computed relative to the plan file's own location");
            },
            "validator checks links are in project-root-relative namespace form"(body) {
                Assert.ok(body.includes("project-root-relative namespace form"), "validator must check links are in project-root-relative namespace form");
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
            "prohibits task content from touching .spec/contracts folders"(body) {
                Assert.ok(body.includes("inside any \`.spec/contracts\` folder"), "must prohibit tasks from touching .spec/contracts folders");
            },
            "prohibits task content from touching .spec/rules folders"(body) {
                Assert.ok(body.includes("any \`.spec/rules\` folder"), "must prohibit tasks from touching .spec/rules folders");
            },
            "prohibits task content from touching .spec/flanders folders"(body) {
                Assert.ok(body.includes("any \`.spec/flanders\` folder"), "must prohibit tasks from touching .spec/flanders folders");
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
            },
            "names the Claude Code Agent tool for the validator"(body) {
                Assert.ok(body.includes("In Claude Code, the host spawns the validator through the Agent tool."), "must name the Claude Code Agent tool for the validator");
            },
            "names the Codex CLI subagent surface for the validator and names no host after it"(body) {
                Assert.ok(body.includes("In Codex CLI, the host spawns it through whatever Codex documents as its subagent surface at the time of the run.\n"), "the subagent-mechanism clause must name the Codex CLI surface and end there, naming no further host after it");
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
            "category 3 names the .spec spec folders and plans/"(body) {
                const category3 = body.slice(body.indexOf("3. Spec-folder write boundary"), body.indexOf("4. Plan content rules"));
                Assert.ok(category3.includes("renames any file inside any \`.spec/contracts\` folder, any \`.spec/rules\` folder, any \`.spec/flanders\` folder, or the \`plans/\` folder"), "validator category 3 must name the .spec/contracts, .spec/rules, .spec/flanders, and plans/ folders");
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
                const inputsSection = validatorInputsSection(body);
                Assert.ok(inputsSection.includes("- The number of leaf task lines you generated (a single non-negative integer)."), "Validator inputs must include the leaf-task count bullet verbatim");
            },
            "makes the host inline the verbatim text of the five check categories"(body) {
                const inputsSection = validatorInputsSection(body);
                Assert.ok(inputsSection.includes("- The verbatim text of the five check categories below, including their per-criterion, per-reference, joint-satisfiability, per-task trigger-completeness, and per-task granularity protocols. The host MUST inline this text in the validator's prompt"), "Validator inputs must make the host inline the verbatim text of the five check categories — the carrier for every protocol stated inside them");
            },
            "includes trigger completeness in the protocols inlined verbatim"(body) {
                const inputsSection = validatorInputsSection(body);
                Assert.ok(inputsSection.includes("including their per-criterion, per-reference, joint-satisfiability, per-task trigger-completeness, and per-task granularity protocols"), "Validator inputs must include trigger completeness among the protocols inlined verbatim");
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
            "re-entered clarification carries the batched cadence by reference, without restating it"(body) {
                Assert.ok(body.includes("Re-entered clarification follows the same cadence the clarification phase above defines, scoped to the specific ambiguity at hand and never re-asking decisions the user has already given in this invocation."), "re-entered clarification must carry the batched cadence by referencing the clarification phase above");
                Assert.strictEqual(body.includes("otherwise asking one question per turn"), false);
            },
            "re-entered clarification drops the no-bundling restriction"(body) {
                Assert.ok(!body.includes("no bundling"), "re-entered clarification must not restate the no-bundling restriction");
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

    test("After completion section points the user at the implement CLI and not at an AI skill", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "has the After completion: implementing the plan section"(body) {
                Assert.ok(body.includes("## After completion: implementing the plan"), "must have the After completion: implementing the plan section");
            },
            "tells the user the plan is implemented by running flanders implement"(body) {
                Assert.ok(body.includes("implemented from the command line by running \`flanders implement\` against it"), "must tell the user the plan is implemented by running flanders implement");
            },
            "states the completion message is informational and final"(body) {
                Assert.ok(body.includes("This message is informational and final"), "must state the completion message is informational and final");
            },
            "does not ask the user whether to proceed"(body) {
                Assert.ok(body.includes("You do not ask the user whether to proceed"), "must state it does not ask the user whether to proceed");
            },
            "does not offer to launch nor launch any AI-tool skill"(body) {
                Assert.ok(body.includes("you do not offer to launch, nor launch, any AI-tool skill"), "must state it does not offer to launch, nor launch, any AI-tool skill");
            },
            "names /flanders-implement as a skill it must not launch to implement the plan"(body) {
                Assert.ok(body.includes("including /flanders-implement"), "must name /flanders-implement as a skill it must not launch to implement the plan");
            },
            "section appears after the Summary section"(body) {
                Assert.ok(body.indexOf("## After completion: implementing the plan") > body.indexOf("## Summary"), "the After completion section must appear after the Summary section");
            },
            "section appears before the Output language section"(body) {
                Assert.ok(body.indexOf("## After completion: implementing the plan") < body.indexOf("## Output language"), "the After completion section must appear before the Output language section");
            }
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
            "no path under contracts/, rules/, flanders/, or plans/ names a specific .md file"(body) {
                Assert.strictEqual(
                    FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH.test(body),
                    false
                );
            },
            "does not name the code-grounding rule file even without a path"(body) {
                Assert.ok(!body.includes("tasks-consistent-with-the-code-they-build-on.md"), "must not name the code-grounding rule file");
            },
            "does not name the runtime-premise rule file even without a path"(body) {
                Assert.ok(!body.includes("runtime-premise-backed-or-escalated.md"), "must not name the runtime-premise rule file");
            },
            "does not name the interaction-language contract file even without a path"(body) {
                Assert.ok(!body.includes("interaction-language.md"), "must not name the interaction-language contract file");
            },
            "inlines the narrower clarification-scope criteria"(body) {
                Assert.ok(body.includes("implementation choice that shapes a task's observable outcome and that the request does not specify, or a task-scope ambiguity"), "must inline the narrower clarification-scope criteria");
            },
            "leaves an outcome-neutral mechanism choice to the implementer in the clarification phase"(body) {
                Assert.ok(body.includes("A choice that affects only how a task's work is carried out internally, with no effect on any observable outcome its acceptance criteria pin, is not asked about: it is left for the implementer to resolve against the real code"), "the clarification phase must leave an outcome-neutral mechanism choice to the implementer rather than asking about it");
            },
            "narrows the FAIL-triage clarification-scope restatement to outcome-affecting choices"(body) {
                Assert.ok(body.includes("an implementation choice that shapes a task's observable outcome and that the request does not specify, a task-scope ambiguity the planner cannot reasonably infer"), "the FAIL-triage restatement must narrow the implementation-choice criterion to an outcome-affecting choice");
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
                Assert.ok(body.includes("No task may describe work that creates, modifies, deletes, or renames files inside any \`.spec/contracts\` folder, any \`.spec/rules\` folder, any \`.spec/flanders\` folder, or the \`plans/\` folder"), "must inline the spec-folder write boundary");
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
            "batches independent clarification questions"(body) {
                Assert.ok(body.includes("ask that whole set together in a single interaction"), "must batch independent questions in a single interaction");
            },
            "falls back to one question per turn without a multi-question facility"(body) {
                Assert.ok(body.includes("when it provides no such facility, ask one question per turn"), "must fall back to one question per turn when no multi-question facility exists");
            },
            "phrases bounded-answer questions as multiple-choice through facility and chat alike"(body) {
                Assert.ok(body.includes("Phrase every question whose answer space is bounded as multiple-choice, through the facility and in chat alike"), "must commit bounded-answer questions to multiple-choice phrasing in both presentation paths");
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
            "routes a cross-cutting convention to a .spec/rules folder"(body) {
                Assert.ok(body.includes("belongs in a \`.spec/rules\` folder"), "a cross-cutting convention must belong in a .spec/rules folder");
            },
            "describes plan-local outcome"(body) {
                Assert.ok(body.includes("Plan-local implementation choice"), "must describe plan-local outcome");
            },
            "prohibits writing to .spec/rules, .spec/contracts, or .spec/flanders folders"(body) {
                Assert.ok(body.includes("never writes to any \`.spec/rules\`, \`.spec/contracts\`, or \`.spec/flanders\` folder"), "must prohibit writing to .spec/rules, .spec/contracts, or .spec/flanders folders");
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
                const placeholdersBullet = "- The persisted plan is free of placeholders, contradictions with existing contracts or rules, acceptance criteria that leave a leaf task's observable outcome ambiguous, unsatisfiable acceptance criteria, missing acceptance criteria on leaf tasks, and missing contract or rule links on leaf tasks.";
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

    test("plan content rules carry the single-line-paragraph obligation", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "instructs writing each paragraph as a single continuous line"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Write each paragraph of prose in the plan as a single continuous line"), "the Plan content rules list must instruct writing each paragraph as a single continuous line");
            },
            "permits a line break only where markdown structure requires it"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("insert a line break only where markdown structure requires it"), "the Plan content rules list must permit a line break only where markdown structure requires it");
            },
            "forbids wrapping a paragraph to a maximum column width"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Never break a paragraph across multiple lines to keep it within a maximum column width"), "the Plan content rules list must forbid wrapping a paragraph to a maximum column width");
            }
        }
    });

    test("plan content rules carry the economy-of-words obligation", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "instructs using the fewest words that state each item unambiguously"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Use the fewest words that state each task, obligation, and explanation unambiguously"), "the Plan content rules list must instruct using the fewest words that state each item unambiguously");
            },
            "writes content only when it carries something not already carried elsewhere"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("only when it carries something not already carried by another task, an earlier sentence, or the reader's ordinary competence"), "the Plan content rules list must write content only when it carries something not already carried elsewhere");
            },
            "reaches for more words only when fewer would leave an outcome ambiguous"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Reach for more words only when fewer would leave an observable outcome ambiguous"), "the Plan content rules list must reach for more words only when fewer would leave an observable outcome ambiguous");
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

    test("plan content rules pin the observable outcome and leave the internal mechanism to the implementer", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "pins each leaf task's observable outcome"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Each leaf task's acceptance criteria pin the task's observable outcome — the behavior the result must exhibit through the surface a reader or a test can inspect — so that any two implementations satisfying them are observably equivalent"), "the Plan content rules list must pin each leaf task's observable outcome");
            },
            "does not dictate the internal mechanism beyond what an outcome or architectural property needs"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("The plan does not dictate a task's internal mechanism beyond what an observable acceptance criterion or an explicitly required architectural property demands"), "the Plan content rules list must not dictate the internal mechanism beyond what an outcome or required architectural property needs");
            },
            "leaves an outcome-neutral internal choice to the implementer"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("is left for the implementer to resolve against the real code rather than fixed by the planner"), "the Plan content rules list must leave an outcome-neutral internal choice to the implementer");
            },
            "states an architectural property as a required outcome rather than fixing an internal mechanism"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("states that property as a required outcome the acceptance criteria assert rather than fixing a specific internal mechanism, whether a code element to reuse or leave untouched or the files and modules its code and tests are placed in"), "the Plan content rules list must state a needed structural property as a required outcome rather than fixing an internal mechanism, including where code and tests are placed");
            },
            "names code organization as an internal mechanism left to the implementer"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("how its code and tests are organized across files and modules"), "the Plan content rules list must name code organization as an internal mechanism left to the implementer");
            }
        }
    });

    test("plan content rules classify the evidence instrument as internal mechanism and require satisfiable acceptance criteria", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "names how an outcome is evidenced an internal choice"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("How an outcome is evidenced is such an internal choice too"), "the Plan content rules list must classify how an outcome is evidenced as an internal choice");
            },
            "fixes a test instrument only when its recorded interaction is the observable outcome"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("fixes a test instrument — a test double, a recording fake, a specific harness — only when the interaction that instrument records is itself the observable outcome, exercised through a collaboration the plan's design provides"), "the Plan content rules list must permit fixing a test instrument only when its recorded interaction is the observable outcome the design provides");
            },
            "requires acceptance criteria be satisfiable with the plan's linked specs and design"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Every leaf task's acceptance criteria are satisfiable together: at least one implementation satisfies all of them while honoring every contract and rule the plan links and the design the plan itself prescribes"), "the Plan content rules list must require acceptance criteria be satisfiable together with the plan's linked contracts, rules, and design");
            },
            "declares unsatisfiable a criterion whose evidence mechanism the design forbids"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("A criterion that prescribes an evidence mechanism whose required structure that design or a canonical rule forbids — for example, asserting the absence of an interaction through a test double on a component the design bars from holding the doubled dependency — is unsatisfiable"), "the Plan content rules list must declare unsatisfiable a criterion whose evidence mechanism the design forbids");
            },
            "restates or escalates instead of persisting the unsatisfiable criterion"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("is never persisted: the planner restates it as the observable fact the design's own surface can verify, or escalates the conflict during the clarification phase"), "the Plan content rules list must restate or escalate the unsatisfiable criterion instead of persisting it");
            }
        }
    });

    test("plan content rules cut every leaf task at trigger completeness", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "requires every leaf task to deliver every obligation its own work triggers"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Every leaf task delivers complete every obligation its own work triggers"), "the Plan content rules list must require every leaf task to deliver every obligation its work triggers");
            },
            "keeps each trigger and its full remedy in the same task across files or layers"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("keep each trigger and its full remedy in the same task, however many files or layers the remedy spans"), "the Plan content rules list must keep each trigger and its full remedy in the same task");
            },
            "widens the task to carry a missing remedy or narrows it to remove the trigger"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("widen it to carry the remedy or narrow it to remove the trigger"), "the Plan content rules list must repair an incomplete draft by widening it for the remedy or narrowing it away from the trigger");
            },
            "never persists a task whose trigger precedes its remedy"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("never persist a task whose trigger remains while a later task delivers its remedy"), "the Plan content rules list must never persist a trigger/remedy split");
            },
            "leaves work whose obligations the task does not trigger to another task"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Work whose obligations the task does not trigger belongs in another task"), "the Plan content rules list must not bundle work whose obligations the task does not trigger");
            },
            "repeats the completeness obligation in validator category 4"(body) {
                Assert.ok(planValidatorCategory4(body).includes("Every leaf task delivers complete every obligation its own work triggers"), "category 4 must carry the same trigger-completeness obligation");
            }
        }
    });

    test("plan content rules cut every leaf task at passing build and test gates", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "states that every leaf task leaves the project building and its tests passing"(body) {
                const planContentRules = sectionBetween(body, "### Plan content rules", "## Post-write verification");
                Assert.ok(planContentRules.includes("Every leaf task leaves the project building and its tests passing"), "the Plan content rules list must require every leaf task to leave the project building and its tests passing");
            },
            "explains that build and test gates run inside every task's own cycle"(body) {
                const planContentRules = sectionBetween(body, "### Plan content rules", "## Post-write verification");
                Assert.ok(planContentRules.includes("The build and test gates run inside every task's own cycle"), "the Plan content rules list must explain why every task boundary must leave the project green");
            },
            "requires compilation and the whole test suite to pass at each task's end"(body) {
                const planContentRules = sectionBetween(body, "### Plan content rules", "## Post-write verification");
                Assert.ok(planContentRules.includes("the code it produces compiles and the whole test suite passes at that task's end"), "the Plan content rules list must require the complete build and test gates to pass between tasks");
            },
            "keeps compilation type checking and broken-test updates in the task that breaks them"(body) {
                const planContentRules = sectionBetween(body, "### Plan content rules", "## Post-write verification");
                Assert.ok(planContentRules.includes("the compilation, the type checking, and the test updates a change breaks are delivered by the task that breaks them"), "the Plan content rules list must keep every gate repair in the task that requires it");
            },
            "keeps inseparable signature and behavior changes in one task regardless of size"(body) {
                const planContentRules = sectionBetween(body, "### Plan content rules", "## Post-write verification");
                Assert.ok(planContentRules.includes("work that only holds together as a unit — a signature change and the call sites it breaks, a behavior change and the tests asserting the previous behavior — lands in one task however large that task becomes"), "the Plan content rules list must keep work with inseparable build or test consequences in one task");
            },
            "repeats the green-task obligation in validator category 4"(body) {
                Assert.ok(planValidatorCategory4(body).includes("Every leaf task leaves the project building and its tests passing"), "category 4 must carry the same passing build and test obligation");
            },
            "judges each task against its own cumulative end state"(body) {
                Assert.ok(planValidatorCategory4(body).includes("Judge each leaf task at its own end state — the current on-disk source plus the changes that task and every earlier task prescribe"), "category 4 must judge each task at the end state where its own gates run");
            },
            "FAILs a task that leaves a gate broken for a later task to repair"(body) {
                Assert.ok(planValidatorCategory4(body).includes("A task that leaves compilation, type checking, or any test broken for a later task to repair is FAIL"), "category 4 must reject a task boundary that leaves the project red");
            },
            "makes the failure identify both the break and its deferred repair"(body) {
                Assert.ok(planValidatorCategory4(body).includes("the FAIL names the change that breaks the gate and the later task the repair falls to"), "category 4 must make a deferred gate repair actionable");
            }
        }
    });

    test("validator inputs state the validator reads the source and audits each task against its baseline", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "reads the on-disk source the tasks build on"(body) {
                const inputsSection = validatorInputsSection(body);
                Assert.ok(inputsSection.includes("the validator reads the on-disk source files the plan's tasks build on"), "Validator inputs must state the validator reads the on-disk source the tasks build on");
            },
            "audits each code-touching task against its baseline"(body) {
                const inputsSection = validatorInputsSection(body);
                Assert.ok(inputsSection.includes("audits each code-touching task against its baseline: the current source, plus the changes earlier tasks in the plan it depends on prescribe"), "Validator inputs must state the validator audits each task against its baseline");
            }
        }
    });

    test("validator category 4 carries the accurate-claims-against-baseline check", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "requires each task's claims be accurate to its baseline"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Each code-touching task's claims about the code it builds on are accurate to its baseline — the current on-disk source, plus the changes any earlier task in the plan it depends on prescribes"), "category 4 must require each task's claims be accurate to its baseline");
            },
            "FAILs a task naming structure neither source nor an earlier task provides"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("A task that names a function, type, field, file, or behavior that neither the source nor any earlier task in the plan provides, or that removes or rewrites code on a mistaken account of what it does, is FAIL"), "category 4 must FAIL a task that misstates the code it builds on");
            },
            "carves out code an earlier task introduces"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Do NOT FAIL a task merely for describing code the current on-disk source lacks when an earlier task in the plan introduces it"), "category 4 must not FAIL a task for code an earlier ordered task introduces");
            },
            "ties the earlier-task carve-out to the depended-on task being ordered first"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("confirm instead that the depended-on task is ordered first"), "category 4 must require the depended-on task be ordered first for the carve-out to apply");
            },
            "carves out behavior change as not itself a violation"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Changing the code's behavior is the task's purpose and is not itself a violation — only a false claim about the code the task builds on is"), "category 4 must state that changing behavior is not itself a violation");
            }
        }
    });

    test("validator category 4 carries the runtime-premise backed-or-escalated check", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "names the runtime-premise backed-or-escalated check"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Runtime-behavior premises are backed or escalated"), "category 4 must name the runtime-premise backed-or-escalated check");
            },
            "qualifies the premise as a claim not confirmable from the source"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("a runtime- or observable-behavior claim not confirmable from the source"), "category 4 must qualify the premise as a runtime- or observable-behavior claim not confirmable from the source");
            },
            "FAILs an unbacked, unescalated runtime premise"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("that no contract, rule, existing test, or preceding task in the plan backs, and that was not escalated to the user — is FAIL"), "category 4 must FAIL an unbacked, unescalated runtime premise");
            },
            "includes code removal on the strength of such a premise"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("This explicitly includes a task that removes, weakens, or replaces existing code on the strength of such an unbacked claim"), "category 4 must include code removal on the strength of an unbacked premise");
            }
        }
    });

    test("validator category 4 carries the outcome-precise / mechanism-free check", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "requires acceptance criteria to pin the observable outcome"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Each leaf task's acceptance criteria pin the task's observable outcome precisely"), "category 4 must require acceptance criteria to pin the observable outcome");
            },
            "FAILs acceptance criteria that leave the observable outcome open"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Acceptance criteria that leave the observable outcome open — satisfiable by implementations that differ in observable behavior"), "category 4 must FAIL acceptance criteria that leave the observable outcome open");
            },
            "does not FAIL leaving an outcome-neutral internal mechanism choice open"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("is NOT a violation when left for the implementer to resolve"), "category 4 must not FAIL leaving an outcome-neutral mechanism choice open");
            },
            "FAILs a gratuitously frozen internal mechanism"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("a task that freezes an internal mechanism that no observable acceptance criterion and no explicitly required architectural property needs is FAIL"), "category 4 must FAIL a gratuitously frozen internal mechanism");
            },
            "includes code organization in the internal-mechanism notion"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("how its code and tests are organized across files and modules"), "category 4 must include code organization in the internal-mechanism notion left to the implementer");
            },
            "includes the evidence instrument in the internal-mechanism notion"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("how an outcome is evidenced (the test instrument or double that demonstrates it)"), "category 4 must include the evidence instrument in the internal-mechanism notion left to the implementer");
            }
        }
    });

    test("validator category 4 carries the satisfiable-under-the-plan's-design check", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "names the satisfiability check"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Acceptance criteria are satisfiable under the plan's own design"), "category 4 must name the satisfiability check");
            },
            "confirms the prescribed evidence's required structure exists under the design"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("confirm at least one implementation can satisfy it while honoring every contract and rule the plan links and the design the plan prescribes — the structure the prescribed evidence requires exists, or is permitted to exist, under that design"), "category 4 must confirm the prescribed evidence's required structure exists under the plan's design");
            },
            "FAILs an evidence mechanism whose required structure the design forbids"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("A criterion whose evidence mechanism requires a structure the plan's design or a canonical rule forbids — non-exhaustively, an assertion of absent interaction observed through a test double on a component the design forbids from holding the doubled dependency — is FAIL"), "category 4 must FAIL a criterion whose evidence mechanism requires a structure the design forbids");
            },
            "scopes call-recording doubles to designs that provide the collaboration"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("A call-recording double is legitimate evidence only where the design provides the collaboration it records"), "category 4 must scope call-recording doubles to designs that provide the recorded collaboration");
            }
        }
    });

    test("validator category 4 inlines the per-criterion adjudication protocol", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "forbids aggregate adjudication and requires per-item enumeration"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Evidence-prescribing criteria are adjudicated one by one, never in aggregate: enumerate every acceptance criterion that prescribes an evidence instrument — a test double, fake, mock, spy, stub, or specific harness — or that asserts the absence of an interaction, each as its own numbered item, and produce for each item, before its verdict"), "category 4 must forbid aggregate adjudication, enumerate each evidence-prescribing criterion as its own item, and require the records before the item's verdict");
            },
            "requires the observed component as the first record"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("(1) the observed component — the code element the prescribed instrument attaches to or observes"), "category 4 must require naming the observed component per item");
            },
            "requires the design disposition quoted verbatim with a read-the-source fallback"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("(2) the design disposition, quoted verbatim — the statement, from the plan (the same task's body, another task, or the plan's narrative) or from a linked rule, that provides the observed component with the doubled collaboration or that denies it"), "category 4 must require the quoted design disposition per item, with its plan-or-linked-rule provenance and its provides-or-denies definition");
                Assert.ok(category4.includes("when neither the plan nor the linked rules state the disposition, establish it by reading the observed component's on-disk source before adjudicating — a disposition is never assumed"), "category 4 must require reading the observed component's source when neither the plan nor the linked rules state the disposition");
            },
            "requires a single-branch verdict and bans conditional adjudication"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("(3) a single-branch verdict — satisfiable or FAIL, decided on the disposition established in record 2"), "category 4 must require a single-branch verdict per item");
                Assert.ok(category4.includes("\"satisfiable whether or not the component holds the dependency\", \"in either case\", or any wording that leaves the branch unresolved — is not a verdict"), "category 4 must ban conditional adjudication as a verdict");
            },
            "FAILs a disposition the plan leaves open instead of passing the item"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("when the plan genuinely leaves the disposition open, that openness is itself a FAIL of this category, never a ground for passing the item"), "category 4 must FAIL an open disposition rather than pass the item");
            },
            "blocks the category while any enumerated item is unaudited"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("An item missing any of the three records is unaudited, and this category is not reported as passed while any enumerated item is unaudited"), "category 4 must not be reported as passed with unaudited items");
                Assert.ok(category4.includes("a summary clause that disposes of several such criteria at once leaves every criterion it covers unaudited"), "category 4 must treat a summary clause as leaving its criteria unaudited");
            }
        }
    });

    test("validator category 4 inlines the per-reference satisfiability protocol", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "adjudicates each task-reference pair, never in aggregate"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("The satisfiability check in category 4 reaches beyond evidence instruments: a task's acceptance criteria must be satisfiable while honoring every contract and rule the task links, and that audit is never rendered in aggregate. For each leaf task, for each contract and rule the task links, the validator produces, before the pair's verdict"), "category 4 must adjudicate each task-reference pair one by one and never in aggregate");
            },
            "requires the constraining obligation quoted verbatim with a none-constrains option"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("(1) the constraining obligation, quoted verbatim — the obligation of that reference that constrains the task's acceptance criteria or the design the task prescribes; when no obligation of the reference constrains them, the record states that explicitly instead"), "category 4 must require the constraining obligation quoted verbatim per pair, with the explicit none-constrains option");
            },
            "requires a single-branch verdict per pair"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("(2) a single-branch verdict — satisfiable or FAIL, deciding whether at least one implementation can satisfy the task's acceptance criteria while honoring the quoted obligation and the design the plan prescribes"), "category 4 must require a single-branch verdict per pair over the quoted obligation and the plan's design");
            },
            "bans conditional adjudication of a pair"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("An adjudication conditioned on an unresolved question — \"satisfiable under either model\", \"in either case\", or any wording that leaves the question unresolved — is not a verdict: the validator resolves what the reference and the plan's design prescribe and judges that alone"), "category 4 must ban conditional adjudication of a pair and resolve what the reference and design prescribe");
            },
            "blocks the category while any pair is unaudited"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("A task-reference pair missing its record is unaudited, and the validator does not report category 4 as passed while any pair is unaudited"), "category 4 must not be reported as passed while any task-reference pair is unaudited");
            },
            "treats a summary clause as leaving its pairs unaudited"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("a summary clause that disposes of several pairs at once leaves every pair it covers unaudited"), "category 4 must treat a per-reference summary clause as leaving every pair it covers unaudited");
            }
        }
    });

    test("validator category 4 inlines the joint-satisfiability protocol", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "completes the per-reference pass instead of replacing it"(body) {
                Assert.ok(planValidatorCategory4(body).includes("The per-reference pass establishes only individual satisfiability."), "category 4 must frame the joint step as following a per-reference pass that establishes only individual satisfiability");
            },
            "sits alongside the per-reference protocol, after it"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.indexOf("Then issue a single-branch verdict per leaf task") > category4.indexOf("For each leaf task, for each contract and rule the task links, the validator produces, before the pair's verdict"), "the joint-satisfiability protocol must sit inside category 4 after the per-reference protocol");
            },
            "requires a single-branch verdict per leaf task"(body) {
                Assert.ok(planValidatorCategory4(body).includes("Then issue a single-branch verdict per leaf task:"), "category 4 must require a single-branch joint verdict per leaf task");
            },
            "requires one implementation to honor all linked references"(body) {
                Assert.ok(planValidatorCategory4(body).includes("at least one implementation must satisfy its acceptance criteria while honoring all linked contracts and rules"), "category 4 must require at least one implementation satisfying the leaf task's acceptance criteria while honoring all the contracts and rules it links");
            },
            "judges the joint verdict against the governed source read on disk"(body) {
                Assert.ok(planValidatorCategory4(body).includes("against the governed source read on disk"), "category 4 must judge the joint verdict against the governed source read on disk, not the linked texts alone");
            },
            "bounds the joint audit to the task's linked references"(body) {
                Assert.ok(planValidatorCategory4(body).includes("Audit only those references, never the whole corpus."), "category 4 must bound the joint audit to the references the task links and never a whole-corpus sweep");
            },
            "resolves what the source pins and rejects a conditional or unresolved reading"(body) {
                Assert.ok(planValidatorCategory4(body).includes("Resolve what the source pins; a conditional or unresolved reading is not a verdict."), "category 4 must resolve what the source pins and deny verdict status to a conditional or unresolved reading");
            },
            "makes every verdict name the consulted governed-source file:line"(body) {
                Assert.ok(planValidatorCategory4(body).includes("Every verdict names the governed-source file:line consulted"), "category 4 must make every joint verdict — satisfiable included — name the governed-source file:line consulted");
            },
            "pins the FAIL citation to the line showing the collision"(body) {
                Assert.ok(planValidatorCategory4(body).includes("— on FAIL, the line showing the collision."), "category 4 must pin the FAIL citation to the governed-source line showing the collision");
            },
            "FAILs a jointly unsatisfiable task naming and quoting the colliding obligations"(body) {
                Assert.ok(planValidatorCategory4(body).includes("If no implementation does, FAIL, naming and quoting the two or more colliding obligations."), "category 4 must FAIL a jointly unsatisfiable task, naming and quoting the two or more colliding obligations");
            },
            "the joint protocol names no path under contracts/, rules/, flanders/, or plans/"(body) {
                Assert.strictEqual(FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH.test(jointSatisfiabilityProtocol(body)), false);
            },
            "the joint protocol contains no .md path at all"(body) {
                Assert.strictEqual(jointSatisfiabilityProtocol(body).includes(".md"), false);
            }
        }
    });

    test("validator category 4 inlines the per-task trigger-completeness protocol", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "renders trigger completeness for each leaf task before its verdict"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("For each leaf task, produce before its verdict"), "category 4 must render the trigger-completeness records for every leaf task before its verdict");
            },
            "enumerates each triggered obligation from every canonical reference in scope"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("(1) the obligations its code triggers, enumerated one by one from all canonical references in scope, not only the references the task links"), "category 4 must enumerate triggered obligations from all in-scope canonical references");
            },
            "records linked obligations that the task does not trigger as untriggered"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("record a linked but untriggered obligation as untriggered"), "category 4 must distinguish linked obligations the task does not trigger");
            },
            "locates every remedy in the task that delivers it"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("(2) for each triggered obligation, the task where its remedy lands — the task under audit or a named later task"), "category 4 must locate each triggered obligation's remedy in a named task");
            },
            "quotes a later task's statement when that task carries the remedy"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("quoting the later task's carrying statement"), "category 4 must quote the later task statement that carries a remedy");
            },
            "requires a single-branch complete-or-FAIL verdict"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("(3) one single-branch verdict — complete or FAIL"), "category 4 must require a single-branch trigger-completeness verdict");
            },
            "FAILs a remedy delivered outside the task under audit with all three identities"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Any remedy in another task is FAIL, naming the obligation, triggering task, and remedy task"), "category 4 must FAIL an external remedy and identify the obligation and both tasks");
            },
            "does not accept an unresolved remedy location as a verdict"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("A conditional location such as \"this task or the next\" is not a verdict: resolve where the plan puts the remedy and judge that alone"), "category 4 must resolve a remedy's location rather than leaving it open");
            },
            "leaves category 4 incomplete when any record or verdict is missing"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("A task missing any record or its trigger-completeness verdict is unaudited and leaves category 4 incomplete"), "category 4 must remain incomplete while any leaf task lacks a trigger-completeness record or verdict");
            },
            "does not let an aggregate summary stand in for per-task audits"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("an aggregate summary leaves every task it covers unaudited"), "category 4 must reject aggregate trigger-completeness summaries");
            }
        }
    });

    test("validator category 4 renders a per-task granularity verdict", {
        ARRANGE() {},
        ACT() { return planSkillBody; },
        ASSERTS: {
            "makes completeness the drafting floor above which doubt triggers subdivision"(body) {
                const planContentRules = body.slice(body.indexOf("### Plan content rules"), body.indexOf("## Post-write verification"));
                Assert.ok(planContentRules.includes("Completeness is the floor: a task whose size is what delivering its triggered obligations whole requires is sane, not too broad, and is never subdivided below that complete unit. Above that floor, when in doubt, subdivide"), "the Plan content rules list must make completeness the floor and subdivide only above it");
            },
            "judges a task whose size completeness requires as sane rather than too broad"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Trigger completeness is the floor: a task whose size is what delivering its triggered obligations whole requires is sane, not too broad"), "category 4 must judge a task whose size completeness requires as sane rather than too broad");
            },
            "renders one verdict line per leaf task, never in aggregate, with its grounding reason"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("Granularity is rendered task by task, never in aggregate: for every leaf task the validator produces one verdict line — sane, too broad, or too narrow — with the reason that grounds it"), "category 4 must render one granularity verdict line per leaf task, never in aggregate, with the reason that grounds it");
            },
            "grounds a too-broad verdict in the distinct kinds of work bundled"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("A too-broad verdict names the distinct kinds of work the task bundles that would each need their own AI invocation"), "category 4 must ground a too-broad verdict in the distinct kinds of work the task bundles that each need their own AI invocation");
            },
            "forbids a too-broad verdict from splitting a trigger from its remedy"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("holds only when they can be separated without splitting a trigger from its remedy"), "category 4 must forbid a too-broad verdict that would split a trigger from its remedy");
            },
            "grounds a too-narrow verdict in the artificial fragmentation created"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("a too-narrow verdict names the artificial fragmentation the split created"), "category 4 must ground a too-narrow verdict in the artificial fragmentation the split created");
            },
            "grounds a sane verdict in the task fitting a single invocation without fragmentation"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("a sane verdict states that the task fits a single AI invocation without artificial fragmentation"), "category 4 must ground a sane verdict in the task fitting a single AI invocation without artificial fragmentation");
            },
            "leaves the category incomplete for a leaf task missing its verdict line"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("A leaf task without its verdict line leaves category 4 incomplete"), "category 4 must be left incomplete by a leaf task missing its granularity verdict line");
            },
            "treats a summary clause as leaving its tasks unaudited"(body) {
                const category4 = planValidatorCategory4(body);
                Assert.ok(category4.includes("a summary clause that disposes of several tasks at once leaves every task it covers unaudited"), "category 4 must treat a per-task summary clause as leaving every task it covers unaudited");
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

    test("names no occurrence of the removed AI-tool host, case-insensitively", {
        ARRANGE() {
            return { removedHost: REMOVED_HOST_NAME };
        },
        ACT() { return specSkillBody; },
        ASSERT(body, { removedHost }) {
            Assert.strictEqual(body.toLowerCase().includes(removedHost.toLowerCase()), false);
        }
    });

    test("covers clarification phase", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "mentions clarification phase"(body) {
                Assert.ok(body.includes("Clarification phase"), "must mention clarification phase");
            },
            "batches independent clarification questions"(body) {
                Assert.ok(body.includes("ask that whole set together in a single interaction"), "must batch independent questions in a single interaction");
            },
            "falls back to one question per turn without a multi-question facility"(body) {
                Assert.ok(body.includes("when it provides no such facility, ask one question per turn"), "must fall back to one question per turn when no multi-question facility exists");
            },
            "phrases bounded-answer questions as multiple-choice through facility and chat alike"(body) {
                Assert.ok(body.includes("Phrase every question whose answer space is bounded as multiple-choice, through the facility and in chat alike"), "must commit bounded-answer questions to multiple-choice phrasing in both presentation paths");
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
                Assert.ok(body.includes("## Contract, rule, or behavior rule: how the skill classifies and places"), "must have Contract, rule, or behavior rule classification-and-placement section");
            },
            "classification and placement are the skill's own decisions"(body) {
                Assert.ok(body.includes("The classification and placement are the skill's own decisions"), "classification and placement must be the skill's own decisions");
            }
        }
    });

    test("frontmatter metadata and opening sole-deliverable sentence name the skill and its three writable folders", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "frontmatter declares the flanders-spec name"(body) {
                Assert.match(yamlFrontmatter(body), /^name: flanders-spec$/m);
            },
            "frontmatter description names .spec/contracts, .spec/rules, and .spec/flanders"(body) {
                Assert.ok(body.includes("description: Translate a free-form request into one or more spec markdown files inside the project's .spec/contracts, .spec/rules, and .spec/flanders folders."), "the frontmatter description must name .spec/contracts, .spec/rules, and .spec/flanders as the writable folders");
            },
            "opening sole-deliverable sentence names .spec/contracts, .spec/rules, and .spec/flanders"(body) {
                Assert.ok(body.includes("Your sole deliverable is one or more markdown files inside the project's \`.spec/contracts\`, \`.spec/rules\`, and \`.spec/flanders\` folders."), "the opening sole-deliverable sentence must name .spec/contracts, .spec/rules, and .spec/flanders as the writable folders");
            }
        }
    });

    test("defines what a behavior rule is", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "has a What a behavior rule is section"(body) {
                Assert.ok(body.includes("## What a behavior rule is"), "must have a What a behavior rule is section");
            },
            "defines a behavior rule as guidance governing how Flanders' own commands and skills behave"(body) {
                Assert.ok(body.includes("A behavior rule is a markdown document that governs how Flanders' own commands and skills behave when they work in the project"), "must define a behavior rule as guidance governing how Flanders' own commands and skills behave");
            },
            "distinguishes a behavior rule from contracts and rules that describe the host project's code"(body) {
                Assert.ok(body.includes("as distinct from contracts and rules, which describe the host project's own code"), "must distinguish a behavior rule from contracts and rules describing the host project's code");
            },
            "states a behavior rule lives in .spec/flanders folders"(body) {
                Assert.ok(body.includes("Behavior rules live in \`.spec/flanders\` folders"), "must state a behavior rule lives in .spec/flanders folders");
            },
            "states all three spec kinds are immovable once written unless the user asks"(body) {
                Assert.ok(body.includes("Contracts, rules, and behavior rules are all immovable once written unless the user explicitly asks for a change."), "must state all three spec kinds are immovable once written unless the user asks");
                Assert.strictEqual(body.includes("Behavior rules are immovable once written unless the user explicitly asks for a change."), false);
            }
        }
    });

    test("classification section presents three kinds and routes a behavior rule to .spec/flanders", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "decides whether each obligation is a contract, a rule, or a behavior rule"(body) {
                Assert.ok(body.includes("the skill decides whether it is a contract, a rule, or a behavior rule"), "classification must decide among a contract, a rule, and a behavior rule");
            },
            "classifies guidance governing Flanders' own command behavior as a behavior rule"(body) {
                Assert.ok(body.includes("guidance that governs how Flanders' own commands and skills behave within a scope is a behavior rule"), "must classify guidance governing Flanders' own command behavior as a behavior rule");
            },
            "routes each kind to its folder including a behavior rule to .spec/flanders"(body) {
                Assert.ok(body.includes("A contract is written to the chosen scope's \`.spec/contracts\` folder, a rule to its \`.spec/rules\` folder, and a behavior rule to its \`.spec/flanders\` folder."), "must route a contract to .spec/contracts, a rule to .spec/rules, and a behavior rule to .spec/flanders");
            }
        }
    });

    test("states the dual-shape rule-separation policy at the five prompt locations", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            // Location 1 — "What a rule is" section
            "What a rule is makes the rule, not the file, the atomic unit and allows one or several rules per file"(body) {
                Assert.ok(body.includes("The rule is the atomic unit, not the file: each rule is a single atomic obligation, and a rule file holds one rule on its own, or several related rules as discrete atomic sections."), "the What a rule is section must make the rule the atomic unit and allow one rule on its own or several related rules as discrete atomic sections");
            },
            "the superseded one-rule-per-file sentence is gone"(body) {
                Assert.ok(!body.includes("Each rule file describes exactly one rule."), "the superseded \"Each rule file describes exactly one rule.\" sentence must be gone");
            },
            // Location 2 — "Bundles of related rules" paragraph
            "Bundles paragraph allows either a subfolder or a single grouping file, both keeping every rule atomic"(body) {
                Assert.ok(body.includes("are modeled either as a subfolder under the scope's \`.spec/rules\` folder containing one file per atomic rule, or as a single file that groups those related rules as discrete atomic sections. The atomic unit is the rule, not the file; both shapes keep every rule atomic."), "the Bundles paragraph must allow either a subfolder of single-rule files or a single grouping file, both keeping every rule atomic");
            },
            "the superseded never-multi-rule-file phrase is gone"(body) {
                Assert.ok(!body.includes("never as a single multi-rule file"), "the superseded \"never as a single multi-rule file\" phrase must be gone");
            },
            // Location 3 — Procedure .spec/rules organization bullet
            "procedure organization bullet enumerates the standalone, single-grouping, and subfolder shapes"(body) {
                Assert.ok(body.includes("the rule is the atomic unit, not the file. A standalone file holds one isolated rule; a single file groups a cluster of related rules as discrete atomic sections; and a subfolder holds a file per rule (or per sub-cluster) when the scope spans several distinct clusters"), "the procedure .spec/rules organization bullet must enumerate the standalone-file, single-grouping-file, and subfolder shapes");
            },
            "procedure organization bullet states both shapes are valid and each rule stays atomic"(body) {
                Assert.ok(body.includes("A subfolder of single-rule files and a single file grouping related rules as sections are both valid; each rule stays atomic in either shape."), "the procedure organization bullet must state both the subfolder-of-single-files shape and the single-file-grouping shape are valid and each rule stays atomic");
            },
            "the superseded MUST-be-a-subfolder phrase is gone"(body) {
                Assert.ok(!body.includes("MUST be modeled as a subfolder of single-rule files, never as one multi-rule file"), "the superseded \"MUST be modeled as a subfolder of single-rule files, never as one multi-rule file\" phrase must be gone");
            },
            // Location 4 — descriptive-filename bullet
            "descriptive-filename bullet refers to a rule or cluster of related rules"(body) {
                Assert.ok(body.includes("which rule or cluster of related rules each rule file pins"), "the descriptive-filename bullet must refer to which rule or cluster of related rules each rule file pins");
            },
            "the superseded single-rule filename phrase is gone"(body) {
                Assert.ok(!body.includes("which single rule each rule file pins"), "the superseded \"which single rule each rule file pins\" phrase must be gone");
            },
            // Location 5 — Validator B1. Format and shape
            "B1 accepts one or more atomic rules per file, each pinning exactly one obligation"(body) {
                Assert.ok(body.includes("captures one or more atomic rules — one rule on its own, or several related rules as discrete atomic sections, where each rule pins exactly one obligation"), "B1 must accept one or more atomic rules per file, each pinning exactly one obligation");
            },
            "B1 FAILs only on a fused non-atomic rule or a non-atomic section"(body) {
                Assert.ok(body.includes("a file is FAIL only when it fuses unrelated obligations into one non-atomic rule, or presents a section as a rule that is not itself atomic"), "B1 must FAIL only when a file fuses unrelated obligations into one non-atomic rule or presents a non-atomic section as a rule");
            },
            "B1 filename sub-point matches the descriptive-filename bullet"(body) {
                Assert.ok(body.includes("Its filename is descriptive of the rule or cluster of related rules it pins"), "B1's filename sub-point must refer to the rule or cluster of related rules the file pins, matching the descriptive-filename bullet");
            },
            "B1 models bundles as either a subfolder of one-file-per-rule or a single grouping file, both valid"(body) {
                Assert.ok(body.includes("bundles of related rules are modeled either as a subfolder containing one file per atomic rule or as a single file grouping those related rules as discrete atomic sections — both shapes are valid"), "B1 must model bundles as either a subfolder of one-file-per-rule or a single grouping file, both valid");
            },
            "the superseded B1 exactly-one-atomic-rule phrase is gone"(body) {
                Assert.ok(!body.includes("captures exactly one atomic rule (a file that pins two or more independent obligations is FAIL"), "the superseded B1 \"captures exactly one atomic rule (a file that pins two or more independent obligations is FAIL\" phrase must be gone");
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
            "places a spec in the lowest enclosing directory's .spec folder"(body) {
                Assert.ok(body.includes("the spec lands in the \`.spec\` folder of the lowest directory that encloses all the code its obligation governs"), "must place a spec in the lowest enclosing directory's .spec folder");
            },
            "covers the one-directory placement case"(body) {
                Assert.ok(body.includes("an obligation governing one directory goes in that directory's \`.spec\` folder"), "must cover the one-directory placement case");
            },
            "covers the nearest-common-ancestor placement case"(body) {
                Assert.ok(body.includes("an obligation spanning sibling directories goes in their nearest common ancestor's \`.spec\` folder"), "must cover the sibling/nearest-common-ancestor placement case");
            },
            "covers the project-boundary placement case"(body) {
                Assert.ok(body.includes("an obligation about project-boundary behavior goes in the project-root \`.spec\` folder"), "must cover the project-boundary placement case");
            }
        }
    });

    test("step 2 instructs recursive .spec discovery with git-ignore exclusion and root-relative namespaces", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "instructs recursive .spec discovery at every depth"(body) {
                Assert.ok(body.includes("Discover every directory named \`.spec\` across the whole project tree at every depth"), "step 2 must instruct recursive .spec discovery at every depth");
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

    test("step 2 builds the behavior-rule listing from .spec/flanders subfolders", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "the files under each .spec/flanders subfolder form the behavior-rule listing"(body) {
                Assert.ok(body.includes("the files under each \`.spec/flanders\` subfolder form the behavior-rule listing"), "step 2 must build the behavior-rule listing from .spec/flanders subfolders");
            },
            "treats every file inside a .spec/flanders folder at any depth as a behavior rule"(body) {
                Assert.ok(body.includes("treating every file inside a \`.spec/flanders\` folder at any depth as a behavior rule"), "step 2 must treat every file inside a .spec/flanders folder at any depth as a behavior rule");
            }
        }
    });

    test("carries the obligation to honor in-scope behavior rules before persisting files", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "reads every in-scope behavior rule before persisting any file"(body) {
                Assert.ok(body.includes("Before persisting any file, read every behavior rule whose \`.spec/flanders\` scope encloses each file you are about to write"), "must read every in-scope behavior rule before persisting any file");
            },
            "scopes the read to the target's .spec folder and every parent .spec folder"(body) {
                Assert.ok(body.includes("the \`.spec\` folder you write the file into and every parent \`.spec\` folder"), "must scope behavior-rule reading to the target's .spec folder and every parent .spec folder");
            },
            "behavior rules govern how the skill names, places, and organizes the files it authors"(body) {
                Assert.ok(body.includes("Behavior rules govern how you name, place, and organize the files you author"), "behavior rules must govern naming, placement, and organization of the authored files");
            },
            "treats an in-scope behavior rule as binding, not advisory"(body) {
                Assert.ok(body.includes("an in-scope behavior rule is binding on that work, not advisory"), "an in-scope behavior rule must be binding, not advisory");
            }
        }
    });

    test("states cross-reference link form in project-root-relative namespace form", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "instructs writing every cross-reference as a markdown link"(body) {
                Assert.ok(body.includes("Write every cross-reference to another spec file as a markdown link"), "must instruct writing every cross-reference as a markdown link");
            },
            "states the link target is prefixed with a single leading slash"(body) {
                Assert.ok(body.includes("prefixed with a single leading slash"), "must state the link target is prefixed with a single leading slash");
            },
            "forbids a path computed relative to the referencing file"(body) {
                Assert.ok(body.includes("never as a path computed relative to the referencing file's own location"), "must forbid a path computed relative to the referencing file's own location");
            }
        }
    });

    test("specSkillBody names no root contracts/ or rules/ folder pair", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "names no root contracts/ path"(body) {
                Assert.ok(!body.includes("contracts/"), "every contracts reference must be a .spec/contracts folder, never a root contracts/ path");
            },
            "names no root rules/ path"(body) {
                Assert.ok(!body.includes("rules/"), "every rules reference must be a .spec/rules folder, never a root rules/ path");
            }
        }
    });

    test("obliges the layout summary to name the committed behavior the new text puts in violation", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "reports, per changed obligation, whether committed behavior is left in violation"(body) {
                const draftingSection = sectionBetween(body, "Drafting phase", "Final validation");
                Assert.ok(draftingSection.includes("whether the new text leaves behavior the project has already committed in violation"), "the layout summary must report whether committed behavior is left in violation");
            },
            "names what the new text puts in violation"(body) {
                const draftingSection = sectionBetween(body, "Drafting phase", "Final validation");
                Assert.ok(draftingSection.includes("the code path, the tests, or the corpus obligation the new text now contradicts"), "the layout summary must name what it puts in violation");
            },
            "establishes it by comparing against the current text and checking code and tests"(body) {
                const draftingSection = sectionBetween(body, "Drafting phase", "Final validation");
                Assert.ok(draftingSection.includes("checking whether the project's code and tests implement the current requirement"), "the drafter must check the project's code and tests against the current requirement");
            },
            "scopes that check to the obligations the run changes"(body) {
                const draftingSection = sectionBetween(body, "Drafting phase", "Final validation");
                Assert.ok(draftingSection.includes("scope that check to the obligations the run changes, not the whole project"), "the check must be scoped to the changed obligations");
            },
            "reports a wording-only change as such"(body) {
                const draftingSection = sectionBetween(body, "Drafting phase", "Final validation");
                Assert.ok(draftingSection.includes("A change that alters only wording is reported as such"), "a wording-only change must be reported as such");
            },
            "forbids resolving such a conflict silently"(body) {
                const draftingSection = sectionBetween(body, "Drafting phase", "Final validation");
                Assert.ok(draftingSection.includes("Never resolve such a conflict silently"), "the drafter must not resolve the conflict silently instead of naming it");
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

    test("carries the active load-bearing-prohibition instruction in drafting guidance", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "states each obligation as the behavior the code performs"(body) {
                const draftingStart = body.indexOf("Drafting phase");
                const finalValidationStart = body.indexOf("Final validation");
                Assert.ok(draftingStart !== -1, "must have Drafting phase section");
                Assert.ok(finalValidationStart !== -1, "must have Final validation section");
                const draftingSection = body.slice(draftingStart, finalValidationStart);
                Assert.ok(draftingSection.includes("State each obligation as the behavior the code performs"), "the drafting guidance must instruct stating each obligation as the behavior the code performs");
            },
            "satisfies a removal request by describing the resulting positive behavior"(body) {
                const draftingSection = body.slice(body.indexOf("Drafting phase"), body.indexOf("Final validation"));
                Assert.ok(draftingSection.includes("satisfy a request to remove or stop a behavior by describing the resulting positive behavior, letting the removed behavior vanish by omission"), "the drafting guidance must satisfy a removal request by describing the resulting positive behavior");
            },
            "writes an explicit prohibition only when load-bearing"(body) {
                const draftingSection = body.slice(body.indexOf("Drafting phase"), body.indexOf("Final validation"));
                Assert.ok(draftingSection.includes("only when it is load-bearing"), "the drafting guidance must admit an explicit prohibition only when load-bearing");
            },
            "names the not-already-entailed load-bearing condition"(body) {
                const draftingSection = body.slice(body.indexOf("Drafting phase"), body.indexOf("Final validation"));
                Assert.ok(draftingSection.includes("its absence is not already entailed by a positive obligation"), "the drafting guidance must name the not-already-entailed load-bearing condition");
            },
            "names the guards-a-plausible-mistake load-bearing condition"(body) {
                const draftingSection = body.slice(body.indexOf("Drafting phase"), body.indexOf("Final validation"));
                Assert.ok(draftingSection.includes("it guards a behavior a competent implementer reading only the positive spec would plausibly introduce"), "the drafting guidance must name the guards-a-plausible-mistake load-bearing condition");
            }
        }
    });

    test("carries the active single-line-paragraph instruction in drafting guidance", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "instructs writing each paragraph as a single continuous line"(body) {
                const draftingSection = body.slice(body.indexOf("Drafting phase"), body.indexOf("Final validation"));
                Assert.ok(draftingSection.includes("Write each paragraph of prose as a single continuous line"), "the drafting guidance must instruct writing each paragraph as a single continuous line");
            },
            "permits a line break only where markdown structure requires it"(body) {
                const draftingSection = body.slice(body.indexOf("Drafting phase"), body.indexOf("Final validation"));
                Assert.ok(draftingSection.includes("insert a line break only where markdown structure requires it"), "the drafting guidance must permit a line break only where markdown structure requires it");
            },
            "forbids wrapping a paragraph to a maximum column width"(body) {
                const draftingSection = body.slice(body.indexOf("Drafting phase"), body.indexOf("Final validation"));
                Assert.ok(draftingSection.includes("Never break a paragraph across multiple lines to keep it within a maximum column width"), "the drafting guidance must forbid wrapping a paragraph to a maximum column width");
            }
        }
    });

    test("carries the active economy instruction in drafting guidance", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "instructs using the fewest files and words that state each obligation unambiguously"(body) {
                const draftingSection = body.slice(body.indexOf("Drafting phase"), body.indexOf("Final validation"));
                Assert.ok(draftingSection.includes("Use the fewest files and the fewest words that state each obligation unambiguously"), "the drafting guidance must instruct using the fewest files and words that state each obligation unambiguously");
            },
            "writes content only when it carries something not already carried elsewhere"(body) {
                const draftingSection = body.slice(body.indexOf("Drafting phase"), body.indexOf("Final validation"));
                Assert.ok(draftingSection.includes("only when it carries something not already carried elsewhere"), "the drafting guidance must write content only when it carries something not already carried elsewhere");
            },
            "reaches for more only when fewer would leave ambiguity or fuse separable concerns"(body) {
                const draftingSection = body.slice(body.indexOf("Drafting phase"), body.indexOf("Final validation"));
                Assert.ok(draftingSection.includes("reach for more files or more words only when fewer would leave an obligation ambiguous or would fuse genuinely separable concerns into one place"), "the drafting guidance must reach for more only when fewer would leave ambiguity or fuse separable concerns");
            }
        }
    });

    test("restricts writes to .spec/contracts, .spec/rules, and .spec/flanders folders only", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes("You must not write, modify, or delete any source code or any file outside the project's \`.spec/contracts\`, \`.spec/rules\`, and \`.spec/flanders\` folders."), "must restrict writes to the project's .spec/contracts, .spec/rules, and .spec/flanders folders");
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

    test("addresses the user in the soft Flanders voice excluding the contract and rule files it authors", {
        ARRANGE() {
            return { voice: expectedSkillVoice("the contract and rule files you author") };
        },
        ACT() { return specSkillBody; },
        ASSERTS: {
            "contains the user-facing tone instruction verbatim with the contract-and-rule-files exclusion"(body, { voice }) {
                Assert.ok(body.includes(voice), "specSkillBody must contain the user-facing Flanders-voice section verbatim, excluding the contract and rule files it authors");
            },
            "names no sample greeting exemplar anywhere in the body"(body) {
                Assert.strictEqual(body.includes(`"neighbor"`), false);
            },
            "names no sample interjection exemplar anywhere in the body"(body) {
                Assert.strictEqual(body.includes(`"okely-dokely"`), false);
            },
            "names no sample suffix exemplar anywhere in the body"(body) {
                Assert.strictEqual(body.includes(`"-diddly-"`), false);
            },
            "the tone instruction excludes machine-read tokens"(body) {
                Assert.ok(userFacingVoiceSection(body).includes("machine-read tokens"), "the tone instruction must keep the flavor out of machine-read tokens");
            },
            "the tone instruction excludes git commit messages"(body) {
                Assert.ok(userFacingVoiceSection(body).includes("git commit messages"), "the tone instruction must keep the flavor out of git commit messages");
            },
            "the tone instruction cites no flanders-internal spec path"(body) {
                Assert.strictEqual(FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH.test(userFacingVoiceSection(body)), false);
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
            },
            "names .spec/contracts, .spec/rules, and .spec/flanders as the unprotected folders"(body) {
                Assert.ok(body.includes("Existing files in the project's \`.spec/contracts\`, \`.spec/rules\`, and \`.spec/flanders\` folders are not protected."), "idempotency must name .spec/contracts, .spec/rules, and .spec/flanders as the unprotected folders");
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
            "re-entered clarification carries the batched cadence by reference, without restating it"(body) {
                Assert.ok(body.includes("Re-entered clarification follows the same cadence the clarification phase above defines, scoped to the specific ambiguity at hand and never re-asking decisions the user has already given in this invocation."), "re-entered clarification must carry the batched cadence by referencing the clarification phase above");
                Assert.strictEqual(body.includes("otherwise asking one question per turn"), false);
            },
            "re-entered clarification drops the no-bundling restriction"(body) {
                Assert.ok(!body.includes("no bundling"), "re-entered clarification must not restate the no-bundling restriction");
            },
            "does not declare complete on exhaustion"(body) {
                Assert.ok(body.includes("do not declare complete"), "must not declare complete on exhaustion");
            },
            "surfaces the last FAIL report on exhaustion"(body) {
                Assert.ok(body.includes("surface the last FAIL report"), "must surface the last FAIL report on exhaustion");
            }
        }
    });

    test("Final validation audits a .spec/flanders file by the non-contradiction category only", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERT(body) {
            Assert.ok(body.includes("A file that landed in a \`.spec/flanders\` folder is audited by the non-contradiction category C only; categories A and B audit files in \`.spec/contracts\` and \`.spec/rules\` folders respectively."), "Validator checks must state a .spec/flanders file is audited by category C only, with categories A and B auditing .spec/contracts and .spec/rules files respectively");
        }
    });

    test("validator checks inline the per-item adjudication protocol", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "validator inputs name the protocol as part of the verbatim text the host inlines"(body) {
                const inputsSection = validatorInputsSection(body);
                Assert.ok(inputsSection.includes("The verbatim text of the check categories below, together with the per-item adjudication protocol stated alongside them. The host MUST inline these categories and that protocol in the validator's prompt"), "Validator inputs must name the per-item adjudication protocol as part of the verbatim text the host inlines");
            },
            "forbids aggregate adjudication and requires one verdict line per applicable item per file"(body) {
                const checks = specValidatorChecksSection(body);
                Assert.ok(checks.includes("Every applicable check item is adjudicated per file individually, never in aggregate: for each file under audit, render every applicable check item — each format-and-shape item, each content item, and the non-contradiction category — as its own verdict line, PASS or FAIL, produced from the record the item's kind requires"), "validator checks must forbid aggregate adjudication and require one verdict line per applicable item per file");
            },
            "requires presence checks to name the satisfying element"(body) {
                const checks = specValidatorChecksSection(body);
                Assert.ok(checks.includes("Presence checks — a check satisfied by an element the file must carry, such as a descriptive filename, an explicit scope-of-enforcement section, atomic rule sections, or cross-references written as markdown links — name or quote the satisfying element, and a FAIL names the missing or malformed element with its file:line"), "validator checks must require presence checks to name or quote the satisfying element");
            },
            "requires absence checks to quote the offending passage or commit to a full read"(body) {
                const checks = specValidatorChecksSection(body);
                Assert.ok(checks.includes("Absence checks — a check violated by content the file must not carry, such as placeholders, hedge phrasing, historical or migration content, implementation detail in a contract, or an obligation duplicated across files — quote the offending passage with its file:line on FAIL, and on PASS commit that a full read of the file surfaced no occurrence"), "validator checks must require absence checks to quote the offending passage on FAIL and commit to a full read on PASS");
            },
            "requires the non-contradiction verdict to name the corpus files read and compared"(body) {
                const checks = specValidatorChecksSection(body);
                Assert.ok(checks.includes("The non-contradiction verdict names the corpus files read and compared to reach it — a non-contradiction verdict that names no consulted corpus file is not an adjudication — and a flagged contradiction quotes both sides with their file:line"), "validator checks must require the non-contradiction verdict to name the corpus files consulted and quote both sides of a flagged contradiction");
            },
            "bans conditional adjudication and FAILs a genuinely open reading"(body) {
                const checks = specValidatorChecksSection(body);
                Assert.ok(checks.includes("A verdict conditioned on an unresolved reading — \"compatible under either reading\", \"fine either way\", or any wording that leaves the reading unresolved — is not a verdict: resolve which reading the corpus text sustains and judge that reading alone; when the audited text genuinely admits both readings, that openness is itself an ambiguous-wording FAIL, never a ground for passing the item"), "validator checks must ban conditional adjudication and FAIL a genuinely open reading");
            },
            "blocks a category while any item is unaudited and voids summary clauses"(body) {
                const checks = specValidatorChecksSection(body);
                Assert.ok(checks.includes("An item missing the record its kind requires is unaudited, and a category is not reported as passed while any of its items is unaudited; a summary clause that disposes of several items or several files at once leaves everything it covers unaudited"), "validator checks must block a category with unaudited items and treat summary clauses as leaving their items unaudited");
            }
        }
    });

    test("the per-item protocol pins the record a source-grounded category C verdict rests on", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "names the governed-source file:line when the judgment is source-grounded"(body) {
                Assert.ok(specValidatorChecksSection(body).includes("When that judgment is source-grounded, the verdict also names the file:line of the governed source read"), "the per-item protocol must make a source-grounded non-contradiction verdict name the file:line of the governed source read");
            },
            "cites that source alongside both obligations on a flagged source-grounded contradiction"(body) {
                Assert.ok(specValidatorChecksSection(body).includes("a flagged source-grounded contradiction cites that source alongside both obligations."), "the per-item protocol must make a flagged source-grounded contradiction cite the governed source alongside both obligations");
            },
            "states the source-grounded verdict record after the corpus-files record it extends"(body) {
                const checks = specValidatorChecksSection(body);
                Assert.ok(checks.indexOf("When that judgment is source-grounded") > checks.indexOf("The non-contradiction verdict names the corpus files read and compared to reach it"), "the source-grounded verdict record must follow the corpus-files record it extends");
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
            "names the Claude Code Agent tool for the validator"(body) {
                Assert.ok(body.includes("In Claude Code, the host spawns the validator through the Agent tool."), "must name the Claude Code Agent tool for the validator");
            },
            "names the Codex CLI subagent surface for the validator and names no host after it"(body) {
                Assert.ok(body.includes("In Codex CLI, the host spawns it through whatever Codex documents as its subagent surface at the time of the run.\n"), "the subagent-mechanism clause must name the Codex CLI surface and end there, naming no further host after it");
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
                FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH.test(body),
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
                const inputsSection = validatorInputsSection(body);
                Assert.ok(inputsSection.includes("When this run renamed, relocated, or removed a term that can recur across the corpus (per the Rename sweep obligation in the procedure above), the explicit list of those old term(s)."), "Validator inputs must pass the explicit list of renamed/relocated/removed terms");
            },
            "states the list is empty when no such term changed"(body) {
                const inputsSection = validatorInputsSection(body);
                Assert.ok(inputsSection.includes("The list is empty when the run changed no such term."), "Validator inputs must state the term list is empty when no such term changed");
            }
        }
    });

    test("Category C carries the renamed-term sweep check", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "names the renamed-term sweep check inside category C"(body) {
                const categoryC = specValidatorCategoryC(body);
                Assert.ok(categoryC.includes("**Renamed-term sweep.** For each old term the host passed (the terms this run renamed, relocated, or removed), the validator searches the whole corpus for that term and inspects every occurrence."), "category C must carry the per-term whole-corpus renamed-term sweep check");
            },
            "FAILs a stale un-updated occurrence"(body) {
                const categoryC = specValidatorCategoryC(body);
                Assert.ok(categoryC.includes("An occurrence that is a stale, un-updated instance of the renamed term — a leftover that should have been changed in this run — is FAIL."), "category C must FAIL a stale un-updated occurrence");
            },
            "treats an intentional reference as not a violation"(body) {
                const categoryC = specValidatorCategoryC(body);
                Assert.ok(categoryC.includes("An occurrence that is an intentional reference the rename correctly leaves alone is not a violation."), "category C must treat an intentional reference as not a violation");
            },
            "drives the check from the passed terms, not the validator's relevance judgment"(body) {
                const categoryC = specValidatorCategoryC(body);
                Assert.ok(categoryC.includes("The validator drives this check from the passed term(s), not from its own judgment of which files are relevant"), "category C must drive the check from the passed terms rather than the validator's relevance judgment");
            },
            "is vacuously satisfied when the passed list is empty"(body) {
                const categoryC = specValidatorCategoryC(body);
                Assert.ok(categoryC.includes("When the passed list is empty, this check is vacuously satisfied."), "category C must be vacuously satisfied when the passed list is empty");
            }
        }
    });

    test("Category C carries the source-grounded contradiction form", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "keeps the text-against-text form the source-grounded form is added to"(body) {
                Assert.ok(specValidatorCategoryC(body).includes("A contradiction is an obligation pinned in two places with incompatible content."), "category C must keep the text-against-text definition of a contradiction");
            },
            "makes a jointly unsatisfiable pair governing the same code a contradiction"(body) {
                Assert.ok(specValidatorCategoryC(body).includes("A contradiction also takes a source-grounded form: when a file written or updated in this run and an existing corpus spec each govern the behavior of the same code, and — though each obligation is satisfiable on its own — no implementation of that code can satisfy both at once, the pair is a contradiction even where the two spec texts read as compatible."), "category C must make a run file and a corpus spec that jointly govern one code and cannot both be implemented a contradiction, even where the two spec texts read as compatible");
            },
            "establishes it against the governed source read on disk, not the two spec texts alone"(body) {
                Assert.ok(specValidatorCategoryC(body).includes("The validator establishes this against the state of the governed source it reads on disk, not from the two spec texts alone."), "category C must establish the source-grounded form against the state of the governed source read on disk rather than from the two spec texts alone");
            },
            "states the citation obligation once, leaving it to the per-item protocol"(body) {
                Assert.strictEqual(sourceGroundedContradictionForm(body).includes("cites that source alongside both obligations"), false);
            },
            "bounds the audit to the files this run wrote or updated, judged against the corpus"(body) {
                Assert.ok(specValidatorCategoryC(body).includes("This audit is bounded to the file(s) this run wrote or updated, judged against the corpus;"), "category C must bound the source-grounded audit to the files this run wrote or updated, judged against the corpus");
            },
            "is not a sweep for latent contradictions between specs the run did not touch"(body) {
                Assert.ok(specValidatorCategoryC(body).includes("it is not a sweep for latent contradictions between specs the run did not touch."), "category C must exclude a sweep for latent contradictions between specs the run did not touch");
            },
            "the source-grounded form names no path under contracts/, rules/, flanders/, or plans/"(body) {
                Assert.strictEqual(FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH.test(sourceGroundedContradictionForm(body)), false);
            },
            "the source-grounded form contains no .md path at all"(body) {
                Assert.strictEqual(sourceGroundedContradictionForm(body).includes(".md"), false);
            }
        }
    });

    test("Validator inputs ground category C in the source a run file and a corpus spec jointly govern", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "reads the on-disk source a run file and a corpus spec jointly govern"(body) {
                Assert.ok(validatorInputsSection(body).includes("It also reads the on-disk source that a file written or updated in this run and a corpus spec jointly govern"), "Validator inputs must have the validator read the on-disk source a run file and a corpus spec jointly govern");
            },
            "rests category C's judgment on that source rather than the two spec texts alone"(body) {
                Assert.ok(validatorInputsSection(body).includes("so category C's judgment rests on the behavior that source pins rather than on the two spec texts alone"), "Validator inputs must rest category C's judgment on the behavior the governed source pins rather than on the two spec texts alone");
            },
            "keeps that source read read-only"(body) {
                Assert.ok(validatorInputsSection(body).includes("that source read is read-only."), "Validator inputs must state the governed-source read is read-only");
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

    test("recommends and launches the next step once the spec is complete", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "has the Recommending and launching the next step section"(body) {
                Assert.ok(body.includes("## Recommending and launching the next step"), "must have the Recommending and launching the next step section");
            },
            "offers the next step only after declaring the spec complete"(body) {
                Assert.ok(body.includes("Once you have declared the spec complete"), "must offer the next step only after declaring the spec complete");
            },
            "makes no offer when the validation loop exhausts without a PASS"(body) {
                Assert.ok(body.includes("surface the last FAIL report and stop, and make no such offer"), "must make no offer when the validation loop exhausts without a PASS");
            },
            "asks which skill to launch: plan, work, or neither"(body) {
                Assert.ok(body.includes("which skill to launch next: /flanders-plan, /flanders-implement, or neither"), "must ask which skill to launch next, offering plan, work, or neither");
            },
            "ends the completion declaration with the launch question as plain chat text"(body) {
                Assert.ok(body.includes("End the same chat message that carries your completion declaration with that launch question asked as plain chat text"), "must end the completion-declaration message with the launch question as plain chat text");
            },
            "never routes the launch question through the question facility"(body) {
                Assert.ok(body.includes("never through a facility your AI tool provides for asking questions"), "must state the launch question never goes through the question facility");
                Assert.strictEqual(body.includes("Present that choice through the same question facility"), false, "must not carry the facility routing for the launch question");
            },
            "the report and its question arrive together in one message"(body) {
                Assert.ok(body.includes("so the report and its question arrive together in one message"), "must state the report and its question arrive together in one message");
            },
            "recommends work for a single small self-contained change"(body) {
                Assert.ok(body.includes("recommend /flanders-implement when the spec describes a single, small, self-contained change"), "must recommend /flanders-implement for a single, small, self-contained change");
            },
            "recommends plan for larger multi-step or multi-scope work"(body) {
                Assert.ok(body.includes("recommend /flanders-plan when the spec describes larger work that spans multiple obligations or scopes or needs an ordered, multi-step implementation"), "must recommend /flanders-plan for larger multi-step or multi-scope work");
            },
            "lets the user accept the recommendation, choose the other, or decline"(body) {
                Assert.ok(body.includes("The user accepts the recommendation, chooses the other skill, or declines"), "must let the user accept the recommendation, choose the other skill, or decline");
            },
            "launches the chosen skill in the same session with no <data> argument"(body) {
                Assert.ok(body.includes("launch it by invoking it in the same session with no <data> argument"), "must launch the chosen skill in the same session with no <data> argument");
            },
            "the launched skill takes its input from the conversation"(body) {
                Assert.ok(body.includes("so the launched skill takes its input from the conversation — the original request together with the spec you just wrote"), "the launched skill must take its input from the conversation");
            },
            "launching leaves the spec skill's own deliverable and write boundary unchanged"(body) {
                Assert.ok(body.includes("leaves your own deliverable and write boundary unchanged, so you write only this run's spec files and never code or a plan file"), "launching must leave the spec skill's own deliverable and write boundary unchanged");
            },
            "ends the run when the user declines"(body) {
                Assert.ok(body.includes("When the user declines, end the run."), "must end the run when the user declines");
            },
            "the section appears after Final validation and before Output language"(body) {
                Assert.ok(body.indexOf("## Recommending and launching the next step") > body.indexOf("## Final validation"), "the section must appear after the Final validation section");
                Assert.ok(body.indexOf("## Recommending and launching the next step") < body.indexOf("## Output language"), "the section must appear before the Output language section");
            }
        }
    });

    test("delivers every owed chat presentation as its own message before the question that follows it", {
        ARRANGE() {},
        ACT() { return specSkillBody; },
        ASSERTS: {
            "has the Chat presentations precede questions section"(body) {
                Assert.ok(body.includes("## Chat presentations precede questions"), "must have the Chat presentations precede questions section");
            },
            "names every owed presentation and orders it before the question that follows it"(body) {
                Assert.ok(body.includes("Print every presentation a step of this skill owes the user in chat — the approach trade-off summaries of the clarification phase, the drafting-phase layout summary — as its own chat message before the question that follows it"), "must name the trade-off summaries and the layout summary as presentations printed as their own chat message before the question that follows them");
            },
            "covers the question facility and the plain-chat question alike"(body) {
                Assert.ok(body.includes("whether that question goes through a facility your AI tool provides for asking questions or is asked as plain chat text"), "must cover a question put through the AI tool's question facility and a plain chat question alike");
            },
            "the question decides only the choice it asks"(body) {
                Assert.ok(body.includes("The question decides only the choice it asks"), "must state the question decides only the choice it asks");
            },
            "content embedded in the question interaction is not the presentation"(body) {
                Assert.ok(body.includes("content embedded in the question interaction — its text, its option labels, or its option descriptions — is not the presentation"), "must state that content embedded in the question interaction is not the presentation");
            },
            "a user-supplied analysis does not waive the presentation"(body) {
                Assert.ok(body.includes("the user having supplied their own analysis of the same matter does not waive it — state your own finding, where it confirms their account and where it diverges, before asking"), "must state a user-supplied analysis does not waive the presentation and the skill states its own finding before asking");
            },
            "the section appears after Recommending and launching and before Output language"(body) {
                Assert.ok(body.indexOf("## Chat presentations precede questions") > body.indexOf("## Recommending and launching the next step"), "the section must appear after the Recommending and launching the next step section");
                Assert.ok(body.indexOf("## Chat presentations precede questions") < body.indexOf("## Output language"), "the section must appear before the Output language section");
            }
        }
    });
});

test.describe("skills – implementSkillBody", test => {
    test("publishes the orchestrator identity and invocation contract", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "starts with YAML frontmatter"(body) {
                Assert.ok(body.startsWith("---\n"));
            },
            "describes the same single-task cycle as the implement command"(body) {
                Assert.ok(body.includes("description: Orchestrate one request through the same single-task cycle that the implement command runs per task, without authoring a plan."));
            },
            "names the installed skill"(body) {
                Assert.ok(body.includes("You are the /flanders-implement skill."));
            },
            "frontmatter declares the flanders-implement name"(body) {
                Assert.match(yamlFrontmatter(body), /^name: flanders-implement$/m);
            },
            "frontmatter carries a description field"(body) {
                Assert.ok(yamlFrontmatter(body).includes("description:"), "frontmatter must carry a description field");
            },
            "makes the resolved request the single task"(body) {
                Assert.ok(body.includes("The request you resolve is the cycle's single task."));
            },
            "orchestrates without implementing"(body) {
                Assert.ok(body.includes("you implement nothing yourself and author no plan"));
            }
        }
    });

    test("resolves all three data forms and preserves the request", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "takes omitted data from the conversation"(body) {
                Assert.ok(body.includes("If <data> is omitted, take the user's natural-language request from the conversation."));
            },
            "reads an existing path"(body) {
                Assert.ok(body.includes("resolves to an existing file path, read the file's content and use it as the request."));
            },
            "uses non-path data verbatim"(body) {
                Assert.ok(body.includes("does not resolve to an existing file, use the value verbatim as the inline request."));
            },
            "keeps the request verbatim for worker and reviewers"(body) {
                Assert.ok(body.includes("Keep the resolved request verbatim. It is the task text injected into the first worker invocation and every reviewer invocation."));
            }
        }
    });

    test("loads one whole Flanders configuration by scope precedence", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "requires a git repository"(body) {
                Assert.ok(body.includes("Require the current project to be a git repository."));
            },
            "uses the project configuration first"(body) {
                Assert.ok(body.includes("If the project root contains a `.flanders/` folder, select its `.flanders/config.json` and ignore the global scope completely"));
            },
            "uses global only when project is absent"(body) {
                Assert.ok(body.includes("Otherwise, if `~/.flanders/` exists, select `~/.flanders/config.json`."));
            },
            "never merges fields"(body) {
                Assert.ok(body.includes("Resolve the Flanders configuration by scope, never field by field"));
            },
            "directs a missing configuration to install"(body) {
                Assert.ok(body.includes("stop and tell the user to run `npx flanders install`"));
            },
            "does not fall back from a malformed selected file"(body) {
                Assert.ok(body.includes("do not fall back to or merge the other scope"));
            },
            "does not fall back when the selected file is missing or unreadable"(body) {
                Assert.ok(body.includes("even when the selected file is missing, unreadable, or malformed"));
            },
            "requires weighted reviewer fields"(body) {
                Assert.ok(body.includes("`minimumReviews`, an integer from 1 through the reviewer count"));
            },
            "requires the exact top-level configuration keys"(body) {
                Assert.ok(body.includes("top-level keys to be exactly `worker`, `reviewers`, and `minimumReviews`"));
            },
            "validates fast-mode compatibility"(body) {
                Assert.ok(body.includes("Require `fast` to be false unless the role uses Claude Code with a model that supports fast mode."));
            },
            "reads but never writes the configuration"(body) {
                Assert.ok(body.includes("Read this configuration; never write it."));
            }
        }
    });

    test("commits every pending spec path before work and baseline capture", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "runs before workspace setup"(body) {
                Assert.ok(body.includes("Before workspace setup, baseline capture, or worker work"));
            },
            "runs before baseline capture"(body) {
                Assert.ok(body.includes("Before workspace setup, baseline capture, or worker work"));
            },
            "runs before worker work"(body) {
                Assert.ok(body.includes("Before workspace setup, baseline capture, or worker work"));
            },
            "checks staged unstaged and untracked changes"(body) {
                Assert.ok(body.includes("inspect staged, unstaged, and untracked changes"));
            },
            "matches a .spec directory at any depth"(body) {
                Assert.ok(body.includes("any changed path that traverses a directory whose name is exactly `.spec`, at any depth"));
            },
            "commits exactly changed spec files"(body) {
                Assert.ok(body.includes("stage and commit exactly all changed spec files without including pending non-spec files"));
            },
            "uses the fixed English message"(body) {
                Assert.ok(body.includes("`Commit pending spec changes`"));
            },
            "does not commit when there are none"(body) {
                Assert.ok(body.includes("When none has changed, make no commit."));
            },
            "reports git output and stops on failure"(body) {
                Assert.ok(body.includes("If staging or committing those files fails, report git's stdout and stderr and stop."));
            },
            "applies failure handling to staging and committing"(body) {
                Assert.ok(body.includes("If staging or committing those files fails"));
            }
        }
    });

    test("provisions isolated temporary folders and detected gate scripts", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "creates the main folder"(body) {
                Assert.ok(body.includes("Create one main temporary folder"));
            },
            "creates one independent folder per reviewer"(body) {
                Assert.ok(body.includes("independently create one temporary folder per configured reviewer"));
            },
            "forbids reviewer-folder nesting"(body) {
                Assert.ok(body.includes("never inside the main folder or another reviewer folder"));
            },
            "assigns scripts and per-iteration logs to the main folder"(body) {
                Assert.ok(body.includes("The main folder holds the gate scripts, per-iteration worker/build/test/reviewer output logs, the briefing `error.log`, and a possible worker-declared `hard-stop.log`."));
            },
            "captures every detection launch in one run-wide log"(body) {
                Assert.ok(body.includes("Append each detect-agent invocation's stream to the main folder's `detect.log`."));
            },
            "isolates each reviewer verdict and reference material"(body) {
                Assert.ok(body.includes("Each reviewer folder holds only that reviewer's `error.log` verdict and any reference material supplied to that reviewer."));
            },
            "chooses Windows script names"(body) {
                Assert.ok(body.includes("`build.bat` and `test.bat` on Windows"));
            },
            "chooses non-Windows script names"(body) {
                Assert.ok(body.includes("`build.sh` and `test.sh` elsewhere"));
            },
            "runs detection with worker fields"(body) {
                Assert.ok(body.includes("configured worker's tool, model, effort, and fast values"));
            },
            "tracks build and test independently"(body) {
                Assert.ok(body.includes("inspect the two chosen paths independently"));
            },
            "uses each present non-empty gate file as its script"(body) {
                Assert.ok(body.includes("A present non-empty file is that gate's script"));
            },
            "skips each absent or empty gate file"(body) {
                Assert.ok(body.includes("an absent or empty file means the command was not determined and that gate is skipped"));
            },
            "passes the same paths to workers"(body) {
                Assert.ok(body.includes("Pass these same two paths to every worker invocation."));
            },
            "limits detect writes to the chosen paths"(body) {
                Assert.ok(body.includes("The detect agent writes nowhere except these paths."));
            }
        }
    });

    test("embeds all shared citation-free prompt cores", {
        ARRANGE() {
            return {
                detect: detectBuildAndTestPromptCore,
                worker: workerPromptCore,
                reviewer: reviewerMethodologyCore,
                diagnosis: hardStopDiagnosisCore
            };
        },
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "embeds detection core verbatim"(body, { detect }) {
                Assert.ok(body.includes(detect));
            },
            "embeds worker core verbatim"(body, { worker }) {
                Assert.ok(body.includes(worker));
            },
            "embeds reviewer methodology verbatim"(body, { reviewer }) {
                Assert.ok(body.includes(reviewer));
            },
            "embeds hard-stop diagnosis verbatim"(body, { diagnosis }) {
                Assert.ok(body.includes(diagnosis));
            },
            "receives exactly the three cycle-agent entry-point boundaries through the embedded cores"(body) {
                Assert.strictEqual(body.split("Flanders entry-point boundary:").length - 1, 3);
            }
        }
    });

    test("injects the reviewer baseline only through the methodology core", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "has exactly one reviewer baseline placeholder"(body) {
                Assert.strictEqual(body.match(/<RUN_BASELINE>/g)?.length, 1);
            },
            "replaces the methodology placeholder with the captured baseline"(body) {
                Assert.ok(body.includes("the methodology below with its run-baseline placeholder replaced by the captured baseline"));
            }
        }
    });

    test("discovers and injects the complete three-part project spec corpus", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "walks every .spec directory at every depth"(body) {
                Assert.ok(body.includes("discover every directory named `.spec` at any depth"));
            },
            "excludes git-ignored paths"(body) {
                Assert.ok(body.includes("traverse the non-git-ignored project tree"));
            },
            "collects contract namespaces"(body) {
                Assert.ok(body.includes("every file below each `.spec/contracts` directory"));
            },
            "collects rule namespaces"(body) {
                Assert.ok(body.includes("every file below each `.spec/rules` directory"));
            },
            "collects behavior-rule namespaces"(body) {
                Assert.ok(body.includes("every file below each `.spec/flanders` directory, including nested files"));
            },
            "builds three separate complete lists"(body) {
                Assert.ok(body.includes("Build three complete, separate namespace lists"));
            },
            "uses project-root-relative namespaces"(body) {
                Assert.ok(body.includes("each path relative to the project root"));
            },
            "distinguishes homonyms by full namespace"(body) {
                Assert.ok(body.includes("Keep same-named files distinct by their full namespaces."));
            },
            "puts all lists in every worker and reviewer prompt"(body) {
                Assert.ok(body.includes("Put all three lists in every worker and reviewer prompt."));
            },
            "places lists above methodology"(body) {
                Assert.ok(body.indexOf("## Available contracts") < body.indexOf("## Adversarial review awaits"));
            },
            "states the list placement explicitly"(body) {
                Assert.ok(body.includes("place the lists above the role methodology"));
            }
        }
    });

    test("launches configured agents as awaited non-interactive maximum-access processes", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "launches every agent as a separate process"(body) {
                Assert.ok(body.includes("Launch the detect agent, worker, and each reviewer as separate processes"));
            },
            "maps detect to worker configuration"(body) {
                Assert.ok(body.includes("Detect uses the worker entry"));
            },
            "maps worker to worker configuration"(body) {
                Assert.ok(body.includes("the worker uses the worker entry"));
            },
            "maps each reviewer to its own entry"(body) {
                Assert.ok(body.includes("reviewer N uses reviewer N's entry"));
            },
            "forbids subagents"(body) {
                Assert.ok(body.includes("Never run an agent as a subagent of this session"));
            },
            "forbids inline replacement"(body) {
                Assert.ok(body.includes("never perform an inline pass in its place"));
            },
            "requires non-interactive maximum access"(body) {
                Assert.ok(body.includes("Every invocation is non-interactive and receives the maximum access its CLI offers."));
            },
            "includes Claude maximum-access invocation"(body) {
                Assert.ok(body.includes("`--dangerously-skip-permissions`"));
            },
            "feeds Claude one stream-json user message through stdin"(body) {
                Assert.ok(body.includes("deliver the prompt as one user message in the input stream-json on stdin, then close stdin"));
            },
            "applies Claude fast mode through session settings"(body) {
                Assert.ok(body.includes("the `fastMode` session setting through `--settings`"));
            },
            "includes Codex maximum-access invocation"(body) {
                Assert.ok(body.includes("`-c sandbox_mode=danger-full-access`"));
            },
            "feeds Codex prompts through stdin"(body) {
                Assert.ok(body.includes("a trailing `-` that reads the prompt from stdin"));
            },
            "applies model effort and fast from each entry"(body) {
                Assert.ok(body.includes("Apply non-empty model and effort values and apply fast mode exactly when the entry enables it"));
            },
            "awaits each process in its launching turn"(body) {
                Assert.ok(body.includes("Wait for every process inside the same turn that launched it."));
            },
            "allows concurrency only for reviewers"(body) {
                Assert.ok(body.includes("Concurrent reviewers are the only concurrent agent launches"));
            },
            "lets no agent or command outlive its stage"(body) {
                Assert.ok(body.includes("No agent or command may survive the stage that started it."));
            },
            "contains no process-wide session-continuity instruction"(body) {
                const start = body.indexOf("Start every process in the project root.");
                const end = body.indexOf("\n\n", start);
                const instructions = body.slice(start, end);
                Assert.strictEqual(/\b(?:capture|retain|resume)\b[^.]*\bsession\b/i.test(instructions), false);
            },
            "terminates cancelled processes before verdict formation"(body) {
                Assert.ok(body.includes("terminate and await its process before forming the round verdict"));
            }
        }
    });

    test("runs every launched process unbounded in duration", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "covers every agent launch and relaunch plus both gate scripts"(body) {
                Assert.ok(body.includes("Every agent process launch or relaunch and every build or test script run follows this unbounded-duration rule"));
            },
            "omits a time limit when the host facility permits omission"(body) {
                Assert.ok(body.includes("when the host command facility lets you omit a time limit, name none"));
            },
            "uses the facility maximum when a limit is mandatory or capped"(body) {
                Assert.ok(body.includes("when a limit is mandatory or the facility caps its wait, supply the highest value it accepts"));
            },
            "waits for process exit or an explicit skill termination decision"(body) {
                Assert.ok(body.includes("Wait until the process exits or this skill decides to terminate it"));
            },
            "never ends a wait because time elapsed"(body) {
                Assert.ok(body.includes("elapsed time never ends the wait"));
            }
        }
    });

    test("absorbs limits errors login failures and worker relaunches", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "waits and relaunches usage limits"(body) {
                Assert.ok(body.includes("A usage or rate limit is a wait, not an error. Wait until retry is allowed and relaunch until the invocation completes."));
            },
            "relaunches the same agent after another error"(body) {
                Assert.ok(body.includes("Any other error relaunches the same agent."));
            },
            "counts ordinary errors per agent and iteration"(body) {
                Assert.ok(body.includes("Count consecutive errored invocations per agent and per current iteration"));
            },
            "counts detector errors in setup iteration zero"(body) {
                Assert.ok(body.includes("treating pre-cycle detection as iteration 0"));
            },
            "resets the count on completion"(body) {
                Assert.ok(body.includes("a completed invocation resets that agent's count"));
            },
            "stops on the third consecutive error with the error reproduced"(body) {
                Assert.ok(body.includes("On the third consecutive error, stop, name the agent, and reproduce the error."));
            },
            "never retries or counts authentication failure"(body) {
                Assert.ok(body.includes("Do not relaunch it or count it toward the error allowance"));
            },
            "enters authentication hard stop immediately"(body) {
                Assert.ok(body.includes("follow the authentication hard stop below immediately"));
            },
            "does not spend an iteration on worker relaunch"(body) {
                Assert.ok(body.includes("stays in the current iteration and does not consume a new iteration"));
            },
            "keeps the current later-iteration resume or fresh form on relaunch"(body) {
                Assert.ok(body.includes("resume the retained worker session when its identifier is available, otherwise use the fresh fallback defined below"));
            }
        }
    });

    test("builds every worker iteration from the standard core and preserves session continuity when available", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "fills only real iteration-one placeholders"(body) {
                const start = body.indexOf("On iteration 1,");
                const end = body.indexOf("Use the resulting core as the fresh worker prompt:", start);
                const instructions = body.slice(start, end);
                Assert.strictEqual(instructions.includes("briefing paths"), false);
                Assert.strictEqual(instructions.includes("replace the iteration"), false);
                Assert.ok(instructions.includes("Iteration 1 has no previous-iteration briefing."));
            },
            "captures the first session identifier"(body) {
                Assert.ok(body.includes("Capture and retain the worker session identifier surfaced during iteration 1."));
            },
            "injects the verbatim request in iteration one"(body) {
                Assert.ok(body.includes("replace its task-text placeholder with the resolved request verbatim"));
            },
            "injects the main gate and hard-stop paths in iteration one"(body) {
                Assert.ok(body.includes("replace the build, test, and hard-stop paths with the main-folder paths"));
            },
            "injects all three lists in iteration one"(body) {
                Assert.ok(body.includes("replace all three namespace-list placeholders with the discovered lists"));
            },
            "uses Claude's resume form"(body) {
                Assert.ok(body.includes("Resume with `--resume <session-id>`."));
            },
            "uses Codex's resume form"(body) {
                Assert.ok(body.includes("Resume through `codex exec resume <session-id>`"));
            },
            "uses the same worker core on every later iteration"(body) {
                Assert.ok(body.includes("Build every later iteration's prompt from the same worker core"));
            },
            "uses a continuation instruction in later iterations"(body) {
                Assert.ok(body.includes("replace the task-text placeholder with a short instruction to continue implementing the current request"));
            },
            "does not re-inject the request"(body) {
                Assert.ok(body.includes("Do not inject, summarize, or repeat the resolved request or previously supplied reference content."));
            },
            "retains every standard path and global list"(body) {
                Assert.ok(body.includes("reuse the same build, test, and hard-stop paths; inject the current three complete namespace lists"));
            },
            "briefing identifies the new iteration and prior problem"(body) {
                Assert.ok(body.includes("names the current iteration, states that the previous iteration produced a problem to review whose cause must be addressed as part of this iteration's work"));
            },
            "briefing points to the full error context"(body) {
                Assert.ok(body.includes("points to the main folder's `error.log` for the full context"));
            },
            "resumes when a session identifier exists"(body) {
                Assert.ok(body.includes("When a retained session identifier is available, launch every later iteration by resuming that session"));
            },
            "falls back to a fresh later invocation without a session identifier"(body) {
                Assert.ok(body.includes("If no identifier was captured, launch the same later-iteration prompt as a fresh invocation"));
            },
            "fresh fallback retains the standard methodology and paths"(body) {
                Assert.ok(body.includes("the global lists, gate paths, hard-stop path, full methodology, and briefing remain present"));
            },
            "fresh fallback can reread needed project files"(body) {
                Assert.ok(body.includes("it may reread the project files it needs"));
            },
            "retains a replacement session identifier"(body) {
                Assert.ok(body.includes("retain the replacement for subsequent launches"));
            }
        }
    });

    test("captures one fixed content baseline for reviewer change-set reduction", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "captures after the pending-spec commit"(body) {
                Assert.ok(body.includes("After the pending-spec commit and workspace setup, but before the first iteration"));
            },
            "captures after workspace setup"(body) {
                Assert.ok(body.includes("After the pending-spec commit and workspace setup, but before the first iteration"));
            },
            "captures before the first iteration"(body) {
                Assert.ok(body.includes("After the pending-spec commit and workspace setup, but before the first iteration"));
            },
            "captures staged and unstaged tracked content"(body) {
                Assert.ok(body.includes("staged and unstaged tracked changes"));
            },
            "captures untracked contents"(body) {
                Assert.ok(body.includes("untracked files and their contents"));
            },
            "captures deletions and renames"(body) {
                Assert.ok(body.includes("deletions, and renames"));
            },
            "keeps the baseline fixed for the run"(body) {
                Assert.ok(body.includes("Keep this fixed for the whole run."));
            },
            "injects the baseline into every reviewer prompt"(body) {
                Assert.ok(body.includes("Inject it into every reviewer prompt"));
            },
            "limits only review"(body) {
                Assert.ok(body.includes("The baseline limits review only"));
            },
            "leaves the entire pending tree in the cycle commit"(body) {
                Assert.ok(body.includes("the successful cycle commit still captures the entire pending tree"));
            }
        }
    });

    test("runs the six ordered cycle stages with a fixed five-iteration cap", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "starts iteration at zero with maximum five"(body) {
                Assert.ok(body.includes("Set `iteration` to 0 and the fixed maximum to 5."));
            },
            "hard-stops after five"(body) {
                Assert.ok(body.includes("If it is greater than 5, enter the iteration-cap hard stop."));
            },
            "checks worker hard stop before any gate"(body) {
                Assert.ok(body.includes("if it exists, enter the worker-declared hard stop before any gate"));
            },
            "stages all changes after worker"(body) {
                Assert.ok(body.includes("Otherwise run `git add -A`."));
            },
            "runs build before test"(body) {
                Assert.ok(body.indexOf("3. **Build.**") < body.indexOf("4. **Test.**"));
            },
            "passes an undetermined build gate"(body) {
                Assert.ok(body.includes("If the build script is absent or empty, pass this gate."));
            },
            "passes an undetermined test gate"(body) {
                Assert.ok(body.includes("A missing or empty script passes"));
            },
            "writes a failed stage to the briefing"(body) {
                Assert.ok(body.includes("overwrite the main `error.log` with both streams"));
            },
            "retains every failed stage in run history"(body) {
                Assert.ok(body.includes("Keep every failed stage's captured context in run history"));
            },
            "restarts after a failed build"(body) {
                Assert.ok(body.includes("retain that failure as this iteration's build-stage history, and restart at step 1"));
            },
            "applies build failure semantics to test"(body) {
                Assert.ok(body.includes("Apply the same semantics to the test script after build passes."));
            },
            "restarts after a failed review"(body) {
                Assert.ok(body.includes("records each violating reviewer's content as this iteration's review-stage history, and restarts at step 1"));
            },
            "runs commit only after review passes"(body) {
                Assert.ok(body.indexOf("5. **Adversarial review.**") < body.indexOf("6. **Commit.**"));
            }
        }
    });

    test("runs the weighted concurrent reviewer round from isolated verdict files", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "uses each reviewer's configuration and folder"(body) {
                Assert.ok(body.includes("with that reviewer's configuration and folder"));
            },
            "deletes every verdict file before launch"(body) {
                Assert.ok(body.includes("Before every reviewer process launch or relaunch"));
            },
            "deletes the reviewer verdict file across every relaunch cause"(body) {
                Assert.ok(body.includes("after an error, usage-limit wait, or successful completion without a verdict file — delete that reviewer's own `error.log` so it is absent"));
            },
            "gives each reviewer its own verdict path and write instruction"(body) {
                Assert.ok(body.includes("that reviewer's own verdict path and instruction to append violations there or create it empty on pass"));
            },
            "launches all reviewers concurrently"(body) {
                Assert.ok(body.includes("launch all reviewers concurrently"));
            },
            "captures each reviewer process output in the main folder"(body) {
                Assert.ok(body.includes("Stream each process into its per-iteration reviewer output log in the main folder."));
            },
            "inspects each reviewer file after successful completion"(body) {
                Assert.ok(body.includes("After each reviewer completes successfully, inspect only its own verdict file"));
            },
            "relaunches a missing-file reviewer without a cap"(body) {
                Assert.ok(body.includes("Relaunch that reviewer fresh, without a maximum count"));
            },
            "does not consume an iteration for a missing verdict"(body) {
                Assert.ok(body.includes("without consuming an iteration"));
            },
            "requires no running reviewer"(body) {
                Assert.ok(body.includes("Complete only when no reviewer is running"));
            },
            "requires every required verdict"(body) {
                Assert.ok(body.includes("every required reviewer has a verdict"));
            },
            "requires the configured minimum"(body) {
                Assert.ok(body.includes("at least `minimumReviews` reviewers have verdicts"));
            },
            "cancels only still-waiting optional reviewers"(body) {
                Assert.ok(body.includes("cancel every still-waiting optional reviewer"));
            },
            "never cancels a required reviewer"(body) {
                Assert.ok(body.includes("Never cancel a required reviewer."));
            },
            "reads only reviewers that reached a verdict"(body) {
                Assert.ok(body.includes("read the verdict file of every reviewer that reached a verdict"));
            },
            "concatenates in configured order with newlines"(body) {
                Assert.ok(body.includes("in configured order, join all contents unconditionally with one newline between files"));
            },
            "trims and tests the aggregate once"(body) {
                Assert.ok(body.includes("trim the joined string, and test that single string once"));
            },
            "passes an empty aggregate"(body) {
                Assert.ok(body.includes("empty passes"));
            },
            "briefs the next iteration with a non-empty aggregate"(body) {
                Assert.ok(body.includes("non-empty fails and becomes the next iteration's briefing"));
            }
        }
    });

    test("builds every reviewer prompt as a fresh independent verdict invocation", {
        ARRANGE() {
            return {
                voice: flandersToneInstruction(true)
            };
        },
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "launches every reviewer fresh and independently"(body) {
                Assert.ok(body.includes("Each reviewer is fresh and independent"));
            },
            "never captures a reviewer session identifier"(body) {
                Assert.ok(body.includes("never capture its session ID"));
            },
            "never resumes a reviewer session"(body) {
                Assert.ok(body.includes("or resume its session"));
            },
            "contains no positive reviewer session-continuity instruction"(body) {
                const start = body.indexOf("Each reviewer is fresh and independent");
                const end = body.indexOf("\n\n", start);
                const instructions = body.slice(start, end)
                    .replace("never capture its session ID or resume its session", "");
                Assert.strictEqual(/\b(?:capture|retain|resume)\b[^.]*\bsession\b/i.test(instructions), false);
            },
            "injects the verbatim request as the reviewed spec"(body) {
                Assert.ok(body.includes("the resolved request verbatim as the spec under review"));
            },
            "places all three lists above reviewer methodology"(body) {
                Assert.ok(body.includes("Keep the three lists above the methodology."));
            },
            "supplies the reviewer's verdict protocol"(body) {
                Assert.ok(body.includes("that reviewer's own verdict path and instruction to append violations there or create it empty on pass"));
            },
            "replaces the methodology baseline placeholder"(body) {
                Assert.ok(body.includes("the methodology below with its run-baseline placeholder replaced by the captured baseline"));
            },
            "includes the reviewer voice section"(body, { voice }) {
                Assert.ok(body.includes(voice));
            },
            "includes the read-only git boundary"(body) {
                Assert.ok(body.includes("the read-only git, governed-folder, and foreground-command boundaries"));
            },
            "includes the governed-folder boundary"(body) {
                Assert.ok(body.includes("the read-only git, governed-folder, and foreground-command boundaries"));
            },
            "includes the foreground-command boundary"(body) {
                Assert.ok(body.includes("the read-only git, governed-folder, and foreground-command boundaries"));
            }
        }
    });

    test("commits accepted work and reports committed success", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "carries the successful-completion section"(body) {
                Assert.ok(body.includes("## Successful completion"));
            },
            "stages the whole tree at commit"(body) {
                Assert.ok(body.includes("Run `git add -A`, derive an English single-line message"));
            },
            "derives the summary from the request"(body) {
                Assert.ok(body.includes("from the request that summarizes the work performed"));
            },
            "allows an empty commit"(body) {
                Assert.ok(body.includes("run `git commit --allow-empty`"));
            },
            "cycles on commit failure"(body) {
                Assert.ok(body.includes("records commit-stage history, and restarts at step 1"));
            },
            "automatically removes every temporary folder after the cycle commit"(body) {
                Assert.ok(body.includes("After the cycle's commit succeeds, remove every temporary folder automatically"));
            },
            "reports what was implemented"(body) {
                Assert.ok(body.includes("report what was implemented"));
            },
            "reports that it is committed"(body) {
                Assert.ok(body.includes("that the result is committed"));
            },
            "keeps both commit messages English"(body) {
                Assert.ok(body.includes("This is independent of the code the worker writes and of the English commit messages."));
            }
        }
    });

    test("diagnoses iteration and worker hard stops before asking for a next skill", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "diagnoses immediately without asking first"(body) {
                Assert.ok(body.includes("Diagnose this stop immediately in the same execution, without asking the user first."));
            },
            "uses the shared diagnosis procedure"(body) {
                Assert.ok(body.includes(hardStopDiagnosisCore));
            },
            "identifies the request that hard-stopped"(body) {
                Assert.ok(body.includes("Present the resolved request as the work that hard-stopped"));
            },
            "presents the verified root cause"(body) {
                Assert.ok(body.includes("the verified root cause"));
            },
            "presents the recommendation"(body) {
                Assert.ok(body.includes("and the recommendation in chat"));
            },
            "reproduces the worker declaration facts"(body) {
                Assert.ok(body.includes("reproduce verbatim the structural cause, evidence, and proposed unblocker recorded in the main `hard-stop.log`"));
            },
            "reports the worker declaration path"(body) {
                Assert.ok(body.includes("report that file's exact path"));
            },
            "verifies the worker declaration independently"(body) {
                Assert.ok(body.includes("treat the declaration as evidence and still perform the independent diagnosis"));
            },
            "recommends spec for a contract or rule defect"(body) {
                Assert.ok(body.includes("Recommend `/flanders-spec` when a defective or ambiguous contract or rule caused the stop."));
            },
            "recommends plan for an oversized request"(body) {
                Assert.ok(body.includes("Recommend `/flanders-plan` when the evidence shows the request is too large for one task"));
            },
            "states a narrower implement reinvocation without launching"(body) {
                Assert.ok(body.includes("state how to re-invoke `/flanders-implement` with that narrower request and recommend neither skill"));
            },
            "states an unchanged retry without launching"(body) {
                Assert.ok(body.includes("when the remedy is to repeat unchanged, say so and recommend neither"));
            },
            "asks the launch choice as plain chat text"(body) {
                Assert.ok(body.includes("a plain-text question asking which skill to launch — /flanders-spec, /flanders-plan, or neither"));
            },
            "keeps the diagnosis and launch question in one message"(body) {
                Assert.ok(body.includes("End the same chat message that carries the diagnosis with"));
            },
            "launches a chosen next skill in the same session without data"(body) {
                Assert.ok(body.includes("launch that skill in this same session with no `<data>` argument"));
            },
            "launches nothing when the user chooses neither"(body) {
                Assert.ok(body.includes("When the user chooses neither, or the remedy is a narrower or unchanged reinvocation, launch nothing."));
            },
            "launches nothing for a narrower or unchanged reinvocation remedy"(body) {
                Assert.ok(body.includes("the remedy is a narrower or unchanged reinvocation, launch nothing"));
            }
        }
    });

    test("handles authentication hard stop without work diagnosis", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "skips diagnosis"(body) {
                Assert.ok(body.includes("Do not diagnose or identify the work"));
            },
            "skips the launch question"(body) {
                Assert.ok(body.includes("do not ask a launch question"));
            },
            "reports the configured tool is not logged in"(body) {
                Assert.ok(body.includes("Report that the configured AI tool is not logged in"));
            },
            "asks the user to log in and reinvoke"(body) {
                Assert.ok(body.includes("tell the user to log in and re-invoke `/flanders-implement`"));
            },
            "preserves temporary folders"(body) {
                Assert.ok(body.includes("end with every temporary folder preserved"));
            },
            "reports the preserved main folder path"(body) {
                Assert.ok(body.includes("give the preserved main temporary folder's exact path"));
            }
        }
    });

    test("cleans ordinary endings and materializes every hard-stop failure history shape", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "carries the hard-stops-and-evidence section"(body) {
                Assert.ok(body.includes("## Hard stops and evidence"));
            },
            "enumerates exactly three hard-stop conditions"(body) {
                Assert.strictEqual(
                    paragraphAt(body, "There are exactly three hard-stop conditions:"),
                    "There are exactly three hard-stop conditions: iteration greater than 5; a worker-declared `hard-stop.log`; and fatal authentication failure. Before preserving folders for any hard stop, materialize the retained failure history in the main folder, then delete the briefing `error.log`:"
                );
            },
            "carries the diagnosed hard-stop subsection"(body) {
                Assert.ok(body.includes("### Iteration-cap or worker-declared hard stop"));
            },
            "carries the authentication hard-stop subsection"(body) {
                Assert.ok(body.includes("### Authentication hard stop"));
            },
            "cleans every non-hard-stop ending"(body) {
                Assert.ok(body.includes("register it for automatic cleanup on every ending that is not a hard stop"));
            },
            "registers cleanup as each folder is created"(body) {
                Assert.ok(body.includes("Immediately after creating each folder"));
            },
            "suppresses cleanup on hard stop"(body) {
                Assert.ok(body.includes("A hard stop suppresses all cleanup and preserves every folder."));
            },
            "materializes build history"(body) {
                Assert.ok(body.includes("`build.<iteration>.error.log` for each failed build stage"));
            },
            "materializes test history"(body) {
                Assert.ok(body.includes("`test.<iteration>.error.log` for each failed test stage"));
            },
            "materializes commit history"(body) {
                Assert.ok(body.includes("`commit.<iteration>.error.log` for each failed commit stage"));
            },
            "materializes only violating reviewer histories"(body) {
                Assert.ok(body.includes("`reviewer.<iteration>.<position>.error.log` for each reviewer that recorded violations"));
            },
            "uses each reviewer's one-based configured position"(body) {
                Assert.ok(body.includes("using its one-based configured position"));
            },
            "does not materialize an empty reviewer verdict"(body) {
                Assert.ok(body.includes("produce none for an empty reviewer verdict"));
            },
            "removes the briefing before preservation"(body) {
                Assert.ok(body.includes("then delete the briefing `error.log`"));
            },
            "materializes failure history before preserving folders"(body) {
                Assert.ok(
                    body.indexOf("Before preserving folders for any hard stop, materialize") <
                    body.indexOf("Preserve the main and every reviewer folder after materialization.")
                );
            },
            "preserves all folders after materialization"(body) {
                Assert.ok(body.includes("Preserve the main and every reviewer folder after materialization."));
            },
            "reports the main folder path for every hard stop"(body) {
                Assert.ok(body.includes("For every hard stop, report the main temporary folder's exact path"));
            }
        }
    });

    test("enforces all project write boundaries", {
        ARRANGE() {},
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "carries the write-boundaries section"(body) {
                Assert.ok(body.includes("## Write boundaries"));
            },
            "keeps this session from project code and tests"(body) {
                Assert.ok(body.includes("it edits no project code or tests and performs no worker or reviewer pass"));
            },
            "forbids all governed spec folders"(body) {
                Assert.ok(body.includes("Neither this session nor the detect agent, worker, or any reviewer creates, modifies, deletes, or renames a file inside any `.spec/contracts`, `.spec/rules`, or `.spec/flanders` directory"));
            },
            "forbids plan writes"(body) {
                Assert.ok(body.includes("or inside `plans/`"));
            },
            "writes no Flanders configuration"(body) {
                Assert.ok(body.includes("The skill never writes inside `.flanders/`."));
            },
            "records pending user spec without altering its contents"(body) {
                Assert.ok(body.includes("The pending-spec commit records existing user changes without altering their contents."));
            },
            "keeps reviewers inspection-only"(body) {
                Assert.ok(body.includes("reviewers are inspection-only"));
            },
            "limits detect writes to the scripts"(body) {
                Assert.ok(body.includes("detect writes only the two chosen scripts"));
            }
        }
    });

    test("is self-contained and removes the former published name from every skill body", {
        ARRANGE() {
            return {
                removedName: "flanders" + "-work",
                bodies: [planSkillBody, specSkillBody, implementSkillBody, hardStopReviewSkillBody]
            };
        },
        ACT({ bodies }) { return bodies; },
        ASSERTS: {
            "contains no internal spec-file citation"(bodies) {
                for (const body of bodies) {
                    Assert.strictEqual(FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH.test(body), false);
                }
            },
            "contains no former published name"(bodies, { removedName }) {
                for (const body of bodies) {
                    Assert.strictEqual(body.includes(removedName), false);
                }
            },
            "plan names implement as the skill it does not launch"(bodies) {
                Assert.ok(bodies[0]!.includes("including /flanders-implement"));
            },
            "spec offers implement as the small-change next step"(bodies) {
                Assert.ok(bodies[1]!.includes("recommend /flanders-implement when the spec describes a single, small, self-contained change"));
            }
        }
    });

    test("carries interaction language and the skill-specific voice exclusion", {
        ARRANGE() {
            return {
                voice: expectedSkillVoice("the code your worker writes and the violation entries your reviewers record")
            };
        },
        ACT() { return implementSkillBody; },
        ASSERTS: {
            "has the interaction-language section"(body) {
                Assert.ok(body.includes("## Interaction language"));
            },
            "uses the user's most recent language"(body) {
                Assert.ok(body.includes("natural language of the user's most recent message"));
            },
            "follows language switches"(body) {
                Assert.ok(body.includes("When the user switches language, every subsequent message follows the latest message."));
            },
            "resolves interaction language independently of worker code"(body) {
                Assert.ok(body.includes("This is independent of the code the worker writes"));
            },
            "resolves interaction language independently of English commit messages"(body) {
                Assert.ok(body.includes("and of the English commit messages."));
            },
            "contains the exact skill voice section"(body, { voice }) {
                Assert.ok(body.includes(voice));
            },
            "contains no sample mannerism"(body) {
                Assert.strictEqual(body.includes(`"okely-dokely"`), false);
            }
        }
    });
});

test.describe("skills – hardStopReviewSkillBody", test => {
    test("is a non-empty string beginning with a frontmatter block", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "is a string"(body) {
                Assert.strictEqual(typeof body, "string");
            },
            "is non-empty"(body) {
                Assert.ok(body.length > 0);
            },
            "begins with a YAML frontmatter opener"(body) {
                Assert.ok(body.startsWith("---\n"), "must begin with a YAML frontmatter opener");
            },
            "frontmatter declares the flanders-hard-stop-review name"(body) {
                Assert.match(yamlFrontmatter(body), /^name: flanders-hard-stop-review$/m);
            },
            "frontmatter carries a description key on its own line"(body) {
                Assert.ok(/^description: .+$/m.test(yamlFrontmatter(body)), "frontmatter must carry a real description key, on its own line, with a value");
            }
        }
    });

    test("names no occurrence of the removed AI-tool host, case-insensitively", {
        ARRANGE() {
            return { removedHost: REMOVED_HOST_NAME };
        },
        ACT() { return hardStopReviewSkillBody; },
        ASSERT(body, { removedHost }) {
            Assert.strictEqual(body.toLowerCase().includes(removedHost.toLowerCase()), false);
        }
    });

    test("states its purpose: diagnose an implement hard stop and how to relaunch it", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "names the /flanders-hard-stop-review skill"(body) {
                Assert.ok(body.includes("You are the /flanders-hard-stop-review skill."), "must identify itself as the /flanders-hard-stop-review skill");
            },
            "diagnoses why the hard-stopped task never reached a clean iteration"(body) {
                Assert.ok(body.includes("You diagnose why the hard-stopped task never reached a clean iteration"), "must diagnose why the hard-stopped task never reached a clean iteration");
            },
            "recommends the action that lets implement be relaunched to completion"(body) {
                Assert.ok(body.includes("recommend the concrete action that lets \`implement\` be relaunched so the task completes instead of stopping again"), "must recommend the action that lets implement be relaunched so the task completes");
            }
        }
    });

    test("states the invocation form and the [<data>] semantics", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "states the invocation form /flanders-hard-stop-review [<data>]"(body) {
                Assert.ok(body.includes("/flanders-hard-stop-review [<data>]"), "must state the invocation form /flanders-hard-stop-review [<data>]");
            },
            "names <data> as the preserved hard-stop temporary folder path"(body) {
                Assert.ok(body.includes("\`<data>\` is the filesystem path of the preserved hard-stop temporary folder"), "must name <data> as the preserved hard-stop temporary folder path");
            },
            "an omitted <data> is taken from the conversation"(body) {
                Assert.ok(body.includes("When \`<data>\` is omitted, take that path from the conversation."), "must take an omitted <data> from the conversation");
            }
        }
    });

    test("instructs the read-only read of the preserved-folder evidence set", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "states the work is read-only"(body) {
                Assert.ok(body.includes("Your work is read-only, drawing only on the preserved hard-stop temporary folder, the plan file, and the project's spec corpus"), "must state the work is read-only");
            },
            "draws on no source outside the preserved folder, plan, and spec corpus"(body) {
                Assert.ok(body.includes("not the AI tools' own session transcripts"), "must not draw on the AI tools' own session transcripts");
            },
            "reads the per-iteration worker, build, test, and reviewer output logs"(body) {
                Assert.ok(body.includes("per-iteration worker, build, test, and reviewer output logs"), "must read the per-iteration worker, build, test, and reviewer output logs");
            },
            "names the materialized build error-log pattern"(body) {
                Assert.ok(body.includes("\`build.<iteration>.error.log\`"), "must name the materialized build.<iteration>.error.log pattern");
            },
            "names the materialized test error-log pattern"(body) {
                Assert.ok(body.includes("\`test.<iteration>.error.log\`"), "must name the materialized test.<iteration>.error.log pattern");
            },
            "names the materialized per-reviewer error-log pattern"(body) {
                Assert.ok(body.includes("\`reviewer.<iteration>.<position>.error.log\`"), "must name the materialized reviewer.<iteration>.<position>.error.log pattern");
            },
            "names the materialized commit error-log pattern"(body) {
                Assert.ok(body.includes("\`commit.<iteration>.error.log\`"), "must name the materialized commit.<iteration>.error.log pattern");
            },
            "states the error logs make explicit which stage failed in each iteration and by which reviewer"(body) {
                Assert.ok(body.includes("making explicit which stage failed in each iteration and by which reviewer"), "must state the per-stage error logs make explicit which stage failed in each iteration and by which reviewer");
            },
            "states the single briefing error.log has been removed at the hard stop"(body) {
                Assert.ok(body.includes("the single briefing \`error.log\` has been removed at the hard stop"), "must state the single briefing error.log has been removed at the hard stop");
            },
            "no longer instructs reading a present briefing error.log"(body) {
                Assert.strictEqual(body.includes("its briefing \`error.log\`"), false);
            },
            "reads the consolidated spec.md"(body) {
                Assert.ok(body.includes("its consolidated \`spec.md\`"), "must read the consolidated spec.md");
            },
            "reads each per-reviewer folder's error.log"(body) {
                Assert.ok(body.includes("each per-reviewer folder's \`error.log\`"), "must read each per-reviewer folder's error.log");
            },
            "identifies the hard-stopped task by plan line and title"(body) {
                Assert.ok(body.includes("identify the task that hard-stopped — its plan-file line number and title"), "must identify the hard-stopped task by plan-file line number and title");
            },
            "identifies the plan file the run was implementing"(body) {
                Assert.ok(body.includes("and the plan file the run was implementing"), "must identify the plan file the run was implementing");
            },
            "grounds the analysis in the project's specs"(body) {
                Assert.ok(body.includes("Ground the analysis in the project's specs"), "must ground the analysis in the project's specs");
            },
            "reads the identified plan file and the contracts and rules the hard-stopped task references"(body) {
                Assert.ok(body.includes("Read the identified plan file and the contracts and rules the hard-stopped task references"), "must read the identified plan file and the contracts and rules the hard-stopped task references");
            },
            "consults the wider spec corpus as far as the diagnosis needs"(body) {
                Assert.ok(body.includes("consulting the wider spec corpus as far as the diagnosis needs"), "must consult the wider spec corpus as far as the diagnosis needs");
            }
        }
    });

    test("classifies the hard stop as complex/transient versus a loop", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "examines how the iterations progressed, what each changed, and how failures evolved"(body) {
                Assert.ok(body.includes("Examine how the iterations progressed — what each iteration changed and how the recorded failures evolved from one iteration to the next"), "must examine how the iterations progressed, what each iteration changed, and how the recorded failures evolved between iterations");
            },
            "the complex/transient case is a task that made real progress across iterations"(body) {
                Assert.ok(body.includes("The task made real progress across iterations"), "must describe the complex/transient case as real progress across iterations");
            },
            "the complex/transient case reflects either a task larger than the cap or a transient failure"(body) {
                Assert.ok(body.includes("the hard stop reflects a task larger than the iteration cap can finish or a transient failure"), "the complex/transient case must reflect either a task larger than the cap or a transient failure");
            },
            "the complex/transient case is carried through by a fresh run or a smaller task"(body) {
                Assert.ok(body.includes("a fresh run or a smaller task would carry it through"), "the complex/transient case must be carried through by a fresh run or a smaller task");
            },
            "the loop case circled the same unresolved failure with no net progress"(body) {
                Assert.ok(body.includes("The iterations circled the same unresolved failure with no net progress — a loop"), "must describe the loop case as circling the same unresolved failure with no net progress");
            }
        }
    });

    test("carries the worker-declared hard-stop trigger across purpose, evidence, and classification", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "names both hard-stop triggers in its purpose"(body) {
                Assert.ok(body.includes("When \`flanders implement\` hard-stops — exceeding its per-task iteration cap, or acting on the worker's own declaration that the task is structurally impossible — it ends the run, preserves its temporary folder on disk, and points the user at that folder."), "the purpose must name both triggers: exceeding the per-task iteration cap and acting on the worker's own declaration that the task is structurally impossible");
            },
            "reads the worker-declared hard-stop.log when the stop was the worker's own declaration"(body) {
                Assert.ok(body.includes("the worker-declared \`hard-stop.log\`, when the stop was the worker's own declaration"), "the evidence step must read the worker-declared hard-stop.log when the stop was the worker's own declaration");
            },
            "treats a worker-declared hard-stop.log's cause as evidence to verify, not a conclusion"(body) {
                Assert.ok(body.includes("When the preserved folder carries a worker-declared \`hard-stop.log\`, its declared cause is evidence, not a conclusion: verify the declaration against the iteration history, the plan, and the specs, and classify the stop by what that verification sustains."), "the classification step must treat a worker-declared hard-stop.log's cause as evidence verified against the iteration history, the plan, and the specs — not accepted as a conclusion");
            }
        }
    });

    test("maps each cause to its remedy, binding the cause to the skill it selects", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "a transient or progressing failure maps to an unchanged flanders implement re-run"(body) {
                Assert.ok(body.includes("Re-run \`flanders implement\` unchanged, when the failure was transient or the task was progressing and needs only a fresh iteration budget."), "a transient or progressing failure must map to an unchanged flanders implement re-run");
            },
            "plan defects, task splitting, or dependency reordering map to /flanders-plan"(body) {
                Assert.ok(body.includes("Revise the plan through \`/flanders-plan\`: split the hard-stopped task into smaller tasks, correct acceptance criteria or a task premise the iterations proved wrong, or reorder the task against the dependency it needs."), "plan defects, task splitting, or dependency reordering must map to /flanders-plan");
            },
            "a contradictory or ambiguous contract or rule maps to /flanders-spec"(body) {
                Assert.ok(body.includes("Fix the spec through \`/flanders-spec\`: resolve the contradictory or ambiguous contract or rule that left the task unsatisfiable."), "a contradictory or ambiguous contract or rule must map to /flanders-spec");
            }
        }
    });

    test("states the iteration cap is a fixed non-configurable five and never raised", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "states the per-task iteration cap is a fixed five and is not configurable"(body) {
                Assert.ok(body.includes("The per-task iteration cap is a fixed five and is not configurable"), "must state the per-task iteration cap is a fixed five and is not configurable");
            },
            "the remedy for needing more attempts is a fresh run"(body) {
                Assert.ok(body.includes("the remedy for a task that needs more attempts is a fresh run"), "must state the remedy for needing more attempts is a fresh run");
            },
            "or a task split into smaller tasks"(body) {
                Assert.ok(body.includes("a task split into smaller tasks"), "must offer splitting into smaller tasks as the remedy");
            },
            "never a raised cap"(body) {
                Assert.ok(body.includes("never a raised cap"), "must state the remedy is never a raised cap");
            }
        }
    });

    test("recommends and launches the next step, or states the re-run command and launches nothing", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "presents the diagnosis in chat"(body) {
                Assert.ok(body.includes("Present your root-cause finding and recommendation in chat."), "must present the diagnosis in chat");
            },
            "offers exactly /flanders-spec, /flanders-plan, or neither"(body) {
                Assert.ok(body.includes("ask the user which skill to launch to carry out the recommendation: \`/flanders-spec\`, \`/flanders-plan\`, or neither."), "must offer exactly /flanders-spec, /flanders-plan, or neither");
            },
            "the launch question is plain chat text at the end of the diagnosis message"(body) {
                Assert.ok(body.includes("That question is plain chat text at the end of the diagnosis message, per step 5."), "must state the launch question is plain chat text at the end of the diagnosis message per step 5");
                Assert.strictEqual(body.includes("present that choice through it as a multiple-choice question"), false, "must not carry the facility routing for the launch question");
            },
            "recommends the skill the selected action points to"(body) {
                Assert.ok(body.includes("Recommend the skill the action you selected in step 4 points to."), "must recommend the skill the selected action points to");
            },
            "choosing one is the condition that launches it in the same session with no <data>"(body) {
                Assert.ok(body.includes("When the user chooses one, launch it in the same session with no \`<data>\` argument"), "choosing one must be the condition that launches it in the same session with no <data>");
            },
            "the launched skill takes the diagnosis from the conversation, uses its own write boundary, and leaves this skill read-only"(body) {
                Assert.ok(body.includes("It takes the diagnosis from the conversation and operates under its own write boundary; yours remains read-only."), "the launched skill must take the diagnosis from the conversation, operate under its own write boundary, and leave this skill read-only");
            },
            "on a re-run remedy states the flanders implement command and launches nothing"(body) {
                Assert.ok(body.includes("state the \`flanders implement\` command for the user to run and launch nothing"), "on a re-run remedy must state the flanders implement command and launch nothing");
            },
            "ends the run when the user declines"(body) {
                Assert.ok(body.includes("When the user declines, end the run."), "must end the run when the user declines");
            },
            "the launch offer comes after the diagnosis is presented"(body) {
                Assert.ok(body.indexOf("After presenting the diagnosis, ask the user which skill to launch") > body.indexOf("Present your root-cause finding and recommendation in chat."), "the launch offer must come after the diagnosis is presented");
            }
        }
    });

    test("ends the diagnosis message with the launch question as plain chat text", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "ends the diagnosis message with the launch question as plain chat text"(body) {
                Assert.ok(body.includes("End the same chat message that carries that diagnosis with the launch question of the next section asked as plain chat text"), "must end the diagnosis message with the launch question of the next section as plain chat text");
            },
            "never routes the launch question through the question facility"(body) {
                Assert.ok(body.includes("never through a facility your AI tool provides for asking questions"), "must state the launch question never goes through the question facility");
            },
            "the report and its question arrive together in one message"(body) {
                Assert.ok(body.includes("so the report and its question arrive together in one message"), "must state the report and its question arrive together in one message");
            },
            "a user-supplied analysis does not waive the presentation"(body) {
                Assert.ok(body.includes("the user having supplied their own analysis of the same matter does not waive it — state your own finding, where it confirms their account and where it diverges, before asking"), "must state a user-supplied analysis does not waive the presentation and the skill states its own finding before asking");
            },
            "the instruction sits in the diagnosis step, before the launch section"(body) {
                Assert.ok(body.indexOf("End the same chat message that carries that diagnosis") > body.indexOf("Present your root-cause finding and recommendation in chat."), "the instruction must extend the diagnosis-presentation step");
                Assert.ok(body.indexOf("End the same chat message that carries that diagnosis") < body.indexOf("## Recommending and launching the next step"), "the instruction must appear before the Recommending and launching the next step section");
            }
        }
    });

    test("states the write boundary: it authors no file of its own", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "creates, modifies, deletes, and renames no file of its own"(body) {
                Assert.ok(body.includes("You create, modify, delete, and rename no file of your own"), "must state it creates, modifies, deletes, and renames no file of its own");
            },
            "every file change happens only through a skill it launches"(body) {
                Assert.ok(body.includes("Every file change happens only through a skill you launch, under that skill's own write authority."), "every file change must happen only through a launched skill under that skill's own write authority");
            }
        }
    });

    test("carries the shared interaction-and-reasoning language obligation with the ordered plan-then-spec fallback", {
        ARRANGE() {
            // The full resolution priority as one continuous, ordered clause. Asserting the section contains it
            // verbatim guards both the wording of each tier and their order: any reordering — e.g. the general
            // most-recent-message resolution moving ahead of the plan/spec fallback — changes the string and fails.
            const priorityChain = "Resolve it, in order, from the natural language of the user's most recent message when that message carries a determinable natural language; otherwise from the plan file you identify, then the spec corpus you consult; otherwise the general most-recent-message resolution.";
            return { priorityChain };
        },
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "has the interaction-and-reasoning language heading"(body) {
                Assert.ok(body.includes("## Interaction and reasoning language"), "must have the interaction and reasoning language section");
            },
            "reasoning and interaction are one resolved language applied to both throughout the run"(body) {
                Assert.ok(interactionAndReasoningLanguageSection(body).includes("Use one resolved language for both your reasoning and every message you address to the user, throughout the run."), "the section must state one resolved language covers both reasoning and every user-facing message throughout the run");
            },
            "states the resolution priority chain verbatim, in order"(body, { priorityChain }) {
                Assert.ok(interactionAndReasoningLanguageSection(body).includes(priorityChain), "the section must state the resolution priority as the user's most recent message, then the plan file, then the spec corpus, then the general resolution — in that exact order");
            },
            "follows a mid-conversation language switch the user makes"(body) {
                Assert.ok(interactionAndReasoningLanguageSection(body).includes("Follow any mid-conversation language switch the user makes."), "the section must state a mid-conversation language switch the user makes is followed");
            }
        }
    });

    test("addresses the user in the soft Flanders voice with no authored-artifact carve-out", {
        ARRANGE() {
            return { voice: `${SKILL_VOICE_HEAD}.` };
        },
        ACT() { return hardStopReviewSkillBody; },
        ASSERTS: {
            "the complete final Voice section equals the shared head plus a single period"(body, { voice }) {
                Assert.strictEqual(body.slice(body.indexOf("## Voice")), voice);
            },
            "adds no authored-artifact carve-out after the shared exclusion list"(body) {
                Assert.strictEqual(body.includes("git commit messages, and"), false);
            },
            "names no sample greeting exemplar anywhere in the body"(body) {
                Assert.strictEqual(body.toLowerCase().includes("neighbor"), false);
            },
            "names no sample interjection exemplar anywhere in the body"(body) {
                Assert.strictEqual(body.toLowerCase().includes("okely-dokely"), false);
            },
            "names no sample suffix exemplar anywhere in the body"(body) {
                Assert.strictEqual(body.toLowerCase().includes("-diddly-"), false);
            }
        }
    });

    test("self-contained body: no flanders-internal spec-path citation", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
        ASSERT(body) {
            Assert.strictEqual(FLANDERS_INTERNAL_SPEC_MARKDOWN_PATH.test(body), false);
        }
    });

    test("has no unresolved placeholders or TODOs", {
        ARRANGE() {},
        ACT() { return hardStopReviewSkillBody; },
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
