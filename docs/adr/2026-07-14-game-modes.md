# 2026-07-14: Classic, Spy, and Precision game modes

Status: Accepted

## Context

The game originally supported one picker-and-guesser flow. New modes require different state machines while preserving the existing Classic behavior and recipient-specific secret information.

## Decision

- The host selects `classic`, `spy`, or `precision` in the lobby. All mode settings are retained when returning to the lobby.
- Classic keeps the existing picker, guessing, scoring, and reveal flow.
- Spy requires at least four players and one random spy per game round.
  - Active players submit text hints in server-assigned order, then discuss and cast mutable votes.
  - Vote snapshots expose candidate totals and the recipient's own choice, never voter identities.
  - Self-votes and abstention are allowed. A tie, an abstention plurality, or unsubmitted votes producing an abstention plurality invalidates the vote.
  - A wrongly eliminated player loses hint/vote rights but does not gain spectator secrets. The spy receives one private color probe before the next hint cycle.
  - Catching the spy or reaching one-on-one starts a final color guess. The spy earns the final similarity percentage. Crew points start at 100 and decrease evenly with actual wrong eliminations; crew earns zero at one-on-one.
- Precision uses one hidden random target for repeated simultaneous attempts.
  - The target ends when any player reaches the configured similarity or the configured attempt limit is reached.
  - Players see only their own attempt history and can restore a previous color. Spectators see the target and every player's live colors and history.
  - Only the final attempt similarity is added to each player's cumulative score.
- Runtime validation bounds natural-number settings: Spy rounds `1..20`, timers `5..300` seconds, Precision target similarity `1..100`, and Precision attempts `1..20`.
- Recipient-specific snapshots are the security boundary. Original spectators receive full mode information; eliminated Spy players do not receive the spy identity or private probes.
- Reconnect grace remains 30 seconds. An expired spy cancels and retries the current ordinal when enough players remain; an expired Precision player is removed from the active target, and fewer than two remaining players returns the room to the lobby.

## Consequences

- Shared snapshot and socket contracts are mode-discriminated.
- Server phase timers remain sequential and room-local.
- Room state remains in memory and is lost on process restart, matching the existing deployment model.
