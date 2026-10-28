# Historical standalone architecture

These documents, formalization sources and configuration examples describe the pre-0.2 standalone runtime. They are retained for provenance, not as installation instructions for the current Pi package. References to the former backend, HTTP API, Workbench, Cloud Run service, authority engine and Lean gates are historical; those executable components are no longer in the default product.

The old benchmark directories and `docs/audits/2026-10-26` record that implementation. The architecture review and its reproduction script refer to baseline `6d0f429`; reproduce them by checking out that baseline separately, not by importing the removed backend into this release. No old runtime state is automatically migrated, promoted or deleted. Explicitly copy relevant proof and experiment files into a new project as provisional historical material.

For the current implementation see the root README and `skills/`.
