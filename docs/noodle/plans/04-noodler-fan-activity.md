# Plan 4 — NoodleR fan activity (subscribers, comments, bounded autonomy)

## Status

Implemented: per-account `fanActivity` setting (enabled + intensity + `autoSchedule`),
the `simulateNoodlerFanActivity` generation function, the manual
`POST /accounts/:id/private/simulate-fans` trigger, the client toggle/button on any
private profile, the global "Enable NoodleR fan activity" kill switch in Noodle Settings,
and `noodle-fan-activity-scheduler.service.ts`, which runs fan activity unattended for
accounts that opt in on both dials. See `05-noodler-completeness.md` Part 1 for the
scheduler's design (per-account `nextRunAt` persisted in `settings.fanActivity`, not a
new schedule table; own lock scope, own poll loop, no shared state with the public
timeline scheduler).

## Goal

Make a NoodleR (private) page feel like it has a real audience — subscribers that
accumulate, comments and likes on posts — without ever letting NoodleR write its own
posts unattended. Autonomy is scoped to *fan reactions*, is capped, and is adjustable
per account plus a global kill switch. Creator posting stays exactly as manual/guided as
Plan 3 made it.

## Why

Right now a NoodleR account's only activity is whatever the owning persona/character
generates for itself, plus the single reactive nudge in `tryGenerateNoodlerReaction`
when the user's own persona subscribes or unlocks something. Outside of that, a private
page is a ghost town — no incoming subscribers, no comments, no sense of an audience.
That undercuts the entire point of the feature (it's modeled on creator platforms, where
the fanbase reacting is most of the fun).

The constraint from the discussion this plan comes from: "some autonomy, but not too
much, something we can set and adjust." So this is deliberately narrower than the public
Noodle refresh loop:

- Fans can like, comment, subscribe, and occasionally unlock PPV posts on their own.
- Fans never write the creator's posts. That stays a manual/guided action the user
  triggers, same as today.
- Every account's fan activity is off by default, tunable per account, and bounded by
  hard caps regardless of the dial — so turning it on can't spiral into runaway
  generation cost or a wall of noise.

## Design choice: reuse the filler roster, not a new "fan" concept

`noodleFillerProfiles` (the editable random-user roster from `ce5791ab`) already exists,
is user-editable, and materializes as `random_user`-kind `noodleAccounts`. Fan activity
reuses those same accounts as the audience instead of inventing a new account kind or
table. A filler account liking/commenting/subscribing to a NoodleR page is just new rows
in tables that already exist (`noodleInteractions`, `noodleAccountSubscriptions`,
`noodlePostUnlocks`) authored by an account that already exists. No new account concept,
no fake subscriber counter — the profile's subscriber count is the real row count, same
as it is today for a persona-driven subscribe.

Filler/random_user accounts are otherwise public-feed accounts. Their participation here
is additive (new interaction/subscription rows referencing a private account) and does
not change anything about how they behave in the public timeline.

## Data model

`packages/server/src/db/schema/noodle.ts` — no new tables/columns. `noodleAccounts.settings`
(already a free-form JSON column, see `subscriptionIncludesPpv` in `5bdadd37`) gains a new
key on private accounts only:

```ts
fanActivity: {
  enabled: boolean;       // default false
  intensity: "low" | "medium" | "high"; // default "low"
  autoSchedule: boolean;  // default false — see "Scheduling" below
}
```

`packages/shared/src/schemas/noodle.schema.ts` — extend `noodlePrivateAccountSettingsSchema`
(or wherever `subscriptionIncludesPpv` currently lives) with the shape above, all optional
with the defaults noted.

## Server

### Generation function

New `packages/server/src/services/noodle/noodle-fan-activity.ts`:

- `simulateNoodlerFanActivity(privateAccountId, intensity)`:
  - Loads the private account's recent posts (last ~10, weighted toward ones without
    much interaction yet).
  - Picks a small set of enabled filler accounts (2–4) not already saturating that
    account with activity.
  - One AI call (same Generation connection Noodle already uses) produces: which posts
    get a like, which get a short in-character comment, whether any filler account
    newly subscribes, and — respecting Plan 2's access rules — whether a `ppv` post gets
    unlocked by a "new subscriber" storyline. Hard cap on output count regardless of
    intensity (see below); the model chooses *what*, not *how much*.
  - Fan-authored comment text runs through the same `enforceNoodlerIdentityBlocklist`
    the creator's own posts use — a fan comment is still text that could leak the real
    identity ("OMG it's really you, [real name]!"), so the backstop has to cover this
    path too, not just creator-authored text.
  - Writes rows via existing storage methods only (`noodle.storage.ts` interaction /
    subscription / unlock creators) — no new write paths, no schema changes to those
    tables.
  - Never creates a `noodlePosts` row. This function cannot author a post under any
    input. That's the hard boundary between "fan autonomy" and "the account posts
    unattended," and it should be enforced by the function's return type (no post field
    exists to return), not just by convention.

