#!/usr/bin/env node
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn } from "node:child_process";
import { packageRoot } from "./paths.js";
import { PiResearchExecutor } from "./pi-executor.js";
import { ResearchStore } from "./store.js";
// This runner prepares isolated inputs and records outputs. It does not use a
// gold-answer oracle to decide which attempts deserve more compute.
const options = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
    const key = process.argv[i]!, value = process.argv[i + 1];
    if (!value || !key.startsWith("--"))
        throw new Error("Use --case NAME --track baseline|skills|research --model ID [--provider NAME] [--minutes N]");
    options.set(key, value);
}
const name = options.get("--case"), track = options.get("--track"), model = options.get("--model");
if (!name || !/^[a-z-]+$/.test(name) || !["baseline", "skills", "research"].includes(track ?? "") || !model)
    throw new Error("Explicit --case, --track and --model are required. See examples/evaluation/README.md");
const provider = options.get("--provider"), thinking = options.get("--thinking"), minutes = Number(options.get("--minutes") ?? 10);
if (!Number.isFinite(minutes) || minutes <= 0)
    throw new Error("Minutes must be positive");
const scenario = JSON.parse(await readFile(join(packageRoot, "examples/evaluation/cases", `${name}.json`), "utf8")) as {
    objective: string;
    files: Record<string, string>;
};
const directory = resolve(options.get("--out") ?? join(".math-research/evaluations", `${name}-${track}-${Date.now()}`));
await mkdir(directory, { recursive: true });
for (const [path, body] of Object.entries(scenario.files)) {
    const dest = resolve(directory, path);
    if (!dest.startsWith(directory + "/"))
        throw new Error("Unsafe scenario path");
    await mkdir(resolve(dest, ".."), { recursive: true });
    await writeFile(dest, body);
}
await writeFile(join(directory, "PROBLEM.md"), scenario.objective);
const startedAt = Date.now(), manifest: Record<string, unknown> = { case: name, track, model, provider, thinking: thinking ?? "Pi configured default", minutes, startedAt, attempt: 1, oracleRetries: false, source: "examples/evaluation/cases", status: "running" };
const save = () => writeFile(join(directory, "run.json"), JSON.stringify(manifest, null, 2) + "\n");
await save();
try {
    if (track === "research") {
        await new ResearchStore(directory).initialize(scenario.objective);
        const child = spawn(process.execPath, [join(packageRoot, "dist/src/cli.js"), "run", "--model", model, ...(provider ? ["--provider", provider] : []), ...(thinking ? ["--thinking", thinking] : []), "--minutes", String(minutes)], { cwd: directory, stdio: "inherit" });
        const timer = setTimeout(() => child.kill("SIGTERM"), minutes * 60000 + 10000);
        const code = await new Promise<number | null>(r => child.once("exit", r));
        clearTimeout(timer);
        manifest.exitCode = code;
        if (code !== 0)
            throw new Error(`Research run exited ${code}`);
        manifest.result = "research/REPORT.md";
    }
    else {
        const executor = new PiResearchExecutor({ resources: track === "baseline" ? "none" : "skills" });
        const result = await executor.execute({ cwd: directory, directory: join(directory, "sessions"), model, provider, thinking, timeoutMs: minutes * 60000,
            prompt: `${scenario.objective}\n\nInspect PROBLEM.md and the supplied local materials. Work on this objective within ${minutes} minutes. Use available tools and save a self-contained final or partial result in FINAL.md with exact scope, remaining gaps and reproducible checks. No research_record tool is available in this track: save files directly. Do not inspect evaluator files or solutions outside this workspace.` }, new AbortController().signal);
        manifest.usage = result.usage;
        manifest.sessionPath = result.sessionPath;
        await writeFile(join(directory, "last-response.md"), result.text);
        manifest.result = "FINAL.md";
    }
    manifest.status = "completed";
}
catch (error) {
    manifest.status = "interrupted-or-failed";
    manifest.error = String(error);
    process.exitCode = 1;
}
finally {
    manifest.durationMs = Date.now() - startedAt;
    await save();
    console.log(directory);
}
