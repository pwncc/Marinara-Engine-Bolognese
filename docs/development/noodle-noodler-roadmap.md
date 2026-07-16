# Noodle and NoodleR Role Separation Roadmap

Status: Proposed, implementation-ready after maintainer approval

Audience: Product, design, and Marinara Engine contributors

Companion specifications:

- [Timeline and Viewer Isolation](noodle-noodler-timeline-isolation.md)
- [Automatic Creator Posting](noodler-automatic-posting.md)
- [Creator Projects and Posting Plans](noodler-creator-projects.md)

## Summary

Make Noodle and NoodleR feel like two coherent fictional products inside a single-player roleplaying engine.

- **Noodle** is the public social timeline.
- **NoodleR** is a separate private creator platform.
- The selected persona is the current fictional viewer and controls subscriptions, unlocks, hidden pages, and viewer-facing feeds.
- The human user is the director and may manage or manually post for any character-owned creator page.
- Public and private posts must not cross feeds, prompts, memories, notifications, or generated interactions.
- NoodleR characters may post automatically through an understandable global schedule and per-page eligibility controls.
- Creator projects let the user guide a character through an evolving posting arc without scripting every post.

This is a role-separation project, not a security-hardening project. Marinara remains a local, single-user application. The implementation should enforce the intended fictional perspective in normal product flows without adding authentication, protected media delivery, or adversarial local API defenses.

## Product model

### The three roles

| Role | Meaning | Authority |
| --- | --- | --- |
| Public account | A character or persona as seen on Noodle | Owns public posts and public interactions |
| Private creator account | The linked stage identity seen on NoodleR | Owns NoodleR posts, creator settings, and projects |
| Selected persona | The fictional viewer currently browsing either product | Determines follows, subscriptions, unlocks, hidden pages, and notifications |

The human user sits above these roles as director. Director actions are explicit management actions, not viewer permissions.

### Surface boundary

Every activity belongs to exactly one surface:

```text
Noodle public surface                         NoodleR private surface
---------------------                         -----------------------
public account                                private creator account
public posts and polls                        creator posts and polls
public replies, likes, reposts, follows       fan replies, likes, subscriptions, unlocks
public timeline generation                    single-creator generation
public history and memory                     that creator's private history
```

Linked accounts may share underlying character identity, appearance, lore, and deliberately attached chat context. They do not share posts, interaction history, stage details, prompt memories, or notifications.

### Viewer and director behavior

Viewer-facing behavior follows the selected persona:

- Noodle posts, likes, replies, follows, and notifications use the selected persona's public account.
- NoodleR Discover hides pages hidden from that persona.
- NoodleR Subscriptions shows creators followed by that persona.
- Subscriber and PPV presentation follows that persona's subscriptions and unlocks.
- Switching persona immediately switches the viewer projection.

Director-facing behavior remains globally available:

- Character-owned NoodleR pages remain editable.
- The user may manually post for any creator page.
- The user may configure automatic posting and creator projects for any page.
- Creator management should be labelled **Creator Pages**, not phrased as if every page belongs to the selected persona.

## Product decisions

1. Noodle and NoodleR remain in shared low-level storage, but every read and generation path must declare its surface.
2. The selected persona scopes viewer-facing cache and feed state.
3. The human user can manage all character creator pages without an omniscient feed mode.
4. Manual posting, guided AI posting, automatic creator posting, and fan activity are distinct actions with distinct gates.
5. Public generation never receives private post history, replies, images, stage details, or projects.
6. Private generation receives only the target creator's NoodleR history.
7. Relevant opted-in chat context may influence private generation, but unrelated participants and status data must not become author identity.
8. NoodleR automatic creator posting uses one global daily schedule and weighted per-page selection. It must not multiply the total daily volume by the number of enabled pages.
9. Fan activity remains independently scheduled and never creates creator posts.
10. Creator projects guide future generation; they do not pre-generate an immutable queue of final post text.
11. Project context is attached deliberately. NoodleR does not continuously scrape all chats.
12. Existing data should be classified by its author account visibility. A schema migration adding an immutable post surface is deferred unless implementation proves classification is too fragile.
13. No authentication, signed media URLs, encrypted local content, or developer-tools resistance is in scope.

## Posting behavior matrix

| Action | Explicit user action | Requires NoodleR enabled | Requires Active page | Requires page auto-post enabled | Requires global auto-post schedule | Requires fan scheduler |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Manual creator composer | Yes | Yes | No | No | No | No |
| Conversation `/noodler` command | Yes | Yes | No | No | No | No |
| Guided AI creator post | Yes | Yes | Yes | No | No | No |
| Generate next project post | Yes | Yes | Yes | No | No | No |
| Refresh all eligible creator pages | Yes | Yes | Yes | Yes | No | No |
| Unattended creator post | No | Yes | Yes | Yes | Yes | No |
| Simulate fan activity now | Yes | Yes | No | No | No | Page fan activity only |
| Unattended fan activity | No | Yes | No | No | No | Global and page fan scheduling |

