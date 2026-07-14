# Plan 5 — NoodleR completeness (scheduler, timeline, discover, theme)

## Status

Part 1 (scheduler + global kill switch) implemented — see `04-noodler-fan-activity.md`
Status. Parts 2–4 (timeline, Discover refinements, accent theming) not started. Note
while implementing Part 1: a `GET /noodler/hub` route and a "NoodleR" client view already
existed before this plan was written, listing owned / subscribed / discover private
accounts in three flat sections. That's a real head start on Part 3 (Discover) — it
already has the account roster and the owned/subscribed/discover split; it's missing the
activity-based sort, unseen-activity badges, and `lastViewedAt` tracking this plan calls
for. Re-read that view before starting Part 3 rather than building a second one.

## Goal

Close the gap between "NoodleR technically works" and "NoodleR feels like a finished
surface." Four pieces, meant to ship together but reviewed here as separate concerns:

1. Finish Plan 4: `autoSchedule` + the global kill switch + the scheduler service.
2. A NoodleR timeline — one place to see activity across every private account, not just
   whichever profile you happen to have open.
3. A NoodleR Discover tab — a browsable roster of your own creators with light
   "suggested" surfacing for accounts with unseen activity.
4. Accent-only theming while inside any NoodleR-scoped view, so it's visually
   unmistakable that you've left the public timeline.

## Design choice: extend the existing single-component architecture

Every prior NoodleR plan reused `noodleAccounts`/`noodlePosts`/`noodleInteractions` with a
`visibility` flag instead of inventing parallel tables, and rendered both modes through
the same `NoodleView.tsx` via `viewedProfileAccount` branching instead of a second
component tree. This plan continues that pattern:

- The timeline and Discover tab are new **views within the same component**, gated the
  same way private profiles already are (`visibility === "private"` filtering), not a
  separate route or app shell.
- The only new *isolated* piece is the fan-activity scheduler service — consistent with
  Plan 4's isolation guarantees, it must not share lock scope, mutable state, or failure
  modes with the existing public refresh scheduler.
- Theming is a CSS/token-level concern scoped to "am I in a NoodleR view right now," not
  a new settings surface per account — one derived boolean, not per-profile brand config.
  Per-creator branding is out of scope (see below).

## Part 1 — Finish Plan 4's scheduler

Implements the "Deferred" section of `04-noodler-fan-activity.md` as written; nothing new
to design here, just build it:

- `packages/server/src/services/noodle/noodle-fan-activity-scheduler.service.ts`,
  modeled on `noodle-refresh-scheduler.service.ts`. Iterates private accounts where
  `settings.fanActivity.enabled && settings.fanActivity.autoSchedule`, spreading
  intensity-capped runs/day across the day. Extract the "spread N events across 24h"
  helper out of the public scheduler so both share it, but keep account-selection and
  lock-scope logic in separate files — no shared mutable state.
- One app-wide "Enable NoodleR fan activity" toggle in Noodle Settings, off by default —
  the kill switch. Gates the scheduler entirely regardless of any account's
  `autoSchedule` value.
