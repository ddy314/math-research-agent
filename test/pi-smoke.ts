import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { PiResearchExecutor, piCliPath } from "../src/pi-executor.js";
import { RpcClient } from "@earendil-works/pi-coding-agent";
import { packageRoot } from "../src/paths.js";
import { piFixture } from "./pi-fixture.js";
import { ResearchStore } from "../src/store.js";
const fixture = await piFixture();
try {
    const testedRoot = process.argv[2] ?? packageRoot;
    const testedExtension = join(testedRoot, "dist/extensions/research.js"), testedSkills = join(testedRoot, "skills");
    const project = join(fixture.directory, "project");
    await mkdir(project);
    const env = { PI_CODING_AGENT_DIR: fixture.agentDir, PI_OFFLINE: "1" };
    const executor = new PiResearchExecutor({ env });
    const result = await executor.execute({ cwd: project, directory: join(project, "sessions"), prompt: "EXECUTOR_SMOKE: disprove the universal primality claim with an exact calculation and save it.", timeoutMs: 30000, provider: "research-fixture", model: "fixture" }, new AbortController().signal);
    assert.match(await readFile(join(project, "experiment.txt"), "utf8"), /1681/);
    assert.match(result.text, /No universal/);
    assert.ok(result.sessionPath);
    assert.ok(result.usage.output > 0);
    const resumed = await executor.execute({ cwd: project, directory: join(project, "sessions"), sessionPath: result.sessionPath, prompt: "Explain the exact scope of the saved check.", timeoutMs: 30000, provider: "research-fixture", model: "fixture" }, new AbortController().signal);
    assert.equal(resumed.sessionPath, result.sessionPath);
    const blockedAt = Date.now();
    await assert.rejects(executor.execute({ cwd: project, directory: join(project, "blocked"), prompt: "BLOCK_UNTIL_CANCEL", timeoutMs: 1500, provider: "research-fixture", model: "fixture" }, new AbortController().signal), /deadline/);
    assert.ok(Date.now() - blockedAt < 5000, "Hard deadline must stop a real blocked Pi process");
    const parentProject = process.argv[2] ? join(fixture.directory, "packed-project") : project;
    if (process.argv[2]) {
        await mkdir(parentProject);
        await new ResearchStore(parentProject).initialize("Packaged plugin finite check");
        await writeFile(join(parentProject, "draft.md"), "One exact test, not a general proof.");
    }
    const client = new RpcClient({ cliPath: piCliPath(), cwd: parentProject, env, provider: "research-fixture", model: "fixture", args: ["--no-extensions", "--extension", testedExtension, "--skill", testedSkills, "--session-dir", join(parentProject, "parent")] });
    try {
        await client.start();
        const commands = await client.getCommands();
        assert.ok(commands.some(c => c.name === "research"));
        for (const name of ["research-orientation", "research-strategy", "mathematical-experiment", "proof-development", "proof-audit", "research-continuity", "research-synthesis"])
            assert.ok(commands.some(c => c.name === `skill:${name}` || c.name === name), `Missing skill command ${name}: ${JSON.stringify(commands.map(c => c.name))}`);
        if (process.argv[2]) {
            await client.prompt("/research run --minutes 1 --rounds 3");
            const packedStore = new ResearchStore(parentProject);
            for (let i = 0; i < 300; i++) {
                const s = await packedStore.read(), rpc = await client.getState();
                if (s.campaign?.status === "paused" && !rpc.isStreaming) break;
                if (i === 299) throw new Error("Packaged plugin failed to settle");
                await new Promise(r => setTimeout(r, 100));
            }
            const packedState = await packedStore.read();
            assert.equal(Object.values(packedState.tasks)[0]?.status, "completed", JSON.stringify(packedState.tasks));
            assert.equal(Object.keys(packedState.results).length, 1);
        }
    }
    finally {
        await client.stop();
    }
    await new ResearchStore(project).initialize("A finite counterexample exercise");
    await writeFile(join(project, "draft.md"), "At n=40, n^2+n+41 = 41^2, so universal primality is false.");
    const child = spawn(process.execPath, [join(packageRoot, "dist/src/cli.js"), "run", "--rounds", "3", "--minutes", "1", "--provider", "research-fixture", "--model", "fixture"], { cwd: project, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let log = "";
    child.stdout.on("data", c => log += c);
    child.stderr.on("data", c => log += c);
    const timeout = setTimeout(() => child.kill("SIGKILL"), 35000);
    const code = await new Promise<number | null>(r => child.once("exit", r));
    clearTimeout(timeout);
    assert.equal(code, 0, log);
    const state = await new ResearchStore(project).read();
    assert.equal(state.campaign?.status, "paused");
    assert.equal(Object.keys(state.results).length, 1);
    assert.equal(Object.values(state.tasks).length, 1);
    assert.equal(Object.values(state.tasks)[0]!.status, "completed", JSON.stringify(state.tasks));
    assert.match(await readFile(join(project, "research/REPORT.md"), "utf8"), /one fixture input only/);
    const budgetProject = join(fixture.directory, "budget-project"); await mkdir(budgetProject);
    const budgetStore = new ResearchStore(budgetProject); await budgetStore.initialize("BUDGET_ONLY: test the continuation boundary");
    const budgetClient = new RpcClient({ cliPath: piCliPath(), cwd: budgetProject, env, provider: "research-fixture", model: "fixture", args: ["--no-extensions", "--extension", testedExtension, "--session-dir", join(budgetProject, "sessions")] });
    try {
        await budgetClient.start(); await budgetClient.prompt("/research run --minutes 1 --rounds 2");
        for (let i = 0; i < 100; i++) {
            const s = await budgetStore.read(), rpc = await budgetClient.getState();
            if (s.campaign?.status === "paused" && !rpc.isStreaming) break;
            if (i === 99) throw new Error("Round budget did not stop automatic research continuation");
            await new Promise(r => setTimeout(r, 100));
        }
        const c = (await budgetStore.read()).campaign!; assert.equal(c.rounds, 2); assert.match(c.reason ?? "", /round budget/);
    } finally { await budgetClient.stop(); }
    console.log(JSON.stringify({ pi: "1.4.0", realToolLoop: true, sessionResume: true, pluginAndSevenSkillsLoaded: true, headlessRecordAndPause: true, independentTaskDispatch: true, hardDeadline: true, roundBudget: true, packagedPlugin: process.argv[2] !== undefined, providerRequests: fixture.calls.length, externalModelCalls: 0 }, null, 2));
}
finally {
    await fixture.close();
}