## Target user experience

### Public Noodle

- Main and Following show public posts only.
- Profiles, Likes, Media, Search, and Notifications use public activity only.
- Refresh now and scheduled refreshes operate only on public accounts and public history.
- Public chat carryover uses public digests only.

### NoodleR viewer experience

- Timeline shows NoodleR activity visible to the selected persona.
- Subscriptions shows posts from creators subscribed to by the selected persona.
- Discover shows non-hidden creator profiles and suitable preview presentation.
- PPV and subscriber presentation follows the selected persona's fictional access state.
- Switching personas updates all viewer-facing sections immediately.

### NoodleR creator experience

- Creator Pages lists all persona and character creator pages manageable by the director.
- Each row shows Active or Passive, automatic-post eligibility, active project, and next planned post.
- Detailed page settings control stage identity, visibility, fan activity, and automatic posting.
- Manual posting remains available on Passive pages.
- Guided and project generation explain why they are unavailable on Passive pages.

### Conversation integration

For a character with a NoodleR page, Conversation Chat Settings gains a compact NoodleR Posting section:

- Automatic-post status.
- Active project.
- Next planned post.
- Add project idea.
- Plan one post.
- Open creator schedule.

A chat message action may explicitly attach that message to a creator project. Nothing is attached automatically.

## Architecture direction

### Surface-aware reads

Introduce explicit read contracts rather than relying on every caller to remember an ad hoc visibility filter.

Candidate concepts:

```ts
type NoodleSurface = "public" | "private";

listSurfacePosts({ surface: "public", since, before, limit })
listCreatorPosts({ creatorAccountId, since, before, limit })
listSurfaceInteractions({ surface, postIds })
```

Exact names may follow existing storage conventions. The important rule is that prompt, feed, pagination, digest, and notification callers state which surface they are reading.

### Viewer projection

Keep the full local model available to director tools, but build viewer-facing responses and client caches from an explicit `viewerPersonaId`.

```text
shared local state
       + selected persona
               ↓
viewer projection: subscriptions, unlocks, hidden pages, notifications
```

### Scheduler ownership

Use separate services and state domains:

- Public Noodle refresh scheduler.
- NoodleR creator-post scheduler.
- NoodleR fan-activity scheduler.

They may share timing utilities and account locks, but no scheduler's master switch or persisted timestamp should control another scheduler.

### Project ownership

Projects belong to a private creator account, not the linked character entity in general. This prevents a project from entering the linked public account or another stage identity.

```text
private creator account
  └── project
      ├── brief and influence mode
      ├── milestones
      ├── deliberately attached context
      └── generated post history
```

## Multi-step implementation plan

### Phase 0: Baseline proof and terminology

Goal: lock down current behavior before changing shared prompt and storage paths.

1. Add regression fixtures containing one linked public account and private creator account for the same character.
2. Add clearly distinguishable public and private posts, replies, images, polls, subscriptions, and unlocks.
3. Capture failing negative controls showing private history in a public refresh prompt and older-post pagination.
4. Document the four posting action types in code comments and shared naming.
5. Confirm UI terminology: Noodle, NoodleR, Creator Pages, Automatic creator posts, Fan activity, and Projects.

Exit criteria:

- The current leaks are reproducible in deterministic regression scripts.
- Each subsequent phase can prove both positive inclusion and negative exclusion.

### Phase 1: Timeline and prompt isolation

Goal: no activity crosses between Noodle and NoodleR in normal feeds or model context.

1. Add surface-aware storage query helpers.
2. Use public-only posts and replies in public prompt history and recalled memory.
3. Use public-only images for public vision context and image captions.
4. Ignore private activity when prioritizing public refresh participants.
5. Restrict public generated interaction targets to public posts.
6. Keep private single-account generation restricted to that creator's private posts and interactions.
7. Filter public feed profiles, likes, media, search, and notifications consistently.
8. Filter NoodleR views to private creator posts and fan activity consistently.
9. Apply equivalent surface filters to older-post pagination.
10. Keep public chat carryover free of private digests, including updated or legacy mixed digests.

Exit criteria:

- Public prompts contain no private text, handles, stage details, image prompts, or image attachments.
- Private prompts contain no public timeline history unless a future explicit feature adds a bounded reference.
- Feed and pagination results agree on surface.

Detailed requirements: [Timeline and Viewer Isolation](noodle-noodler-timeline-isolation.md).

### Phase 2: Viewer persona consistency

Goal: switching role changes the fictional viewer everywhere without changing director authority.

