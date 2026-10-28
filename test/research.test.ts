import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ResearchStore, hash } from "../src/store.js";
import { ResearchCoordinator } from "../src/coordinator.js";
import { emptyUsage, type ResearchExecutor } from "../src/types.js";
import { generateReport } from "../src/report.js";
import { parseCommand } from "../src/commands.js";
async function fixture(t: {
    after(fn: () => Promise<void>): unknown;
}) {
    const root = await mkdtemp(join(tmpdir(), "pi-math-test-"));
    t.after(() => rm(root, { recursive: true, force: true }));
    const store = new ResearchStore(root);
    await store.initialize("Find the exact scope of the proposed theorem");
    await writeFile(join(root, "draft.md"), "The original proof body.");
    return { root, store };
}
const task = (title: string) => ({ title, question: "Check a precise missing lemma", successCriteria: "Give a derivation or a concrete counterexample" });
const result = { statement: "A bounded lemma", scope: "n=1,...,10 only", kind: "lemma" as const, path: "draft.md" };
const executor: ResearchExecutor = { async execute(request, _signal, onEvent) { const sessionPath = request.sessionPath ?? join(request.directory, "pi-session.jsonl"); onEvent?.({ type: "session", sessionPath }); return { text: "Independent derivation with explicit scope.", sessionPath, usage: emptyUsage() }; } };
test("captures the exact body rather than a differently named publication file", async (t) => {
    const { root, store } = await fixture(t);
    const id = await store.record(result, "author");
    await writeFile(join(root, "draft.md"), "A different and unchecked body");
    const state = await store.read();
    assert.equal(await readFile(join(root, state.results[id]!.body.path), "utf8"), "The original proof body.");
    assert.equal(await store.resultStatus(state.results[id]!, state), "candidate");
});
test("an independent exact-body review is required, and a changed report invalidates it", async (t) => {
    const { root, store } = await fixture(t), id = await store.record(result, "author");
    await assert.rejects(store.review(id, "missing", "accepted"), /completed independent/);
    const review = await store.addTask({ ...task("Audit"), kind: "review", reviewResultId: id });
    await store.start("main");
    await new ResearchCoordinator(store, executor).dispatch();
    await store.review(id, review, "accepted");
    let state = await store.read();
    assert.equal(await store.resultStatus(state.results[id]!, state), "reviewed");
    await assert.rejects(store.review(id, review, "rejected"), /already recorded/);
    const report = state.tasks[review]!.attempts.at(-1)!.output!;
    await writeFile(join(root, report.path), "The report changed");
    state = await store.read();
    assert.equal(await store.resultStatus(state.results[id]!, state), "stale");
});
test("edited proof body, goal or input cannot retain a valid review", async (t) => {
    const { root, store } = await fixture(t), id = await store.record(result, "author");
    const review = await store.addTask({ ...task("Audit"), reviewResultId: id });
    await store.start("main");
    await new ResearchCoordinator(store, executor).dispatch();
    const state = await store.read();
    await writeFile(join(root, state.results[id]!.body.path), "Changed theorem");
    await assert.rejects(store.review(id, review, "accepted"), /changed/);
    assert.equal(await store.resultStatus(state.results[id]!, state), "stale");
});
test("conflicting independent reviews stay disputed", async (t) => {
    const { store } = await fixture(t), id = await store.record(result, "author");
    const a = await store.addTask({ ...task("Audit A"), reviewResultId: id });
    const b = await store.addTask({ ...task("Audit B"), reviewResultId: id });
    await store.start("main");
    await new ResearchCoordinator(store, executor).dispatch();
    await store.review(id, a, "accepted");
    await store.review(id, b, "changes");
    const state = await store.read();
    assert.equal(await store.resultStatus(state.results[id]!, state), "disputed");
});
test("dependency invalidation propagates transitively", async (t) => {
    const { root, store } = await fixture(t), a = await store.record(result, "author");
    const review = await store.addTask({ ...task("Audit A"), reviewResultId: a });
    await store.start("main");
    await new ResearchCoordinator(store, executor).dispatch();
    await store.review(a, review, "accepted");
    const b = await store.record({ ...result, dependencies: [a] }, "author"), state = await store.read();
    assert.equal(await store.resultStatus(state.results[b]!, state), "candidate");
    await writeFile(join(root, state.results[a]!.body.path), "Changed dependency");
    assert.equal(await store.resultStatus(state.results[b]!, await store.read()), "stale");
});
test("task dependencies are honored and concurrent tasks have separate directories and sessions", async (t) => {
    const { store } = await fixture(t), a = await store.addTask(task("A")), b = await store.addTask(task("B"));
    const c = await store.addTask({ ...task("C"), dependsOn: [a, b] });
    await store.start("main");
    const coordinator = new ResearchCoordinator(store, executor);
    const dispatched = await coordinator.dispatch();
    assert.deepEqual(new Set(dispatched), new Set([a, b]));
    assert.equal((await store.read()).tasks[c]!.status, "queued");
    await coordinator.dispatch();
    const state = await store.read();
    assert.equal(state.tasks[c]!.status, "completed");
    assert.notEqual(state.tasks[a]!.attempts[0]!.sessionPath, state.tasks[b]!.attempts[0]!.sessionPath);
    assert.notEqual(state.tasks[a]!.attempts[0]!.directory, state.tasks[b]!.attempts[0]!.directory);
});
test("changed evidence prevents dispatch before a provider is called", async (t) => {
    const { root, store } = await fixture(t), id = await store.addTask({ ...task("Inputs"), inputs: ["draft.md"] });
    await writeFile(join(root, "draft.md"), "Changed evidence");
    await store.start("main");
    let calls = 0;
    await new ResearchCoordinator(store, { async execute() { calls++; throw new Error("must not run"); } }).dispatch();
    assert.equal(calls, 0);
    assert.equal((await store.read()).tasks[id]!.status, "failed");
});
test("interruption is saved, resume reuses the durable session without duplicating completed work", async (t) => {
    const { root, store } = await fixture(t), id = await store.addTask(task("Interrupt"));
    await store.start("main");
    const savedSession = join(root, "old-pi-session");
    await writeFile(savedSession, "Pi history fixture");
    await store.transact(state => { state.tasks[id]!.status = "running"; state.tasks[id]!.attempts.push({ id: "old", sessionPath: savedSession, directory: "scratch", startedAt: 0, usage: emptyUsage() }); });
    await store.pause("Simulated process exit");
    await store.start("new-main", {}, true);
    assert.equal((await store.read()).tasks[id]!.status, "interrupted");
    let calls = 0;
    const coordinator = new ResearchCoordinator(store, { async execute(request) { calls++; assert.equal(request.sessionPath, savedSession); return { text: "Recovered", sessionPath: request.sessionPath!, usage: emptyUsage() }; } });
    await coordinator.dispatch();
    await coordinator.dispatch();
    assert.equal(calls, 1);
});
test("cancel reaches an active task and leaves a resumable attempt", async (t) => {
    const { store } = await fixture(t), id = await store.addTask(task("Blocking"));
    await store.start("main");
    let entered!: () => void;
    const started = new Promise<void>(r => entered = r);
    const coordinator = new ResearchCoordinator(store, { async execute(_r, signal) { entered(); await new Promise<void>((_r, reject) => signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })); throw new Error("cancelled"); } });
    const pending = coordinator.dispatch();
    await started;
    await coordinator.cancel();
    await pending;
    assert.equal((await store.read()).tasks[id]!.status, "interrupted");
});
test("resume preserves consumed budget and only explicit additions extend it", async (t) => {
    const { store } = await fixture(t);
    await store.start("main", { milliseconds: 50, maxRounds: 1 });
    const coordinator = new ResearchCoordinator(store, executor);
    assert.equal((await coordinator.boundary("main")).continue, false);
    assert.equal((await coordinator.boundary("main")).continue, false);
    await store.pause("Budget end");
    await assert.rejects(store.start("main", {}, true), /exhausted/);
    await store.start("main", { milliseconds: 100, maxRounds: 2 }, true);
    const state = await store.read();
    assert.equal(state.campaign!.remainingRounds, 2);
    assert.ok(state.campaign!.remainingMs <= 150);
});
test("a second live campaign cannot take ownership", async (t) => {
    const { store } = await fixture(t);
    await store.start("A");
    await assert.rejects(store.start("B"), /already running/);
});
test("crash recovery charges time through the last heartbeat, not the offline interval", async (t) => {
    const { store } = await fixture(t);
    await store.start("main");
    await store.transact(state => { const c = state.campaign!; c.ownerPid = 2147483647; c.activeSince = 1000; c.heartbeatAt = 2000; c.remainingMs = 10000; });
    await store.start("recovered", {}, true);
    assert.equal((await store.read()).campaign!.remainingMs, 9000);
});
test("a changed completed dependency cannot silently feed the next task", async (t) => {
    const { root, store } = await fixture(t), a = await store.addTask(task("A"));
    const b = await store.addTask({ ...task("B"), dependsOn: [a] });
    await store.start("main");
    const coordinator = new ResearchCoordinator(store, executor);
    await coordinator.dispatch();
    const ref = (await store.read()).tasks[a]!.attempts[0]!.output!;
    await writeFile(join(root, ref.path), "Tampered dependency output");
    await coordinator.dispatch();
    assert.equal((await store.read()).tasks[b]!.status, "failed");
});
test("missing Pi history falls back to the explicit saved handoff", async (t) => {
    const { store } = await fixture(t), id = await store.addTask(task("Recover"));
    await store.start("main");
    await store.transact(state => { state.tasks[id]!.status = "interrupted"; state.tasks[id]!.attempts.push({ id: "old", sessionPath: "/nonexistent/pi-session", directory: "scratch", startedAt: 0, usage: emptyUsage() }); });
    await new ResearchCoordinator(store, { async execute(request) { assert.equal(request.sessionPath, undefined); assert.match(request.prompt, /previous Pi session file is unavailable/); return { text: "Recovered from inputs", sessionPath: "new-session", usage: emptyUsage() }; } }).dispatch();
    assert.equal((await store.read()).tasks[id]!.status, "completed");
});
test("parallel state writers serialize and immutable reports expose actual scope", async (t) => {
    const { root, store } = await fixture(t);
    const other = new ResearchStore(root);
    await Promise.all(Array.from({ length: 12 }, (_, i) => (i % 2 ? store : other).addTask(task(`T${i}`))));
    assert.equal(Object.keys((await store.read()).tasks).length, 12);
    await store.record(result, "author");
    const report = await readFile(await generateReport(store), "utf8");
    assert.match(report, /n=1,...,10 only/);
    assert.match(report, /candidate/);
    assert.match(report, /not a formal certificate/);
});
test("objective revisions invalidate historical results instead of rewriting them", async (t) => {
    const { root, store } = await fixture(t), id = await store.record(result, "author");
    await writeFile(join(root, "research/GOAL.md"), "A new quantified objective");
    const state = await store.read();
    assert.equal(await store.resultStatus(state.results[id]!, state), "stale");
    assert.equal(state.results[id]!.body.hash, hash("The original proof body."));
});
test("recording a worker output carries its actual producer and input provenance", async t => {
    const { root, store } = await fixture(t);
    const id = await store.addTask({ ...task("Derived result"), inputs: ["draft.md"] }); await store.start("main");
    await new ResearchCoordinator(store, executor).dispatch();
    const completed = (await store.read()).tasks[id]!, attempt = completed.attempts[0]!;
    const resultId = await store.record({ ...result, path: attempt.output!.path }, "main-session");
    let state = await store.read(); assert.equal(state.results[resultId]!.authorSession, attempt.sessionPath);
    assert.equal(state.results[resultId]!.sources[0]!.path, "draft.md");
    await writeFile(join(root, "draft.md"), "Changed experimental input"); state = await store.read();
    assert.equal(await store.resultStatus(state.results[resultId]!, state), "stale");
    await assert.rejects(store.record({ ...result, path: attempt.output!.path }, "main-session"), /provenance is stale/);
});
test("command parser rejects missing budgets and supports explicit additions", () => {
    assert.throws(() => parseCommand("run --minutes"), /Invalid/);
    assert.equal(parseCommand("resume --minutes 2 --rounds 3").budget.milliseconds, 120000);
    assert.throws(() => parseCommand("run --magic"), /Unknown/);
});
