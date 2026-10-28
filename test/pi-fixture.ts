// Local deterministic endpoint for integration tests. Never part of the published package.
import { createServer } from "node:http";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
export async function piFixture() {
    const directory = await mkdtemp(join(tmpdir(), "research-pi-fixture-"));
    const agentDir = join(directory, "agent");
    await mkdir(agentDir);
    const calls: {
        body: any;
    }[] = [];
    const server = createServer(async (req, res) => {
        let raw = "";
        for await (const chunk of req)
            raw += chunk;
        const body = JSON.parse(raw);
        calls.push({ body });
        if (JSON.stringify(body.messages).includes("BLOCK_UNTIL_CANCEL")) {
            res.writeHead(200, { "Content-Type": "text/event-stream" });
            res.write(`data: ${JSON.stringify({ id: "blocked", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: { role: "assistant", content: "Partial evidence before cancellation" }, finish_reason: null }] })}\n\n`);
            return;
        }
        const tools = new Set((body.tools ?? []).map((t: any) => t.function.name));
        const used = new Set(body.messages.flatMap((m: any) => (m.tool_calls ?? []).map((c: any) => c.function.name)));
        let tool: {
            name: string;
            args: object;
        } | undefined;
        if (JSON.stringify(body.messages).includes("BUDGET_ONLY")) {
            // Intentionally settle without a pause tool so the plugin must enforce the round limit.
        }
        else if (tools.has("research_record")) {
            if (!used.has("research_record"))
                tool = { name: "research_record", args: { action: "result", kind: "experiment", statement: "A finite arithmetic check", scope: "one fixture input only", path: "draft.md" } };
        else if (!JSON.stringify(body.messages).includes('\\"action\\":\\"enqueue\\"') && !body.messages.some((m: any) => (m.tool_calls ?? []).some((c: any) => c.function.name === "research_task" && JSON.parse(c.function.arguments).action === "enqueue")))
            tool = { name: "research_task", args: { action: "enqueue", title: "Independent exact calculation", question: "Check n=40 with exact arithmetic and save the calculation.", successCriteria: "A saved exact calculation with finite scope.", kind: "experiment", inputs: ["draft.md"] } };
        else if (!body.messages.some((m: any) => (m.tool_calls ?? []).some((c: any) => c.function.name === "research_task" && JSON.parse(c.function.arguments).action === "dispatch")))
            tool = { name: "research_task", args: { action: "dispatch" } };
        else if (!used.has("research_status"))
                tool = { name: "research_status", args: { action: "pause", reason: "Fixture finite result delivered; no general theorem claimed" } };
        }
        else if (!used.has("write"))
            tool = { name: "write", args: { path: "experiment.txt", content: "40^2+40+41 = 1681 = 41^2\n" } };
        const delta = tool ? { tool_calls: [{ index: 0, id: `call-${calls.length}`, type: "function", function: { name: tool.name, arguments: JSON.stringify(tool.args) } }] } : { content: "Finite check recorded. No universal primality conclusion follows." };
        res.writeHead(200, { "Content-Type": "text/event-stream" });
        const chunk = (choice: object, usage?: object) => `data: ${JSON.stringify({ id: `chat-${calls.length}`, object: "chat.completion.chunk", created: 1, model: "fixture", choices: [choice], ...(usage ? { usage } : {}) })}\n\n`;
        res.write(chunk({ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }));
        res.write(chunk({ index: 0, delta: {}, finish_reason: tool ? "tool_calls" : "stop" }, { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }));
        res.end("data: [DONE]\n\n");
    });
    await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("Missing fixture port");
    await writeFile(join(agentDir, "models.json"), JSON.stringify({ providers: { "research-fixture": { api: "openai-completions", baseUrl: `http://127.0.0.1:${address.port}/v1`, apiKey: "local-test-only", models: [{ id: "fixture", name: "Fixture", reasoning: false, input: ["text"], contextWindow: 100000, maxTokens: 1000, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } }] } } }));
    await writeFile(join(agentDir, "settings.json"), JSON.stringify({ defaultProvider: "research-fixture", defaultModel: "fixture", defaultThinkingLevel: "off" }));
    return { directory, agentDir, calls, async close() { server.closeAllConnections(); await new Promise<void>(r => server.close(() => r())); await rm(directory, { recursive: true, force: true }); } };
}
