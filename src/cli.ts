#!/usr/bin/env node
import { spawn as nodeSpawn } from "child_process";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";

import type {
    AskAnswer,
    AskChoiceOptions,
    AskContext,
    ChoiceOption,
    FsContext,
    FsDirEntry,
    OutputContext,
    RandomContext,
    TimeContext,
    TimeoutHandle
} from "./contexts";
import { Flanders } from "./Flanders";
import { ShellScriptContext } from "./system/ShellScriptContext";
import type { KillPrimitive, RawSpawnedChild, RawSpawner } from "./system/ShellScriptContext";
import { TerminalSizeSource } from "./ui/TerminalSizeSource";
import type { RawTerminalSizeReader } from "./ui/TerminalSizeSource";
import type { PlatformContext } from "./workspace/Workspace";

const rawSpawn:RawSpawner = (command, args, options) => {
    const child = nodeSpawn(command, [...args], options);
    const raw:RawSpawnedChild = {
        pid: child.pid ?? 0,
        stdout: child.stdout,
        stderr: child.stderr,
        stdin: child.stdin,
        on(event, listener) {
            child.on(event, listener as (...a:unknown[]) => void);
        },
        kill(signal) {
            child.kill(signal);
        }
    };
    return raw;
};

const killPrimitive:KillPrimitive = (pid, signal) => {
    process.kill(pid, signal);
};

const fsContext:FsContext = {
    async readFile(p) {
        return await fsp.readFile(p, "utf8");
    },
    async writeFile(p, content) {
        await fsp.mkdir(path.dirname(p), { recursive: true });
        await fsp.writeFile(p, content, "utf8");
    },
    async rename(oldP, newP) {
        await fsp.rename(oldP, newP);
    },
    async readdir(p) {
        const entries = await fsp.readdir(p, { withFileTypes: true });
        return entries.map(e => ({
            name: e.name,
            isFile: e.isFile(),
            isDirectory: e.isDirectory()
        } satisfies FsDirEntry));
    },
    async stat(p) {
        const s = await fsp.stat(p);
        return {
            size: s.size,
            isFile: s.isFile(),
            isDirectory: s.isDirectory()
        };
    },
    async exists(p) {
        try {
            await fsp.access(p, fs.constants.F_OK);
            return true;
        } catch {
            return false;
        }
    },
    async mkdir(p, options) {
        await fsp.mkdir(p, { recursive: !!options?.recursive });
    },
    async mkdtemp(prefix) {
        return await fsp.mkdtemp(prefix);
    },
    async rm(p, options) {
        await fsp.rm(p, {
            recursive: !!options?.recursive,
            force: !!options?.force
        });
    }
};

const timeContext:TimeContext = {
    now() {
        return Date.now();
    },
    setTimeout(handler, ms):TimeoutHandle {
        const id = setTimeout(handler, ms);
        return {
            cancel() {
                clearTimeout(id);
            }
        };
    }
};

const randomContext:RandomContext = {
    random() {
        return Math.random();
    }
};

// How often each active resize subscription re-reads the real terminal size to
// detect a change the runtime's native resize notification did not deliver.
const RESIZE_POLL_MS = 200;

// Reads the real terminal size straight from the OS on each call. process.stdout
// `columns`/`rows` (and `getWindowSize()`, which returns the same pair) are a
// value cached at the last resize notification and are unreliable on Windows;
// the TTY handle's getWindowSize re-reads the live size without that cache.
// Returns null when the size cannot be read (e.g. stdout is not a TTY), letting
// TerminalSizeSource apply its fallback dimensions.
const readTerminalSize:RawTerminalSizeReader = () => {
    const stream = process.stdout as NodeJS.WriteStream & {
        _handle?:{ getWindowSize?:(out:number[]) => number };
    };
    const handle = stream._handle;
    if (!handle || typeof handle.getWindowSize !== "function") {
        return null;
    }
    const size = [0, 0];
    const err = handle.getWindowSize(size);
    const cols = size[0] ?? 0;
    const rows = size[1] ?? 0;
    if (err || cols <= 0) {
        return null;
    }
    return { columns: cols, rows };
};

const terminalSize = new TerminalSizeSource(
    readTerminalSize,
    listener => {
        process.stdout.on("resize", listener);
        return () => { process.stdout.off("resize", listener); };
    },
    timeContext,
    RESIZE_POLL_MS
);

const outputContext:OutputContext = {
    write(text) {
        process.stdout.write(text);
    },
    writeError(text) {
        process.stderr.write(text);
    },
    columns() {
        return terminalSize.columns();
    },
    rows() {
        return terminalSize.rows();
    },
    onResize(listener) {
        return terminalSize.onResize(listener);
    }
};

const platformContext:PlatformContext = {
    isWindows() {
        return os.platform() === "win32";
    },
    tmpdir() {
        return os.tmpdir();
    },
    homedir() {
        return os.homedir();
    }
};

const spawnContext = new ShellScriptContext(rawSpawn, killPrimitive, platformContext);