- Per-account `autoSchedule` toggle in the private-profile settings panel, only visible
  once `fanActivity.enabled` is on (already scoped this way in Plan 4's client section).
- Manual "Simulate fan activity now" is unaffected — it already ignores `autoSchedule`
  per Plan 4.

## Part 2 — NoodleR timeline ("Subscriptions")

### What it is

A chronological feed interleaving posts and fan-activity events across **every** private
account that exists. Not a subscription-graph feature — this app is single-user, so
"subscribed" means "every NoodleR account you have," with no per-account opt-out at the
timeline level (opting out of an account's activity happens by disabling its fan
activity, not by hiding it from this view).

### Entry point

A NoodleR icon alongside the existing Main/Following switcher, visible only when at
least one private account exists. Opens a new top-level tab state in `NoodleView.tsx`
(sibling to `"main"` and `"following"` feed modes), not a route change.

### Content

- **Posts**: existing post-card rendering, reused as-is, sourced from a new storage query
  (`packages/server/src/services/storage/noodle.storage.ts`) that unions posts across all
  `visibility = "private"` accounts, ordered by `createdAt`, same pagination shape as the
  existing feed query. This is the same access-gating that already applies to any private
  post (subscriber/PPV rules from Plan 2) — no new gating logic, since in a single-user
  app the viewer always has full access to their own accounts.
- **Fan-activity events**: a new lightweight row type, not a post. Render as a compact
  notification-style item: avatar + "**{filler display name}** subscribed to
  **{creator}**" / "commented: '{text}'" / "unlocked a post." Sourced from the same
  `noodleInteractions`/`noodleAccountSubscriptions`/`noodlePostUnlocks` rows Plan 4 writes
  — no new table. Query needs a `createdAt` cursor across three tables; a `UNION ALL`
  keyed by timestamp is enough, no need to materialize a combined events table.
- Empty state, matching existing feed empty-state tone: something like "No NoodleR
  accounts yet" if none exist, "Nothing here yet" if accounts exist but have no activity.

### Explicit non-goals

- No cross-account composer here — posting still happens from a specific private
  profile, keeping the "which creator is this from" decision explicit (same reasoning
  Plan 3 used for keeping the composer profile-scoped).
- No infinite-scroll-of-everything performance work beyond reusing the existing feed's
  pagination/window (160 most recent, same as Main).

## Part 3 — Discover tab

### What it is

A grid of creator cards, one per private account: avatar, stage name (or persona/character
display name if no stage identity set), subscriber count (real row count, per Plan 4's
"no fake counters" rule), latest post preview, and a "new since your last visit" badge.

### Suggested surfacing

Sort order is activity-based, not alphabetical: accounts with unseen fan activity
(subscribers/comments/unlocks since the account was last viewed) surface first. This
needs one new piece of state — a `lastViewedAt` timestamp per private account, stored the
same way other per-account UI state is tracked today (check whatever mechanism
`viewedProfileAccount` already persists, if any, before adding a new column; if none
exists, add it to `noodleAccounts.settings` alongside `fanActivity`, not a new table).

- Badge shows a count of unseen events (capped display, e.g. "9+") rather than an exact
  number once it gets large.
- Visiting a private profile clears its badge (updates `lastViewedAt`).
- No cross-creator recommendation logic, no "trending" algorithm — this is a personal
  roster with a freshness sort, not a discovery engine simulating other users' taste.

### Entry point

Sibling tab to the NoodleR timeline, same top-level switcher. If there's only one private
account, Discover can be hidden or shown as a single card — decide during implementation
based on whether a one-item grid reads as pointless UI or as a harmless empty case; either
is acceptable, this is not worth a setting.

## Part 4 — Accent-only theming for NoodleR views

### Scope

While viewing any NoodleR-scoped surface — a private profile, the NoodleR timeline, or
Discover — swap the accent/highlight color token (primary buttons, active tab indicator,
links, the composer's focus ring) to a distinct NoodleR palette. Layout, spacing,
typography, and surface/background colors stay identical to public Noodle. This is a
token swap, not a second theme file: same components, different CSS custom property
values, applied via a wrapper class/data-attribute on the relevant subtree while a
NoodleR view is active.

- One derived boolean drives it — "is the current view private-scoped" — computed the
  same way `viewedProfileAccount?.visibility === "private"` is already checked elsewhere
  in `NoodleView.tsx`, extended to also cover the new timeline/Discover tabs (private by
  construction, always true there).
- No per-account branding, no user-configurable NoodleR color — one fixed accent for the
  whole private surface. If per-creator theming is wanted later, that's a separate,
  bigger decision (it starts touching the "stage profile" identity concept from Plan 3
  and would need its own design pass).
- Applies immediately on navigating into a NoodleR view and reverts immediately on
  leaving — no persisted "theme mode," it's purely a function of where you are.

## Out of scope (this plan)

- Per-creator branding/theming beyond the shared accent swap.
- DMs/messaging (already out of scope per Plan 4).
- Any activity digest for NoodleR (public-timeline digests already explicitly refuse to
  touch private accounts; a NoodleR-specific digest is a separate future decision, not
  bundled here).
- Cross-account composer / bulk actions from the timeline or Discover view.

## Manual verification (unchecked)

- [ ] With the global "Enable NoodleR fan activity" switch off, no scheduled runs occur
      even if every account has `autoSchedule: true`.
- [ ] With the global switch on, only accounts with `autoSchedule: true` get scheduled
      runs, spread across the day per their intensity cap.
- [ ] A scheduled fan-activity run never blocks or delays the public timeline's scheduled
      refresh, and vice versa (lock-scope keys don't collide).
- [ ] NoodleR timeline shows posts and fan-activity events from every private account,
      correctly interleaved by time.
- [ ] NoodleR timeline is empty/hidden entry point when no private accounts exist.
- [ ] Discover tab lists every private account, sorted with unseen-activity accounts
      first; visiting a profile clears its badge.
- [ ] Subscriber counts shown in Discover match real row counts (spot-check against the
      DB, not just the UI).
- [ ] Entering a private profile, the NoodleR timeline, or Discover visibly swaps the
      accent color; leaving any of them reverts to the standard Noodle accent
      immediately, with no flash/flicker on navigation.
- [ ] Public Main/Following feeds are visually unchanged — accent swap never leaks into
      public views.
