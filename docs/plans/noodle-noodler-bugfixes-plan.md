# Plan: Noodle / NoodleR bug-fix & UX pass

> **For:** the agent picking up the reported bugs on the `noooooods` branch.
> **Scope:** Mostly UI/UX and behavior fixes in the Noodle + NoodleR client surface, plus **two server-touching items**: B2 (private-profile access scoping — security) and B1 (new per-profile automatic-posting setting). Both likely need `pnpm db:push`.
> **Baseline validation:** `pnpm install`, then `pnpm check` (TypeScript + ESLint). Run `pnpm db:push` for B1/B2. There is no automated test suite, so each item below lists a **manual verify** step. Read `packages/client/.instructions.md` before editing client code (per `CLAUDE.md`).
> **All maintainer questions are answered** — see *Resolved decisions* near the end. Nothing here is blocked on further input.

## Ground truth — where things live

Almost everything is in `packages/client/src/components/noodle/`:

- **`NoodleView.tsx`** (~6970 lines) — the top-level container. Owns mode/view state (`activeNoodleMode` = `"noodle"|"noodler"`, `activeNoodleView` = `"home"|"noodler"|"profile"|"settings"|"notifications"|"search"|"noodler-verification"`), all handlers, the two settings blocks, the right rail, the sidebars, and the profile/create flows.
- **`NoodleHome.tsx`** — the public Noodle timeline body + mobile "Who to follow".
- **`NoodlerHome.tsx`** — the NoodleR hub body, verification/enable screen, and the inline "Creators to check out" section.
- **`noodle-shared.tsx`** — shared presentational pieces: `NoodleModeSwitcher`, `RefreshTimelineButton`, composer, `BrowserChrome`.
- **`hooks/use-noodle.ts` / `hooks/use-noodler.ts`** — data hooks (`useRefreshNoodle`, `useUpdateNoodleSettings`, `useCreatePrivateNoodleAccount`, `useSubscribe/UnsubscribeNoodleAccount`, `useDeletePrivateNoodleAccount`, …).

Key state facts:
- `isNoodlerEnabled = settings?.enableNoodler === true` (`NoodleView.tsx:953`).
- Mode accent color switches via CSS var `--noodle-blue` = `NOODLER_BLUE` when in noodler mode, else `NOODLE_BLUE` (`NoodleView.tsx:5971`, `6008`). NoodleR "pink" is that `NOODLER_BLUE` token.
- The `NoodleModeSwitcher` is rendered **twice**, unconditionally: desktop sidebar `NoodleView.tsx:6217`, mobile drawer `NoodleView.tsx:6049`.

---

## Group A — Noodle (public side)

### A1. Mode switcher shows even when NoodleR is disabled
**Symptom:** With NoodleR not enabled in Settings, the Noodle↔NoodleR switcher is still displayed.
**Cause:** Both `NoodleModeSwitcher` render sites (`NoodleView.tsx:6049`, `:6217`) render regardless of `isNoodlerEnabled`.
**Fix:** Gate both on `isNoodlerEnabled`. When disabled, render nothing (there is nothing to switch to). Keep the enable path reachable from Settings (A/B below) — do **not** rely on the switcher as the only entry point.
**Manual verify:** Fresh install / NoodleR off → no switcher in desktop sidebar or mobile drawer. Enable in Settings → switcher appears in both.

---

## Group B — NoodleR (private side)

### B1. "Refresh timeline" in NoodleR refreshes the *Noodle* timeline
**Decision (maintainer):** The NoodleR refresh should **generate NoodleR posts — but only for NoodleR profiles where automatic posting is enabled.** That per-profile "automatic posting" setting **does not exist yet** and must be added as part of this work.

**Symptom:** The refresh button on the NoodleR hub regenerates the public Noodle feed, not NoodleR content.
**Cause:** `NoodlerHome.tsx:470` uses the shared `RefreshTimelineButton` wired to the same `onTriggerRefresh` → `triggerRefresh` (`NoodleView.tsx:2729`), which calls `refreshNoodle.mutate({ personaId, connectionId })` — the public-feed refresh. NoodleR posts are otherwise generated per-page and on-demand via `generateGuidedPrivatePost` (`NoodleView.tsx:2755`).

