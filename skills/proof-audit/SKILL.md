---
name: proof-audit
description: Independently examine an exact candidate proof or research result for decisive gaps, invalid assumptions, boundary failures, or unsupported generalization.
---

# Audit the inference, not the confidence

Start with the original problem, exact candidate body, assumptions, and cited dependencies. Reconstruct the argument independently enough to locate the inference carrying the conclusion. A fluent exposition, long computation, or another model's acceptance is not a correctness certificate.

Try to break the claim with minimal and boundary examples. Verify changes of quantifiers, exchanged limits, extremal existence, sign-sensitive inequalities, divisibility by nonunits, and equality conditions when they occur. Check that cited results actually supply the needed statement and assumptions.

Report the first decisive defect with its exact location, why it matters, and a counterexample or missing obligation where possible. Distinguish an incorrect theorem from an incomplete proof and a minor exposition problem. Do not silently repair the candidate and approve the repaired version under the old hash.

Example: “Every n has the property because for each n one can find a sufficiently large cutoff, so one cutoff works for all n” exchanges `for all n, exists B` and `exists B, for all n`. The audit should name the exchange and test whether a uniform bound is actually available. Merely asking the author to “add rigor” fails to identify the problem.

Submit a review file with one explicit assessment: accepted, changes, rejected, or inconclusive; explain the evidence. The caller records that assessment with research_record against the exact reviewed body and completed independent review task. A changed proof needs another review. A review may also be wrong; contradictory reviews remain visible until resolved.

Read the [automata case](../research-orientation/references/automata-case.md) when distinguishing paper proof, exhaustive finite verification, and a restricted computation.