1. Include `viewerPersonaId` in Noodle bootstrap and pagination query keys.
2. Cancel or isolate in-flight viewer queries during persona switches.
3. Derive NoodleR subscriptions, unlocks, hidden pages, and notifications from the selected persona.
4. Ensure mutations invalidate the correct viewer-specific and director-level caches.
5. Rename **Your Pages** to **Creator Pages** and explain its director scope.
6. Keep character creator editing available regardless of selected persona.
7. Verify mobile navigation and persona switching have the same projection rules.

Exit criteria:

- No stale previous-persona NoodleR state flashes after a switch.
- Creator management remains available without pretending the selected persona owns every page.

### Phase 3: Posting semantics cleanup

Goal: every posting entrypoint follows the behavior matrix.

1. Split account resolution from automatic-post eligibility checks.
2. Make explicit manual composer posts require only NoodleR enabled and a valid private account.
3. Make `/noodler` follow the same manual rule.
4. Keep guided AI generation restricted to Active pages, but independent of auto-post settings.
5. Keep bulk NoodleR refresh restricted to Active, auto-post-enabled pages.
6. Add clear errors for disabled NoodleR, Passive pages, missing connections, and concurrent generation.
7. Add route-level NoodleR enable checks for normal product consistency.
8. Preserve one-account refresh locking for private generation.

Exit criteria:

- Manual, guided, bulk, and unattended paths have independent regression rows.
- A Passive page can be posted to manually but never generates automatically.

### Phase 4: Global automatic creator-post schedule

Goal: offer Noodle-like scheduling for NoodleR without per-page volume explosion.

1. Add global Automatic creator posts enablement and posts-per-day setting.
2. Preserve per-page Include in automatic posting, Active/Passive, and Low/Medium/High weight.
3. Build daily schedule slots using the established Noodle timezone and rescheduling behavior where practical.
4. At each due slot, select one eligible page using weighted fairness and recent-run history.
5. Show planned times, selected creator when known, next run, completion, retry, and error state.
6. Keep manual **Refresh eligible pages** separate from unattended daily slots.
7. Move creator-post scheduling out of the fan-activity scheduler.
8. Ensure fan and creator scheduling updates merge against fresh account/settings state.
9. Apply catch-up behavior that creates at most one post after downtime instead of flooding.
10. Log prompts and operational results through the shared logger.

Exit criteria:

- Global posts per day is a total ceiling across all creator pages.
- Disabling fan activity does not stop automatic creator posts.
- Disabling NoodleR stops all NoodleR unattended work.

Detailed requirements: [Automatic Creator Posting](noodler-automatic-posting.md).

### Phase 5: Creator projects foundation

Goal: let the user give one creator an ongoing content direction.

1. Add creator-owned project and milestone contracts.
2. Add Draft, Active, Paused, Completed, and Archived project states.
3. Add Loose, Balanced, and Focused influence modes.
4. Add ordered milestones with optional due time, access, and media preference.
5. Add project create/edit/reorder/pause/complete/archive APIs.
6. Build a Creator Projects workspace on each NoodleR page.
7. Add **Generate next**, **Skip**, **Pause**, and **Complete** actions.
8. Store generated post IDs and a bounded completion summary against milestones.
9. Inject only the target creator's active project and relevant milestone into its private prompt.
10. Ensure projects never enter public prompts or another creator's private prompt.

Exit criteria:

- A project can drive a coherent multi-post arc without repeating completed milestones.
- Organic posting still works when no project work is due.

Detailed requirements: [Creator Projects and Posting Plans](noodler-creator-projects.md).

### Phase 6: Project-aware scheduling

Goal: make automatic posts advance deliberate plans while retaining character spontaneity.

1. Add scheduler priority for specifically due milestones.
2. Select due cadence-based project milestones before organic posts.
3. Fall back to organic generation when no project work is due and the page is eligible.
4. Respect global daily post limits even when several projects are due.
5. Show delayed milestones when available daily slots are exhausted.
6. Prevent one creator with many projects from starving other eligible creators indefinitely.
7. Add per-project cadence and optional weekday/time windows.
8. Record why each automatic post was selected: fixed milestone, project cadence, or organic.

Exit criteria:

- Project schedules and global posting limits have deterministic precedence.
- Paused and completed projects cannot generate posts.

### Phase 7: Conversation integration

Goal: let roleplay events deliberately influence creator plans.

1. Add compact NoodleR Posting controls to Conversation Chat Settings.
2. Show each character's page status, active project, and next planned post.
3. Add **Create project**, **Add project idea**, and **Plan post** actions.
4. Add a message action to attach a selected message to a project.
5. Store an immutable excerpt with speaker, chat, message ID, and attachment time.
6. Do not automatically stream future chat messages into projects.
7. Scope private prompt chat context to exchanges relevant to the target creator.
8. Label speakers and omit unrelated character sheets and statuses.
9. Keep Conversation presence schedules separate from NoodleR posting schedules.
10. Optionally read current Conversation activity as bounded generation context when the source chat opted into Noodle references.

