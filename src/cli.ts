#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { ResearchStore } from "./store.js";
import { parseCommand } from "./commands.js";
import { researchSummary, generateReport } from "./report.js";
import { piCliPath } from "./pi-executor.js";
import { extensionPath, skillsPath } from "./paths.js";
export async function main(argv = process.argv.slice(2)): Promise<void> {
    if (!argv.length || argv.includes("--help")) {
        console.log("math-research init <objective> | status | report | run | resume | pause\nRun/resume options: --minutes N --rounds N --workers 1|2 --task-minutes N\nPi options: --provider NAME --model ID --thinking LEVEL --extension PATH\nRuns in the current directory. Resume preserves remaining budget; explicit --minutes/--rounds add budget.");
        return;
    }
    const args: string[] = [], piArgs: string[] = [];
    let provider: string | undefined, model: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const token = argv[i]!;
        if (["--provider", "--model", "--thinking", "--extension"].includes(token)) {
            const value = argv[++i];
            if (!value)
                throw new Error(`${token} needs a value`);
            if (token === "--provider")
                provider = value;
            else if (token === "--model")
                model = value;
            else
                piArgs.push(token, value);
        }
        else
            args.push(token);
    }
    const command = parseCommand(args.join(" ")), store = new ResearchStore(process.cwd());
    if (command.action === "steer")
        throw new Error("Use /research steer <taskId> <guidance> inside the active Pi session");
    if (command.action === "init") {
        await store.initialize(command.text);
        console.log("Created research/GOAL.md and research/PROGRESS.md");
        return;
    }
    if (command.action === "status") {
        console.log(await researchSummary(store));
        return;
    }
    if (command.action === "report") {
        console.log(await generateReport(store));
        return;
    }
    if (command.action === "pause") {
        await store.pause(command.text || "Paused by command");
        console.log("Pause requested; the active coordinator will stop at its next boundary.");
        return;
    }
    const state = await store.read(), directory = resolve(store.runtime, "main-sessions");
    await mkdir(directory, { recursive: true });
    const previous = command.action === "resume" ? state.campaign?.ownerSession : undefined;
    if (command.action === "resume" && !previous)
        throw new Error("No campaign to resume");
    const client = new RpcClient({ cliPath: piCliPath(), cwd: store.root, provider, model,
        args: ["--no-extensions", "--extension", extensionPath, "--skill", skillsPath, "--session-dir", directory, ...(previous ? ["--session", previous] : []), ...piArgs] });
    let interrupted = false, rejectExit: ((error: Error) => void) | undefined;
    const stopped = new Promise<never>((_, reject) => { rejectExit = reject; });
    const cancel = () => { interrupted = true; void client.abort().catch(() => { }); rejectExit?.(new Error("Interrupted; research state retained for resume")); };
    process.once("SIGINT", cancel);
    process.once("SIGTERM", cancel);
    const dispose = client.onEvent(event => {
        if (event.type === "message_end" && event.message.role === "assistant") {
            const text = event.message.content.filter(p => p.type === "text").map(p => p.text).join("");
            if (text)
                console.log(text);
        }
    });
    try {
        await client.start();
        await client.prompt(`/research ${args.join(" ")}`);
        const work = async () => {
            let started = false;
            for (let tick = 0;; tick++) {
                const current = await store.read(), session = await client.getState();
                if (current.campaign?.status === "running" && current.campaign.ownerSession === session.sessionFile)
                    started = true;
                if (current.campaign?.status === "paused" && current.campaign.ownerSession === session.sessionFile) {
                    // Command handling and campaign state may finish before the final tool reply settles.
                    if (!session.isStreaming && !session.isCompacting && !session.pendingMessageCount)
                        break;
                }
                if (!started && tick > 100 && !session.isStreaming)
                    throw new Error("Pi did not start the campaign; inspect its command diagnostics");
                await new Promise(r => setTimeout(r, 100));
            }
        };
        await Promise.race([work(), stopped]);
        console.log(await generateReport(store));
    }
    finally {
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
        dispose();
        await client.stop();
        const current = await store.read();
        if (current.campaign?.status === "running")
            await store.pause(interrupted ? "Headless process interrupted" : "Headless Pi process ended");
        await generateReport(store);
    }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
}
