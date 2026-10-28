import { resolve } from "node:path";
import { RpcClient, getPackageDir, type RpcClientOptions } from "@earendil-works/pi-coding-agent";
import type { ExecutionRequest, ExecutionResult, ExecutionEvent, ResearchExecutor } from "./types.js";
import { emptyUsage } from "./types.js";
import { charterPath, skillsPath } from "./paths.js";
export const piCliPath = (): string => resolve(getPackageDir(), "dist/bundle/cli.js");
export type PiClient = Pick<RpcClient, "start" | "stop" | "onEvent" | "getState" | "getSessionStats" | "promptAndWait" | "abort" | "steer">;
export class ExecutionInterrupted extends Error {
    constructor(message: string, readonly partial: ExecutionResult) { super(message); this.name = "ExecutionInterrupted"; }
}
export interface PiExecutorOptions {
    clientFactory?: (options: RpcClientOptions) => PiClient;
    extraArgs?: string[];
    env?: Record<string, string>;
    resources?: "none" | "skills";
}
export class PiResearchExecutor implements ResearchExecutor {
    private readonly clients = new Map<string, PiClient>();
    constructor(private readonly options: PiExecutorOptions = {}) { }
    async steer(id: string, message: string): Promise<void> {
        const client = this.clients.get(id);
        if (!client)
            throw new Error("Pi task is not active");
        await client.steer(message);
    }
    async execute(request: ExecutionRequest, signal: AbortSignal, onEvent?: (event: ExecutionEvent) => void): Promise<ExecutionResult> {
        const args = ["--no-extensions", ...(this.options.resources === "none" ? ["--no-skills"] : ["--skill", skillsPath, "--append-system-prompt", charterPath]),
            "--session-dir", request.directory, ...(request.sessionPath ? ["--session", request.sessionPath] : []),
            ...(request.thinking ? ["--thinking", request.thinking] : []), ...(this.options.extraArgs ?? [])];
        const client = (this.options.clientFactory ?? (options => new RpcClient(options)))({
            cliPath: piCliPath(), cwd: request.cwd, args,
            ...(request.provider ? { provider: request.provider } : {}), ...(request.model ? { model: request.model } : {}),
            ...(this.options.env ? { env: this.options.env } : {})
        });
        let text = "", sessionPath = request.sessionPath ?? "", usage = emptyUsage(), failed: string | undefined;
        let timer: NodeJS.Timeout | undefined, health: NodeJS.Timeout | undefined, checking = false, closing = false;
        let rejectStop: ((error: Error) => void) | undefined;
        const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
        const abort = () => { void client.abort().catch(() => { }); rejectStop?.(new Error("Research task cancelled")); };
        const dispose = client.onEvent(event => {
            onEvent?.({ type: event.type });
            if (event.type === "message_end" && event.message.role === "assistant") {
                const message = event.message;
                const body = message.content.filter(p => p.type === "text").map(p => p.text).join("");
                if (body)
                    text = body;
                if (message.stopReason === "error" || message.stopReason === "aborted")
                    failed = message.errorMessage ?? message.stopReason;
            }
            if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
                text += event.assistantMessageEvent.delta;
                onEvent?.({ type: "text", text: event.assistantMessageEvent.delta });
            }
        });
        try {
            if (signal.aborted)
                throw new Error("Research task cancelled before startup");
            signal.addEventListener("abort", abort, { once: true });
            timer = setTimeout(() => { void client.abort().catch(() => { }); rejectStop?.(new Error("Research task deadline exceeded")); }, request.timeoutMs);
            const work = async () => {
                await client.start();
                if (closing || signal.aborted)
                    throw new Error("Research task cancelled during Pi startup");
                if (request.id)
                    this.clients.set(request.id, client);
                const current = await client.getState();
                sessionPath = current.sessionFile ?? "";
                if (!sessionPath)
                    throw new Error("Pi did not expose a persistent session file");
                onEvent?.({ type: "session", sessionPath });
                health = setInterval(() => {
                    if (checking || closing)
                        return;
                    checking = true;
                    void client.getState().catch(error => rejectStop?.(new Error(`Pi process became unavailable: ${String(error)}`))).finally(() => { checking = false; });
                }, 1000);
                const before = await client.getSessionStats();
                if (closing || signal.aborted)
                    throw new Error("Research task cancelled before prompting");
                await client.promptAndWait(request.prompt, undefined, request.timeoutMs);
                const after = await client.getSessionStats();
                usage = { input: after.tokens.input - before.tokens.input, output: after.tokens.output - before.tokens.output,
                    cacheRead: after.tokens.cacheRead - before.tokens.cacheRead, cacheWrite: after.tokens.cacheWrite - before.tokens.cacheWrite, cost: after.cost - before.cost };
                onEvent?.({ type: "usage", usage });
                if (failed)
                    throw new Error(`Pi model operation failed: ${failed}`);
                if (!text.trim())
                    throw new Error("Pi task settled without a result body");
                return { text, sessionPath, usage };
            };
            return await Promise.race([work(), stopped]);
        }
        catch (e) {
            throw new ExecutionInterrupted(e instanceof Error ? e.message : String(e), { text, sessionPath, usage });
        }
        finally {
            closing = true;
            if (timer)
                clearTimeout(timer);
            if (health)
                clearInterval(health);
            signal.removeEventListener("abort", abort);
            dispose();
            // Official client performs TERM followed by KILL if Pi will not exit.
            await client.stop();
            if (request.id && this.clients.get(request.id) === client)
                this.clients.delete(request.id);
        }
    }
}
