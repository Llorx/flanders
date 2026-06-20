import type { FsContext } from "../contexts";
import { joinPath } from "../system/fsUtils";

export type WorkspacePaths = Readonly<{
    root:string;
    buildScript:string;
    testScript:string;
    errorLog:string;
    specFile:string;
    prepLog(taskIndex:number):string;
    workerLog(iter:number):string;
    buildLog(iter:number):string;
    testLog(iter:number):string;
    reviewerLog(iter:number):string;
    reviewerOutputLog(iter:number, reviewerIndex:number):string;
    reviewerErrorLog(reviewerIndex:number):string;
    reviewerSpecFile(reviewerIndex:number):string;
}>;

export interface PlatformContext {
    isWindows():boolean;
    tmpdir():string;
    homedir():string;
}

export class Workspace {
    private _disposed = false;
    private _preserve = false;
    private _root:string|null = null;
    private _reviewerRoots:string[] = [];
    constructor(
        private _fs:FsContext,
        private _platform:PlatformContext
    ) {}
    preserveOnDispose():void {
        if (this._disposed) return;
        this._preserve = true;
    }
    async setup(reviewerCount:number):Promise<WorkspacePaths> {
        if (this._disposed) {
            throw new Error("Workspace disposed");
        }
        if (this._root) {
            throw new Error("Workspace already set up");
        }
        const prefix = joinPath(this._platform.tmpdir(), "flanders-");
        this._root = await this._fs.mkdtemp(prefix);
        for (let i = 0; i < reviewerCount; i++) {
            const dir = await this._fs.mkdtemp(prefix);
            this._reviewerRoots.push(dir);
        }
        return this._paths(this._root, this._reviewerRoots);
    }
    paths():WorkspacePaths {
        if (!this._root) {
            throw new Error("Workspace not set up");
        }
        return this._paths(this._root, this._reviewerRoots);
    }
    private _paths(root:string, reviewerRoots:readonly string[]):WorkspacePaths {
        const isWindows = this._platform.isWindows();
        return {
            root,
            buildScript: joinPath(root, isWindows ? "build.bat" : "build.sh"),
            testScript: joinPath(root, isWindows ? "test.bat" : "test.sh"),
            errorLog: joinPath(root, "error.log"),
            specFile: joinPath(root, "spec.md"),
            prepLog(taskIndex:number) { return joinPath(root, `prep.${taskIndex}.log`); },
            workerLog(iter:number) { return joinPath(root, `worker.${iter}.log`); },
            buildLog(iter:number) { return joinPath(root, `build.${iter}.log`); },
            testLog(iter:number) { return joinPath(root, `test.${iter}.log`); },
            reviewerLog(iter:number) { return joinPath(root, `reviewer.${iter}.log`); },
            reviewerOutputLog(iter:number, reviewerIndex:number) { return joinPath(root, `reviewer.${iter}.${reviewerIndex}.log`); },
            reviewerErrorLog(reviewerIndex:number) { return joinPath(reviewerRoots[reviewerIndex - 1]!, "error.log"); },
            reviewerSpecFile(reviewerIndex:number) { return joinPath(reviewerRoots[reviewerIndex - 1]!, "spec.md"); }
        };
    }
    async errorLogExists():Promise<boolean> {
        const paths = this.paths();
        return await this._fs.exists(paths.errorLog);
    }
    async readErrorLog():Promise<string> {
        const paths = this.paths();
        if (!await this._fs.exists(paths.errorLog)) {
            return "";
        }
        return await this._fs.readFile(paths.errorLog);
    }
    async writeErrorLog(content:string):Promise<void> {
        const paths = this.paths();
        await this._fs.writeFile(paths.errorLog, content);
    }
    async clearErrorLog():Promise<void> {
        const paths = this.paths();
        if (await this._fs.exists(paths.errorLog)) {
            await this._fs.rm(paths.errorLog, { force: true });
        }
    }
    async reviewerErrorLogExists(reviewerIndex:number):Promise<boolean> {
        const paths = this.paths();
        return await this._fs.exists(paths.reviewerErrorLog(reviewerIndex));
    }
    async readReviewerErrorLog(reviewerIndex:number):Promise<string> {
        const paths = this.paths();
        const path = paths.reviewerErrorLog(reviewerIndex);
        if (!await this._fs.exists(path)) {
            return "";
        }
        return await this._fs.readFile(path);
    }
    async clearReviewerErrorLog(reviewerIndex:number):Promise<void> {
        const paths = this.paths();
        const path = paths.reviewerErrorLog(reviewerIndex);
        if (await this._fs.exists(path)) {
            await this._fs.rm(path, { force: true });
        }
    }
    async dispose() {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        const root = this._root;
        const reviewerRoots = this._reviewerRoots;
        this._root = null;
        this._reviewerRoots = [];
        if (root && !this._preserve) {
            for (let i = reviewerRoots.length - 1; i >= 0; i--) {
                try {
                    await this._fs.rm(reviewerRoots[i]!, { recursive: true, force: true });
                } catch {

                }
            }
            try {
                await this._fs.rm(root, { recursive: true, force: true });
            } catch {

            }
        }
    }
}
