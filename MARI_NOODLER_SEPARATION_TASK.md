# TASK: Separate NoodleR from Noodle — isolation, UX, generation quality

> **Coordination doc for AI agents.** Self-contained: file paths, anchors, and step ordering are
> given so broad re-exploration shouldn't be necessary. The design below is approved by the
> maintainer — do not re-plan from scratch, but use judgment on exact line numbers (the file has
> likely moved since these anchors were taken). Work on the `noooooods` branch (already based on
> `staging`, already carries the prior NoodleR commits) unless told otherwise — do **not** target
> `main`. Check `git log --oneline -15` on this branch before starting a phase below, in case
> another agent already completed it.

## Repo facts you need

- Monorepo (pnpm): `packages/client` (React 19 + TS strict, Tailwind v4 CSS-vars, Zustand stores,
  TanStack Query hooks, **no URL router** — navigation is state-based), `packages/server`
  (Fastify + Pino logger), `packages/shared` (types/schemas/constants).
- **Read `packages/client/.instructions.md` before any client edit.** No barrel/index files —
  direct imports only. Lazy-load heavy components in `AppShell.tsx` per existing convention
  (`CharacterEditor`, `LorebookEditor`, etc.).
- Server logging: import the Pino `logger`, never `console.*` in server code.
- Validate with `pnpm install` then `pnpm check` (TS + ESLint). No automated test suite exists —
  manual verification is required and must be described explicitly, not implied.
- **No `pnpm db:push` is needed anywhere in this task** — all new fields go into existing JSON
  `settings`/`metadata` bags on `NoodleAccount`/`NoodlePost`, not new columns.

## Background (why)

Noodle (public social feed) and NoodleR (private, OnlyFans-style creator/subscriber sub-mode)
currently live inside one ~7,351-line component (`packages/client/src/components/noodle/NoodleView.tsx`)
with no real isolation between them:

- "Mode" is *derived* from `viewedProfileAccount?.visibility`, not tracked explicitly — a stray
  code path can silently render NoodleR chrome.
- Switching modes or disabling NoodleR doesn't reset NoodleR-scoped state
  (`viewedProfileAccountId`, `noodlerHubTab`) — a private profile can reappear after switching
  back to Noodle, or survive disabling the feature.
- The server ships **all** private accounts/posts in the bootstrap payload regardless of whether
  `settings.enableNoodler` is on. The "verification" flow is intentionally cosmetic flavor (a joke
  checklist) and should stay that way — but the resulting *data* should still not be resident in
  the client when the feature is off. This is an accidental-leak fix, not an access-control
  feature: **do not add server-side route rejection / 404s for the NoodleR API when the setting is
  off** — the maintainer explicitly decided against that; it's not worth the complexity for a
  novelty feature with no real access-control stakes.
- NoodleR's UI (hub, profile, composer, settings) hand-rolls pill/badge styles instead of the
  app's existing chip system (`.mari-suggestion-chip`, `.mari-chat-mode-badge` in
  `globals.css`), has no pricing/tier framing despite modeling a creator-platform, and the
  composer only exposes the access-level choice when an image is attached (text-only posts
  silently default to public with no way to gate them).
- NoodleR's generation prompts (persona identity, fan comments, creator thank-you replies) are
  serviceable but generic/repetitive, and the pipeline has real inefficiencies (duplicate context
  builds, N+1 image captioning per refresh, full account/subscription reloads on every fan-activity
  scheduler tick).

Goal: make cross-mode leakage structurally impossible (not just behaviorally unlikely) while
keeping Noodle/NoodleR feeling like one app, then use the resulting clean boundary to give NoodleR
a real creator-platform-flavored UX pass and tighten generation quality/cost.

---

## Phase 1 — Server: stop shipping private data when NoodleR is off

*(Independent, ship first — no client changes required.)*

File: `packages/server/src/services/storage/noodle.storage.ts`

