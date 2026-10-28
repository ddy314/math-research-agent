---
name: mathematical-experiment
description: Design reproducible computations that distinguish mathematical conjectures, expose counterexamples, or suggest a proof mechanism.
---

# Make computation answer a mathematical question

State what the experiment can distinguish. Choose small instances, boundary cases, degeneracies, or adversarial examples that stress the proposed mechanism. Before enlarging a search, ask whether a simpler exact example could already falsify the claim.

Use exact integers, rational arithmetic, symbolic identities, or certified bounds when the conclusion depends on equality or sign. Floating point is useful for discovery; a nearly zero number is not an exact zero. For exhaustive searches, specify the domain, equivalence reductions, completeness argument, and excluded cases.

Save runnable code, inputs, outputs, and the exact mathematical scope. Check at least one independent formulation when an indexing error or implementation assumption could determine the conclusion. Do not write tests that merely reproduce the same recurrence in the same way.

Look for structure in counterexamples or extremizers. Change the next experiment to discriminate between the emerging explanations. A large table is useful only when it changes your proof question.

Example: `n^2+n+41` is prime for n=0,...,39. Before extrapolating, inspect n=40: `40^2+40+41=41^2`. This single structural counterexample is more informative than checking the first forty cases again at higher precision. Save the corrected scope; do not discard the valid observations.

Misuse: finding no counterexample below a cutoff and reporting that none exists. If a theorem reduces all remaining cases to that finite domain, provide that reduction separately.

For digit-boundary and prime-power experiment design, read the reconstructed [concatenation case](../research-strategy/references/concatenation-case.md).
