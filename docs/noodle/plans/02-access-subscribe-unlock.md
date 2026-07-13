# Plan 2 — Access / Subscribe / Unlock system

## Goal

Give any Noodle post an access level (`public` / `subscriber` / `ppv`), and give any
account a fake, local, no-currency subscribe/unlock relationship to other accounts. This
is the generic mechanism — it is not exclusive to NoodleR (Plan 3). A `random_user` bait
account posting `ppv` content in the open feed is just as valid a use as a real NoodleR
account doing it.

## Why

A flat `locked: boolean` (the original idea) can't express "subscribers see this for
free, everyone else has to unlock it," and can't express "subscribing should feel like
all-access." Modeling it as an access enum plus two join tables gets the real mechanic
(and the "subscribing bypasses PPV by default" rule, which is what keeps this from
feeling broken) for about the same amount of code, still fully fake/local — no pricing,
no currency, no billing.

## Data model

`packages/server/src/db/schema/noodle.ts`:

- `noodlePosts.access: text("access").notNull().default("public")` — one of
  `"public" | "subscriber" | "ppv"`.
- New table `noodleAccountSubscriptions`:
  - `id`, `subscriberAccountId`, `creatorAccountId`, `createdAt`
  - unique index on `(subscriberAccountId, creatorAccountId)`
- New table `noodlePostUnlocks`:
  - `id`, `accountId`, `postId`, `createdAt`
  - unique index on `(accountId, postId)`

`packages/shared/src/types/noodle.ts`:

- `NoodlePost.access: "public" | "subscriber" | "ppv"`
- `NoodleAccountSubscription { id; subscriberAccountId; creatorAccountId; createdAt }`
- `NoodlePostUnlock { id; accountId; postId; createdAt }`

`packages/shared/src/schemas/noodle.schema.ts`: zod schemas for the above, plus
composer-side validation that `access` may only be `subscriber`/`ppv` when the author
account allows it (see Plan 3 for how NoodleR accounts turn this on).

## Server

- `packages/server/src/services/storage/noodle.storage.ts`: CRUD for subscriptions and
  unlocks; a post-visibility resolver — given a viewer account + a post, resolve whether
  the image/content is revealed:
  - `access === "public"` → always revealed.
  - `access === "subscriber"` → revealed if viewer has an active subscription to the
    post's author, else blurred.
  - `access === "ppv"` → revealed if viewer is subscribed to the author (subscription
    bypasses PPV — this is the important rule) OR has an explicit unlock row for that
    post, else blurred.
- `packages/server/src/routes/noodle.routes.ts`: endpoints —
  - `POST /noodle/accounts/:id/subscribe` / `DELETE .../subscribe` (creates/removes a
    `noodleAccountSubscriptions` row — no payment, just the row)
  - `POST /noodle/posts/:id/unlock` (creates a `noodlePostUnlocks` row)
  - Composer endpoint accepts `access` on post creation.
- `services/noodle/*` generation logic: allow generated posts (including `random_user`
  bait accounts) to occasionally set `access: "ppv"` with bait-style caption text, for
  the "fun random accounts" flavor. This is the one piece that touches the AI
  prompt/generation layer rather than pure CRUD.

## Client

- `NoodleView.tsx`:
  - Composer: access-level selector (Public / Subscribers / Pay-per-post) — only shown
    for accounts where posting non-public content is enabled (see Plan 3; for a plain
    public/`random_user` account in v1 this can just always be available, since there's
    no gating requirement here, only in Plan 3's private-account layer).
  - Feed/profile rendering: blurred image + "Subscribe" or "Unlock" button per the
    resolver's verdict; clicking either just calls the corresponding endpoint and
    re-renders revealed.
  - No pricing UI, no currency display — buttons are unconditional actions.

## Out of scope (deliberately, per the "don't build tiers yet" call)

- No pricing/currency/credits.
- No tiered subscription levels.
- No `premiumPpv`/tip-unlock concept — flagged as a later addition only if needed.

## Manual verification (unchecked)

- [ ] Create a `subscriber`-access post; as a non-subscribed viewer it renders blurred
      with a Subscribe button.
- [ ] Subscribe; the same post (and any other subscriber-access post from that account)
      renders unlocked without individually unlocking each one.
- [ ] Create a `ppv`-access post as a subscribed-to account; a subscribed viewer sees it
      unlocked automatically (no PPV prompt).
- [ ] As a non-subscribed viewer, a `ppv` post is blurred with an Unlock button; clicking
      it reveals just that post and persists across reload.
- [ ] A `random_user` account can post `ppv` content in the normal public feed with bait
      caption text, unrelated to any NoodleR private account.
