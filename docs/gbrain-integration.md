# GBrain promotion boundary

Version 0.1 adds no GBrain tables and performs no GBrain writes. `export-gbrain` produces a stable JSON file with:

- boundary and schema versions;
- the source topic;
- `mutates_gbrain: false`;
- stable concept candidates;
- local source references;
- all state evidence IDs;
- the unassisted attempt IDs that qualify the candidate.

An owner or a future explicit adapter may inspect and promote a candidate. The candidate file is not proof that promotion occurred, and rerunning export is safe because its order and content are derived deterministically for the supplied `as_of` timestamp.
