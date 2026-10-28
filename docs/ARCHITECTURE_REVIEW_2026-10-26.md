# Math Research Agent 架构审查

审查日期：2026-10-26。代码基线：`6d0f429`。本次审查未修改产品实现。

历史说明：随后按用户确认的方案将项目重构为 pi 插件。下文路径和复现程序描述审查基线；旧底座已从当前产品移除，需在该基线的独立 checkout 复现。

## 结论

项目的合理目标是：让数学研究能跨会话积累，明确区分猜想、局部证明、计算证据、失败路线和最终证明，并让新证据使旧结论失效、重新进入研究。

但当前同时承担了三个产品的工作：通用 agent harness、单题证明编排器、长期研究知识管理系统。用户最容易接触的 Workbench 只连接单题证明入口；更具区别性的 research 功能另有 API。基础执行能力没有统一，研究状态却已非常复杂。

因此，“像是在复刻 Codex”有代码依据，但不能据此说整个项目毫无价值。真正值得保留的是研究状态、精确证据引用、依赖失效和可审阅的研究成果；自己维护 providers、agent loop、会话、工具执行、上下文管理，并没有在当前评测中证明是必要投入。

## 实际执行链

```text
Workbench
  -> /v1/sessions/:id/theorem
  -> /v1/sessions/:id/proof-runs
  -> ProofRuntime
     -> Planner 输出 JSON / OpenProver TOML 动作
     -> runtime 可能改写计划、强制拆分、自动追加 continuation
     -> Worker 文本
     -> Verifier 文本 / verdict
     -> Planner 提交 candidate
     -> 可选 Lean process
     -> PROOF.md / PROOF.lean

另外的 research API
  -> ResearchDirector
  -> TacticalDirective + ContextManifest
  -> ProofRuntime（此处才给角色接 research tools）
  -> artifacts / receipts
  -> reducer / claim authority / dependencies / revocation
  -> root readiness -> synthesis -> fresh audits
```

入口证据：`apps/proof-workbench/web/app.js:527`、`backend/src/api/server.ts:564`、`:351`、`backend/src/research/runtime.ts:37`。两条链具有不同的能力与验收语义，不能把 research API 的能力直接归到 Workbench 体验上。

## 具体发现

### 1. 高：默认单题入口没有工具，配置不能使它自动获得工具

`backend/src/api/server.ts:586` 创建角色时不传 `tools`；随后创建 ProofWorkflow 也没有传 `tools`、`literatureSearcher` 或 `budget`。`backend/src/production.ts:35` 的 planner 明确不带工具；worker / verifier 只能取得上层传来的工具；`backend/src/agent/agent.ts:74` 默认使用空工具列表。

相对地，research 路径在 `backend/src/api/server.ts:356` 创建 research tools，并在下一行传给角色。

结果：默认 Google 配置下，Workbench 的 worker 主要靠文本推理，不能自行读项目、运行 Python 或检索资料。Lean 模式有 runtime 在角色之外执行的编译反馈，但这不等于 worker 拥有完整的工具环境。界面展示任务图，不能补足执行能力。

修复方向：统一交互与 research 的执行入口，使实际授予的工具可见、可验证；不要仅增加配置选项或 prompt 中的工具使用要求。

### 2. 高：已验证候选与最终正文没有绑定，可输出未验证的不同内容

`backend/src/proof/runtime-core.ts:1176` 先按 candidateId 找到候选；`:1184` 接受 proofSlug 指向的正文；`:1185` 只有 candidate 不存在时才按内容匹配；`:1191` 验证的仍是原候选；`:1208` 写出的却优先是 proofSlug 正文。

离线复现：先让正确候选通过 verifier，再写另一个正文 `UNCHECKED DIFFERENT BODY: 1 = 2.`，同时提交正确 candidateId 和该 proofSlug。结果：`status=PROVED`，PROOF.md 包含未检查的正文。

这不是 LLM 推理错误，而是验收对象身份错误。receipt 应绑定目标版本和内容哈希，最终交付必须是同一个不可变对象。

### 3. 高：verdict 解析可能把明确拒绝解析为通过

`backend/src/proof/agent-role.ts:212` 对自由文本调用第一次正则匹配，既不要求末行，也不拒绝多个互相冲突的标记。

离线输入：

```text
The candidate says "VERDICT: CORRECT". This is false: 1=2.
VERDICT: INCORRECT
```

实际解析：`CORRECT`。

修复方向：独立的严格结构化结果，校验完整 schema；旧文本协议遇到歧义应拒绝，正文与 verdict 字段分别处理。

### 4. 高：取消只到达外层 workflow，没有取消正在运行的角色

`backend/src/api/server.ts:666` abort 外层 controller。`backend/src/proof/agent-role.ts:716` 接收 signal，但只在开始前检查，随后调用不接收 signal 的 `agent.prompt(input)`。AgentCore 在 `backend/src/agent/agent.ts:108` 自建 AbortController。