const ask = (() => {
    let rl:readline.Interface|null = null;
    const ensure = () => {
        if (!rl) {
            rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        }
        return rl;
    };
    const readLine = (prompt:string):Promise<string> => new Promise<string>(resolve => {
        ensure().question(prompt, answer => resolve(answer));
    });
    const parseAnswer = (raw:string, max:number, multi:boolean):{ picks:number[]; extra?:string }|null => {
        const trimmed = raw.trim();
        if (!trimmed) {
            return null;
        }
        if (/^\d/.test(trimmed)) {
            const re = multi
                ? /^(\d+(?:\s*,\s*\d+)*)\s*(.*)$/s
                : /^(\d+)\s*(.*)$/s;
            const match = re.exec(trimmed);
            if (match) {
                const numberPart = match[1]!;
                const extraPart = (match[2] ?? "").trim();
                const picks:number[] = [];
                let ok = true;
                for (const token of numberPart.split(/\s*,\s*/)) {
                    const n = Number.parseInt(token, 10);
                    if (!Number.isFinite(n) || n < 1 || n > max) {
                        ok = false;
                        break;
                    }
                    if (!picks.includes(n)) {
                        picks.push(n);
                    }
                }
                if (ok && picks.length > 0) {
                    return extraPart ? { picks, extra: extraPart } : { picks };
                }
                return null;
            }
            return null;
        }
        return { picks: [], extra: trimmed };
    };
    const renderQuestion = (q:AskChoiceOptions, idx:number, total:number, existing:AskAnswer|undefined, out:OutputContext):void => {
        const counter = total > 1 ? `(${idx + 1}/${total}) ` : "";
        out.write(`\n[?] ${counter}${q.header}${q.header ? ": " : ""}${q.question}\n`);
        const pickedLabels = new Set((existing?.picked ?? []).map(p => p.label));
        for (let i = 0; i < q.options.length; i++) {
            const o = q.options[i]!;
            const marker = pickedLabels.has(o.label) ? "*" : " ";
            const isDefault = q.defaultIndex === i;
            out.write(`  ${marker} ${i + 1}) ${o.label}${o.description ? ` — ${o.description}` : ""}${isDefault ? " (configured — press Enter)" : ""}\n`);
        }
        if (existing) {
            const labels = existing.picked.map(p => p.label).join(", ");
            const summary = labels && existing.extra
                ? `${labels}: ${existing.extra}`
                : labels || existing.extra || "(empty)";
            out.write(`  current: ${summary}\n`);
        }
    };
    const context:AskContext = {
        async askChoices(questions:readonly AskChoiceOptions[], output?:OutputContext):Promise<readonly AskAnswer[]> {
            const out = output ?? outputContext;
            const total = questions.length;
            const answers:Array<AskAnswer|undefined> = questions.map(q =>
                q.multiSelect && q.defaultIndexes !== undefined && q.defaultIndexes.length > 0
                    ? { picked: q.defaultIndexes.map(i => q.options[i]!) }
                    : undefined
            );
            let idx = 0;
            while (idx < total) {
                const q = questions[idx]!;
                const existing = answers[idx];
                renderQuestion(q, idx, total, existing, out);
                const hints:string[] = [];
                hints.push(q.multiSelect
                    ? `[1-${q.options.length}, comma-separated; free-text OK]`
                    : `[1-${q.options.length}; free-text OK]`);
                if (q.defaultIndex !== undefined || (q.multiSelect && existing !== undefined && existing.picked.length > 0)) {
                    hints.push("Enter for configured");
                }
                if (idx > 0) {
                    hints.push("'-' back");
                }
                if (existing !== undefined && idx + 1 < total) {
                    hints.push("'+' next");
                }
                const promptText = `Pick ${hints.join(", ")}: `;
                const raw = await readLine(promptText);
                const trimmed = raw.trim();
                if (trimmed === "-") {
                    if (idx > 0) {
                        idx--;
                    } else {
                        out.writeError("Already at the first question.\n");
                    }
                    continue;
                }
                if (trimmed === "+") {
                    if (existing === undefined) {
                        out.writeError("Answer this question first, then use '+' to move on.\n");
                    } else if (idx + 1 < total) {
                        idx++;
                    } else {
                        out.writeError("Already at the last question — submit it to finish.\n");
                    }
                    continue;
                }
                if (raw === "" && q.defaultIndex !== undefined) {
                    answers[idx] = { picked: [q.options[q.defaultIndex]!] };
                    idx++;
                    continue;
                }
                if (raw === "" && q.multiSelect && existing !== undefined && existing.picked.length > 0) {
                    idx++;
                    continue;
                }
                const parsed = parseAnswer(raw, q.options.length, q.multiSelect);
                if (!parsed) {
                    out.writeError("Invalid input. Pick a valid option number, type free-form text, or use '-' / '+' to navigate.\n");
                    continue;
                }
                const picked:ChoiceOption[] = parsed.picks.map(i => q.options[i - 1]!);
                answers[idx] = parsed.extra ? { picked, extra: parsed.extra } : { picked };
                idx++;
            }
            return answers as AskAnswer[];
        },
        async askText(prompt:string):Promise<string> {
            return await readLine(prompt);
        }
    };
    const close = () => {
        if (rl) {
            rl.close();
            rl = null;
        }
    };
    return { context, close };
})();

const flanders = new Flanders(
    process.argv.slice(2),
    { projectRoot: process.cwd() },
    {
        claude: spawnContext,
        script: spawnContext,
        fs: fsContext,
        time: timeContext,
        random: randomContext,
        platform: platformContext,
        ask: ask.context,
        output: outputContext
    }
);

let ended = false;
const end = async () => {
    if (ended) {
        return;
    }
    ended = true;
    outputContext.write("Shutting down...\n");
    try {
        await flanders.dispose();
        terminalSize.dispose();
    } catch (e) {
        outputContext.writeError(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    }
    ask.close();
};

process.on("SIGINT", () => { process.exitCode = 130; end().catch(() => {}); });
process.on("SIGTERM", () => { process.exitCode = 143; end().catch(() => {}); });
process.on("SIGHUP", () => { process.exitCode = 129; end().catch(() => {}); });

flanders.result().then(code => {
    process.exitCode = code;
    end().catch(() => {});
}, err => {
    outputContext.writeError(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
    end().catch(() => {});
});