- Intensity → caps (hard ceiling, not a target):
  - `low`: at most 3 interactions per run, at most 1 run/day if scheduled.
  - `medium`: at most 6 interactions per run, at most 3 runs/day if scheduled.
  - `high`: at most 10 interactions per run, at most 6 runs/day if scheduled.
  - These caps apply identically to the manual trigger — intensity bounds "how much
    happens per click/run," a separate schedule setting bounds "how often it runs
    unattended" (see below).

### Isolation guarantees (must hold, verified against existing patterns)

- Runs are always scoped to a single private account, using that account's existing
  per-scope refresh lock (`c1cf0691`'s per-account scope keys) — cannot contend with or
  block the public timeline refresh or that same account's own guided post generation.
- Never calls `chooseNoodleParticipantAccounts` or anything in the public batch
  selection path — fan activity has its own account-selection logic scoped to one
  creator's filler pool, and is a fully separate code path from
  `noodle-participant-selection.ts`.
- Never creates a `noodleActivityDigests` row — already true by construction, since
  digest creation already refuses any run touching a private account
  (`noodle.storage.ts:1046-1054`); this function doesn't need its own check, just
  shouldn't try to route around that one.
- Wrapped in its own `try/catch` distinct from the public `/refresh` handler's outer
  `try/catch`, so a failure here 500s only the fan-activity call, never the public
  timeline or the creator's own guided generation.

### Routes

`packages/server/src/routes/noodle.routes.ts`:

- `POST /noodle/accounts/:id/private/simulate-fans` — manual trigger, ignores
  `autoSchedule`, always available regardless of the schedule toggle (so a user with
  scheduling off can still say "give me some fan activity right now").
- Extend the existing private-account settings write path to accept `fanActivity`.

### Scheduling (opt-in, separate dial from public Noodle's "Refreshes/day")

- New `packages/server/src/services/noodle/noodle-fan-activity-scheduler.service.ts`,
  modeled on `noodle-refresh-scheduler.service.ts` but iterating only private accounts
  where `settings.fanActivity.enabled && settings.fanActivity.autoSchedule`, spreading
  that account's intensity-capped runs/day across the day using the same spreading logic
  the public scheduler already has (extract/share the "spread N events across 24h" helper
  rather than duplicating it, but keep the account-selection and lock-scope logic
  separate files — no shared mutable state with the public scheduler).
- A single app-wide setting (Noodle Settings panel) — "Enable NoodleR fan activity" —
  gates the scheduler entirely, off by default. This is the kill switch: even if every
  individual account has `autoSchedule: true`, nothing runs unless this is also on. Turn
  it off and every NoodleR page freezes exactly where it is; turn a specific account's
  `autoSchedule` off and only that page stops, independent of the global switch.

## Client

`packages/client/src/components/noodle/NoodleView.tsx` / `use-noodler.ts`:

- Private profile settings (same panel that already holds the stage-profile editor and
  `subscriptionIncludesPpv` toggle): add a "Fan activity" section with the enabled
  toggle, intensity select, and (only visible once enabled) the auto-schedule toggle.
- "Simulate fan activity now" button on the private profile, next to but visually
  distinct from the guided-post-generation button — these must never look like the same
  action, since one writes a post and the other only reacts to existing ones.
- Noodle Settings panel: one new "Enable NoodleR fan activity" toggle (off by default),
  documented in `docs/noodle/settings.md` alongside the existing refresh-schedule
  settings.
- New interaction/subscription rows render through the existing feed/profile rendering
  — no new UI needed there, since a filler account's like/comment looks exactly like any
  other interaction already rendered today.

## Out of scope

- No autonomous creator posting under any setting — this plan only ever produces
  reactions to existing posts, never new ones. If "let the creator post on its own too"
  is wanted later, it's a deliberately separate decision (and a bigger one, given it
  bypasses the "manual-post-only" guarantee Plan 3 built NoodleR around).
- No DMs/messaging simulation.
- No fake subscriber counter — counts are always real rows, so there's nothing to keep
  in sync or that can drift from reality.
- No per-post fan-activity override (e.g. "boost this post") in v1 — intensity is
  account-level only.

## Manual verification (unchecked)

- [ ] With fan activity disabled (default), a private account gets zero unsolicited
      interactions — behavior is identical to today.
- [ ] Manual "Simulate fan activity now" respects the intensity cap (count actual rows
      created, confirm ≤ the documented ceiling).
- [ ] Fan-authored comments pass through the identity blocklist the same as creator
      posts (verify with a "secret" disclosure account: fan comment text never contains
      the real character/persona name).
- [ ] Turning on a single account's `autoSchedule` while the global "Enable NoodleR fan
      activity" switch is off produces no scheduled runs.
- [ ] Turning on the global switch with no accounts opted into `autoSchedule` produces no
      scheduled runs.
- [ ] A scheduled fan-activity run for one private account never blocks or delays the
      public timeline's scheduled refresh, and vice versa (check lock-scope keys don't
      collide).
- [ ] No `noodlePosts` row is ever created by `simulateNoodlerFanActivity` under any
      intensity or input (code-level guarantee, not just observed behavior).
- [ ] No `noodleActivityDigests` row is created by a fan-activity run.