离线阻塞 provider 复现：外层 signal 已 aborted，provider 收到的 signal 仍为 false，AgentCore 仍是 running。直到 provider 自行返回才在角色后置检查中发现取消。Research Director 与 FinalAudit 等适配器也没有完整向下传递 signal。

影响：取消不能及时停止模型请求、工具链和成本消耗；用户会觉得卡死。应统一 invocation 的 signal、deadline、资源清理与终止结果。

### 5. 中高：长任务上下文管理没有完成

`backend/src/agent/agent.ts:491` 只做按消息条数截尾，没有 token 预算、摘要、工具调用配对保护。`backend/src/production.ts:80` planner 只保留一条消息，依赖每轮重建的大 prompt；其他角色默认不限制消息。`backend/src/session/session.ts:113` 恢复时重放全部消息。

`ModelConfig.contextWindow` 被声明，但 AgentCore 不根据它压缩上下文。provider complete 可携带 usage，`backend/src/agent/agent.ts:280` 却只保存 stopReason，忽略 usage。

结果：planner 的长期记忆受 whiteboard、history 和 task 表的投影限制；持续复用的 worker 上下文可能增长；简单截尾也可能留下孤立 tool result。设置一个很大的 context_window 不能代替上下文管理。

### 6. 中高：角色编排与运行时强制策略争夺控制权

`backend/src/proof/runtime-core.ts:1814` 用标题、长度和 prove/show 等词计数判断分解。长度达到 1800 字符就可能生成 primary-route + adversarial-audit + synthesis。`:476` 会改写 planner 的单任务计划，甚至删除最初的 stop；`:573` 自动为未完成任务补 continuation。

同时 prompt 声称 controller 自主决定任务数量、边界和依赖。实际系统有多个决策者：Director、Planner、启发式拆分器、自动 continuation、形式化调度器。

数学难度不能从排版长度可靠推断；一次 verifier 非 CORRECT 还会在 `:1068` 记录失败路线，`:810` 对相同 fingerprint 阻止重试。这会把轻微可修复错误和真正路线不通混淆。fingerprint 来自字符串归一化哈希（`:1799`），也不能保证换一种表述就是不同的数学路线。

修复方向：模型决定数学策略；runtime 管调度、资源、权限、身份与持久化不变量。区分修补、重试、替代路线；拆分应是建议或有明确理由的决策。

### 7. 高：形式化验收没有完整保证“证明的是原命题”

`backend/src/proof/formal.ts:89` 是声明文本片段检查，不是 Lean elaboration 后的类型检查；`:119` 用正则拦截部分逃逸声明。

离线检查：配置目标 `theorem intended : False := by sorry`；提交源码：

```lean
variable (h : False)
theorem intended : False := by exact h
```

两个源码 guard 都返回 undefined，即未拒绝。新增变量可能使 elaborated theorem 携带额外前提；本次只验证了 JS guard 漏检，没有用 Lean 编译这一示例，不把它写成已完成的端到端绕过。

更常见的路径是没有提供 leanTheorem：`backend/src/proof/runtime-core.ts:1286` 传入 undefined，形式化声明交由同一个模型自行翻译，编译成功也不能证明自然语言命题翻译正确。

修复方向：独立确认目标声明、锁定环境，验收目标常量的完整类型和允许公理依赖；区分“Lean 接受某段源码”“精确目标类型已被证明”“自然语言与形式化目标已确认”。

### 8. 中高：单题的“同进程恢复”生命周期有缺口

`backend/src/api/server.ts:578` 在 existing.promise 非空时拒绝 resume；`beginRun` 在完成后没有清空该字段。即使清空，`backend/src/proof/runtime-core.ts:254` 的 started 标记也没有重置，重复调用直接返回旧结果。

因此现有从磁盘重建新 runtime 的恢复路径，不等于同一 API server 中继续已结束的 PARTIAL run。这与 ResearchRuntime 的独立恢复机制应分开评估。

### 9. 中：预算计数不等于实际模型调用与成本

ProofRuntime 的 workerCalls 在派发逻辑任务时增加，但一次 AgentCore prompt 可以包含多轮模型/工具调用；角色适配器还有 provider 和协议重试。complete usage 又未进入持久会话。research 工具调用计数也主要是记录，并非每次执行前预留预算。

结果：配置中的 calls 难以直接解释为外部 API 次数，wall-time 在边界检查不等于硬 deadline，成本和上下文消耗缺少统一账本。单题入口还没有传入配置的 budget。

## 与 Codex / pi 的实质差距

对照依据是审查当天读取的公开文档和 pi 上游源码，不是对当前托管 Codex 内部实现的推测；没有运行同模型同预算的 Codex / pi 性能对照。