- `bootstrap()` (~L1294-1314): read `settings.enableNoodler` first (it already calls
  `this.getSettings()` — reorder if needed), then pass `includePrivate: settings.enableNoodler`
  into `listAccounts()` (see next bullet). Filter `posts` to exclude posts authored by private
  accounts when disabled — do this post-hoc using the already-fetched account list (avoids
  threading a new param through `listPosts()`, which has other unrelated callers). Filter
  `subscriptions`/`postUnlocks` to reference only the accounts still included.
- `listAccounts()` (~L497, currently `async listAccounts(): Promise<NoodleAccount[]> { const rows
  = await db.select().from(noodleAccounts).orderBy(desc(noodleAccounts.updatedAt)); return
  rows.map(mapAccount); }`): add an optional `{ includePrivate?: boolean }` param, default `true`
  (preserves behavior for internal callers in `noodler.routes.ts` that legitimately need private
  accounts, e.g. identity retry). When `false`, filter out rows where `visibility === "private"`.

File: `packages/server/src/routes/noodle.routes.ts`

- `GET /posts` cursor route (~L2306, calls `noodle.listPostsBefore(before, { limit: limit + 1 })`)
  has a comment (~L2301-2305) stating results are "unfiltered by account visibility, matching
  bootstrap's existing convention." Once bootstrap is scoped, this becomes the new leak vector
  (scroll back far enough → private posts appear even with NoodleR off). Apply the same
  account-visibility filter here, gated on `settings.enableNoodler`, and update the now-stale
  comment.

**Verify:** toggle `enableNoodler` off in settings, hit `/api/noodle` (bootstrap) and the
cursor-pagination endpoint directly (or scroll the feed far back), confirm private accounts/posts
are absent from both responses. Toggle it back on, confirm they reappear.

---

## Phase 2 — Client: centralized mode-transition function

File: `packages/client/src/components/noodle/NoodleView.tsx`

- Add one function, `transitionNoodleMode(next: NoodleMode)`, near the other `open*` handlers.
  It should set the target view and **always** reset: `viewedProfileAccountId`, `noodlerHubTab`,
  `accountSwitcherOpen`, `mobileDrawerOpen`, `activeComposerTool`, `profileConnectionTab`, and any
  other transient UI-local state currently reset piecemeal by `openHomeTimeline` (~L3021-3028) and
  `openNoodlerHub` (~L3117-3131).
- Route `openHomeTimeline`, `openNoodlerHub`, `NoodleModeSwitcher`'s `onOpenNoodle`/`onOpenNoodler`
  callbacks (switcher itself at ~L787-823, wired at ~L5415-5417 and ~L5545-5546), and
  `setNoodlerEnabled(false)`'s cleanup (~L3108-3115) through this one function instead of each
  hand-rolling a subset of resets. Make `setNoodlerEnabled(false)` call
  `transitionNoodleMode("noodle")` **unconditionally**, not only when already in NoodleR mode —
  today it skips the reset if the user happens to be in `"noodle"` mode but still has stale
  NoodleR state (e.g. `viewedProfileAccountId` pointing at a private account) hanging around.
- Grep for direct `setActiveNoodleView(` call sites (~10-15 expected) and audit each: any that
  bypass the `openProfile` visibility gate (~L2405-2421) should be converted to call
  `openProfile`/`transitionNoodleMode` instead of setting the view directly.

**Verify manually:** open a private profile → switch to Noodle via the mode switcher → switch back
to NoodleR — the profile should not silently reappear without going through the gate. Disable
NoodleR while viewing a private profile — should land on the home timeline, not a stale private
view.

---

## Phase 3 — Client: explicit mode as single source of truth

File: `packages/client/src/components/noodle/NoodleView.tsx`

