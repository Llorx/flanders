import * as Assert from "assert";

import test from "arrange-act-assert";

import { parsePlan, parseLinkedPaths, PlanFile } from "./PlanFile";
import type { FsContext } from "./contexts";

function mockFs(initialContent:string):{ fs:FsContext; content():string } {
    let stored = initialContent;
    return {
        fs: {
            readFile() { return Promise.resolve(stored); },
            writeFile(_p:string, c:string) { stored = c; return Promise.resolve(); },
            rename() { return Promise.resolve(); },
            readdir() { return Promise.resolve([]); },
            stat() { return Promise.resolve({ size: stored.length, isFile: true, isDirectory: false }); },
            exists() { return Promise.resolve(true); },
            mkdir() { return Promise.resolve(); },
            mkdtemp(prefix:string) { return Promise.resolve(prefix); },
            rm() { return Promise.resolve(); }
        },
        content() { return stored; }
    };
}

test.describe("parsePlan taskNumber extraction", test => {
    test("extracts taskNumber from numbered heading above task", {
        ARRANGE() {
            return '## 1. Section title\n\n- [ ]{"it":0,"ot":0,"t":0} Task A\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns one task"(result) {
                Assert.strictEqual(result.tasks.length, 1);
            },
            "taskNumber is 1"(result) {
                Assert.strictEqual(result.tasks[0]!.taskNumber, "1");
            }
        }
    });

    test("extracts dotted taskNumber from sub-heading", {
        ARRANGE() {
            return '### 2.1 Subsection\n\n- [ ]{"it":0,"ot":0,"t":0} Task B\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns one task"(result) {
                Assert.strictEqual(result.tasks.length, 1);
            },
            "taskNumber is 2.1"(result) {
                Assert.strictEqual(result.tasks[0]!.taskNumber, "2.1");
            }
        }
    });

    test("taskNumber is empty when no numbered heading precedes task", {
        ARRANGE() {
            return '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task C\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns one task"(result) {
                Assert.strictEqual(result.tasks.length, 1);
            },
            "taskNumber is empty"(result) {
                Assert.strictEqual(result.tasks[0]!.taskNumber, "");
            }
        }
    });

    test("each task gets taskNumber from its nearest numbered heading", {
        ARRANGE() {
            return '## 1. First\n\n- [ ]{"it":0,"ot":0,"t":0} A\n\n## 2. Second\n\n- [ ]{"it":0,"ot":0,"t":0} B\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns two tasks"(result) {
                Assert.strictEqual(result.tasks.length, 2);
            },
            "first task taskNumber is 1"(result) {
                Assert.strictEqual(result.tasks[0]!.taskNumber, "1");
            },
            "second task taskNumber is 2"(result) {
                Assert.strictEqual(result.tasks[1]!.taskNumber, "2");
            }
        }
    });

    test("tasks under same heading share taskNumber", {
        ARRANGE() {
            return '### 3.1 Group\n\n- [ ]{"it":0,"ot":0,"t":0} X\n- [ ]{"it":0,"ot":0,"t":0} Y\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns two tasks"(result) {
                Assert.strictEqual(result.tasks.length, 2);
            },
            "first task taskNumber is 3.1"(result) {
                Assert.strictEqual(result.tasks[0]!.taskNumber, "3.1");
            },
            "second task taskNumber is 3.1"(result) {
                Assert.strictEqual(result.tasks[1]!.taskNumber, "3.1");
            }
        }
    });

    test("deeply nested taskNumber with three levels", {
        ARRANGE() {
            return '#### 4.2.3 Deep\n\n- [ ]{"it":0,"ot":0,"t":0} Deep task\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns one task"(result) {
                Assert.strictEqual(result.tasks.length, 1);
            },
            "taskNumber is 4.2.3"(result) {
                Assert.strictEqual(result.tasks[0]!.taskNumber, "4.2.3");
            }
        }
    });

    test("heading without number does not reset taskNumber", {
        ARRANGE() {
            return '## 5. Numbered\n\n### Details\n\n- [ ]{"it":0,"ot":0,"t":0} Under unnumbered\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns one task"(result) {
                Assert.strictEqual(result.tasks.length, 1);
            },
            "taskNumber is 5"(result) {
                Assert.strictEqual(result.tasks[0]!.taskNumber, "5");
            }
        }
    });
});

