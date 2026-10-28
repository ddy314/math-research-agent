---
name: research-synthesis
description: Prepare an inspectable mathematical proof, partial result, or research handoff and decide whether the available evidence supports submitting it.
---

# Submit the result the evidence supports

Organize the deliverable around the mathematical claim and its dependency chain, not the order in which agents ran. Include definitions and hypotheses needed to read it independently. Cite exact source statements and include reproducible code for proof-relevant computation.

Before saying a result is complete, compare the original objective with the theorem actually proved, discharge every required lemma and case, and inspect an independent audit of the exact body. A model-reviewed proof remains an informal proof; do not describe it as formally certified.

Submit a meaningful partial result when the full objective remains open: state the proven domain, what it rules out, the precise remaining obstruction, and a useful next action. Do substantive gap-repair work first; a list of caveats is not a substitute for doing recoverable mathematics.

Example: an exact finite arithmetic minimization formula with a proved termination bound is a finished result, even if it is not an elementary closed form. Name it accurately. A finite experiment supporting a conjecture is a different deliverable and must state its range. See the [concatenation case](../research-strategy/references/concatenation-case.md).

Save the result file, capture it with research_record using its statement, scope, assumptions, sources, and dependencies, and request a focused independent review if it is a proof. For a repaired proof, capture a new result rather than editing a reviewed snapshot. Generate the project report after recording the work.

Here “submit” means delivering local research artifacts to the user. Publication, journal/arXiv submission, Git pushes, or messages to other people need the user's corresponding instruction.

Stop when the requested result is supported and delivered, a precise obstruction remains after reasonable attempts, or the user/budget requires a pause. State what is complete and what is open; never convert “workflow finished” into “the theorem is true.”