Exit criteria:

- The user can turn a roleplay event into a creator arc with an explicit action.
- Unattached chat content cannot enter a project prompt through project storage.

### Phase 8: Polish, documentation, and migration review

Goal: ship a coherent feature rather than disconnected controls.

1. Update Noodle overview and settings guides.
2. Add a dedicated NoodleR user guide covering viewer personas, creator pages, automation, and projects.
3. Update developer prompt internals with public/private prompt source maps.
4. Add empty, disabled, delayed, paused, and error states.
5. Validate desktop and mobile creator management.
6. Review existing stored posts and classify them from author visibility.
7. Decide whether an immutable `surface` field is needed based on implementation complexity and orphan handling.
8. Add cleanup for orphaned account activity where existing deletion paths leave ambiguous rows.
9. Run full prompt, Noodle, type, lint, build, and UI smoke validation.

Exit criteria:

- User documentation matches shipped controls.
- Existing timelines remain readable and correctly separated.

## Data and compatibility strategy

### Initial strategy

Avoid a schema migration in the first isolation patch. Classify posts through their author account:

- Public author account means Noodle.
- Private author account means NoodleR.
- Missing author accounts are excluded from generated prompt context until they can be classified safely.

This is the smallest compatible change for existing data.

### Migration trigger

Add an immutable post-level `surface` only if one of these becomes concrete:

- Account visibility can change after posts exist.
- Imports contain posts whose author account is missing.
- Query complexity or performance makes joins/classification impractical.
- Projects or future creator surfaces require durable provenance.

If added, derive the initial value from the author account, preserve it in author snapshots, and reject mismatched writes.

## Verification strategy

Prompt and scheduler work are risky boundaries. Every phase needs positive rows and negative controls.

### Required regression claims

- Public history is present in public prompts.
- Private history is absent from public prompts.
- Target creator history is present in its private prompt.
- Public and other-creator history is absent from a private prompt.
- Public vision inputs contain no private images.
- Public generated interactions cannot target private posts.
- Pagination never changes surface.
- Persona switching changes viewer subscriptions and unlocks without stale data.
- Manual `/noodler` works when auto-posting is off.
- Passive pages never generate guided or automatic posts.
- Creator auto-posting runs while fan activity is disabled.
- Global NoodleR daily rate is not multiplied by eligible creator count.
- Due project milestones precede organic posts.
- Paused, completed, and other-creator projects are absent from generation prompts.

### Validation commands

At minimum for implementation phases:

```bash
pnpm check
pnpm regression:prompt
pnpm regression:noodle
pnpm smoke:ui
```

Add focused regression scripts to `pnpm regression:noodle` rather than permanent `.test.ts` files.

## Non-goals

- Multi-user accounts or remote authorization.
- Preventing the local user from inspecting API responses or local storage.
- Protected or signed PPV media delivery.
- Real billing, payments, or entitlement enforcement.
- Automatically converting every chat event into social content.
- Sharing one project between multiple creators in the first version.
- Pre-generating an entire project's final post text.
- Replacing Conversation presence schedules.
- Letting fan activity generate creator-owned posts.
- Letting projects or private stage details influence public Noodle generation.

## Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Shared tables invite accidental cross-surface reads | Central surface-aware storage helpers and negative regressions |
| Many enabled pages create too much content | One global posts-per-day ceiling with weighted selection |
| Project posts become repetitive | Persist completed milestones and bounded summaries; generate one milestone at a time |
| Projects over-control character voice | Loose/Balanced/Focused influence modes and character profile precedence |
| Chat context blends identities | Explicit attachment, speaker labels, target-character scoping, bounded excerpts |
| Persona switching shows stale viewer state | Viewer-specific query keys and cancellation/invalidation rules |
| Scheduler state overwrites another scheduler | Separate state domains and fresh-state merges |
| Existing orphaned posts cannot be classified | Exclude from prompts and handle in migration/cleanup review |

## Definition of done

The roadmap is complete when:

1. Noodle and NoodleR feeds, prompts, memories, images, notifications, and interactions remain on their own surfaces.
2. Selected-persona viewing consistently controls fictional access without restricting director management.
3. Manual, guided, automatic, and fan posting behaviors match the documented matrix.
4. NoodleR has a visible global automatic creator-post schedule and per-page eligibility controls.
5. The global rate controls total creator-post volume across all enabled pages.
6. Creator projects can guide multi-post arcs, schedule milestones, and attach deliberate chat context.
7. Project and chat context cannot enter public Noodle or another creator's prompt.
8. Regression coverage proves the key positive and negative boundaries.
9. User and developer documentation describe the shipped behavior accurately.
