# Ledger contract

The event ledger is the only tutoring system of record. Each line is one validated v1 event and ends with a newline. Event identifiers are unique within the ledger. Corrections append `event.corrected`; no command rewrites accepted history.

Projections are rebuilt from the ledger and may be replaced atomically. Concept state history, misconceptions, reviews, tutor decisions, and promotion candidates retain the event identifiers that justify them.

The GBrain export is a file boundary. It produces candidates with source references and qualifying evidence identifiers, and never writes GBrain state.
