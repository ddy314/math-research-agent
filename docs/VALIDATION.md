# Pi research package validation

This record concerns the 0.2 Pi plugin, not the historical standalone runtime reviewed at baseline `6d0f429`.

## Checks performed

- TypeScript strict typecheck and build: passed.
- Unit/invariant suite: 22 tests passed, zero failures or skips. The expanded TAP output is in `validation/tests.tap`. Tests cover exact-body capture, independent review, conflicting reviews, changed goals/sources/dependencies, producer provenance, task isolation, cancellation, hard deadlines, dead process detection, remaining-budget recovery and missing-session handoff.
- All seven skills pass the skill-creator frontmatter validator; their relative reference paths resolve.
- Real Pi 1.4.0 integration runs use a deterministic localhost endpoint with temporary Pi settings. They exercise actual Pi tool execution and persistent session restoration, plugin and skill discovery, native plugin dispatch to an independent Pi task, and the headless record/pause/report flow. No user credentials or paid model are used. The final unpacked-package run made 20 requests to the local fixture and zero external model calls; hard deadlines and the two-round stop condition both passed.
- An npm distribution is unpacked outside the checkout and loaded by Pi without a package-local node_modules directory. This verifies host peer-module mapping and that shipped resources resolve outside the development tree. The distribution excludes the old backend, tests, legacy configs and formalization sources.
- Whitespace check: passed.

Integration output and the final pack manifest are retained in `validation/pi-integration.log` and `validation/package.json`. The smoke test includes hard-deadline and automatic round-budget scenarios; use its recorded output to distinguish completed checks from assertions in the test source.

## What this does and does not establish

These checks establish the mechanics of the research loop. A scripted endpoint cannot demonstrate that the skills improve mathematical judgment. The five behavior scenarios and equal-budget three-track runner are implemented under `examples/evaluation`; **no paid-model comparison or research-quality improvement is claimed**.

The runtime is tested here on Node v26.12.0 with the pinned Pi 1.4.0 Node/npm package. The declared minimum Node version is 22.19.0; that minimum and Pi's standalone Bun binary have not been tested here. Worker execution uses the Node entry shipped by the Pi npm package.

Research state is deliberately new and file-based. Historical `.math-agent` data is not migrated or deleted. Archived benchmark scores describe the removed implementation. Reviewed results are explicitly informal model assessments; no Lean gate or mathematical truth oracle is present.

The first localhost test attempt inside the filesystem/network sandbox was denied with `listen EPERM`; the integration checks were subsequently run with permission outside that sandbox. Tests never require a production API key.
