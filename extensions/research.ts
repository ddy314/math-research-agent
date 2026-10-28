import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { ResearchStore } from "../src/store.js";
import { ResearchCoordinator } from "../src/coordinator.js";
import { PiResearchExecutor } from "../src/pi-executor.js";
import { charterPath } from "../src/paths.js";
import { parseCommand } from "../src/commands.js";
import { generateReport, researchSummary } from "../src/report.js";
const strings = Type.Array(Type.String());
const response = (value: unknown) => ({ content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }], details: {} });
export default function researchExtension(pi: ExtensionAPI): void {
    let store: ResearchStore | undefined, coordinator: ResearchCoordinator | undefined;
    let deadline: NodeJS.Timeout | undefined, monitor: NodeJS.Timeout | undefined, sessionId = "";
    let pausing = false;
    const current = (ctx: ExtensionContext) => {
        if (!store || store.root !== resolve(ctx.cwd)) {
            store = new ResearchStore(ctx.cwd);
            coordinator = new ResearchCoordinator(store, new PiResearchExecutor(), { model: ctx.model?.id, provider: ctx.model?.provider, thinking: ctx.thinkingLevel });
        }
        coordinator!.setSelection({ model: ctx.model?.id, provider: ctx.model?.provider, thinking: ctx.thinkingLevel });
        return { store, coordinator: coordinator! };
    };
    const owner = (ctx: ExtensionContext) => ctx.sessionManager.getSessionFile() ?? ctx.sessionManager.getSessionId();
    const show = async (ctx: ExtensionContext) => {
        const { store } = current(ctx);
        if (!(await store.exists()))
            return;
        const summary = await researchSummary(store);
        ctx.ui.setStatus("math-research", (await store.read()).campaign?.status ?? "ready");
        ctx.ui.setWidget("math-research", summary.split("\n").slice(0, 12));
    };
    const pause = async (ctx: ExtensionContext, reason: string, abort = true) => {
        if (pausing)
            return;
        pausing = true;
        const { store, coordinator } = current(ctx);
        if (deadline)
            clearTimeout(deadline);
        deadline = undefined;
        if (monitor)
            clearInterval(monitor);
        monitor = undefined;
        try {
            await coordinator.cancel();
            await store.pause(reason);
            await generateReport(store);
            if (abort && !ctx.isIdle())
                ctx.abort();
            await show(ctx);
        }
        finally {
            pausing = false;
        }
    };
    const armDeadline = async (ctx: ExtensionContext) => {
        if (deadline)
            clearTimeout(deadline);
        const c = (await current(ctx).store.read()).campaign;
        if (c?.status === "running" && c.ownerSession === owner(ctx))
            deadline = setTimeout(() => { void pause(ctx, "Wall-time budget exhausted").catch(e => ctx.ui.notify(String(e), "error")); }, Math.max(1, c.remainingMs));
        if (monitor)
            clearInterval(monitor);
        monitor = setInterval(() => {
            void (async () => {
                const current = (await store!.read()).campaign;
                if (current?.ownerSession === owner(ctx) && current.status === "paused")
                    await pause(ctx, current.reason ?? "Paused externally");
                else if (current?.ownerSession === owner(ctx) && Date.now() - (current.heartbeatAt ?? 0) >= 2000)
                    await store!.heartbeat(owner(ctx));
            })().catch(e => ctx.ui.notify(String(e), "error"));
        }, 500);
    };
    pi.on("session_start", async (_event, ctx) => { sessionId = owner(ctx); current(ctx); await show(ctx); });
    pi.on("session_shutdown", async (_event, ctx) => {
        if (deadline)
            clearTimeout(deadline);
        deadline = undefined;
        if (monitor)
            clearInterval(monitor);
        monitor = undefined;
        if (store && await store.exists()) {
            const c = (await store.read()).campaign;
            if (c?.ownerSession === sessionId && c.status === "running")
                await pause(ctx, "Pi session closed; resume explicitly", false);
        }
        await coordinator?.cancel();
        store = undefined;
        coordinator = undefined;
    });
    pi.on("before_agent_start", async (event, ctx) => {
        const { store } = current(ctx);
        if (!(await store.exists()))
            return;
        const progress = await readFile(resolve(store.root, "research/PROGRESS.md"), "utf8");
        return { systemPrompt: `${event.systemPrompt}\n\n${await readFile(charterPath, "utf8")}`,
            message: { customType: "research-context", content: `${(await store.goal()).slice(0, 8000)}\n\n${progress.slice(0, 12000)}\n\n${(await researchSummary(store)).slice(0, 14000)}\nRead the linked files for full arguments.`, display: false } };
    });
    pi.on("agent_before_settle", async (event, ctx) => {
        const { store, coordinator } = current(ctx);
        if (!(await store.exists()))
            return;
        if (event.outcome !== "completed") {
            const c = (await store.read()).campaign;
            if (c?.ownerSession === owner(ctx) && c.status === "running")
                await pause(ctx, `Pi operation ${event.outcome}`, false);
            return;
        }
        if (ctx.hasPendingMessages() || event.continue)
            return;
        const next = await coordinator.boundary(owner(ctx));
        if (!next.continue) {
            if (next.message)
                await pause(ctx, next.message, false);
            return;
        }
        await show(ctx);
        return { continue: true, entries: [{ type: "custom_message", customType: "research-next", content: next.message, display: false }] };
    });
    pi.on("agent_settled", async (_event, ctx) => {
        const { store } = current(ctx);
        if (await store.exists() && (await store.read()).campaign?.status === "paused")
            await generateReport(store);
        await show(ctx);
    });
    pi.registerCommand("research", {
        description: "Mathematical research: init, run, pause, resume, status, report; --minutes --rounds --workers --task-minutes",
        handler: async (args, ctx) => {
            try {
                const command = parseCommand(args), { store } = current(ctx);
                if (command.action === "init") {
                    await store.initialize(command.text);
                    ctx.ui.notify("Research initialized in research/. Read the orientation skill to begin.", "info");
                }
                else if (command.action === "pause")
                    await pause(ctx, command.text || "Paused by researcher");
                else if (command.action === "steer") {
                    const [taskId, ...message] = command.text.split(/\s+/);
                    await current(ctx).coordinator.steer(taskId ?? "", message.join(" "));
                    ctx.ui.notify("Guidance queued for the active independent task", "info");
                }
                else if (command.action === "run" || command.action === "resume") {
                    await store.start(owner(ctx), command.budget, command.action === "resume");
                    await armDeadline(ctx);
                    pi.sendUserMessage("Begin or continue this mathematical research campaign. Read the research-orientation skill and current research files. Choose a concrete next action; preserve partial results and exact remaining gaps. Use the normal Pi tools and the research tools. Keep going within the authorized budget; pause and report when the objective is met or no defensible next attempt remains.", { deliverAs: "followUp" });
                }
                else if (command.action === "report")
                    ctx.ui.notify(await generateReport(store), "info");
                else
                    pi.sendMessage({ customType: "research-status", content: await researchSummary(store), display: true });
                await show(ctx);
            }
            catch (e) {
                ctx.ui.notify(e instanceof Error ? e.message : String(e), "error");
            }
        }
    });
    pi.registerTool({ name: "research_task", label: "Research task", description: "Enqueue a focused independent exploration, computation, or exact-body proof review; dispatch ready tasks; inspect task outputs. Never infer mathematical acceptance from completion.",
        parameters: Type.Object({ action: Type.Union([Type.Literal("enqueue"), Type.Literal("dispatch"), Type.Literal("inspect"), Type.Literal("steer")]), taskId: Type.Optional(Type.String()), message: Type.Optional(Type.String()),
            title: Type.Optional(Type.String()), question: Type.Optional(Type.String()), successCriteria: Type.Optional(Type.String()), kind: Type.Optional(Type.Union([Type.Literal("explore"), Type.Literal("experiment"), Type.Literal("review")])),
            dependsOn: Type.Optional(strings), inputs: Type.Optional(strings), reviewResultId: Type.Optional(Type.String()) }),
        async execute(_id, params, signal, onUpdate, ctx) {
            const { store, coordinator } = current(ctx);
            if (params.action === "steer") {
                await coordinator.steer(params.taskId ?? "", params.message ?? "");
                return response("Steering queued for the active Pi task");
            }
            if (params.action === "enqueue")
                return response({ taskId: await store.addTask({ title: params.title ?? "", question: params.question ?? "", successCriteria: params.successCriteria ?? "", kind: params.kind, dependsOn: params.dependsOn, inputs: params.inputs, reviewResultId: params.reviewResultId }) });
            if (params.action === "dispatch")
                return response({ tasks: await coordinator.dispatch(signal, (id, event) => onUpdate?.(response({ taskId: id, event: event.type })), owner(ctx)), summary: await researchSummary(store) });
            const task = (await store.read()).tasks[params.taskId ?? ""];
            if (!task)
                throw new Error("Unknown taskId");
            const output = task.attempts.at(-1)?.output;
            return response({ task, body: output ? await readFile(await store.path(output.path), "utf8") : null });
        }
    });
    pi.registerTool({ name: "research_record", label: "Record research", description: "Capture a local mathematical result with exact scope, assumptions, source and dependency hashes, or attach an independent completed review to the exact body. Revisions are new results. This does not publish externally.",
        parameters: Type.Object({ action: Type.Union([Type.Literal("result"), Type.Literal("review")]),
            statement: Type.Optional(Type.String()), scope: Type.Optional(Type.String()), path: Type.Optional(Type.String()),
            kind: Type.Optional(Type.Union([Type.Literal("proof"), Type.Literal("lemma"), Type.Literal("counterexample"), Type.Literal("experiment"), Type.Literal("obstruction"), Type.Literal("note")])),
            assumptions: Type.Optional(strings), sources: Type.Optional(strings), dependencies: Type.Optional(strings), resultId: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()),
            verdict: Type.Optional(Type.Union([Type.Literal("accepted"), Type.Literal("changes"), Type.Literal("rejected"), Type.Literal("inconclusive")])) }),
        async execute(_id, params, _signal, _update, ctx) {
            const { store } = current(ctx);
            if (params.action === "review") {
                if (!params.verdict)
                    throw new Error("An explicit review verdict is required; read the independent report first");
                await store.review(params.resultId ?? "", params.taskId ?? "", params.verdict);
                return response(await researchSummary(store));
            }
            if (!params.kind)
                throw new Error("Result kind is required");
            return response({ resultId: await store.record({ statement: params.statement ?? "", scope: params.scope ?? "", path: params.path ?? "", kind: params.kind, assumptions: params.assumptions, sources: params.sources, dependencies: params.dependencies }, owner(ctx)) });
        }
    });
    pi.registerTool({ name: "research_status", label: "Research status", description: "Inspect tasks, results, remaining budget and stale reviews; write a report or pause the explicit campaign with a mathematical or operational reason.",
        parameters: Type.Object({ action: Type.Union([Type.Literal("status"), Type.Literal("report"), Type.Literal("pause")]), reason: Type.Optional(Type.String()) }),
        async execute(_id, params, _signal, _update, ctx) {
            const { store } = current(ctx);
            // Do not abort the tool that is saving the orderly final handoff.
            if (params.action === "pause") {
                if (!params.reason?.trim())
                    throw new Error("State why research is pausing");
                await pause(ctx, params.reason, false);
            }
            if (params.action === "report")
                return response({ report: await generateReport(store) });
            return response(await researchSummary(store));
        }
    });
}