- Replace the derived `activeNoodleMode`/`isNoodlerScopedView` (~L1459-1462, currently:
  `isNoodlerScopedView = activeNoodleView === "noodler" || (activeNoodleView === "profile" &&
  viewedProfileAccount?.visibility === "private")`) with real state:
  `const [activeNoodleMode, setActiveNoodleMode] = useState<NoodleMode>("noodle")`, set **only**
  inside `transitionNoodleMode` from Phase 2. All chrome-selection logic (which shell/header/accent
  color renders) reads this state directly instead of re-deriving from account visibility.
- This is the change that kills the bug class at the type level: no code path can set
  `activeNoodleView` to `"profile"` and implicitly get NoodleR chrome as a side effect — chrome
  branches on `activeNoodleMode`, which only ever changes via the one centralized function.
- Depends on Phase 2 landing first (the transition function must exist to be the sole setter).

---

## Phase 4 — Client: evict private data from cache on disable

File: `packages/client/src/hooks/use-noodle.ts` (`useUpdateNoodleSettings`, ~L94-122) or the
`setNoodlerEnabled(false)` handler in `NoodleView.tsx`.

- When a settings patch sets `enableNoodler: false`, strip private accounts/posts and clear
  `subscriptions`/`postUnlocks` from the cached `noodleKeys.bootstrap()` React Query entry via
  `qc.setQueryData`, then `qc.invalidateQueries({ queryKey: noodleKeys.bootstrap() })` to force a
  refetch of the now server-scoped (Phase 1) payload. This closes the gap between the mutation
  succeeding and the refetch completing, where stale private rows would otherwise still be
  resident in memory.

**Verify:** disable NoodleR, inspect React Query devtools — no private rows should linger in the
bootstrap cache entry before the refetch resolves.

---

## Phase 5 — Client: file split (`NoodleHome.tsx` / `NoodlerHome.tsx`) — DONE (profile view; settings sections still open)

Status: `NoodleHome.tsx` (home timeline/search/notifications, plus the new `PublicProfileView`),
`NoodlerHome.tsx` (NoodleR hub tabs — timeline/subscriptions/discover/owned, lazy-loaded from
`NoodleView.tsx` via `lazy()` — plus the new `PrivateProfileView`), and `noodle-shared.tsx`
(types, constants, `Avatar`, badges, and other genuinely shared bits) have been extracted and
merged. The profile view split (previously the main open item) is now complete: `NoodleView.tsx`
builds two prop objects — `publicProfileViewProps` (typed `PublicProfileViewProps`) and
`profileViewProps` (typed `PrivateProfileViewProps`, threaded through `noodlerHomeProps`) — from
its existing local state/handlers and renders `<PublicProfileView>` or routes to
`NoodlerHome`'s `<PrivateProfileView>` depending on `activeNoodleMode`, instead of one shared
code path branching on `viewedProfileAccount.visibility`. Along the way, fixed a latent bug where
`noodlerHomeProps.activeNoodleView` never actually passed through `"profile"` (it only ever
computed `"noodler"` or `"noodler-verification"`), so `NoodlerHome`'s private-profile branch was
unreachable until now. `tsc --noEmit` (full client pass) and `eslint` on all four touched files
are clean, including removal of several imports that were only used by the inline JSX this
extraction removed. **Not verified in a browser** — no dev server was available in this
environment, so a manual click-through on desktop and mobile (own public profile edit, someone
else's public profile + follow, own private profile creator tools/fan-activity, someone else's
private profile + subscribe) is still owed before this ships.

**Not done — remaining work for whoever picks this up next:** the private composer's shared
full-screen compose modal had its `authorAccountId` bug fixed as part of this same pass (see
Phase 6 status below), but the NoodleR settings sections ("NoodleR Access", "NoodleR Fan
Activity") are still inline in `NoodleView.tsx`'s `settingsContent`, not extracted. This wasn't
attempted in this pass — it's lower-entanglement than the profile view was (mostly toggle/select
rows against `SettingControls`/`ToggleSetting`) and can reasonably stay in the shell, or be
pulled into a small `NoodlerSettings.tsx` later; either is defensible.
- Original plan for reference (kept below for anyone doing the rest of this extraction):

