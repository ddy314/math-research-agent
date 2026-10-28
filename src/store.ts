import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, rm, realpath, stat } from "node:fs/promises";
import { resolve, relative, dirname, sep } from "node:path";
import type { ResearchState, FileRef, TaskSpec, ResultSpec, ResearchResult, Review, Budget } from "./types.js";
import { DEFAULT_BUDGET } from "./types.js";
export const hash = (text: string | Uint8Array): string => createHash("sha256").update(text).digest("hex");
export function alive(pid: number): boolean { try {
    process.kill(pid, 0);
    return true;
}
catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM";
} }
const queues = new Map<string, Promise<unknown>>();
export class ResearchStore {
    readonly root: string;
    readonly runtime: string;
    constructor(cwd: string) { this.root = resolve(cwd); this.runtime = resolve(this.root, ".math-research"); }
    async initialize(goal: string): Promise<void> {
        if (!goal.trim())
            throw new Error("A nonempty research objective is required");
        await mkdir(resolve(this.root, "research"), { recursive: true });
        await mkdir(this.runtime, { recursive: true });
        await this.locked(async () => {
            try {
                await stat(resolve(this.runtime, "state.json"));
                throw new Error("Research already initialized; edit research/GOAL.md to revise the objective");
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== "ENOENT")
                    throw e;
            }
            await writeFile(resolve(this.root, "research/GOAL.md"), `# Research objective\n\n${goal.trim()}\n`, { flag: "wx" });
            await writeFile(resolve(this.root, "research/PROGRESS.md"), "# Research progress\n\nRecord established results, the current obstruction, failed routes and their scope, and the next informative test.\n", { flag: "wx" });
            await this.write({ version: 1, revision: 0, goalHash: hash(await this.goal()), tasks: {}, results: {} });
        });
    }
    async goal(): Promise<string> { return readFile(resolve(this.root, "research/GOAL.md"), "utf8"); }
    async read(): Promise<ResearchState> {
        const state = JSON.parse(await readFile(resolve(this.runtime, "state.json"), "utf8")) as ResearchState;
        if (state.version !== 1)
            throw new Error("Unsupported research state version");
        return state;
    }
    async exists(): Promise<boolean> { try {
        await this.read();
        return true;
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code === "ENOENT")
            return false;
        throw e;
    } }
    async transact<T>(fn: (state: ResearchState) => Promise<T> | T): Promise<T> {
        return this.locked(async () => { const state = await this.read(); const value = await fn(state); state.revision++; await this.write(state); return value; });
    }
    private async write(state: ResearchState): Promise<void> {
        const target = resolve(this.runtime, "state.json"), temp = `${target}.${randomUUID()}.tmp`;
        await writeFile(temp, `${JSON.stringify(state, null, 2)}\n`);
        await rename(temp, target);
    }
    private async locked<T>(fn: () => Promise<T>): Promise<T> {
        const previous = queues.get(this.runtime) ?? Promise.resolve();
        const operation = previous.catch(() => { }).then(async () => {
            const lock = resolve(this.runtime, "write.lock");
            await mkdir(this.runtime, { recursive: true });
            for (let i = 0;; i++) {
                try {
                    await mkdir(lock);
                    await writeFile(resolve(lock, "owner.json"), JSON.stringify({ pid: process.pid, created: Date.now() }));
                    break;
                }
                catch (e) {
                    if ((e as NodeJS.ErrnoException).code !== "EEXIST")
                        throw e;
                    try {
                        const owner = JSON.parse(await readFile(resolve(lock, "owner.json"), "utf8"));
                        if (!alive(owner.pid)) {
                            await rm(lock, { recursive: true, force: true });
                            continue;
                        }
                    }
                    catch (e) {
                        if ((e as NodeJS.ErrnoException).code !== "ENOENT")
                            throw e;
                        if (Date.now() - (await stat(lock)).mtimeMs > 10000) {
                            await rm(lock, { recursive: true, force: true });
                            continue;
                        }
                    }
                    if (i >= 200)
                        throw new Error("Research state is locked by another writer");
                    await new Promise(r => setTimeout(r, 25));
                }
            }
            try {
                return await fn();
            }
            finally {
                await rm(lock, { recursive: true, force: true });
            }
        });
        queues.set(this.runtime, operation);
        try {
            return await operation;
        }
        finally {
            if (queues.get(this.runtime) === operation)
                queues.delete(this.runtime);
        }
    }
    async path(path: string): Promise<string> {
        const target = resolve(this.root, path), actual = await realpath(target), base = await realpath(this.root);
        if (actual !== base && !actual.startsWith(base + sep))
            throw new Error(`Research reference escapes project: ${path}`);
        return actual;
    }
    async capture(path: string): Promise<FileRef> {
        const actual = await this.path(path);
        return { path: relative(await realpath(this.root), actual).split(sep).join("/"), hash: hash(await readFile(actual)) };
    }
    async matches(ref: FileRef): Promise<boolean> { try {
        return (await this.capture(ref.path)).hash === ref.hash;
    }
    catch {
        return false;
    } }
    async addTask(spec: TaskSpec): Promise<string> {
        for (const key of ["title", "question", "successCriteria"] as const)
            if (!spec[key]?.trim())
                throw new Error(`${key} is required`);
        const inputs = await Promise.all((spec.inputs ?? []).map(p => this.capture(p)));
        return this.transact(async (state) => {
            const deps = [...new Set(spec.dependsOn ?? [])];
            if (deps.some(id => !state.tasks[id]))
                throw new Error("Unknown task dependency");
            const goalHash = hash(await this.goal()), id = `task-${randomUUID().slice(0, 12)}`;
            const target = spec.reviewResultId === undefined ? undefined : state.results[spec.reviewResultId];
            if (spec.reviewResultId !== undefined && !target)
                throw new Error("Unknown review result");
            if (spec.kind === "review" && !target)
                throw new Error("Review tasks require reviewResultId");
            if (target)
                inputs.push(target.body, ...target.sources, ...target.dependencies.map(d => state.results[d.resultId]!.body));
            state.tasks[id] = { id, title: spec.title, question: spec.question, successCriteria: spec.successCriteria,
                kind: target ? "review" : spec.kind ?? "explore", dependsOn: deps, inputs, goalHash,
                status: "queued", attempts: [], createdAt: Date.now(),
                ...(target ? { reviewTarget: { resultId: target.id, hash: target.body.hash } } : {}) };
            return id;
        });
    }
    async record(spec: ResultSpec, authorSession: string): Promise<string> {
        if (!spec.statement.trim() || !spec.scope.trim())
            throw new Error("A statement and exact scope are required");
        if (!authorSession)
            throw new Error("A producer session is required");
        const source = await this.capture(spec.path), content = await readFile(await this.path(source.path), "utf8");
        if (hash(content) !== source.hash)
            throw new Error("Source changed during capture");
        if (!content.trim())
            throw new Error("A result body must not be empty");
        const sources = await Promise.all((spec.sources ?? []).map(p => this.capture(p)));
        return this.transact(async (state) => {
            let producer: { task: ResearchState["tasks"][string]; attempt: ResearchState["tasks"][string]["attempts"][number] } | undefined;
            for (const task of Object.values(state.tasks)) for (const attempt of task.attempts) {
                if (attempt.output?.path === source.path) {
                    if (attempt.output.hash !== source.hash) throw new Error("Task output changed; capture the revision as a new draft with explicit sources");
                    producer = { task, attempt };
                }
            }
            if (producer) {
                if (producer.task.goalHash !== hash(await this.goal()) || !(await this.inputsValid(producer.task.inputs))) throw new Error("Task provenance is stale; revalidate the changed inputs before recording its result");
                sources.push(...producer.task.inputs);
                for (const id of producer.task.dependsOn) {
                    const ref = state.tasks[id]?.attempts.at(-1)?.output;
                    if (!ref || !(await this.matches(ref))) throw new Error("Task dependency output is stale");
                    sources.push(ref);
                }
            }
            const dependencies = [...new Set(spec.dependencies ?? [])].map(resultId => {
                const result = state.results[resultId];
                if (!result)
                    throw new Error(`Unknown result ${resultId}`);
                return { resultId, hash: result.body.hash };
            });
            const id = `result-${randomUUID().slice(0, 12)}`, file = `research/results/${id}/${source.hash}.md`;
            await mkdir(dirname(resolve(this.root, file)), { recursive: true });
            await writeFile(resolve(this.root, file), content, { flag: "wx" });
            state.results[id] = { id, statement: spec.statement, scope: spec.scope, assumptions: spec.assumptions ?? [], kind: spec.kind,
                body: { path: file, hash: source.hash }, sources: [...new Map(sources.map(ref => [ref.path, ref])).values()], dependencies, goalHash: hash(await this.goal()), authorSession: producer?.attempt.sessionPath ?? authorSession, reviews: [], createdAt: Date.now() };
            return id;
        });
    }
    async review(resultId: string, taskId: string, verdict: Review["verdict"]): Promise<void> {
        await this.transact(async (state) => {
            const result = state.results[resultId], task = state.tasks[taskId], attempt = task?.attempts.at(-1);
            if (!result || !task || task.kind !== "review" || task.status !== "completed" || !attempt?.output || !attempt.sessionPath)
                throw new Error("A completed independent review task with saved output is required");
            if (task.reviewTarget?.resultId !== resultId || task.reviewTarget.hash !== result.body.hash)
                throw new Error("Review does not target this exact result body");
            if (result.authorSession === attempt.sessionPath)
                throw new Error("Author cannot independently review its own result");
            if (task.goalHash !== hash(await this.goal()) || !(await this.matches(result.body)) || !(await this.matches(attempt.output)) || !(await this.inputsValid(task.inputs)))
                throw new Error("Review inputs or report changed; obtain a fresh review");
            if (result.reviews.some(r => r.taskId === taskId))
                throw new Error("Review task already recorded; conflicting verdicts require a new review");
            result.reviews.push({ id: randomUUID(), verdict, taskId, bodyHash: result.body.hash, report: attempt.output, sessionPath: attempt.sessionPath, createdAt: Date.now() });
        });
    }
    async inputsValid(refs: FileRef[]): Promise<boolean> { return (await Promise.all(refs.map(r => this.matches(r)))).every(Boolean); }
    async resultStatus(result: ResearchResult, state: ResearchState, seen = new Set<string>()): Promise<"candidate" | "reviewed" | "disputed" | "stale"> {
        if (seen.has(result.id))
            return "stale";
        const next = new Set(seen).add(result.id);
        if (result.goalHash !== hash(await this.goal()) || !(await this.matches(result.body)) || !(await this.inputsValid(result.sources)))
            return "stale";
        for (const dep of result.dependencies) {
            const current = state.results[dep.resultId];
            if (!current || current.body.hash !== dep.hash || await this.resultStatus(current, state, next) !== "reviewed")
                return "stale";
        }
        for (const review of result.reviews)
            if (!(await this.matches(review.report)) || review.bodyHash !== result.body.hash)
                return "stale";
        if (result.reviews.some(r => r.verdict !== "accepted"))
            return "disputed";
        return result.reviews.length ? "reviewed" : "candidate";
    }
    async start(ownerSession: string, overrides: Partial<Budget> = {}, resume = false): Promise<void> {
        await this.transact(async (state) => {
            const previous = state.campaign;
            if (previous?.status === "running" && alive(previous.ownerPid))
                throw new Error("A campaign is already running; pause it first");
            const budget = { ...DEFAULT_BUDGET, ...overrides };
            for (const value of Object.values(budget))
                if (!Number.isFinite(value) || value <= 0)
                    throw new Error("Budget values must be positive finite numbers");
            if (!Number.isInteger(budget.concurrency) || budget.concurrency > 2 || !Number.isInteger(budget.maxRounds))
                throw new Error("Concurrency must be 1 or 2; rounds must be an integer");
            if (resume && !previous)
                throw new Error("There is no campaign to resume");
            if (resume && previous) {
                chargeTime(previous, alive(previous.ownerPid) ? Date.now() : previous.heartbeatAt ?? previous.activeSince ?? Date.now());
                if (overrides.milliseconds !== undefined)
                    previous.remainingMs += overrides.milliseconds;
                if (overrides.maxRounds !== undefined)
                    previous.remainingRounds += overrides.maxRounds;
                previous.budget = { ...previous.budget, ...overrides };
                if (previous.remainingMs <= 0 || previous.remainingRounds <= 0)
                    throw new Error("Budget exhausted; resume with an explicit additional budget");
                Object.assign(previous, { status: "running", ownerSession, ownerPid: process.pid, activeSince: Date.now(), heartbeatAt: Date.now(), reason: undefined });
            }
            else {
                state.campaign = { status: "running", ownerSession, ownerPid: process.pid, budget, remainingMs: budget.milliseconds, remainingRounds: budget.maxRounds, activeSince: Date.now(), heartbeatAt: Date.now(), rounds: 0, stallRounds: 0, lastProgress: progressKey(state) };
            }
            for (const task of Object.values(state.tasks))
                if (task.status === "running") {
                    task.status = "interrupted";
                    const attempt = task.attempts.at(-1);
                    if (attempt) {
                        attempt.endedAt = Date.now();
                        attempt.error = "Previous execution interrupted";
                    }
                }
        });
    }
    async pause(reason: string): Promise<void> { await this.transact(state => { if (state.campaign) {
        chargeTime(state.campaign);
        state.campaign.status = "paused";
        state.campaign.reason = reason;
    } }); }
    async heartbeat(ownerSession: string): Promise<void> { await this.transact(state => { const c = state.campaign; if (c?.status === "running" && c.ownerSession === ownerSession)
        c.heartbeatAt = Date.now(); }); }
}
export function chargeTime(c: NonNullable<ResearchState["campaign"]>, now = Date.now()): void {
    if (c.activeSince !== undefined) {
        c.remainingMs = Math.max(0, c.remainingMs - Math.max(0, now - c.activeSince));
        c.activeSince = undefined;
    }
}
export function progressKey(state: ResearchState): string { return hash(JSON.stringify(Object.values(state.results).map(r => [r.id, r.body.hash, r.reviews.length]))); }
