# Research behavior evaluation

Run `npm run build`, then run each case under three tracks using the **same exact Pi model, thinking settings and authorized time limit**:

```sh
node dist/src/benchmark.js --case proof-gap --track baseline --model PROVIDER/MODEL --minutes 10
node dist/src/benchmark.js --case proof-gap --track skills --model PROVIDER/MODEL --minutes 10
node dist/src/benchmark.js --case proof-gap --track research --model PROVIDER/MODEL --minutes 10
```

The explicit model argument prevents this script from silently choosing a paid model. Running it can incur your configured provider's charges. No live model benchmark is run by `npm test` or `npm run smoke:pi`.

Cases: `proof-gap`, `small-sample`, `experiment-to-lemma`, `resume-project`, `interruption`.

The runner copies only the problem and raw materials into a fresh workspace, records one attempt, and never uses evaluator judgments to select retries. The rubric below is not passed to the solver. This is input separation, not a filesystem sandbox: Pi retains the user's normal OS permissions.

Time is capped equally; actual token and cost consumption must also be reported. A run stopping early uses fewer resources. Do not call unequal actual token consumption a matched-token experiment. For a token-matched follow-up, select limits before running and disclose deviations. Record Pi version, exact model, thinking level, wall time, input/output/cache tokens, cost, session and artifact paths, and any early stop or provider error. Main-session totals for the research track are in Pi's saved session; report task totals separately to avoid double counting.

Have a separate reviewer compare anonymous artifacts. Score correctness, decisive-gap detection, valid partial progress, attribution/scope, avoidable repeated work, and recovery quality (0–2 each). Include the disputed mathematical step and a body hash with every assessment. Do not automatically award correctness for a model verdict or campaign completion.

Inspect these behaviors:

- **proof-gap:** Finds the non-strict-subadditivity obstruction; gives a counterexample or repairs hypotheses rather than merely polishing the proposed induction.
- **small-sample:** Tests a structural boundary beyond the supplied range and states the actual conclusion, not a universal extrapolation.
- **experiment-to-lemma:** Uses exact finite checks to suggest the gcd invariant, then supplies a general Euclidean/Bézout argument; computational verification alone is partial progress.
- **resume-project:** Preserves the valid restricted result, inspects the saved counterexample and does not repeat the disproved prime-denominator conjecture. It identifies what additional argument would establish the stronger classification.
- **interruption:** First interrupt a live run after a saved result, then use `resume` with the remaining budget. Compare results/session identities before and after. There must be no duplicated publication or claim that an interrupted task mathematically failed. This scenario needs a real interruption in addition to the supplied historical handoff; reading the handoff alone does not test crash recovery.

Keep failures and partial results. To repeat, predeclare a new attempt for **all** compared tracks; do not only retry answers known to be wrong. The deterministic integration fixture tests execution mechanics, not research intelligence. No quality improvement over plain Pi is claimed until these model runs and independent reviews have actually been performed.
