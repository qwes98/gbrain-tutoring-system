# Concurrency Control: Lecture Note

An append-only log stores each accepted record after all earlier accepted records. A record is never edited in place; a correction is represented by another record that identifies what it corrects.

When several processes append, exclusion must cover both the duplicate check and the append. A lock that covers only the write leaves a time-of-check/time-of-use race. Each complete JSON Lines record ends with a newline so readers can distinguish a durable record from an interrupted final write.

Derived views are disposable. Replaying the ordered log from the beginning must reproduce them, and each derived change retains the identifiers of the records that justify it.
