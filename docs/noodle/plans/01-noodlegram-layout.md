# Plan 1 — NoodleGram (grid layout mode)

## Goal

Add an image-first grid rendering mode for Noodle, alongside the existing Twitter-style
timeline. Purely a display toggle — no schema changes to posts/accounts, no new
capabilities, no behavior change to likes/reposts/replies/follows.

## Why

Noodle currently only renders as a Twitter/X-style timeline (`docs/noodle/overview.md`).
An Instagram-style grid is a distinct-enough look to be worth offering as an alternate
lens on the same data, and it's the lowest-risk of the three planned changes, so it
ships first.

## Scope

- `packages/shared/src/types/noodle.ts`: add `layout: "timeline" | "grid"` to
  `NoodleSettings` (`noodle.ts:25-51`).
- `packages/shared/src/schemas/noodle.schema.ts`: add the corresponding zod field/default
  (`"timeline"`).
- `packages/server` settings storage/route handling for `NoodleSettings` (wherever
  settings PATCH is validated/persisted) needs no schema migration — `NoodleSettings` is
  stored as a JSON blob via `app-settings.storage`, so this is additive with no DB change.
- `packages/client/src/components/noodle/NoodleView.tsx`:
  - Settings panel: add a layout toggle (Timeline / Grid).
  - When `layout === "grid"`: render the main feed and a profile's Posts/Media tabs as an
    image-first square grid (post image as the tile; posts without an image either
    excluded from the grid or shown as a text-only tile — decide during implementation
    based on how much existing image-only filtering logic already exists for the Media
    tab).
  - Timeline mode remains the current behavior unchanged.
- `packages/client/src/hooks/use-noodle.ts`: expose `layout` from settings if the hook
  doesn't already pass the full `NoodleSettings` object through.

## Out of scope

- No per-account/per-character layout override — this is a single global setting.
- No changes to composer, interactions, or generation/scheduler logic.

## Manual verification (unchecked — verify after implementation)

- [ ] Toggle Timeline → Grid in Noodle settings; feed re-renders as a grid without a
      page reload.
- [ ] Toggle back to Timeline; original card rendering returns unchanged.
- [ ] A profile's Posts/Media tab renders as a grid when grid mode is on, for both a
      persona account and a character account.
- [ ] Existing interactions (like/repost/reply/poll vote) still work identically in grid
      mode.
- [ ] No new console/server errors when switching layouts.
