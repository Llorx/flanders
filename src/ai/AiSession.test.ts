import * as Assert from "assert";

import test from "arrange-act-assert";

import { AiSession } from "./AiSession";
import type { AiSessionContexts, AiSessionOptions } from "./AiSession";
import type { ToolAdapter, ToolAdapterInvokeArgs, ToolEvent } from "./ToolAdapter";
import type { OutputContext, TimeContext, TimeoutHandle } from "../contexts";

function stubAdapter(invocations:readonly (readonly ToolEvent[])[]):{
    adapter:ToolAdapter;
    $invokeArgs:ToolAdapterInvokeArgs[];
} {
    const invokeArgs:ToolAdapterInvokeArgs[] = [];
    let call = 0;
    return {
        adapter: {
            invoke(args:ToolAdapterInvokeArgs):AsyncIterable<ToolEvent> {
                invokeArgs.push(args);
                const events = invocations[call++] ?? [];
                return {
                    async *[Symbol.asyncIterator]() {
                        for (const e of events) yield e;
                    }
                };
            }
        },
        $invokeArgs: invokeArgs
    };
}

function autoTimeContext(initialNow = 0) {
    let now = initialNow;
    return {
        ...({
            now() { return now; },
            setTimeout(handler:() => void, ms:number):TimeoutHandle {
                const target = now + ms;
                let cancelled = false;
                setImmediate(() => {
                    if (!cancelled) {
                        now = target;
                        handler();
                    }
                });
                return { cancel() { cancelled = true; } };
            }
        } satisfies TimeContext)
    };
}

function captureOutput():{
    output:OutputContext;
    $writes:string[];
    $errors:string[];
} {
    const writes:string[] = [];
    const errors:string[] = [];
    return {
        output: {
            write(text:string) { writes.push(text); },
            writeError(text:string) { errors.push(text); },
            columns() { return 80; },
            rows() { return 24; },
            onResize() { return () => {}; }
        },
        $writes: writes,
        $errors: errors
    };
}

function buildSession(
    events:readonly ToolEvent[],
    overrides?:Partial<AiSessionOptions>
):{ session:AiSession; $writes:string[]; $errors:string[]; $invokeArgs:ToolAdapterInvokeArgs[] } {
    const { adapter, $invokeArgs } = stubAdapter([events]);
    const { output, $writes, $errors } = captureOutput();
    const time = autoTimeContext();
    const contexts:AiSessionContexts = { time, output };
    const session = new AiSession({
        adapter,
        prompt: "test prompt",
        model: "",
        effort: "",
        ...overrides
    }, contexts);
    return { session, $writes, $errors, $invokeArgs };
}

