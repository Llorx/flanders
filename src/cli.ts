#!/usr/bin/env node
import { spawn as nodeSpawn } from "child_process";
import * as fs from "fs";
import { promises as fsp } from "fs";
import * as os from "os";
import * as path from "path";
import * as readline from "readline";

import type {
    FsContext,
    FsDirEntry,
    OutputContext,
    RandomContext,
    TimeContext,
    TimeoutHandle
} from "./contexts";
import { disposeOnce } from "./disposeOnce";
import { Flanders } from "./Flanders";
import { ShellScriptContext } from "./system/ShellScriptContext";
import type { KillPrimitive, RawSpawnedChild, RawSpawner } from "./system/ShellScriptContext";
import { ConsoleAsk } from "./ui/ConsoleAsk";
import { PromptLineReader } from "./ui/PromptLineReader";
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
            isDirectory: s.isDirectory(),
            mtimeMs: s.mtimeMs
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
    // The interface must stay without an `output`: readline would otherwise print the prompt and
    // echo the typed line through ambient stdout, and would intercept Ctrl+C before the process
    // signal handlers see it.
    const reader = new PromptLineReader(() => {
        const rl = readline.createInterface({ input: process.stdin });
        const onClose = () => {
            reader.cancel();
        };
        rl.once("close", onClose);
        return {
            echoesInput: process.stdin.isTTY === true,
            ask(onLine) {
                rl.question("", onLine);
            },
            close() {
                rl.off("close", onClose);
                rl.close();
            }
        };
    });
    return {
        context: new ConsoleAsk(reader, outputContext),
        cancel: () => reader.cancel(),
        close: () => reader.dispose()
    };
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

const end = disposeOnce(async () => {
    // Releasing the read in flight is not a teardown: the dispose below waits for the run, and a
    // run still waiting on an answer would never settle.
    ask.cancel();
    try {
        await flanders.dispose();
    } catch (e) {
        flanders.output().writeError(`${e instanceof Error ? e.stack ?? e.message : String(e)}\n`);
    }
    try {
        await ask.close();
    } finally {
        terminalSize.dispose();
    }
});

process.on("SIGINT", () => { process.exitCode = 130; end().catch(() => {}); });
process.on("SIGTERM", () => { process.exitCode = 143; end().catch(() => {}); });
process.on("SIGHUP", () => { process.exitCode = 129; end().catch(() => {}); });

flanders.result().then(code => {
    process.exitCode = code;
    end().catch(() => {});
}, err => {
    flanders.output().writeError(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exitCode = 1;
    end().catch(() => {});
});
