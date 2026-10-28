import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ResearchStore } from "./store.js";
export async function researchSummary(store: ResearchStore): Promise<string> {
    const state = await store.read();
    const lines = [`Campaign: ${state.campaign?.status ?? "not started"}${state.campaign?.reason ? ` (${state.campaign.reason})` : ""}`];
    if (state.campaign) {
        const c = state.campaign, remaining = Math.max(0, c.remainingMs - (c.activeSince ? Date.now() - c.activeSince : 0));
        lines.push(`Rounds: ${c.rounds}; remaining rounds: ${c.remainingRounds}; remaining seconds: ${Math.floor(remaining / 1000)}`);
    }
    lines.push("Tasks:");
    for (const t of Object.values(state.tasks))
        lines.push(`- ${t.id} [${t.kind}/${t.status}]: ${t.title}${t.attempts.at(-1)?.output ? ` -> ${t.attempts.at(-1)!.output!.path}` : ""}`);
    lines.push("Results (reviewed means informal model review, not formal certification):");
    for (const r of Object.values(state.results))
        lines.push(`- ${r.id} [${r.kind}/${await store.resultStatus(r, state)}]: ${r.statement}\n  Scope: ${r.scope}\n  Body: ${r.body.path}`);
    return lines.join("\n");
}
export async function generateReport(store: ResearchStore): Promise<string> {
    const state = await store.read(), lines = ["# Mathematical research report", "", `Generated: ${new Date().toISOString()}`, "", await store.goal(), "## Current mathematical state", ""];
    try {
        lines.push(await readFile(resolve(store.root, "research/PROGRESS.md"), "utf8"));
    }
    catch {
        lines.push("No progress note saved.");
    }
    lines.push("", "## Results and evidence", "", "A reviewed result has an independent model review of its exact body. It is not a formal certificate. Stale or disputed results must not be used as established dependencies.", "");
    for (const result of Object.values(state.results)) {
        lines.push(`### ${result.statement}`, "", `- Kind: ${result.kind}; status: **${await store.resultStatus(result, state)}**`, `- Scope: ${result.scope}`, `- Assumptions: ${result.assumptions.join("; ") || "none declared"}`, `- [Exact body](${result.body.path.replace(/^research\//, "")}) · SHA-256: \`${result.body.hash}\``);
        for (const source of result.sources)
            lines.push(`- Source: [${source.path}](../${source.path}) · \`${source.hash}\``);
        for (const dep of result.dependencies)
            lines.push(`- Dependency: ${dep.resultId} · \`${dep.hash}\``);
        for (const review of result.reviews)
            lines.push(`- Review: **${review.verdict}** · [report](${review.report.path.replace(/^research\//, "")}) · session \`${review.sessionPath}\``);
        lines.push("");
    }
    lines.push("## Execution and unfinished tasks", "", "Execution status describes work performed, not whether the mathematics is correct.", "");
    let input = 0, output = 0, cost = 0;
    for (const task of Object.values(state.tasks)) {
        lines.push(`- **${task.title}** (${task.id}): ${task.status}`, `  Question: ${task.question}`, `  Completion condition: ${task.successCriteria}`);
        for (const attempt of task.attempts) {
            input += attempt.usage.input;
            output += attempt.usage.output;
            cost += attempt.usage.cost;
            if (attempt.output)
                lines.push(`  [Attempt output](${attempt.output.path.replace(/^research\//, "")})${attempt.error ? ` — ${attempt.error}` : ""}`);
        }
    }
    lines.push("", `Task-session usage: input=${input}, output=${output}, estimated USD=${cost.toFixed(6)}. Main-session usage is available in Pi's session statistics; these task totals do not include it. Interrupted requests may lack final provider accounting; a zero recorded value is not a cost guarantee.`, "", `Campaign: ${state.campaign?.status ?? "not started"}; reason: ${state.campaign?.reason ?? "none recorded"}.`, "");
    const target = resolve(store.root, "research/REPORT.md");
    await writeFile(target, lines.join("\n"));
    return target;
}