test.describe("parsePlan metrics detection and validation", test => {
    test("well-formed task line yields expected metrics", {
        ARRANGE() {
            return '- [ ]{"it":10,"ot":5,"t":3} 1.1 Implement feature\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns one task"(result) {
                Assert.strictEqual(result.tasks.length, 1);
            },
            "no malformed entries"(result) {
                Assert.strictEqual(result.malformed.length, 0);
            },
            "metrics match"(result) {
                Assert.deepStrictEqual(result.tasks[0]!.metrics, { it: 10, ot: 5, t: 3 });
            },
            "title is parsed"(result) {
                Assert.strictEqual(result.tasks[0]!.title, "1.1 Implement feature");
            },
            "task is not done"(result) {
                Assert.strictEqual(result.tasks[0]!.done, false);
            }
        }
    });

    test("done task with metrics parses with done:true", {
        ARRANGE() {
            return '- [x]{"it":12,"ot":3,"t":7} 2.1 Completed task\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns one task"(result) {
                Assert.strictEqual(result.tasks.length, 1);
            },
            "no malformed entries"(result) {
                Assert.strictEqual(result.malformed.length, 0);
            },
            "metrics match"(result) {
                Assert.deepStrictEqual(result.tasks[0]!.metrics, { it: 12, ot: 3, t: 7 });
            },
            "task is done"(result) {
                Assert.strictEqual(result.tasks[0]!.done, true);
            }
        }
    });

    test("zero metrics object parses correctly", {
        ARRANGE() {
            return '- [ ]{"it":0,"ot":0,"t":0} Fresh task\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns one task"(result) {
                Assert.strictEqual(result.tasks.length, 1);
            },
            "metrics are all zero"(result) {
                Assert.deepStrictEqual(result.tasks[0]!.metrics, { it: 0, ot: 0, t: 0 });
            }
        }
    });

    test("checkbox with no metrics is reported in malformed", {
        ARRANGE() {
            return "- [ ] Task without metrics\n";
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            },
            "malformed line is 1"(result) {
                Assert.strictEqual(result.malformed[0]!.line, 1);
            },
            "malformed raw matches input"(result) {
                Assert.strictEqual(result.malformed[0]!.raw, "- [ ] Task without metrics");
            }
        }
    });

    test("metrics object with non-JSON content is reported in malformed", {
        ARRANGE() {
            return '- [ ]{it:0,ot:0,t:0} Bad JSON\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            },
            "malformed line is 1"(result) {
                Assert.strictEqual(result.malformed[0]!.line, 1);
            }
        }
    });

    test("negative values are reported in malformed", {
        ARRANGE() {
            return '- [ ]{"it":-1,"ot":0,"t":0} Negative it\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            },
            "malformed line is 1"(result) {
                Assert.strictEqual(result.malformed[0]!.line, 1);
            }
        }
    });

    test("non-integer values are reported in malformed", {
        ARRANGE() {
            return '- [ ]{"it":1.5,"ot":0,"t":0} Float it\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            },
            "malformed line is 1"(result) {
                Assert.strictEqual(result.malformed[0]!.line, 1);
            }
        }
    });

    test("extra keys are reported in malformed", {
        ARRANGE() {
            return '- [ ]{"it":0,"ot":0,"t":0,"extra":1} Extra key\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            },
            "malformed line is 1"(result) {
                Assert.strictEqual(result.malformed[0]!.line, 1);
            }
        }
    });

    test("missing key is reported in malformed", {
        ARRANGE() {
            return '- [ ]{"it":0,"ot":0} Missing t\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            },
            "malformed line is 1"(result) {
                Assert.strictEqual(result.malformed[0]!.line, 1);
            }
        }
    });

    test("uppercase X checkbox with metrics is reported in malformed", {
        ARRANGE() {
            return '- [X]{"it":0,"ot":0,"t":0} Bad checkbox\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            }
        }
    });

    test("large metric values parse correctly", {
        ARRANGE() {
            return '- [x]{"it":1234567,"ot":89012,"t":3600} Big numbers\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns one task"(result) {
                Assert.strictEqual(result.tasks.length, 1);
            },
            "metrics match"(result) {
                Assert.deepStrictEqual(result.tasks[0]!.metrics, { it: 1234567, ot: 89012, t: 3600 });
            }
        }
    });

    test("string values in metrics are reported in malformed", {
        ARRANGE() {
            return '- [ ]{"it":"0","ot":0,"t":0} String value\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            }
        }
    });

    test("metrics that parse to an array are reported in malformed", {
        ARRANGE() {
            return '- [ ]{[1,2,3]} Array metrics\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            }
        }
    });

    test("metrics that parse to null are reported in malformed", {
        ARRANGE() {
            return '- [ ]{null} Null metrics\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            }
        }
    });

    test("metrics that parse to a non-object are reported in malformed", {
        ARRANGE() {
            return '- [ ]{"hello"} String metrics\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "no valid tasks"(result) {
                Assert.strictEqual(result.tasks.length, 0);
            },
            "one malformed entry"(result) {
                Assert.strictEqual(result.malformed.length, 1);
            }
        }
    });

    test("task with metrics but no trailing text has empty title", {
        ARRANGE() {
            return '- [ ]{"it":0,"ot":0,"t":0}\n';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "returns one task"(result) {
                Assert.strictEqual(result.tasks.length, 1);
            },
            "title is empty"(result) {
                Assert.strictEqual(result.tasks[0]!.title, "");
            }
        }
    });
});

