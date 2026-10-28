---
name: research-continuity
description: Preserve useful mathematical state before a break or context boundary and resume from durable findings without repeating failed work.
---

# Preserve decisions and their reasons

Before ending a research round or handing off work, save the current statement, established facts, exact sources, unresolved bottleneck, and the next informative action in research/PROGRESS.md. Link to full arguments and runnable experiments instead of copying a transcript into the summary.

Record a failed route with the claim attempted, hypotheses, the precise failing step, what survived, and what new information could reopen it. Distinguish a mathematical failure from a timeout, missing dependency, or interrupted tool. A rejected proof is not automatically a rejected strategy.

Example handoff: “The construction works for q<=3m-1 by the linked argument. The attempted extension needs lemma L for q>=3m; experiment E disproves L when m=6 at input X. The lower-bound construction remains valid. Next: test whether the weaker L' follows from synchronization.” This is more useful than “approach failed; try something else.” Use actual identifiers and outputs, not invented placeholder evidence.

On return, read the summary and referenced artifacts, verify that target and source hashes still match, and identify one next action. Recheck stale dependencies before relying on them. A compressed session is an aid; the research files hold the inspectable work.

Misuse: restarting the entire proof because context was compacted, or continuing an old claim after its assumptions changed. If the source of a statement cannot be recovered, label it provisional and reconstruct it rather than assuming it was once proved.