<details>
<summary>Original Phase 5 plan (not fully executed)</summary>

- `NoodleView.tsx` becomes a thin shell: shared chrome (top bar, compose-modal wiring,
  `NoodleModeSwitcher`, settings-panel scaffold), the `activeNoodleMode` state, and
  `transitionNoodleMode`. It renders `<NoodleHome>` or `<NoodlerHome>` based on mode.
- `NoodleHome.tsx`: public feed — home timeline, search, notifications, public profile view.
- `NoodlerHome.tsx`: NoodleR hub, private profile view, composer, fan-activity settings panel.
- Lazy-load `NoodlerHome.tsx` (done, though from within `NoodleView.tsx` rather than
  `AppShell.tsx` — functionally equivalent since `NoodleView.tsx` itself is already lazy-loaded
  from `AppShell.tsx`).
- Extract genuinely shared bits (avatar rendering, image lightbox, locked-content blur+overlay
  pattern) into a small shared file instead of duplicating them (done — `noodle-shared.tsx`).

</details>

**Verify (still owed):** manually click through both modes on desktop and mobile widths, confirm
no visual regression from the pre-split behavior — profile view, composer, and settings
especially, since those weren't touched by the extraction and should be behaviorally identical,
but haven't been eyeballed in a running app.

---

## Phase 6 — NoodleR UX redesign (creator-platform framing) — PARTIALLY DONE

Status: the composer access-gating bug is fixed (text-only posts no longer silently default to
public), the composer's access selector is now always-visible `.mari-suggestion-chip` buttons
instead of a conditionally-rendered `<select>`, and simulated display-only pricing
(`subscriptionPrice` on `NoodleAccount.settings`, `ppvPrice` on `NoodlePost.metadata` — new
optional field on `noodleCreatePostSchema`, no DB migration) is wired through the composer,
creator-tools "Subscription price" field, all Subscribe buttons, and both locked-post overlay
captions. `subscribeLabel`/`unlockLabel` helpers in `noodle-shared.tsx` are the single source of
truth for that price-or-fallback formatting. tsc is clean across shared/server/client (shared
must be rebuilt — `pnpm --filter @marinara-engine/shared build` — before the server picks up new
shared-schema fields, since server consumes `packages/shared/dist`, not source). Not verified in
a browser.

This landed only in `NoodleView.tsx` (composer, profile view, locked-post overlays), **not** in
`NoodlerHome.tsx`, because Phase 5 didn't extract the composer/profile view there — see Phase 5's
status note. Whoever finishes the Phase 5 extraction should expect this pricing/composer code to
move with it.

**Not done, for whoever continues this:**
- Badge restyle (`NoodlerBadge`/`NoodlerPrivateBadge` → `.mari-chat-mode-badge`): skipped
  deliberately — the existing badges already use the same `--noodle-blue`/`NOODLER_BLUE`
  accent-swap convention as everything else and read fine; switching CSS-class families risked an
  unstyled badge that couldn't be caught without a browser. Revisit if there's a concrete reason.
- "Earnings" stat block on the owner's hub/profile (computed display, no new stored field).
- Discover-card layout beyond the price now shown on its existing Subscribe button.
- A dedicated Settings "Monetization" grouping: `subscriptionPrice` ended up living in the
  per-profile creator-tools panel instead of the global Settings panel, since it's a
  per-creator-account value, not a single global default — a deliberate deviation from the
  original plan text below. `SettingControls`/`ToggleSetting` reuse still applies if a global
  *default* price is wanted later.