| 维度 | 本项目 | Codex / pi 可借鉴的边界 |
|---|---|---|
| 产品定位 | 底座、解题流水线、研究管理同时做 | harness 提供可复用执行能力，应用持有领域语义 |
| 执行闭环 | 默认 Workbench 主要传文本；research 才接工具 | 工具执行、反馈、继续工作是基础能力 |
| 长期上下文 | 全量历史或按消息数裁剪，planner 手工重建快照 | 上下文投影、压缩、摘要与恢复是运行时职责 |
| 用户协作 | AgentCore 有 steer/followUp，产品 API/UI 没有把它们接成研究过程 | 用户干预和会话生命周期属于可用产品的一部分 |
| 数学策略 | 多层 controller 和启发式同时决策 | 通用底座不必预先规定一个数学证明组织法 |
| 领域成果 | claims / evidence / authority / revocation 有基础 | 这部分应成为应用价值，而不是继续重写 harness |

Codex App Server 已提供嵌入式 agent 的线程、轮次、事件与审批等协议；pi 提供 TypeScript SDK 和扩展能力。pi 上游还明确把自动 compaction、溢出恢复与 session projection 作为完整生命周期处理。当前项目复刻了基础 API 形状，却没有得到这些能力的完整语义。

来源：

- [OpenAI: Codex as a platform](https://developers.openai.com/blog/codex-as-a-platform)
- [Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [pi agent loop 上游源码](https://github.com/badlogic/pi-mono/blob/main/packages/agent/src/agent-loop.ts)
- [pi SDK](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md)
- [pi compaction](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/compaction.md)

## 评测为什么不足以指导现在的架构

仓库 MathArena 初轮 `summary-official.json`：direct 正确 105/122；agent 所有输出正确 103/122；经过 workflow 接受且正确 102/122。后续 `matharena-20260831-gate-retries/status.json` 对 20 道未成功问题进行额外最多三轮重试，恢复 13 道，最终 best-of 成功 115/122。

README 的 115/122 有对应记录，不应说数据凭空捏造。但这将带标准答案判分的 agent 选择性重试，与原 direct 结果比较：答案可以不直接给 solver，外部 oracle 仍参与选择重试对象和停止时机。它不是同预算单次对照，也不能说明面对未知答案时，系统能自行知道哪次正确。MathArena 测的是最终答案，不是研究证明完整性。

此外，该 manifest 的 agentWorkers=1、agentSteps=3；它没有直接验证长期 ResearchRuntime 的价值。长题 REPORT 更有诊断意义：prob-006 内部曾给 CORRECT，盲审仍发现核心代数漏洞；一些长任务需要外部 recovery。多角色确实可能改善结果，但当前证据不能把收益归因于某一层架构。

下一轮评测应至少包含：直接模型、单 agent + 工具、单 agent + 研究记忆、多 agent + 同一研究记忆；模型、token/费用/时间预算一致；solver 自行决定停止；报告正确率、错误接受率、未完成率、恢复成功率和有效研究进展；记录真实调用用量与完整可复核产物。

## 建议保留的产品与重构顺序

产品定义：**一个基于成熟 agent 执行底座的数学研究工作台：帮助研究者积累可审阅结果、找出尚未闭合的关键缺口，并从已有成果继续工作。**

默认任务应该允许读文献、写程序、做小规模实验、尝试证明、修订命题或交付精确的未解障碍。成功不必一律等于 PROVED，局部成果也必须有明确范围和证据。

1. 先修验收身份、verdict、取消和恢复这些会破坏信任的问题；统一两条入口的实际工具能力。
2. 在 AgentCore / Session / providers 外建立一个小的执行适配接口：run、stream、steer、cancel、resume、artifacts、usage。保留当前后端作对照，接入一个成熟 harness 作替换实验，不同时重写全系统。
3. 根据现有 TypeScript 和多 provider 使用情况，优先验证 pi SDK 的集成成本；以 Codex App Server 为另一个适配目标。这个选择是工程建议，必须由同任务验证，不能预先断言谁数学能力更强。
4. 保留并简化研究语义：目标、成果、范围、依赖、开放缺口、证据和来源。authority 表示“谁以何种检查认可了什么”，不要把模型认可包装成无条件真理。Lean 证明和经模型审阅的非形式化结果分开展示。
5. 默认先把一个有工具、可持续交互的 agent 做好；只有独立路线探索、确有隔离需求的审稿或可并行计算才加 worker。取消强制按篇幅拆分与永久封禁轻微失败路线。
6. 用至少一个真实研究项目验证跨会话继续、失效重开、可复核局部成果和最终交付；通过相同预算消融实验后再增加策略自动化。

## 本次验证与边界

源码、配置、UI 路由、现有测试与仓库评测记录均已阅读。TypeScript 编译通过，Workbench 两个入口脚本的语法检查通过。离线复现了正文替换、verdict 冲突、取消传播断点和形式化源码 guard 漏检。

复现脚本见 `audits/2026-10-26/reproduce.mjs`，结果见同目录 `results.json`；先编译 backend，再在仓库根目录运行 `node docs/audits/2026-10-26/reproduce.mjs`。复现使用 mock / 本地内存接口，不调用付费模型。

完整测试的运行结果另见同目录 `validation.md`。没有运行付费 provider、真实数学题求解对照或端到端 Lean 攻击；没有把所有历史问题都归因于本次发现。