**What exists today (confirmed — do not confuse these for auto-posting):**
- **Posting mode** Active/Passive (`stageProfilePostingMode`, `NoodleView.tsx:3996–4019`). Its own help text says it is *"unrelated to AI auto-posting, which stays off regardless."* It only controls whether the account participates vs lurks — **not** scheduled post generation.
- **Fan activity** per-page `autoSchedule` (`readFanActivityAutoSchedule`, `:4256`) + the global `noodler.enableFanActivityScheduler` kill switch (`:3922`). Fans only like/comment/subscribe/unlock — *"Fans never write new posts."*
- The public Noodle side has scheduled auto-refresh (`scheduler.scheduledTimes`); **NoodleR has no equivalent for generating/posting new content.**

**Fix:**
1. **Add a per-NoodleR-profile "Automatic posting" toggle** (new setting on the private account, alongside stage profile / fan activity). Persist it via `useUpdateNoodleAccount` (server + likely `pnpm db:push`). Consider a global NoodleR kill switch mirroring `enableFanActivityScheduler` so unattended generation is off by default.
2. **Rewire the NoodleR refresh button** so it generates posts for the owned NoodleR profiles that have automatic posting enabled — reuse the existing private-post generation path (`generateGuidedPrivatePost` / `refreshNoodle.mutate` with `targetAccountId`, `NoodleView.tsx:2769`) per eligible profile, rather than calling the public `triggerRefresh`.
3. Do **not** leave it calling `triggerRefresh` (public feed).

**Manual verify:** In NoodleR mode, hit refresh → new posts appear only on profiles with automatic posting on; profiles with it off get nothing; the public Noodle feed is untouched (no "Noodle timeline refreshed." toast).

### B2. Cross-persona NoodleR profile access when no NoodlerID exists
**Symptom:** "If no NoodlerID for a persona is created, accounts can access NoodleR profiles of others." Personas can view NoodleR profiles that aren't theirs — a privacy leak.
**Decision (maintainer):** Fix it **in this pass** (not split into a separate PR). Call it out explicitly as a security fix in the PR description.

**Cause:** Needs confirmation on the server. The private-account visibility filter (`account.visibility === "private" && !isNoodlerEnabled` at `NoodleView.tsx:2195`) gates the switcher, but profile *access* by id may not be scoped to the acting persona/owner. Trace the read path in `hooks/use-noodler.ts` and the server route it hits.
**Fix:** Scope NoodleR profile reads so a persona can only open private pages it owns (or is subscribed to, per product intent). Enforce on the **server**, not just by hiding UI — a client-side filter alone does not close this. Run `pnpm db:push` if the change touches schema.
**Manual verify:** With persona A (no NoodleR page) try to open persona B's private page by navigating/deep-linking → denied. Confirm the check is server-side (e.g. hit the API directly, not just the UI). Confirm the public Noodle side and legitimate subscriber access are unaffected.
**Owner note:** security-relevant — flag it explicitly in the PR description, and don't let it get buried among the UI polish commits. Keep it as its own commit within the branch so it's reviewable in isolation.

### B3. "Just kidding. NoodleR enabled." toast is stale copy
**Decision (maintainer):** Drop the "Just kidding" gag. Replace with copy that confirms verification and points the user at the next step — creating a NoodlerID. Something along the lines of:

> **"Verification complete — welcome to NoodleR. Start by creating a NoodlerID."**

**Symptom:** Enabling NoodleR shows `toast.success("Just kidding. NoodleR enabled.")` (`NoodleView.tsx:1243`).
**Fix:** Update the toast to the new copy. Align both enable paths — the verification screen (`onEnableNoodlerFromVerification`, `NoodlerHome.tsx:329`) and the Settings toggle (`setNoodlerEnabled`, `NoodleView.tsx:2979`). Note the Settings-toggle path never showed a verification screen, so "Verification complete" doesn't fit there — use a suitable variant for that path (e.g. "NoodleR enabled. Start by creating a NoodlerID.").
**Nice-to-have:** if it's cheap, make the "create a NoodlerID" hint actionable (link/CTA into the create flow) rather than just a toast string — ties into B8.
**Manual verify:** Enable from the verification screen and from the Settings toggle → each shows correct, non-joke copy that names the NoodlerID next step.

