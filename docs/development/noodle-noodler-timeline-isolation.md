# Noodle and NoodleR Timeline and Viewer Isolation

Status: Proposed

Parent roadmap: [Noodle and NoodleR Role Separation Roadmap](noodle-noodler-roadmap.md)

## Purpose

Keep the fictional public and private platforms separate while preserving Marinara's single-player director model.

The requirement is not secrecy from the local user. The requirement is that the app shows and generates the right activity for the selected fictional role:

- Public Noodle must not contain or learn from NoodleR posts.
- NoodleR must not present public posts as creator content.
- One creator's private generation must not learn from another creator's private history.
- Persona switching must change viewer-facing subscriptions, unlocks, hidden pages, and notifications.
- Director tools may still manage every character creator page.

## Current boundary problem

Noodle and NoodleR share accounts, posts, interactions, digests, subscriptions, unlocks, and refresh runs. Accounts carry `visibility`, while posts do not carry an immutable surface. Generic post queries therefore return both surfaces unless each caller filters them.

Known affected paths include:

- Public recent and recalled prompt history.
- Public prompt image candidates.
- Public participant priority calculation.
- Existing targets for generated interactions.
- Older-post pagination.
- Some profile, notification, and cache selectors.
- Digest update and legacy carryover paths.

Private single-account generation already filters recent posts to the target account. That behavior should become the explicit contract rather than a special-case filter after a global query.

## Canonical rules

### Public Noodle reads

Public reads include only posts whose author is a public account.

For an interaction to appear in public Noodle:

- Its target post must be public.
- Its actor must be valid for the public interaction type.
- A private creator actor must never appear as a public actor.

Public account profiles may share underlying character identity with private pages, but public profile tabs use public posts and public interactions only.

### Private NoodleR reads

NoodleR reads include only posts whose author is a private creator account.

For an interaction to appear as NoodleR fan activity:

- Its target post must belong to a private creator.
- Its actor may be an eligible public persona, character, or filler account according to NoodleR fan rules.
- The interaction remains private-surface activity because its target post is private.

NoodleR feed grouping is viewer-specific, but creator management is director-level.

### Prompt reads

| Generation | Allowed history | Forbidden history |
| --- | --- | --- |
| Public Noodle batch | Public posts, public replies, public images | All private posts, stage profiles, projects, subscriptions, unlocks |
| Private creator post | Target creator's private posts and fan replies | Public timeline, other private creators, unrelated projects |
| Public image generation | Current generated public post plus public references | Private images and stage appearance overrides |
| Private image generation | Current private draft, linked identity, private stage settings | Other creators and unrelated public identities |

### Chat carryover

Noodle activity inserted into chat prompts is public activity only. NoodleR posts and fan activity do not enter chats through the existing Noodle carryover setting.

A future explicit NoodleR chat reference feature would need a separate opt-in and is not part of this plan.

## Viewer projection

### Selected persona

The selected persona determines:

- Public Noodle authorship and interactions.
- Public Following and Notifications.
- NoodleR subscriptions.
- NoodleR PPV unlock presentation.
- NoodleR hidden-page filtering.
- Persona-owned NoodleR page identity.

It does not determine whether the human director can edit a character creator page.

### NoodleR sections

| Section | Projection |
| --- | --- |
| Timeline | Private creator activity visible to the selected persona |
| Subscriptions | Posts from creators subscribed to by the selected persona |
| Discover | Non-hidden creator profiles and preview presentation |
| Creator Pages | All persona and character pages manageable by the director |

### Cache rules

Viewer-specific query keys must include `viewerPersonaId`:

```ts
noodleKeys.bootstrap(viewerPersonaId)
noodleKeys.posts(viewerPersonaId, surface, cursor)
noodlerKeys.hub(viewerPersonaId)
```

Exact key names may differ. Requirements:

1. Switching viewer never reuses another viewer's bootstrap as current data.
2. In-flight requests for an old viewer cannot overwrite the new viewer's visible state.
3. Director-level creator data uses a separate query or clearly separate cache key.
4. Mutations invalidate all affected viewer projections when necessary.

## Storage and service changes

### Step 1: Central classification

Add one shared classifier that resolves a post's surface from its author account.

Behavior for missing authors:

- Exclude the post from generation prompts.
- Exclude it from surface-specific viewer feeds unless a preserved snapshot gains a reliable surface field later.
- Do not guess from `access`, because a public-access NoodleR post is still a NoodleR post.

### Step 2: Surface-aware queries

Add storage or service helpers for:

- Recent public posts.
- Public posts before a cursor or cutoff.
- Posts for one private creator.
- Interactions for surface-filtered post IDs.
- Public digests.

Prefer filtering close to storage rather than loading all rows into every route. Preserve existing generic methods only where callers genuinely need director-level shared data.

### Step 3: Public generation

Update `buildRefreshPrompt()` and refresh participant selection:

