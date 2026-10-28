export type TaskKind = "explore" | "experiment" | "review";
export type TaskStatus = "queued" | "running" | "completed" | "interrupted" | "failed";
export type ResultKind = "proof" | "lemma" | "counterexample" | "experiment" | "obstruction" | "note";
export interface FileRef {
    path: string;
    hash: string;
}
export interface Usage {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    cost: number;
}
export const emptyUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 });
export interface Attempt {
    id: string;
    sessionPath?: string;
    directory: string;
    startedAt: number;
    endedAt?: number;
    output?: FileRef;
    usage: Usage;
    error?: string;
    steering?: {
        message: string;
        at: number;
    }[];
}
export interface ResearchTask {
    id: string;
    title: string;
    question: string;
    successCriteria: string;
    kind: TaskKind;
    dependsOn: string[];
    inputs: FileRef[];
    goalHash: string;
    status: TaskStatus;
    reviewTarget?: {
        resultId: string;
        hash: string;
    };
    attempts: Attempt[];
    createdAt: number;
}
export interface Review {
    id: string;
    verdict: "accepted" | "changes" | "rejected" | "inconclusive";
    taskId: string;
    bodyHash: string;
    report: FileRef;
    sessionPath: string;
    createdAt: number;
}
export interface ResearchResult {
    id: string;
    statement: string;
    scope: string;
    assumptions: string[];
    kind: ResultKind;
    body: FileRef;
    sources: FileRef[];
    dependencies: {
        resultId: string;
        hash: string;
    }[];
    goalHash: string;
    authorSession: string;
    reviews: Review[];
    createdAt: number;
}
export interface Budget {
    milliseconds: number;
    maxRounds: number;
    concurrency: number;
    taskTimeoutMs: number;
}
export const DEFAULT_BUDGET: Budget = { milliseconds: 7200000, maxRounds: 20, concurrency: 2, taskTimeoutMs: 1200000 };
export interface Campaign {
    status: "running" | "paused";
    ownerSession: string;
    ownerPid: number;
    budget: Budget;
    remainingMs: number;
    remainingRounds: number;
    activeSince?: number;
    heartbeatAt?: number;
    rounds: number;
    stallRounds: number;
    lastProgress: string;
    reason?: string;
}
export interface ResearchState {
    version: 1;
    revision: number;
    goalHash: string;
    tasks: Record<string, ResearchTask>;
    results: Record<string, ResearchResult>;
    campaign?: Campaign;
}
export interface TaskSpec {
    title: string;
    question: string;
    successCriteria: string;
    kind?: TaskKind;
    dependsOn?: string[];
    inputs?: string[];
    reviewResultId?: string;
}
export interface ResultSpec {
    statement: string;
    scope: string;
    assumptions?: string[];
    kind: ResultKind;
    path: string;
    sources?: string[];
    dependencies?: string[];
}
export interface ExecutionRequest {
    id?: string;
    cwd: string;
    directory: string;
    prompt: string;
    sessionPath?: string;
    timeoutMs: number;
    model?: string;
    provider?: string;
    thinking?: string;
}
export interface ExecutionResult {
    text: string;
    sessionPath: string;
    usage: Usage;
}
export interface ExecutionEvent {
    type: string;
    text?: string;
    sessionPath?: string;
    usage?: Usage;
}
export interface ResearchExecutor {
    execute(request: ExecutionRequest, signal: AbortSignal, onEvent?: (event: ExecutionEvent) => void): Promise<ExecutionResult>;
    steer?(id: string, message: string): Promise<void>;
}