### B4. "Your pages" needs an info box + main-account attribution
**Symptom:** The NoodleR "your pages" list shows all persona NoodleR profiles with no explanation, and doesn't show which main account each profile belongs to.
**Cause:** The list renders profile rows (`renderNoodlerProfileRow`, `NoodleView.tsx:~4982–5041`) with no header/context and no linked-account label.
**Fix:**
- Add an info box above the list explaining this shows *all of the user's own persona NoodleR profiles*.
- For each row, show the main/linked account (each private account has `linkedAccountId`; resolve via `accountById` and render the owner's display name/handle under the stage name).
**Manual verify:** With 2+ personas that each have a NoodleR page, the list shows the info box and each row names its parent account.

### B5. Move "Creators to check out" into the right rail
**Symptom:** NoodleR's "Creators to check out" is a cool section but currently sits inline in the timeline (`NoodlerHome.tsx:473–488`). It should live in the right-side rail — the NoodleR analog of Noodle's "Who to follow".
**Cause:** The right rail (`rightRailContent`, `NoodleView.tsx:5633–5694`) is shared across both modes but only ever renders "Who to follow" from `suggestedCharacters`. NoodleR's `suggestedNoodlerCreators` (`NoodleView.tsx:1079`) is only consumed by the inline section.
**Fix:**
- In `rightRailContent`, branch on `activeNoodleMode`: in `"noodler"` mode render a "Creators to check out" card driven by `suggestedNoodlerCreators` (reuse the row markup from `renderNoodlerSuggestionRow`, `NoodleView.tsx:5109`); in `"noodle"` mode keep "Who to follow".
- Remove the inline "Creators to check out" section from `NoodlerHome.tsx:473–488` (and drop now-unused props if any).
- Net: Noodle rail = "Who to follow", NoodleR rail = "Creators to check out".
**Manual verify:** In Noodle mode the rail shows "Who to follow"; switch to NoodleR mode → same rail slot shows "Creators to check out", and the timeline no longer has the inline block.

### B6. Profile header: action-button placement is wrong
**Symptom:** On a profile (e.g. a persona profile) the **Delete** button sits on the right and **Subscribe** sits in the middle — the layout reads as misaligned.
**Cause:** In the profile row/header, the two states render as siblings with `mt-1 shrink-0` and no shared alignment: Subscribe (`NoodleView.tsx:5013–5027`) vs Delete (`:5028–5039`). Depending on which branch is active they land in different horizontal slots.
**Fix:** Normalize the action slot so the primary action (Subscribe/Unsubscribe for others, Delete/manage for own) occupies the same right-aligned position with consistent sizing. Verify against the full profile header too (not just the compact row) — the same `isOwn`/`!isOwn` split appears where the profile is shown.
**Manual verify:** Own persona profile and someone else's profile → the action button is in the same spot with consistent alignment/size in both.

### B7. Creator tools are oversized
**Symptom:** On a profile, the "creator tools" are "really fucking big."
**Cause:** The creator-tool controls render as full-width `<Section>` blocks inside the profile view (`Your page` at `NoodleView.tsx:4281`, `Fan activity` at `:4197`, etc.), using the same heavy Section styling as the settings screen. On a profile they dominate the layout.
**Fix:** Give the profile's creator tools a more compact presentation — smaller/denser than the settings Sections (tighter padding, smaller headings, or a collapsible panel). Keep the same controls and behavior; just reduce visual weight. Coordinate with B8 so the compact tools are reusable across persona and character profiles.
**Manual verify:** Own NoodleR profile → creator tools are visibly more compact and don't crowd out the posts.

### B8. No way to "Create" on a character's NoodleR profile; unify persona + character
**Symptom:** You can create/use NoodleR create tools on a persona profile but not on a character's NoodleR profile. They should work identically — all the settings/toggles usable for both.
**Cause:** The underlying mutation is generic — `createPrivateStageAccount` / `useCreatePrivateNoodleAccount` take any `publicAccountId` (`NoodleView.tsx:1317–1340`), so the server side already supports characters. But the create entry point is only surfaced for personas: `showNoodlerSignup = activeNoodleMode === "noodler" && !viewedProfileAccountId && !personaLinkedNoodlerAccount` (`:5948`) and `onStartStageDraft` calls `openPrivateStageSetup(personaAccount)` (`:5951`) — persona-scoped. Character public accounts never reach the create flow or the creator tools.
**Fix:**
- Surface the "Your page" / create-NoodleR-profile affordance on **character** public profiles too, wiring `createPrivateStageAccount` with the character's `publicAccountId`.
- Make the creator-tools panel (B7) render on character NoodleR profiles with the same toggles (stage profile, pricing, fan activity, posting mode) as personas.
- Confirm downstream (fan activity scheduler, posting) treats character-owned private pages the same as persona-owned ones.
**Manual verify:** From a character profile, create a NoodleR page, then open it and confirm every creator tool/toggle present on a persona page is present and functional.

---

## Group C — Both sides (settings + shared)

### C1. Merge the two settings screens into one, sectioned settings
**Symptom:** Noodle and NoodleR have separate settings screens ("separated settings is dumb"). Put all Noodle + NoodleR settings in one screen, organized into sections like elsewhere.
**Cause:** Two independent blocks: `settingsContent` (`NoodleView.tsx:3095`, Noodle) and `noodlerSettingsContent` (`:3893`, NoodleR), chosen at render by `activeNoodleMode === "noodler" ? noodlerSettingsContent : settingsContent` (`:6453`). There's also duplicated "NoodleR Access" (`:3524` and `:3895`) and "Allow global feed persona" toggles across both.
**Fix:**
- Build a single settings body that renders **all** sections, de-duplicating the "NoodleR Access" / "Allow global feed persona" toggles (keep one copy).
- Keep the existing `<Section>` grouping pattern (`Section` / `ToggleSetting` / `FieldLabel` already used throughout) so it matches the rest of the app.
- Gate the NoodleR-only sections on `isNoodlerEnabled` (see C2) rather than on which mode you entered from.
- Update the render at `:6453` to use the single body; retire `noodlerSettingsContent` (or fold it in).

### C2. Settings theming + conditional NoodleR sections (don't flip theme by entry mode)
**Symptom:** Today the settings screen re-themes based on the mode you entered from. Desired:
- Open Settings with NoodleR **disabled** → settings button/screen shows **blue** (Noodle) and NoodleR-related settings are **hidden**.
- NoodleR **enabled** → settings menu button is **half blue / half pink**, and NoodleR settings are **unhidden**.
- Don't switch the whole screen to the NoodleR theme just because you were in NoodleR mode.
**Cause:** Accent is driven by `activeNoodleMode` via `--noodle-blue` (`NoodleView.tsx:5971`, `6008`); settings inherits that, so entering settings from NoodleR mode paints it pink.
**Fix:**
- Decouple the settings screen accent from `activeNoodleMode`. Base settings theme = blue.
- Drive NoodleR-section visibility off `isNoodlerEnabled`, not the entry mode.
- Settings nav button (`activeNoodleView === "settings"` highlight at `NoodleView.tsx:6281`): render a half-blue/half-pink treatment when `isNoodlerEnabled`, plain blue when not. Use `NOODLE_BLUE` / `NOODLER_BLUE` tokens for the split (e.g. a gradient/two-tone icon or background).
**Manual verify:** NoodleR off → settings is blue, no NoodleR sections, settings button plain blue. Turn NoodleR on → NoodleR sections appear, settings button goes half-blue/half-pink, and the accent doesn't fully flip to pink when you enter from NoodleR mode.

### C3. Make the Noodle↔NoodleR toggle smaller
**Symptom:** "Make the noodle/noodler toggle smaller."
**Cause:** `NoodleModeSwitcher` (`noodle-shared.tsx:329–369`) uses `min-h-9`, `gap-1.5`, `px-2`, `text-xs`, `size={14}` icons.
**Fix:** Reduce to a more compact control (smaller min-height, tighter padding, smaller/optional label or icon-only). Keep it accessible (`aria-pressed`, hit target ≥ the a11y minimum — don't shrink the tap target below ~32px even if visuals are denser). This affects both render sites via the shared component.
**Manual verify:** Switcher is visibly smaller in desktop sidebar and mobile drawer; still keyboard/pointer usable.

---

### C4. Let characters invoke Noodle/NoodleR create & post in-character during RP/convo
**Decision (maintainer):** **Yes** — characters should be able to use the Noodle and NoodleR create/post functions themselves, in-character, during roleplay and conversations.

**Scope note:** This is distinct from B8. B8 is the *user-facing profile* create surface; C4 is the *character/agent* invoking create/post on its own during RP.
**Relevant code:** in-character posting already partly exists — `lib/slash-commands.ts`, and commits `e47c9fca` ("Add in-character Noodle and NoodleR posting for roleplay"), `7fd596cc` (posting mode), `f2c9102f` (`private_identity` response format for noodle generation).
**Fix:**
- Start by auditing what `e47c9fca` already wired up — in-character posting exists, so establish the gap between "character can post" and "character can *create* / use the full create functions" before building anything.
- Extend the in-character path so characters can invoke the create/post functions for both Noodle and NoodleR, consistent with B8 (character-owned NoodleR pages must exist for a character to post to one).
- Respect existing gates: `postingMode` (passive = never posts), NoodleR enablement, and the B1 automatic-posting toggle. A character acting in-character should not bypass a user's off switches.
- Keep the private-identity disclosure rules (`open`/`hinted`/`secret`) intact — an in-character NoodleR post must honor the stage profile's `identityDisclosure`, and must not leak the linked account when set to `secret`.
**Manual verify:** In an RP/conversation, have a character create/post to Noodle and to NoodleR; confirm the post lands on the right account, honors posting mode + disclosure settings, and that a passive/disabled account produces no post.
**Sizing:** This is the largest and least-specified item. It is reasonable to land Groups A/B/C1–C3 first and do C4 as a **follow-up PR** — flag to the maintainer if it balloons.

---

## Resolved decisions (asked & answered)

| Item | Decision |
|---|---|
| B1 refresh | Generate NoodleR posts, but **only** for profiles with automatic posting enabled — **that setting doesn't exist yet and must be added**. |
| B3 toast | Drop the joke. Use "Verification complete — welcome to NoodleR. Start by creating a NoodlerID." |
| C4 RP create | **Yes** — characters can use Noodle/NoodleR create functions in-character. |
| B2 privacy | Fix **in this pass**, as its own reviewable commit, flagged as a security fix. |

## Suggested sequencing

1. A1 + C3 (small, isolated shared-component changes).
2. **B2** early — it's the security fix; land it as its own commit rather than letting it trail the UI polish.
3. C1 + C2 (settings unification + theming — biggest UI refactor; do together).
4. **B1** — add the per-profile automatic-posting setting (server + `pnpm db:push`), then rewire the refresh button. Landing the setting before C1/C2 finalize is fine, but the new toggle must end up inside the unified settings from C1 and be gated per C2.
5. B4, B5, B6 (NoodleR hub/profile UI polish).
6. B7 + B8 together (compact, reusable creator tools across persona + character).
7. B3 (trivial copy change; can go any time).
8. C4 last, or as a follow-up PR — largest scope, depends on B8.

**Cross-item watch-outs:**
- B1's new toggle, C1's settings merge, and C2's `isNoodlerEnabled` gating all touch the same settings surface — whoever does C1 should know B1 is adding a field.
- B7 and B8 both touch the creator-tools panel; do them together to avoid restyling twice.
- B1 and C4 both gate on posting settings — keep the gate logic in one place.

## Process reminders (from CLAUDE.md / CONTRIBUTING.md)

- Target **`staging`**, not `main`.
- Before starting, check for an existing issue-linked branch / open or draft PR / board item so agents don't duplicate work; open a **draft PR** as soon as implementation starts and tag the issue owner.
- If no linked issue exists, note that one should be opened first.
- Run `pnpm check` before pushing. Leave all PR test-plan checkboxes **unchecked** and write manual-verify entries as "Manually verify X …".
- Make the *why* explicit in the PR description (these are user-reported bugs — reference the report).
- Client code keeps `console.*`; no Pino in the browser.
