# 验证记录

基线：6d0f429。日期：2026-10-26。

- `node backend/node_modules/typescript/bin/tsc -p backend/tsconfig.json`：通过；编译包含 src 和现有 test。
- `node --check apps/proof-workbench/web/app.js`：通过。
- `node --check apps/proof-workbench/server/main.mjs`：通过。
- `node --test --test-reporter=tap backend/dist/test/*.test.js`：144 项，142 通过，2 跳过，0 失败，约 107.5 秒。需要沙箱外执行，因为部分测试监听 localhost。
- `node docs/audits/2026-10-26/reproduce.mjs`：成功复现所列缺陷；详见 results.json。这里的“成功”表示确实观察到错误行为，不表示实现通过安全性验收。

完整测试输出：test-output.tap。

运行环境 Node 为 v26.12.0；这是本次测试环境，不代表仓库声明的最低支持版本。未执行付费模型求解或 Codex/pi 同预算性能对照。

依赖安装说明：先尝试离线安装，缓存缺少指定 pnpm 版本；在线安装已取得锁定依赖，但 pnpm 因未批准 @google/genai/protobufjs 的 lifecycle scripts 返回非零。未批准或运行这些脚本。pnpm run 触发相同预检查，因此直接调用已安装 TypeScript 和 Node test runner。pnpm 自动加入 workspace 文件的待审批条目已还原；产品代码和原配置未修改。

最初沙箱内测试因 localhost 权限等环境限制失败，不能计为产品回归；上面列出的是随后授权沙箱外运行的最终结果。
