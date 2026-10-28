# Decimal concatenation: change the question before increasing the search

This is a reconstructed teaching example based on the completed A069862 project. It explains public proof structure, not a remembered sequence of hidden thoughts.

Let a(n) be the least k for which the decimal concatenation `(n+1)||...||(n+k)` is divisible by n. A search can produce many terms without answering whether every n has a witness.

**Decision point.** Before optimizing the search for the least k, establish that a witness exists. Otherwise an algorithm with “search until found” has no general termination argument.

**Structural move.** Within one fixed digit width d, concatenation obeys `x -> 10^d x + t`. This exposes modular state transitions. The noninvertible factors 2 and 5 need different treatment from factors coprime to 10; the 3-part needs its own lifting calculation. Splitting the modulus is motivated by this algebra, not by a generic desire to split work into agents.

**Critical obligation.** A prime-power lifting step is useful only if it preserves components already installed. One must also prove every shifted endpoint stays inside the same digit interval; otherwise the recurrence used in the proof changes. The maintained argument explicitly budgets the displacement and chooses a sufficiently large width.

**When to compute.** Test the recurrence and lifting identities on small prime powers and near digit boundaries. Compare with direct concatenation independently. These tests detect indexing and invertibility errors; they do not prove the all-index existence theorem.

**When to submit.** Once existence and an explicit bound are proved, a finite arithmetic minimization procedure is a legitimate exact result. Describe it as a finite minimum formula, not an elementary closed form without minimization. Credit pre-existing special cases separately.

**Bad alternative.** Run larger searches, observe no counterexample, and announce universal existence; or hide the difficulty in “apply CRT” without showing that the local endpoint choices are compatible.

Sources: [existence.tex](https://github.com/dongxuelian2/oeis-papers/blob/main/papers/A069862/existence.tex), [minimum_formula.tex](https://github.com/dongxuelian2/oeis-papers/blob/main/papers/A069862/minimum_formula.tex). The local proof and validation record were checked on 2026-10-26. Read the full proof before reusing its lifting statements.
