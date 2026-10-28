import { test } from "node:test";
import assert from "node:assert/strict";
import { PiResearchExecutor, ExecutionInterrupted, type PiClient } from "../src/pi-executor.js";
function fake() {
    let listener: Parameters<PiClient["onEvent"]>[0] = () => { };
    const counts = { abort: 0, stop: 0, prompt: 0, steer: 0 };
    const client: PiClient = {
        async start() { }, async stop() { counts.stop++; }, async abort() { counts.abort++; },
        async steer() { counts.steer++; return "queued"; },
        onEvent(fn) { listener = fn; return () => { }; },
        async getState() { return { sessionFile: "/tmp/pi-test-session" } as Awaited<ReturnType<PiClient["getState"]>>; },
        async getSessionStats() { return { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0 } as Awaited<ReturnType<PiClient["getSessionStats"]>>; },
        async promptAndWait() { counts.prompt++; listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "Useful partial derivation" } } as Parameters<typeof listener>[0]); return new Promise(() => { }); },
    };
    return { client, counts };
}
const request = { id: "task", cwd: "/tmp", directory: "/tmp", prompt: "A focused question", timeoutMs: 10000 };
test("Pi cancellation forwards abort, retains partial output, and disposes the child", async () => {
    const { client, counts } = fake(), controller = new AbortController();
    const executor = new PiResearchExecutor({ clientFactory: () => client });
    const pending = executor.execute(request, controller.signal);
    await new Promise(r => setTimeout(r, 10));
    await executor.steer("task", "Try the boundary case first");
    controller.abort();
    await assert.rejects(pending, (e: unknown) => e instanceof ExecutionInterrupted && e.partial.text.includes("partial derivation"));
    assert.equal(counts.abort, 1);
    assert.equal(counts.stop, 1);
    assert.equal(counts.steer, 1);
    await assert.rejects(executor.steer("task", "Late"), /not active/);
});
test("Pi hard deadline interrupts even if the provider never returns", async () => {
    const { client, counts } = fake();
    const executor = new PiResearchExecutor({ clientFactory: () => client });
    await assert.rejects(executor.execute({ ...request, timeoutMs: 15 }, new AbortController().signal), /deadline/);
    assert.equal(counts.abort, 1);
    assert.equal(counts.stop, 1);
});
test("a cancelled slow startup cannot send a late model prompt", async () => {
    const { client, counts } = fake();
    client.start = async () => { await new Promise(r => setTimeout(r, 40)); };
    const executor = new PiResearchExecutor({ clientFactory: () => client });
    await assert.rejects(executor.execute({ ...request, timeoutMs: 10 }, new AbortController().signal), /deadline/);
    await new Promise(r => setTimeout(r, 55));
    assert.equal(counts.prompt, 0);
    assert.equal(counts.stop, 1);
});
test("unexpected process death is detected without waiting for the full task deadline", async () => {
    const { client, counts } = fake();
    let checks = 0;
    const state = client.getState;
    client.getState = async () => { if (++checks > 1)
        throw new Error("child exited"); return state(); };
    const start = Date.now();
    await assert.rejects(new PiResearchExecutor({ clientFactory: () => client }).execute(request, new AbortController().signal), /became unavailable/);
    assert.ok(Date.now() - start < 4000);
    assert.equal(counts.stop, 1);
});