- **`authorAccountId` bug — investigated and fixed.** Confirmed by reading
  `resolvePersonaAccount`/`POST /posts` server-side (`packages/server/src/routes/noodle.routes.ts`):
  when `authorAccountId` is omitted, the route falls back to
  `getAccountByEntity(authorKind, authorEntityId)`, which resolves `personaAccount.entityId` to the
  **public** persona account — so the shared modal's `submitPost` (`NoodleView.tsx`, grep
  `composerAccess`) always posted publicly regardless of mode, despite the modal's title changing
  to "New NoodleR post". Fixed: added `personaLinkedNoodlerAccount` (derived from
  `personaAccount.linkedAccountId`, distinct from the profile-view's `linkedNoodlerAccount` which
  is derived from `viewedProfileAccount` instead — the modal isn't page-scoped, so it must resolve
  the poster's *own* linked account, not whichever profile happens to be open). `submitPost` now
  passes `authorAccountId: personaLinkedNoodlerAccount.id` and forces `access: "public"` when no
  linked account exists yet, and `canSubmitPost` now also requires a linked account when
  `activeNoodleMode === "noodler"` so the modal can't silently post publicly under a "New NoodleR
  post" title.
- **Also discovered, not fixed:** the same access-defaulting bug the inline composer had (access
  selector only offered when an image is attached) is still present in **two** places sharing the
  same `composerAccess`/`attachedImageUrl` state: the inline composer now living in
  `NoodleHome.tsx` (~L473-500, still a bare `<select>`) and the full-screen modal in
  `NoodleView.tsx` (same pattern, near the `authorAccountId` fix above). Phase 6's chip-styled,
  always-visible access selector was only ever applied to `submitPrivatePost`'s creator-tools
  composer (`NoodlerHome.tsx`) — these two share one fix (same state, same handler) but it's a UI
  redesign across two files, not a one-line change, so left as Phase 6 follow-up rather than
  scope-creeping a Phase 5/bugfix pass.

Original plan text follows for reference (some of it — chip reuse, pricing fields, composer
chips — is now done; treat the rest as still-open):

**Note on line anchors below:** Phase 5 only partially landed (see its section above) — the hub
tabs (`renderNoodlerDiscoverCard`, `NOODLER_HUB_TABS`, subscribe/unlock rows) now live in
`NoodlerHome.tsx`, but the composer, private profile view, and NoodleR settings sections are
still in `NoodleView.tsx` at shifted line numbers. `NoodlerPrivateBadge`/`NoodlerBadge` and other
shared primitives now live in `noodle-shared.tsx`. Re-grep for exact locations before editing —
the `~L####` anchors below are from the pre-split file and are now approximate at best.

**Reuse the existing chip/badge system instead of hand-rolled pills:**
- `.mari-suggestion-chip` (`globals.css` ~L894-930, tinted pill with `color-mix` tint/border/glow)
  — replaces the current ad hoc subscribe/unlock pill buttons and the composer's bare
  access-level `<select>` (~L6635-6642).
- `.mari-chat-mode-badge` (`globals.css` ~L785) — informs a consistent replacement/variant for the
  current hand-rolled `NoodlerPrivateBadge`/`NoodlerBadge` (~L757-771).
- Keep the existing CSS-var accent swap (`--noodle-blue` → pink `#FF6FAE` in NoodleR context,
  `NOODLE_BLUE`/`NOODLER_BLUE` constants ~L146-147) — apply it through the shared chip classes
  instead of scattered inline `text-[var(--noodle-blue)]` usages.
- Keep the existing locked-content pattern (`blur-xl`/`blur-2xl` image + `bg-black/45` overlay +
  centered caption) as-is — it already reads correctly. Just restyle the CTA button inside it with
  the shared chip class.

**Simulated pricing/tier framing** — display-only, no real payments implied or processed, stored
in existing JSON bags (no schema migration):
- Add `subscriptionPrice` (a number, simulated $/mo) to `NoodleAccount.settings`. Surface it next
  to the Subscribe button on the profile view and on Discover cards
  (`renderNoodlerDiscoverCard`) — e.g. "Subscribe · $9.99/mo". Expose it as an editable field in
  the owner's composer/settings area.
- Add `ppvPrice` to `NoodlePost.metadata`. Surface on the locked-post overlay CTA in place of the
  generic "Pay-per-post" label — e.g. "Unlock · $4.99".
- Add a lightweight "earnings" stat block to the owner's hub/profile — purely client-computed
  (subscriber count × price + PPV-unlock count × price), no new stored field, just a display
  calculation — to give the creator-dashboard feel these platforms lean on.

**Composer improvements** (currently embedded inline in the owner's own profile, ~L6560-6656):
- Always show the access-level choice (public/subscriber/PPV), not only when an image URL is
  present — today text-only posts silently default to public with no way to gate them.
- Replace the bare `<select>` (~L6635-6642) with `.mari-suggestion-chip`-styled access-level
  chips (Public / Subscribers / PPV), each showing the relevant price inline when applicable.
- Keep the existing "subscribers auto-unlock PPV" checkbox (`subscriptionIncludesPpv`,
  ~L6602-6620) — it's a reasonable existing mechanic, don't touch it.

**Hub/profile/settings polish:**
- Hub tabs (`NOODLER_HUB_TABS`) keep their structure but adopt the shared chip/badge classes for
  unseen-count (`noodlerUnseenCountByAccountId`) and subscriber-count pills.
- Discover cards (`renderNoodlerDiscoverCard`) gain the price chip described above.
- Settings: add a small "Monetization" grouping (default subscription price, default PPV price)
  alongside the existing "NoodleR Access" (~L3619-3645) and "NoodleR Fan Activity" (~L3647-3660)
  sections, using the existing `SettingControls`/`ToggleSetting` components already used elsewhere
  in the settings panels — don't invent a new settings-row pattern.

**Verify:** manually walk through composer → create a post at each access level → confirm the
price renders correctly on the resulting locked-post overlay, on the subscribe flow, and on the
Discover card. Check both desktop and mobile.

---

## Phase 7 — Generation prompt quality

File: `packages/server/src/routes/noodle.routes.ts`

- Stage-identity generation (`generatePrivateAccountStageIdentity`, ~L1416): the "vibe" field's
  prompt guidance currently gives an enumerated example list ("confident, coy, submissive but
  articulate, bratty, anonymous, etc.") which nudges the model toward a small fixed vocabulary —
  reword to ask for a distinctive, specific trait combination rather than implicitly picking from
  a short list, to reduce persona repetitiveness across generated accounts.
- Creator thank-you replies (`generateNoodlerReaction`, ~L1718, invoked via
  `tryGenerateNoodlerReaction` ~L1776): currently grounded only in one line of bio with no
  reference to the specific post/interaction being replied to (`"Write only the reply text: one
  or two sentences, casual and personal, matching the creator's voice and bio. No JSON, no quotes,
  no extra commentary."`) — pass the actual post content and interaction type (subscribe/unlock/
  comment) into the prompt so replies read as responding to *that* event, not a generic template.
- Fan-activity comments (`simulateNoodlerFanActivity`, ~L1854): currently differentiated only by
  `fan.bio` (prompt asks for "a short one-sentence in-character fan reaction"), producing
  similar-sounding comments across filler accounts — generate (once, at fan-account creation time)
  a short per-fan "voice" trait, store it in that account's `settings` bag, and include it
  alongside bio in the batch prompt so generated comments read as distinct people rather than one
  voice repeated.

**Verify:** no automated test exists for prompt quality — generate a batch of fan activity and a
few reactions before/after the change and manually compare for repetitiveness. Note this is a
judgment call in the PR description, not a pass/fail check.

---

## Phase 8 — Generation efficiency

File: `packages/server/src/routes/noodle.routes.ts` (and wherever `buildRefreshPrompt`'s helpers
live, likely alongside it or in a sibling prompt-service file — check imports).

- `buildRefreshPrompt` (~L862, used for guided single-post NoodleR generation) currently calls
  `buildContext` twice to produce both `context` and a near-duplicate `textOnlyContext`
  (~L1232-1233) — derive the text-only variant from the already-built `context` instead of running
  a second full build, cutting prompt-construction cost for every NoodleR post generation.
- Image-candidate vision captioning currently issues one call per candidate image via
  `Promise.all` when `imageCaptioning.enabled` — batch into a single multi-image captioning call
  where the provider supports it, or cap the number of candidates considered, to avoid N+1 calls
  per refresh.
- `simulateNoodlerFanActivity` reloads `listAccounts()`/`listSubscriptions()` in full on every
  scheduler tick (~L1873, 1879, 1885) — since the scheduler polls every 60s per account
  (`noodle-fan-activity-scheduler.service.ts`), pass already-loaded data from the caller where it's
  already in hand, or add a short-lived in-memory cache keyed by a settings-version/timestamp,
  instead of re-querying on every tick.
- `ensurePrivateAccountIdentity` (~L1610) runs text-identity generation and avatar-image
  generation sequentially with no reuse on retry. There's already an `avatarGenerationFailed` flag
  in the account's `settings` bag — on a retry triggered by that flag specifically, skip
  regenerating the text identity and only retry the image call.

**Verify:** no automated perf test exists — spot-check via `logger.debug` timing (this repo's
convention for prompt logging — see `AGENTS.md` line ~70 on wiring prompt/debug logging for new
generation code) comparing call counts/latency for a NoodleR post refresh and a fan-activity tick
before/after.

---

## Reuse (don't reinvent)

- `.mari-suggestion-chip`, `.mari-chat-mode-badge` (`globals.css`) — the app's general chip/badge
  system; NoodleR currently doesn't use it and should.
- `SettingControls.tsx` / `ToggleSetting` — existing settings-row primitives used by every other
  settings subtab; use these for the new Monetization section, don't invent new markup.
- Existing lazy-load pattern in `AppShell.tsx` (see `CharacterEditor`/`LorebookEditor` imports) —
  the template for lazy-loading `NoodlerHome.tsx`.
- Existing blur+overlay locked-content pattern (~L4326-4352, ~L4600-4645 in the pre-split file) —
  keep it, don't redesign the visual mechanic, just restyle the CTA inside it.

## Definition of done / verification (cumulative, after all phases)

1. `pnpm check` clean (TypeScript + ESLint) after each phase.
2. Toggle `enableNoodler` off: confirm no private account/post data appears in the bootstrap
   response, the posts cursor-pagination response, or the React Query cache (devtools).
3. Switch Noodle → NoodleR → Noodle repeatedly, including while a private profile is open: no
   stale private state or chrome ever appears in Noodle mode.
4. Compose a post at each access level (public/subscriber/PPV) in the redesigned composer, confirm
   correct price display and locked/unlocked behavior across profile, feed, and Discover.
5. Desktop and mobile manual check for all UI-touching phases (2, 3, 5, 6) — describe explicitly
   what was checked; do not claim verification that wasn't performed.
6. No `pnpm db:push` should be necessary at any point — flag immediately if a phase turns out to
   need one, since that wasn't the plan.

## PR notes (per `CLAUDE.md` / `AGENTS.md`)

- Target `staging`, not `main`.
- No GitHub issue is currently linked to this work — note in the PR description that one should be
  opened, or link this task doc, per maintainer preference.
- Phases 1-5 (isolation) are the structural foundation and are the highest-value, lowest-risk work
  — safe to ship independently and first. Phases 6-8 (UX, prompt quality, efficiency) depend on
  Phase 5's file split existing but are otherwise independent of each other; any one can be
  reordered or dropped without blocking the others.
- Leave all validation/test-plan checkboxes in a PR description UNCHECKED — they're a human to-do
  list, not evidence of completion. List manual-verification items explicitly instead
  ("Manually verify X in browser").
- Before starting a phase, check `git log`/branches/open PRs for prior progress by another agent
  on the same phase to avoid duplicate work.