test.describe("parsePlan line count", test => {
    test("content without trailing newline counts lines correctly", {
        ARRANGE() {
            return '- [ ]{"it":0,"ot":0,"t":0} Task A\n- [ ]{"it":0,"ot":0,"t":0} Task B';
        },
        ACT(content) {
            return parsePlan(content);
        },
        ASSERTS: {
            "lineCount equals number of lines"(result) {
                Assert.strictEqual(result.lineCount, 2);
            },
            "returns two tasks"(result) {
                Assert.strictEqual(result.tasks.length, 2);
            }
        }
    });
});

test.describe("PlanFile.updateMetrics", test => {
    test("rewrites only the targeted line and preserves the rest byte-for-byte", {
        ARRANGE() {
            const content = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Task A\n- [ ]{"it":0,"ot":0,"t":0} Task B\n\nSome trailing text.\n';
            return mockFs(content);
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            await plan.updateMetrics(3, {it:100, ot:50, t:30});
        },
        ASSERTS: {
            "line 0 is '# Plan'"(_unused, { content }) {
                Assert.strictEqual(content().split("\n")[0], "# Plan");
            },
            "line 1 is empty"(_unused, { content }) {
                Assert.strictEqual(content().split("\n")[1], "");
            },
            "line 2 is the rewritten task A"(_unused, { content }) {
                Assert.strictEqual(content().split("\n")[2], '- [ ]{"it":100,"ot":50,"t":30} Task A');
            },
            "line 3 is unchanged task B"(_unused, { content }) {
                Assert.strictEqual(content().split("\n")[3], '- [ ]{"it":0,"ot":0,"t":0} Task B');
            },
            "line 4 is empty"(_unused, { content }) {
                Assert.strictEqual(content().split("\n")[4], "");
            },
            "line 5 is trailing text"(_unused, { content }) {
                Assert.strictEqual(content().split("\n")[5], "Some trailing text.");
            },
            "round-trip produces two tasks"(_unused, { content }) {
                Assert.strictEqual(parsePlan(content()).tasks.length, 2);
            },
            "round-trip first task has updated metrics"(_unused, { content }) {
                Assert.deepStrictEqual(parsePlan(content()).tasks[0]!.metrics, {it:100, ot:50, t:30});
            }
        }
    });

    test("preserves file byte-for-byte except the targeted line", {
        ARRANGE() {
            const content = 'Line 1\n- [ ]{"it":0,"ot":0,"t":0} Target\nLine 3\n';
            return mockFs(content);
        },
        async ACT({ fs, content }) {
            const before = content();
            const plan = await PlanFile.load("plan.md", fs);
            await plan.updateMetrics(2, {it:10, ot:20, t:5});
            const after = content();
            const beforeLines = before.split("\n");
            const afterLines = after.split("\n");
            return { beforeLines, afterLines };
        },
        ASSERTS: {
            "line count is preserved"({ beforeLines, afterLines }) {
                Assert.strictEqual(beforeLines.length, afterLines.length);
            },
            "line 0 is unchanged"({ beforeLines, afterLines }) {
                Assert.strictEqual(afterLines[0], beforeLines[0]);
            },
            "line 1 differs from before"({ beforeLines, afterLines }) {
                Assert.notStrictEqual(afterLines[1], beforeLines[1]);
            },
            "line 1 has updated metrics"({ afterLines }) {
                Assert.strictEqual(afterLines[1], '- [ ]{"it":10,"ot":20,"t":5} Target');
            },
            "line 2 is unchanged"({ beforeLines, afterLines }) {
                Assert.strictEqual(afterLines[2], beforeLines[2]);
            },
            "line 3 is unchanged"({ beforeLines, afterLines }) {
                Assert.strictEqual(afterLines[3], beforeLines[3]);
            }
        }
    });

    test("rejects negative metric values", {
        ARRANGE() {
            return mockFs('- [ ]{"it":0,"ot":0,"t":0} Task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            try {
                await plan.updateMetrics(1, {it:-1, ot:0, t:0});
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERTS: {
            "mentions the invalid key"(message) {
                Assert.ok(message.includes("it"));
            },
            "mentions the invalid value"(message) {
                Assert.ok(message.includes("-1"));
            }
        }
    });

    test("rejects non-integer metric values", {
        ARRANGE() {
            return mockFs('- [ ]{"it":0,"ot":0,"t":0} Task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            try {
                await plan.updateMetrics(1, {it:0, ot:1.5, t:0});
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERTS: {
            "mentions the invalid key"(message) {
                Assert.ok(message.includes("ot"));
            },
            "mentions the invalid value"(message) {
                Assert.ok(message.includes("1.5"));
            }
        }
    });

    test("throws when lineNumber does not point to a task line", {
        ARRANGE() {
            return mockFs('# Heading\n- [ ]{"it":0,"ot":0,"t":0} Task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            try {
                await plan.updateMetrics(1, {it:0, ot:0, t:0});
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.ok(message.includes("not a task line"), "error should indicate the line is not a task line");
        }
    });

    test("works on done tasks (does not require open checkbox)", {
        ARRANGE() {
            return mockFs('- [x]{"it":10,"ot":5,"t":3} Done task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            await plan.updateMetrics(1, {it:20, ot:10, t:6});
        },
        ASSERT(_unused, { content }) {
            Assert.strictEqual(content(), '- [x]{"it":20,"ot":10,"t":6} Done task\n');
        }
    });

    test("preserves CRLF newlines when rewriting a task line", {
        ARRANGE() {
            return mockFs('# Plan\r\n- [ ]{"it":0,"ot":0,"t":0} Task\r\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            await plan.updateMetrics(2, {it:10, ot:5, t:3});
        },
        ASSERTS: {
            "output uses CRLF"(_unused, { content }) {
                Assert.ok(content().includes("\r\n"));
            },
            "task line is rewritten"(_unused, { content }) {
                const lines = content().split("\r\n");
                Assert.strictEqual(lines[1], '- [ ]{"it":10,"ot":5,"t":3} Task');
            },
            "heading is preserved"(_unused, { content }) {
                const lines = content().split("\r\n");
                Assert.strictEqual(lines[0], "# Plan");
            }
        }
    });
});

test.describe("PlanFile.markDone", test => {
    test("flips checkbox and updates metrics in one write", {
        ARRANGE() {
            return mockFs('- [ ]{"it":0,"ot":0,"t":0} Task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            await plan.markDone(1, {it:500, ot:200, t:60});
        },
        ASSERT(_unused, { content }) {
            Assert.strictEqual(content(), '- [x]{"it":500,"ot":200,"t":60} Task\n');
        }
    });

    test("preserves surrounding lines byte-for-byte", {
        ARRANGE() {
            const content = '# Plan\n\n- [x]{"it":10,"ot":5,"t":3} Done\n- [ ]{"it":0,"ot":0,"t":0} Open\n\nFooter\n';
            return mockFs(content);
        },
        async ACT({ fs, content }) {
            const before = content();
            const plan = await PlanFile.load("plan.md", fs);
            await plan.markDone(4, {it:42, ot:7, t:12});
            const after = content();
            return { beforeLines: before.split("\n"), afterLines: after.split("\n") };
        },
        ASSERT({ beforeLines, afterLines }) {
            Assert.strictEqual(beforeLines.length, afterLines.length);
            for (let i = 0; i < beforeLines.length; i++) {
                if (i === 3) {
                    Assert.strictEqual(afterLines[i], '- [x]{"it":42,"ot":7,"t":12} Open');
                } else {
                    Assert.strictEqual(afterLines[i], beforeLines[i]);
                }
            }
        }
    });

    test("throws on already-done task", {
        ARRANGE() {
            return mockFs('- [x]{"it":10,"ot":5,"t":3} Already done\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            try {
                await plan.markDone(1, {it:10, ot:5, t:3});
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.ok(message.includes("not an open task"));
        }
    });

    test("result survives round-trip through parsePlan", {
        ARRANGE() {
            return mockFs('- [ ]{"it":0,"ot":0,"t":0} Task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            await plan.markDone(1, {it:123, ot:456, t:789});
        },
        ASSERTS: {
            "returns one task"(_unused, { content }) {
                Assert.strictEqual(parsePlan(content()).tasks.length, 1);
            },
            "no malformed entries"(_unused, { content }) {
                Assert.strictEqual(parsePlan(content()).malformed.length, 0);
            },
            "task is done"(_unused, { content }) {
                Assert.strictEqual(parsePlan(content()).tasks[0]!.done, true);
            },
            "metrics match"(_unused, { content }) {
                Assert.deepStrictEqual(parsePlan(content()).tasks[0]!.metrics, {it:123, ot:456, t:789});
            }
        }
    });
});

test.describe("PlanFile.markOpen", test => {
    test("flips checkbox from done to open and writes given metrics", {
        ARRANGE() {
            return mockFs('- [x]{"it":100,"ot":50,"t":30} Task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            await plan.markOpen(1, {it:200, ot:80, t:45});
        },
        ASSERT(_unused, { content }) {
            Assert.strictEqual(content(), '- [ ]{"it":200,"ot":80,"t":45} Task\n');
        }
    });

    test("preserves surrounding lines byte-for-byte", {
        ARRANGE() {
            const content = '# Plan\n\n- [ ]{"it":0,"ot":0,"t":0} Open\n- [x]{"it":10,"ot":5,"t":3} Done\n\nFooter\n';
            return mockFs(content);
        },
        async ACT({ fs, content }) {
            const before = content();
            const plan = await PlanFile.load("plan.md", fs);
            await plan.markOpen(4, {it:20, ot:10, t:6});
            const after = content();
            return { beforeLines: before.split("\n"), afterLines: after.split("\n") };
        },
        ASSERT({ beforeLines, afterLines }) {
            Assert.strictEqual(beforeLines.length, afterLines.length);
            for (let i = 0; i < beforeLines.length; i++) {
                if (i === 3) {
                    Assert.strictEqual(afterLines[i], '- [ ]{"it":20,"ot":10,"t":6} Done');
                } else {
                    Assert.strictEqual(afterLines[i], beforeLines[i]);
                }
            }
        }
    });

    test("throws on already-open task", {
        ARRANGE() {
            return mockFs('- [ ]{"it":0,"ot":0,"t":0} Open task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            try {
                await plan.markOpen(1, {it:0, ot:0, t:0});
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.ok(message.includes("not a done task"));
        }
    });

    test("throws when line does not exist", {
        ARRANGE() {
            return mockFs('- [x]{"it":0,"ot":0,"t":0} Task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            try {
                await plan.markOpen(99, {it:0, ot:0, t:0});
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.ok(message.includes("not found"));
        }
    });

    test("throws when line is not a task line", {
        ARRANGE() {
            return mockFs('# Heading\n- [x]{"it":0,"ot":0,"t":0} Task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            try {
                await plan.markOpen(1, {it:0, ot:0, t:0});
                return "no error";
            } catch (e) {
                return (e as Error).message;
            }
        },
        ASSERT(message) {
            Assert.ok(message.includes("not a task line"));
        }
    });

    test("result survives round-trip through parsePlan", {
        ARRANGE() {
            return mockFs('- [x]{"it":10,"ot":5,"t":3} Task\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            await plan.markOpen(1, {it:50, ot:25, t:15});
        },
        ASSERTS: {
            "returns one task"(_unused, { content }) {
                Assert.strictEqual(parsePlan(content()).tasks.length, 1);
            },
            "no malformed entries"(_unused, { content }) {
                Assert.strictEqual(parsePlan(content()).malformed.length, 0);
            },
            "task is open"(_unused, { content }) {
                Assert.strictEqual(parsePlan(content()).tasks[0]!.done, false);
            },
            "metrics match"(_unused, { content }) {
                Assert.deepStrictEqual(parsePlan(content()).tasks[0]!.metrics, {it:50, ot:25, t:15});
            }
        }
    });
});

test.describe("PlanFile._rewriteTaskLine newline detection", test => {
    test("defaults to LF when content has no newlines at all", {
        ARRANGE() {
            return mockFs('- [ ]{"it":0,"ot":0,"t":0} Single line no newline');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            await plan.updateMetrics(1, {it:5, ot:3, t:1});
        },
        ASSERT(_unused, { content }) {
            Assert.strictEqual(content(), '- [ ]{"it":5,"ot":3,"t":1} Single line no newline');
        }
    });
});

test.describe("PlanFile.planTotals", test => {
    test("sums metrics across mixed done and open tasks", {
        ARRANGE() {
            const content = [
                '## 1. Section',
                '',
                '- [x]{"it":100,"ot":50,"t":30} Done task',
                '- [ ]{"it":200,"ot":100,"t":60} Open task',
                '',
                '## 2. Section',
                '',
                '- [x]{"it":300,"ot":150,"t":90} Another done',
                ''
            ].join("\n");
            return mockFs(content);
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            return plan.planTotals();
        },
        ASSERT(totals) {
            Assert.deepStrictEqual(totals, {it:600, ot:300, t:180});
        }
    });

    test("returns zeros for a plan with no tasks", {
        ARRANGE() {
            return mockFs('# Empty plan\n\nNo tasks here.\n');
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            return plan.planTotals();
        },
        ASSERT(totals) {
            Assert.deepStrictEqual(totals, {it:0, ot:0, t:0});
        }
    });

    test("matches hand-summed expected value across multi-task fixture", {
        ARRANGE() {
            const content = [
                '## 1. First',
                '- [x]{"it":10,"ot":20,"t":5} A',
                '- [x]{"it":30,"ot":40,"t":15} B',
                '## 2. Second',
                '- [ ]{"it":50,"ot":60,"t":25} C',
                '- [ ]{"it":0,"ot":0,"t":0} D',
                ''
            ].join("\n");
            return mockFs(content);
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            return plan.planTotals();
        },
        ASSERTS: {
            "it total is 90"(totals) {
                Assert.strictEqual(totals.it, 90);
            },
            "ot total is 120"(totals) {
                Assert.strictEqual(totals.ot, 120);
            },
            "t total is 45"(totals) {
                Assert.strictEqual(totals.t, 45);
            }
        }
    });
});

test.describe("parseLinkedPaths", test => {
    test("extracts contract and rule paths from task body", {
        ARRANGE() {
            return [
                '- [ ]{"it":0,"ot":0,"t":0} 1.1 Some task',
                '',
                '  Description text.',
                '',
                '  Linked contracts: `contracts/foo.md`, `contracts/bar.md`.',
                '',
                '  Linked rules: `rules/a.md`, `rules/b.md`.',
                ''
            ].join("\n");
        },
        ACT(content) {
            return parseLinkedPaths(content, 1);
        },
        ASSERTS: {
            "contracts array matches"(result) {
                Assert.deepStrictEqual(result.contracts, ["contracts/foo.md", "contracts/bar.md"]);
            },
            "rules array matches"(result) {
                Assert.deepStrictEqual(result.rules, ["rules/a.md", "rules/b.md"]);
            }
        }
    });

    test("strips trailing parenthetical annotations from paths", {
        ARRANGE() {
            return [
                '- [ ]{"it":0,"ot":0,"t":0} 2.1 Task with annotations',
                '',
                '  Linked contracts: `contracts/cli-commands/implement/iteration-loop.md` (Worker stage), `contracts/cli-commands/implement/ai-runner.md`.',
                '',
                '  Linked rules: `rules/ai/task-context/worker-iter1-context.md` (every bullet of branches A and B), `rules/ai/task-context/prep-optimization.md` (gating reference).',
                ''
            ].join("\n");
        },
        ACT(content) {
            return parseLinkedPaths(content, 1);
        },
        ASSERTS: {
            "contracts array has bare paths"(result) {
                Assert.deepStrictEqual(result.contracts, [
                    "contracts/cli-commands/implement/iteration-loop.md",
                    "contracts/cli-commands/implement/ai-runner.md"
                ]);
            },
            "rules array has bare paths"(result) {
                Assert.deepStrictEqual(result.rules, [
                    "rules/ai/task-context/worker-iter1-context.md",
                    "rules/ai/task-context/prep-optimization.md"
                ]);
            }
        }
    });

    test("returns empty arrays when no linked lines exist", {
        ARRANGE() {
            return [
                '- [ ]{"it":0,"ot":0,"t":0} 3.1 No links',
                '',
                '  Just a description.',
                ''
            ].join("\n");
        },
        ACT(content) {
            return parseLinkedPaths(content, 1);
        },
        ASSERTS: {
            "contracts array is empty"(result) {
                Assert.deepStrictEqual(result.contracts, []);
            },
            "rules array is empty"(result) {
                Assert.deepStrictEqual(result.rules, []);
            }
        }
    });

    test("stops at the next task line", {
        ARRANGE() {
            return [
                '- [ ]{"it":0,"ot":0,"t":0} 1.1 First task',
                '',
                '  Linked contracts: `contracts/first.md`.',
                '',
                '- [ ]{"it":0,"ot":0,"t":0} 1.2 Second task',
                '',
                '  Linked contracts: `contracts/second.md`.',
                ''
            ].join("\n");
        },
        ACT(content) {
            return parseLinkedPaths(content, 1);
        },
        ASSERTS: {
            "only first task contracts"(result) {
                Assert.deepStrictEqual(result.contracts, ["contracts/first.md"]);
            },
            "rules array is empty"(result) {
                Assert.deepStrictEqual(result.rules, []);
            }
        }
    });

    test("PlanFile.linkedPaths delegates to parseLinkedPaths", {
        ARRANGE() {
            const content = [
                '- [ ]{"it":0,"ot":0,"t":0} 1.1 Task',
                '',
                '  Linked contracts: `contracts/x.md`.',
                '  Linked rules: `rules/y.md`.',
                ''
            ].join("\n");
            return mockFs(content);
        },
        async ACT({ fs }) {
            const plan = await PlanFile.load("plan.md", fs);
            const task = plan.nextOpenTask()!;
            return plan.linkedPaths(task);
        },
        ASSERTS: {
            "contracts match"(result) {
                Assert.deepStrictEqual(result.contracts, ["contracts/x.md"]);
            },
            "rules match"(result) {
                Assert.deepStrictEqual(result.rules, ["rules/y.md"]);
            }
        }
    });
});