test.describe("AiSession", test => {
    test("forwards output events as tool-use bullets and result lines", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "Read", subtitle: "src/foo.ts", details: "file contents here" },
                { type: "output", title: "Result", subtitle: "src/foo.ts", details: "line one\nline two" },
                { type: "output", title: "Edit", subtitle: "src/bar.ts", details: "" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERTS: {
            "tool-use bullet for Read with cyan name and yellow target"(_result, { $writes }) {
                Assert.strictEqual($writes[0], "● \x1b[36mRead\x1b[0m(\x1b[33msrc/foo.ts\x1b[0m)\n");
            },
            "result lines for Result with magenta marker"(_result, { $writes }) {
                Assert.strictEqual($writes[1], "\x1b[35m  ⎿ \x1b[0mline one\n    line two\n");
            },
            "tool-use bullet for Edit with cyan name and yellow target"(_result, { $writes }) {
                Assert.strictEqual($writes[2], "● \x1b[36mEdit\x1b[0m(\x1b[33msrc/bar.ts\x1b[0m)\n");
            },
            "exactly three writes"(_result, { $writes }) {
                Assert.strictEqual($writes.length, 3);
            }
        }
    });

    test("streams Assistant text verbatim including ANSI escapes", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "Assistant", subtitle: "", details: "hello " },
                { type: "output", title: "Assistant", subtitle: "", details: "\x1b[31mred\x1b[0m" },
                { type: "output", title: "Assistant", subtitle: "", details: " world\n" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERTS: {
            "green Assistant label precedes the block"(_result, { $writes }) {
                Assert.strictEqual($writes[0], "\x1b[32mAssistant\x1b[0m\n");
            },
            "first chunk verbatim"(_result, { $writes }) {
                Assert.strictEqual($writes[1], "hello ");
            },
            "ANSI escape chunk verbatim"(_result, { $writes }) {
                Assert.strictEqual($writes[2], "\x1b[31mred\x1b[0m");
            },
            "third chunk verbatim"(_result, { $writes }) {
                Assert.strictEqual($writes[3], " world\n");
            },
            "consecutive Assistant events are not relabeled"(_result, { $writes }) {
                Assert.strictEqual($writes.length, 4);
            },
            "captured text includes ANSI escapes but not the label"(result) {
                Assert.strictEqual(result.text, "hello \x1b[31mred\x1b[0m world\n");
            }
        }
    });

    test("closes open text line before tool-use bullet", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "Assistant", subtitle: "", details: "partial text" },
                { type: "output", title: "Bash", subtitle: "ls", details: "" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERTS: {
            "newline inserted between text and bullet"(_result, { $writes }) {
                Assert.deepStrictEqual($writes, [
                    "\x1b[32mAssistant\x1b[0m\n",
                    "partial text",
                    "\n",
                    "● \x1b[36mBash\x1b[0m(\x1b[33mls\x1b[0m)\n"
                ]);
            }
        }
    });

    test("closes open text line before Result", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "Assistant", subtitle: "", details: "partial" },
                { type: "output", title: "Result", subtitle: "", details: "result text" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERTS: {
            "newline inserted between text and result"(_result, { $writes }) {
                Assert.deepStrictEqual($writes, [
                    "\x1b[32mAssistant\x1b[0m\n",
                    "partial",
                    "\n",
                    "\x1b[35m  ⎿ \x1b[0mresult text\n"
                ]);
            }
        }
    });

    test("closes open text line at end of run", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "Assistant", subtitle: "", details: "no trailing newline" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERTS: {
            "trailing newline appended"(_result, { $writes }) {
                Assert.deepStrictEqual($writes, [
                    "\x1b[32mAssistant\x1b[0m\n",
                    "no trailing newline",
                    "\n"
                ]);
            }
        }
    });

    test("does not double-close text line when text already ends with newline", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "Assistant", subtitle: "", details: "complete line\n" },
                { type: "output", title: "Read", subtitle: "x.ts", details: "" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERTS: {
            "no extra newline between closed text and bullet"(_result, { $writes }) {
                Assert.deepStrictEqual($writes, [
                    "\x1b[32mAssistant\x1b[0m\n",
                    "complete line\n",
                    "● \x1b[36mRead\x1b[0m(\x1b[33mx.ts\x1b[0m)\n"
                ]);
            }
        }
    });

    test("returns session id from runner", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "session", id: "sess-42" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERT(result) {
            Assert.strictEqual(result.sessionId, "sess-42");
        }
    });

    test("returns null session id when no session event", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERT(result) {
            Assert.strictEqual(result.sessionId, null);
        }
    });

    test("accumulates token usage via onUsage callback", {
        ARRANGE() {
            const { adapter, $invokeArgs } = stubAdapter([
                [{ type: "done" }]
            ]);
            const { output } = captureOutput();
            const time = autoTimeContext();
            const session = new AiSession({
                adapter,
                prompt: "p",
                model: "",
                effort: ""
            }, { time, output });
            return { session, $invokeArgs };
        },
        async ACT({ session, $invokeArgs }) {
            const runPromise = session.run();
            const args = $invokeArgs[0]!;
            args.onUsage!({ inputTokens: 100, outputTokens: 20 });
            args.onUsage!({ inputTokens: 50, outputTokens: 10 });
            return await runPromise;
        },
        ASSERTS: {
            "inputTokens accumulated"(result) {
                Assert.strictEqual(result.inputTokens, 150);
            },
            "outputTokens accumulated"(result) {
                Assert.strictEqual(result.outputTokens, 30);
            }
        }
    });

    test("long-wait callbacks invoked exactly once on rate_limit", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "rate_limit", waitUntilMs: 100 }
            ];
            const doneEvents:ToolEvent[] = [
                { type: "done" }
            ];
            const { adapter } = stubAdapter([events, doneEvents]);
            const { output } = captureOutput();
            const time = autoTimeContext(0);
            let waitStartCount = 0;
            let waitEndCount = 0;
            let waitStartKind:string|null = null;
            let waitStartEndTime:number|null = null;
            const session = new AiSession({
                adapter,
                prompt: "p",
                model: "",
                effort: "",
                onLongWaitStart: (kind, endTimeMs) => {
                    waitStartCount++;
                    waitStartKind = kind;
                    waitStartEndTime = endTimeMs;
                },
                onLongWaitEnd: () => {
                    waitEndCount++;
                }
            }, { time, output });
            return { session, waitStartCount: () => waitStartCount, waitEndCount: () => waitEndCount, waitStartKind: () => waitStartKind, waitStartEndTime: () => waitStartEndTime };
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERTS: {
            "onLongWaitStart called exactly once"(_result, { waitStartCount }) {
                Assert.strictEqual(waitStartCount(), 1);
            },
            "onLongWaitEnd called exactly once"(_result, { waitEndCount }) {
                Assert.strictEqual(waitEndCount(), 1);
            },
            "onLongWaitStart kind is rate-limit"(_result, { waitStartKind }) {
                Assert.strictEqual(waitStartKind(), "rate-limit");
            },
            "onLongWaitStart endTimeMs is the rate_limit waitUntilMs"(_result, { waitStartEndTime }) {
                Assert.strictEqual(waitStartEndTime(), 100);
            }
        }
    });

    test("Result with empty details renders (empty)", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "Result", subtitle: "", details: "" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERT(_result, { $writes }) {
            Assert.strictEqual($writes[0], "\x1b[35m  ⎿ \x1b[0m(empty)\n");
        }
    });

    test("Result with more than 5 lines is truncated", {
        ARRANGE() {
            const lines = Array.from({ length: 8 }, (_, i) => `line ${i + 1}`);
            const events:ToolEvent[] = [
                { type: "output", title: "Result", subtitle: "", details: lines.join("\n") },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERT(_result, { $writes }) {
            Assert.strictEqual($writes[0],
                "\x1b[35m  ⎿ \x1b[0mline 1\n" +
                "    line 2\n" +
                "    line 3\n" +
                "    line 4\n" +
                "    line 5\n" +
                "    … +3 more lines\n"
            );
        }
    });

    test("stderr output routed through writeError", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "stderr", subtitle: "", details: "warning: something\n" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERTS: {
            "writeError receives stderr details"(_result, { $errors }) {
                Assert.strictEqual($errors[0], "warning: something\n");
            },
            "write does not receive stderr"(_result, { $writes }) {
                Assert.strictEqual($writes.length, 0);
            }
        }
    });

    test("passes resumeSessionId to adapter", {
        ARRANGE() {
            const events:ToolEvent[] = [{ type: "done" }];
            return buildSession(events, { resumeSessionId: "resume-1" });
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERT(_result, { $invokeArgs }) {
            Assert.strictEqual($invokeArgs[0]!.resumeSessionId, "resume-1");
        }
    });

    test("dispose aborts in-progress run", {
        ARRANGE() {
            const { adapter } = stubAdapter([
                [{ type: "output", title: "Assistant", subtitle: "", details: "text" }]
            ]);
            const { output } = captureOutput();
            const time = autoTimeContext();
            const session = new AiSession({
                adapter,
                prompt: "p",
                model: "",
                effort: ""
            }, { time, output });
            return { session };
        },
        async ACT({ session }) {
            const runPromise = session.run();
            await session.dispose();
            const err = await runPromise.catch(e => e);
            return err;
        },
        ASSERT(err) {
            Assert.ok(err instanceof Error);
            Assert.strictEqual(err.name, "AbortError");
        }
    });

    test("dispose waits for run that resolves before abort takes effect", {
        ARRANGE() {
            const { adapter } = stubAdapter([
                [
                    { type: "output", title: "Assistant", subtitle: "", details: "ok" },
                    { type: "done" }
                ]
            ]);
            const { output } = captureOutput();
            const time = autoTimeContext();
            const session = new AiSession({
                adapter,
                prompt: "p",
                model: "",
                effort: ""
            }, { time, output });
            return { session };
        },
        async ACT({ session }) {
            const runPromise = session.run();
            await session.dispose();
            return await runPromise;
        },
        ASSERT(result) {
            Assert.strictEqual(result.text, "ok");
        }
    });

    test("dispose is idempotent", {
        ARRANGE() {
            const events:ToolEvent[] = [{ type: "done" }];
            const { session } = buildSession(events);
            return { session };
        },
        async ACT({ session }) {
            await session.run();
            await session.dispose();
            await session.dispose();
            return "ok";
        },
        ASSERT(result) {
            Assert.strictEqual(result, "ok");
        }
    });

    test("run after dispose throws", {
        ARRANGE() {
            const events:ToolEvent[] = [{ type: "done" }];
            const { session } = buildSession(events);
            return { session };
        },
        async ACT({ session }) {
            await session.dispose();
            try {
                await session.run();
                return null;
            } catch (e) {
                return e;
            }
        },
        ASSERT(err) {
            Assert.ok(err instanceof Error);
            Assert.strictEqual(err.message, "AiSession disposed");
        }
    });

    test("a non-Assistant event between assistant runs starts a new labeled block", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "Assistant", subtitle: "", details: "A" },
                { type: "output", title: "Read", subtitle: "f", details: "" },
                { type: "output", title: "Assistant", subtitle: "", details: "B" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERTS: {
            "captured text is the concatenation of Assistant bodies, excluding labels"(result) {
                Assert.strictEqual(result.text, "AB");
            },
            "each assistant block separated by a tool event gets its own green label"(_result, { $writes }) {
                Assert.deepStrictEqual($writes, [
                    "\x1b[32mAssistant\x1b[0m\n",
                    "A",
                    "\n",
                    "● \x1b[36mRead\x1b[0m(\x1b[33mf\x1b[0m)\n",
                    "\x1b[32mAssistant\x1b[0m\n",
                    "B",
                    "\n"
                ]);
            }
        }
    });

    test("Thinking output rendered as a dim reasoning marker", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "Thinking", subtitle: "step two", details: "reasoning..." },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERT(_result, { $writes }) {
            Assert.strictEqual($writes[0], "\x1b[2m● Thinking(step two)\x1b[0m\n");
        }
    });

    test("non-retryable error from runner propagates", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "error", retryable: false, message: "fatal error" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            try {
                await session.run();
                return null;
            } catch (e) {
                return e;
            }
        },
        ASSERT(err) {
            Assert.ok(err instanceof Error);
            Assert.strictEqual(err.message, "fatal error");
        }
    });

    test("output events produce exactly expected write sequence", {
        ARRANGE() {
            const events:ToolEvent[] = [
                { type: "output", title: "Read", subtitle: "src/a.ts", details: "contents" },
                { type: "output", title: "Result", subtitle: "src/a.ts", details: "ok" },
                { type: "output", title: "Assistant", subtitle: "", details: "I will edit" },
                { type: "output", title: "Edit", subtitle: "src/b.ts", details: "" },
                { type: "output", title: "Result", subtitle: "src/b.ts", details: "applied" },
                { type: "done" }
            ];
            return buildSession(events);
        },
        async ACT({ session }) {
            return await session.run();
        },
        ASSERT(_result, { $writes }) {
            Assert.deepStrictEqual($writes, [
                "● \x1b[36mRead\x1b[0m(\x1b[33msrc/a.ts\x1b[0m)\n",
                "\x1b[35m  ⎿ \x1b[0mok\n",
                "\x1b[32mAssistant\x1b[0m\n",
                "I will edit",
                "\n",
                "● \x1b[36mEdit\x1b[0m(\x1b[33msrc/b.ts\x1b[0m)\n",
                "\x1b[35m  ⎿ \x1b[0mapplied\n"
            ]);
        }
    });
});
