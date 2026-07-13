# Plan 3 — NoodleR private accounts

## Goal

Let a persona or character have a separate, linked, hidden account (NoodleR) whose posts
never appear in the normal feed/switcher/search — reachable only via a direct link from
the linked public profile. Builds on Plan 2's access/subscribe/unlock system for gating
the private account's own posts.

## Why

Unlike NoodleGram (a lens) or the access system (a mechanic usable anywhere), the actual
"keep it secret" behavior people associate with an OnlyFans-style account requires a
genuinely separate, non-discoverable account — not a mode flag on the existing public
one. This is scoped last because it depends on Plan 2 already existing.

## Data model

`packages/server/src/db/schema/noodle.ts` — `noodleAccounts`:

- `visibility: text("visibility").notNull().default("public")` — `"public" | "private"`.
- `linkedAccountId: text("linked_account_id")` — nullable, self-referencing to another
  `noodleAccounts.id`.
- unique index on `linkedAccountId` (1:1 — one private account per public account, no
  multiple secret personas in v1).

`packages/shared/src/types/noodle.ts` — add both fields to `NoodleAccount`.

Restrict creation to `kind IN ("persona", "character")` — `random_user` accounts never
get a linked private account (no owner to manage one, and they already get to use
`ppv`/bait posts directly on their public account per Plan 2).

## Server

- `packages/server/src/services/storage/noodle.storage.ts`:
  - Feed/timeline queries filter to `visibility = "public"` by default (unchanged
    accounts keep working exactly as today, since default is `"public"`).
  - Account switcher / search / mention-autocomplete queries get the same filter.
  - A new query path serves a private account's own posts, used only by the dedicated
    private-profile route.
  - **Write-time guard**: reject creating a post/interaction where `quotePostId` or
    `parentPostId` references a post authored by a `visibility = "private"` account, if
    the new post's author is `visibility = "public"`. Public → private references are
    blocked; private → public is fine (a private account can comment on public content).
  - Extend the existing character/persona deletion path (wherever a `noodleAccounts` row
    tied to a deleted entity is cleaned up today) to also delete the row pointed to by
    `linkedAccountId` — cascade, don't leave an orphaned private account.
  - `services/noodle/*` refresh scheduler / participant selection: exclude
    `visibility = "private"` accounts from auto-generation entirely — these accounts are
    manual-post-only. Also exclude their posts as valid AI-generated reply/quote targets
    for public accounts (belt-and-suspenders with the write-time guard above).
- `packages/server/src/routes/noodle.routes.ts`:
  - `POST /noodle/accounts/:id/private` — creates the linked private account (only for
    `persona`/`character` kinds, only if `linkedAccountId` is currently null). Triggers
    the same one-shot AI profile generation used for character accounts today
    (`noodle-generated-profiles.ts`), since private accounts don't go through the
    scheduler that would otherwise generate a profile on first refresh.
  - Relationship to a NoodleR account is `subscribe` (Plan 2), not `follow` — don't wire
    up the normal follow graph for `visibility = "private"` accounts, to avoid two
    overlapping relationship types on the same account.

## Client

- `NoodleView.tsx`:
  - Public profile: if `linkedAccountId` is null and the NoodleR feature is enabled,
    show a "Create private account" action. If set, show a small lock icon / "View
    private" link instead — this is the only entry point into the private profile.
  - Private profile view: same post rendering as a normal profile, but pulls from the
    private-only query path; composer here can set `access` per Plan 2 without
    restriction (this is the account type Plan 2's access levels were ultimately
    designed for).
  - Private accounts never appear in the main feed, the account switcher's default list,
    or mention/search autocomplete.

## Out of scope

- No converting an existing account's visibility after creation (fixed at creation
  time).
- No multiple private accounts per public account (1:1 only).
- No real access control against other humans — this app is single-user/self-hosted, so
  "private" means UI-hidden from the aggregated feed, not authenticated/secured. If the
  app ever grows real multi-user auth, this needs revisiting.

## Manual verification (unchecked)

- [ ] Creating a private account for a persona only shows the option once; it's replaced
      by "View private" afterward.
- [ ] Private account's posts never appear in Main/Following, search, or the account
      switcher.
- [ ] Deleting the persona/character also removes its linked private account.
- [ ] A public account's post cannot quote or reply to a private account's post (blocked
      server-side, verify via direct API call, not just UI).
- [ ] A private account's post can quote/reply to a public post without issue.
- [ ] The refresh scheduler never generates a post for a private account, and never
      selects one of its posts as a reply/quote target for a public account's generated
      post.
- [ ] Subscribing to a NoodleR account unlocks its `subscriber`/`ppv` posts per Plan 2;
      there is no separate "follow" button on a private account's profile.
