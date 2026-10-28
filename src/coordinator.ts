import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { resolve, relative } from "node:path";
import { ResearchStore, hash, progressKey } from "./store.js";
import { emptyUsage, type ResearchExecutor, type ResearchTask, type ExecutionEvent } from "./types.js";
import { ExecutionInterrupted } from "./pi-executor.js";
export class ResearchCoordinator {
    private readonly active = new Map<string, AbortController>();
    private dispatching = false;
    constructor(readonly store: ResearchStore, private readonly executor: ResearchExecutor, private readonly defaults: {
        provider?: string;
        model?: string;
        thinking?: string;
    } = {}) { }
    setSelection(selection: {
        provider?: string;
        model?: string;
        thinking?: string;
    }): void { Object.assign(this.defaults, selection); }
    async dispatch(signal?: AbortSignal, notify?: (taskId: string, event: ExecutionEvent) => void, ownerSession?: string): Promise<string[]> {
        if (this.dispatching)
            throw new Error("Task dispatch is already active");
        this.dispatching = true;
        try {
            const state = await this.store.read(), campaign = state.campaign;
            if (campaign?.status !== "running")
                throw new Error("Start or resume a campaign before dispatching tasks");
            if (ownerSession !== undefined && campaign.ownerSession !== ownerSession)
                throw new Error("Only the active campaign session may dispatch tasks");
            const remainingMs = campaign.remainingMs - (Date.now() - (campaign.activeSince ?? Date.now()));
            if (remainingMs <= 0 || campaign.remainingRounds <= 0) {
                await this.store.pause("Budget exhausted");
                return [];
            }
            const ready = Object.values(state.tasks).filter(t => (t.status === "queued" || t.status === "interrupted") && t.dependsOn.every(id => state.tasks[id]?.status === "completed"));
            let next = 0;
            const dispatched: string[] = [];
            await Promise.all(Array.from({ length: Math.min(ready.length, campaign.budget.concurrency) }, async () => {
                while (next < ready.length && !signal?.aborted) {
                    const current = await this.store.read();
                    if (current.campaign?.status !== "running")
                        break;
                    const left = current.campaign.remainingMs - (Date.now() - (current.campaign.activeSince ?? Date.now()));
                    if (left <= 0)
                        break;
                    const task = ready[next++]!;
                    dispatched.push(task.id);
                    await this.execute(task, Math.min(left, campaign.budget.taskTimeoutMs), signal, event => notify?.(task.id, event));
                }
            }));
            return dispatched;
        }
        finally {
            this.dispatching = false;
        }
    }
    private async execute(task: ResearchTask, timeoutMs: number, signal: AbortSignal | undefined, onEvent: (event: ExecutionEvent) => void): Promise<void> {
        const before = await this.store.read();
        const dependencyRefs = task.dependsOn.map(id => before.tasks[id]?.attempts.at(-1)?.output);
        if (task.goalHash !== hash(await this.store.goal()) || !(await this.store.inputsValid(task.inputs)) || dependencyRefs.some(ref => !ref) || !(await this.store.inputsValid(dependencyRefs.filter(ref => ref !== undefined)))) {
            await this.store.transact(state => { state.tasks[task.id]!.status = "failed"; });
            onEvent({ type: "invalidated", text: "Goal or input changed; schedule a fresh task" });
            return;
        }
        const previous = task.attempts.at(-1), attemptId = `attempt-${randomUUID().slice(0, 12)}`;
        let resumableSession = previous?.sessionPath;
        if (resumableSession)
            try {
                await access(resumableSession);
            }
            catch {
                resumableSession = undefined;
            }
        const directory = resolve(this.store.runtime, "tasks", task.id, attemptId);
        await mkdir(directory, { recursive: true });
        const controller = new AbortController(), abort = () => controller.abort();
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted)
            abort();
        this.active.set(task.id, controller);
        const claimed = await this.store.transact(state => {
            const saved = state.tasks[task.id]!;
            if (saved.status !== "queued" && saved.status !== "interrupted")
                return false;
            saved.status = "running";
            saved.attempts.push({ id: attemptId, directory: relative(this.store.root, directory), startedAt: Date.now(), usage: emptyUsage(), ...(resumableSession ? { sessionPath: resumableSession } : {}) });
            return true;
        });
        if (!claimed) {
            signal?.removeEventListener("abort", abort);
            this.active.delete(task.id);
            return;
        }
        const state = await this.store.read();
        const dependencies = task.dependsOn.map(id => ({ id, output: state.tasks[id]!.attempts.at(-1)?.output }));
        const prompt = [
            `Research project directory: ${this.store.root}. Your task scratch directory is ${directory}.`,
            "Use Pi's normal file and computation tools. Save experimental scripts in your task directory. Do not edit canonical research documents or another task's files. Return a self-contained result body; the coordinator saves it and the main researcher decides how to integrate it.",
            task.kind === "review" ? "Use the proof-audit skill. Independently inspect the exact candidate and sources below. Do not inherit the author's conclusion. State accepted, changes, rejected, or inconclusive in your report with the decisive reasons. Do not silently repair a candidate and accept the repaired version. You are a reviewer, not the project controller." : task.kind === "experiment" ? "Use the mathematical-experiment skill. State what the experiment can establish, save runnable code, and distinguish tested instances from the general claim." : "Use the research-strategy and proof-development skills as needed. Attack only the focused question; preserve valid partial progress and explain any remaining gap.",
            `Original objective:\n${await this.store.goal()}`, `Task: ${task.title}\n${task.question}`, `Completion condition: ${task.successCriteria}`,
            `Exact input references (read the bodies):\n${JSON.stringify(task.inputs.map(ref => ({ ...ref, path: resolve(this.store.root, ref.path) })), null, 2)}`,
            `Completed dependency outputs:\n${JSON.stringify(dependencies.map(d => ({ ...d, output: d.output ? { ...d.output, path: resolve(this.store.root, d.output.path) } : undefined })), null, 2)}`,
            previous?.output ? `Previous partial output:\n${await readFile(await this.store.path(previous.output.path), "utf8")}` : "",
            previous?.sessionPath && !resumableSession ? "The previous Pi session file is unavailable. Continue from saved task inputs and partial output in a fresh session; explicitly record this recovery limitation." : "",
        ].filter(Boolean).join("\n\n");
        await writeFile(resolve(directory, "request.md"), prompt);
        let partial = "", sessionPath = resumableSession, usage = emptyUsage();
        try {
            const result = await this.executor.execute({ id: task.id, cwd: directory, directory, prompt, timeoutMs, ...this.defaults, ...(sessionPath ? { sessionPath } : {}) }, controller.signal, event => {
                if (event.sessionPath) {
                    sessionPath = event.sessionPath;
                    void this.store.transact(s => { s.tasks[task.id]!.attempts.at(-1)!.sessionPath = event.sessionPath; }).catch(() => { });
                }
                if (event.usage)
                    usage = event.usage;
                onEvent(event);
            });
            partial = result.text;
            sessionPath = result.sessionPath;
            usage = result.usage;
            await this.finish(task.id, attemptId, "completed", partial, sessionPath, usage);
        }
        catch (e) {
            if (e instanceof ExecutionInterrupted) {
                partial = e.partial.text;
                sessionPath = e.partial.sessionPath || sessionPath;
                usage = e.partial.usage;
            }
            const reason = e instanceof Error ? e.message : String(e);
            await this.finish(task.id, attemptId, controller.signal.aborted || /deadline|cancel/i.test(reason) ? "interrupted" : "failed", partial, sessionPath, usage, reason);
        }
        finally {
            signal?.removeEventListener("abort", abort);
            this.active.delete(task.id);
        }
    }
    private async finish(taskId: string, attemptId: string, status: "completed" | "interrupted" | "failed", text: string, sessionPath: string | undefined, usage: ReturnType<typeof emptyUsage>, error?: string): Promise<void> {
        const path = `research/tasks/${taskId}/${attemptId}.md`;
        await mkdir(resolve(this.store.root, "research/tasks", taskId), { recursive: true });
        await writeFile(resolve(this.store.root, path), text || `No result body. ${error ?? ""}\n`);
        await this.store.transact(state => {
            const task = state.tasks[taskId]!, attempt = task.attempts.find(a => a.id === attemptId)!;
            task.status = status;
            Object.assign(attempt, { endedAt: Date.now(), output: { path, hash: hash(text || `No result body. ${error ?? ""}\n`) }, sessionPath, usage, ...(error ? { error } : {}) });
        });
    }
    async cancel(): Promise<void> { for (const controller of this.active.values())
        controller.abort(); }
    async steer(taskId: string, message: string): Promise<void> {
        if (!message.trim())
            throw new Error("A steering message is required");
        if (!this.active.has(taskId) || !this.executor.steer)
            throw new Error("Task is not active or does not support steering");
        await this.executor.steer(taskId, message);
        await this.store.transact(state => { const attempt = state.tasks[taskId]!.attempts.at(-1)!; (attempt.steering ??= []).push({ message, at: Date.now() }); });
    }
    async boundary(ownerSession: string): Promise<{
        continue: boolean;
        message: string;
    }> {
        return this.store.transact(state => {
            const c = state.campaign;
            if (!c || c.status !== "running" || c.ownerSession !== ownerSession)
                return { continue: false, message: "" };
            const remaining = c.remainingMs - (Date.now() - (c.activeSince ?? Date.now()));
            if (remaining <= 0 || c.remainingRounds <= 0)
                return { continue: false, message: "Research budget exhausted. Save the current bottleneck and report." };
            c.remainingRounds--;
            c.rounds++;
            if (c.remainingRounds <= 0)
                return { continue: false, message: "Research round budget exhausted. The saved files remain available for explicit resume." };
            const key = progressKey(state);
            c.stallRounds = key === c.lastProgress ? c.stallRounds + 1 : 0;
            c.lastProgress = key;
            return { continue: true, message: c.stallRounds >= 3
                    ? "Three rounds produced no recorded result or fresh review. Read the research-strategy skill. Diagnose the bottleneck, preserve partial work, and choose a concrete new test or repair. If you have no defensible next attempt, call research_status with action=pause and the precise obstruction. Do not rename a failed route and repeat it. Update research/PROGRESS.md."
                    : "Continue the explicitly authorized research campaign. Read current progress, integrate completed task outputs, choose the next informative mathematical action, and save useful results. Use research_task only when delegation is useful. If the objective is met or a precise obstruction remains after substantive attempts, update progress and call research_status action=pause with the reason. Do not treat task completion as mathematical correctness." };
        });
    }
}
