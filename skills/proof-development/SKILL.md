---
name: proof-development
description: Turn a plausible mathematical route or computational pattern into a self-contained argument, especially when a central lemma is still missing.
---

# Work on the step carrying the theorem

Write a short dependency skeleton and locate the least justified inference. Spend effort there rather than polishing already established steps. Test a proposed lemma before building the rest of the proof on it.

Choose techniques by their mechanism. Strengthen induction if the induction step lacks an invariant. Use a minimal counterexample if a reduction preserves the hypotheses. Try double counting when two local descriptions constrain one global quantity. Look for duality when the original extremum hides a certificate. Check equality conditions when extremizers appear rigid. Do not force these methods onto every problem.

When replacing computation with a paper proof, identify which property the computation is detecting and prove that property over the entire class. Keep the computation as a control. A finite list of observed types requires a completeness argument before its exclusions imply the theorem.

Example: for the sum of the first n odd numbers, the step works because adding `2n+1` changes `n^2` to `(n+1)^2`. A useful proof states the base case, induction domain, and this identity. In a harder recurrence, a similar-looking numerical fit does not supply a missing induction hypothesis: formulate the stronger invariant explicitly or return to experimentation.

Misuse: “the remaining cases are analogous” when those cases require a new argument; “by compactness” without a topology and hypotheses; “by symmetry” without an action that preserves the objective. Expand the claimed mechanism enough for a reader to check it.

Before submission, check the argument against the original statement, including excluded and degenerate cases. If a gap remains after substantive repair attempts, state the valid conditional or restricted result and the exact missing lemma. Use research_record to capture the proof body before obtaining an independent audit.
