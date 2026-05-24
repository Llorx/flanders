# Long waits run as a loop of bounded chunks

Any wait that can plausibly last beyond an hour is implemented as a loop of bounded chunks rather than a single long timer. JavaScript timers are not reliable for arbitrarily long durations, and an absolute clock is subject to drift; chunking re-checks the remaining time after every chunk and keeps the wait correct.

## Who this applies to

- **Subject:** any wait inside Flanders that can run for an hour or more.

## How the wait is structured

- Each chunk lasts at most one hour.
- After each chunk completes, the wait recomputes how much time remains and either waits another chunk (a full hour or the remainder, whichever is smaller) or exits the loop because the target end has been reached.
- The mechanism is a single reusable helper: a wait function that takes a target duration (or end time) and a maximum chunk size, and returns when the full duration has elapsed.

## Why this is needed

- JavaScript timers (`setTimeout`) cannot reliably schedule arbitrarily long single delays; very long delays are subject to skipped, clamped, or coalesced behavior.
- The system clock can drift, jump, or be adjusted while a long wait is sleeping; chunking gives the wait an opportunity to re-anchor against the current clock after each chunk.

## Failure signals

- A wait longer than the chunk size is implemented as a single timer.
- A long-wait path uses absolute timestamps without re-checking remaining time after intermediate chunks.
- A second, parallel implementation of the chunked-wait pattern appears in the codebase instead of reusing the existing helper.
