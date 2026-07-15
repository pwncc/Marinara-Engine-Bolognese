# Plan 6 — "Global" pseudo-persona in the account switcher

## Status

Not started. This doc is written for another agent to pick up and implement.

## Context

Today, `personaAccount` selection in `NoodleView.tsx` (backed by
`ui.store.ts`'s `noodleSelectedPersonaId`) only controls **which account you act as**
(post/like/reply/follow, your own profile, your own subscriptions/unlocks) — it does not
currently filter *which posts you see*. The Main timeline and the planned NoodleR
timeline are already global unions across all accounts within their visibility tier
(public vs private); the only existing persona-scoped view is the client-side
"Following" tab filter.

The feature request: add an explicit **"Global" entry to the persona/account switcher**
(the same switcher used to pick which persona you're posting as, in both Noodle and
NoodleR modes) that, when selected, puts the view into a global/all-personas mode. This
is gated behind a new app-wide settings toggle — off by default, consistent with how
`enableNoodler` gates NoodleR mode itself.

Read `docs/noodle/overview.md`, `docs/noodle/settings.md`, and
`docs/noodle/plans/05-noodler-completeness.md` first for the surrounding design
conventions (single shared `NoodleView.tsx` component tree, `visibility` flag pattern,
settings panel patterns) before making changes.

## Design

### 1. New app-wide setting: `allowGlobalPersona`

Add to `packages/shared/src/schemas/noodle.schema.ts`:

- `DEFAULT_NOODLE_SETTINGS.allowGlobalPersona = false` (near `enableNoodler`, line ~44).
- `noodleSettingsSchema.allowGlobalPersona = z.boolean().default(DEFAULT_NOODLE_SETTINGS.allowGlobalPersona)`.

This is a single app-wide flag (confirmed with the user — not per-persona), matching the
pattern of `enableNoodler` and `noodler.enableFanActivityScheduler`. No DB migration
needed; it lives in the same settings JSON these other flags already use.

### 2. Settings UI toggle

In `packages/client/src/components/noodle/NoodleView.tsx`, add a `ToggleSetting` next to
the existing "Enable NoodleR" toggle inside the `Section title="NoodleR Access"` block
(around line 3507-3539 for `settingsContent`, and the equivalent block around line 3872
in `noodlerSettingsContent` — both panels should expose it since the user wants identical
behavior in Noodle and NoodleR). Follow the exact pattern used for `setNoodlerEnabled`
(line 2962) and `saveSettings` (line 1217):

```tsx
<ToggleSetting
  label="Allow global feed persona"
  help="Adds a 'Global' entry to the account switcher that shows every post across all personas, in both Noodle and NoodleR."
  checked={settings?.allowGlobalPersona === true}
  disabled={updateSettings.isPending}
  onChange={(enabled) => saveSettings({ allowGlobalPersona: enabled })}
/>
```

### 3. "Global" sentinel in switcher state

Add a sentinel constant, e.g. `NOODLE_GLOBAL_PERSONA_ID = "__global__"`, exported from a
shared location (`noodle-shared.tsx` fits the existing pattern of shared constants/helpers
for this component).

`ui.store.ts` already stores `noodleSelectedPersonaId: string | null` (line 492) with
`setNoodleSelectedPersonaId` (line 1860) — reuse this field and just allow it to hold the
sentinel value instead of adding new store state. This keeps persistence (line 2743,
already persisted) working for free.

### 4. Derive a `isGlobalPersonaSelected` flag and adjust `personaAccount`

In `NoodleView.tsx`:

- Around line 912-914, where `personaAccount` is derived from `selectedPersonaId`, add a
  guard: when `selectedPersonaId === NOODLE_GLOBAL_PERSONA_ID` and
  `settings?.allowGlobalPersona === true`, `personaAccount` should resolve to `null`
  (there is no "acting as" identity in Global mode) rather than falling back to
  `sortedPersonaAccounts[0]`.
- Add `const isGlobalPersonaSelected = selectedPersonaId === NOODLE_GLOBAL_PERSONA_ID && settings?.allowGlobalPersona === true;`
  near that memo, and use it to drive the UI changes below. If `allowGlobalPersona` gets
  turned off while `"__global__"` is still selected, fall back to a real persona the same
  way the existing auto-select effect at line 1163-1168 already recovers from an invalid
  `selectedPersonaId`.

Because most of the component (composer identity, own-profile, follows, subscriptions,
notifications-read-state — see the many `personaAccount.*` reads found throughout
`NoodleView.tsx`) assumes a non-null `personaAccount`, Global mode should be treated as a
**view-only** mode:

- **Composer**: disable the compose button / show a "Pick a persona to post" state
  when `isGlobalPersonaSelected` is true (mirrors how the UI already treats "no persona
  accounts yet").
- **Profile nav item**: disable or hide "Profile" while in Global mode (there is no
  "own profile" to show) — `openOwnProfile` should no-op or be visually disabled.
- **Following tab**: hide or disable it while in Global mode, since "Following" is
  defined relative to a persona's own follow list, which doesn't exist without a
  `personaAccount`. Global mode is itself the "show everyone" equivalent of what
  Following restricts.
- **Notifications**: notifications are also persona-relative (`personaAccount.id`-keyed
  read state at line 2112-2124) — hide or disable while in Global mode, or decide to skip
  this nav item's badge state entirely when no persona is selected.

These are recommended defaults; if the implementing agent finds a cleaner UX (e.g.
allowing posting from whichever persona was last active while still labeled "Global" for
the feed), that's an acceptable deviation as long as it's called out in the PR
description, since this part of the spec was not pinned down with the user in detail.

### 5. Render the "Global" entry in both switcher instances

Two switcher UI blocks render the persona list identically and both need the new entry:

- Desktop: `accountSwitcherOpen` dropdown, `visiblePersonaAccounts.map(...)` at
  `NoodleView.tsx:6191-6224`.
- Mobile: `mobileAccountSwitcherOpen` dropdown, `sortedPersonaAccounts.map(...)` at
  `NoodleView.tsx:6030-6064`.

In both, when `settings?.allowGlobalPersona === true`, render one extra button above or
below the persona list (a `Globe`-style icon from `lucide-react`, consistent with the
existing `Avatar`/icon usage) that calls `setSelectedPersonaId(NOODLE_GLOBAL_PERSONA_ID)`
instead of `account.entityId`, and clears `viewedProfileAccountId` /
resets profile tab state the same way the existing persona buttons do (lines 6038-6044,
6199-6205). Mark it `selected` when `isGlobalPersonaSelected` is true. Label it "Global"
with helper text like "See every persona's posts."

Also update the switcher's trigger button (line 6078-6092 mobile, and its desktop
equivalent below line 6249) to show a distinct "Global" label/icon instead of
`personaAccount.handle` when `isGlobalPersonaSelected` is true (since `personaAccount` is
now `null` in this mode).

### 6. Feed behavior while Global is selected

Since the Main Noodle timeline and the planned NoodleR union timeline are *already*
global (no persona filter applied server-side or client-side beyond the "Following" tab
narrowing), the primary feed-content change needed is:

- Ensure whichever tab/view is showing collapses to the full unscoped list when
  `isGlobalPersonaSelected` is true — concretely, force the "Main" behavior (skip the
  `followedCharacterAccountIds` filter) regardless of which tab was last active, since
  "Following" has no meaning without a persona.
- No new server-side query or route is needed — this is a client-side mode, same as
  "Following" is today. Do not add a `personaId` filter to
  `packages/server/src/services/storage/noodle.storage.ts`'s `listPosts()` /
  `listPostsBefore()` — those intentionally stay global per Plan 5's design note ("this is
  a single-user app").

## Files touched

- `packages/shared/src/schemas/noodle.schema.ts` — new `allowGlobalPersona` setting.
- `packages/client/src/components/noodle/NoodleView.tsx` — settings toggle (both panels),
  sentinel handling in `personaAccount`/`selectedPersonaId` derivation, switcher entry
  (desktop + mobile), composer/profile/following/notifications gating while in Global
  mode.
- `packages/client/src/components/noodle/noodle-shared.tsx` (or wherever shared
  constants live for this component) — `NOODLE_GLOBAL_PERSONA_ID` sentinel export.
- No server route or DB schema changes required.

## Verification

- `pnpm check` (TypeScript + ESLint, no automated test suite for this repo).
- Manual, in-browser:
  1. With the setting off (default), confirm the switcher looks unchanged — no "Global"
     entry.
  2. Turn on "Allow global feed persona" in Settings, confirm the entry appears in both
     desktop and mobile switchers, in both Noodle and NoodleR mode.
  3. Select "Global": confirm the feed shows posts from multiple personas/accounts
     unfiltered, composer/profile/following/notifications degrade sensibly (per whatever
     behavior was implemented in step 4), and switching back to a real persona restores
     normal behavior.
  4. Turn the setting back off while "Global" is selected — confirm it doesn't leave the
     UI in a broken state (falls back to a real persona per the auto-recovery logic at
     `NoodleView.tsx:1163-1168`).