1. Query recent public posts only.
2. Query public posts for recalled memory only.
3. Load interactions only for those public post IDs.
4. Build vision candidates only from those public posts and replies.
5. Calculate active-account priority only from public activity.
6. Build allowed existing interaction targets only from public posts.
7. Ensure corrective retry prompts do not expose private handles through known-target lists.
8. Persist generated activity only for selected public accounts.

### Step 4: Private generation

Update the private target path:

1. Query only posts authored by the exact private target account.
2. Load fan interactions only for those posts.
3. Do not sample global recalled memory.
4. Include only the target creator's active project when project support lands.
5. Keep the linked identity and private stage profile separate and clearly labelled.
6. Reject generated authors or interactions outside the target creator and eligible fan actors.
7. Never create a digest consumed by public chat carryover.

### Step 5: Feed and pagination

Make initial bootstrap and older-page requests agree:

- Public feed pagination requests `surface=public` or uses a public endpoint.
- NoodleR creator pagination requests a private surface and viewer persona.
- Profile Posts, Likes, and Media apply the account's surface.
- Public notifications ignore private target posts and private author accounts.
- NoodleR activity cards ignore public target posts.
- Search results may discover both account types only in their corresponding product UI.

Do not append unscoped pages into a shared bootstrap list.

### Step 6: Digests

Enforce the public-only carryover rule in all write and read paths:

1. Digest creation rejects private account participation.
2. Digest updates repeat the same validation.
3. Digest reads used for chat carryover exclude any digest containing private accounts.
4. Legacy mixed digests are ignored rather than partially projected.
5. Private post and fan activity creation should not create public carryover digests.

## Chat context for private generation

Private creator generation may use opted-in chat context, but only as bounded source material.

### Relevance rules

- Include chats that opted into Noodle references and contain the target character.
- Prefer messages authored by the target character and directly adjacent messages needed to understand the exchange.
- Include user or other-character messages only when they form part of that relevant exchange.
- Omit unrelated character sheets, unrelated statuses, and unrelated messages.
- Label every excerpt with speaker and chat.
- Keep the target creator clearly identified as the only author.

### Persona-linked creators

Persona-linked creator generation continues to omit ambient chat context unless the user deliberately attaches a message to a creator project in a later phase.

### Project attachments

When projects land, deliberately attached excerpts are separate from ambient opted-in context. They carry stable attribution and are included only for their owning creator and project.

## UI behavior

### Switching persona

- Replace the viewer projection immediately with loading or cached data for the selected persona.
- Do not show the old persona's subscriptions or unlocks while fetching.
- Keep Creator Pages stable because it is director-level.
- Recompute public notifications and Following for the new persona.

### Locked NoodleR presentation

Because Marinara is single-player, normal API payload redaction is not required for this roadmap. The UI must still maintain the fiction:

- Subscriber presentation unlocks after the selected persona subscribes.
- PPV presentation unlocks after that persona unlocks the post.
- Switching persona can lock the same post again for the new viewer.
- Discover should not accidentally render full locked content in secondary cards.

### Terminology

- Use **Creator Pages** for director management.
- Use **Your NoodleR Page** only for the selected persona's own page.
- Use **Subscriptions** for the selected persona's subscribed feed.
- Avoid security language such as authorization or ownership in user-facing copy.

## Regression plan

Build fixtures with:

- Public character account `A-public`.
- Linked private creator `A-private`.
- Another public character `B-public`.
- Another private creator `B-private`.
- Viewer personas `P1` and `P2` with different subscriptions and unlocks.
- Distinctive marker strings and images for every surface.

Required assertions:

1. Public prompt contains `A-public` history.
2. Public prompt contains no `A-private` or `B-private` markers.
3. Public vision candidates contain no private image keys.
4. Public recalled memory contains no private posts.
5. Public priority IDs are unchanged by private-only activity.
6. Public generated interactions reject private target post IDs.
7. `A-private` prompt contains its own private history.
8. `A-private` prompt contains no `A-public` or `B-private` history.
9. Public older pagination contains public rows only.
10. NoodleR older pagination contains private rows appropriate to its view.
11. P1 and P2 bootstrap projections differ according to subscriptions and unlocks.
12. Switching query keys cannot install P1 data as P2 data.
13. Public notifications ignore private mentions and replies.
14. Mixed public/private digests are absent from chat carryover.
15. Private context includes a relevant labelled exchange but omits unrelated participant profiles and statuses.

## Acceptance criteria

- No private marker appears in a captured public model prompt or image manifest.
- No public or other-private marker appears in a captured single-creator prompt.
- Public and private feeds remain separated through pagination and profile tabs.
- Generated public activity cannot target a private post.
- Selected-persona switching updates viewer-facing state without stale-role display.
- Creator Pages remains available as a director tool.
- Existing public chat carryover contains no NoodleR activity.
- Regression scripts cover both allowed inclusion and forbidden exclusion.

## Deferred work

- Authentication or API authorization.
- Server-side PPV content redaction.
- Signed or protected image URLs.
- Immutable post surface migration unless classification proves insufficient.
- Private NoodleR activity flowing back into chats.
