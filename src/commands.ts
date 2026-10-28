import type { Budget } from "./types.js";
export interface ResearchCommand {
    action: string;
    text: string;
    budget: Partial<Budget>;
}
export function parseCommand(input: string): ResearchCommand {
    const parts = input.trim().split(/\s+/), action = parts.shift() || "status", words: string[] = [], budget: Partial<Budget> = {};
    for (let i = 0; i < parts.length; i++) {
        const token = parts[i]!;
        const key = ({ "--minutes": "milliseconds", "--rounds": "maxRounds", "--workers": "concurrency", "--task-minutes": "taskTimeoutMs" } as const)[token as "--minutes"];
        if (key) {
            const value = Number(parts[++i]);
            if (!Number.isFinite(value) || value <= 0)
                throw new Error(`Invalid value for ${token}`);
            budget[key] = value * (key === "milliseconds" || key === "taskTimeoutMs" ? 60000 : 1);
        }
        else if (token.startsWith("--"))
            throw new Error(`Unknown research option: ${token}`);
        else
            words.push(token);
    }
    if (!["init", "run", "pause", "resume", "status", "report", "steer"].includes(action))
        throw new Error("Use /research init|run|pause|resume|status|report|steer");
    return { action, text: words.join(" "), budget };
}
