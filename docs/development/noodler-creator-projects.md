# NoodleR Creator Projects and Posting Plans

Status: Proposed

Parent roadmap: [Noodle and NoodleR Role Separation Roadmap](noodle-noodler-roadmap.md)

Scheduler specification: [Automatic Creator Posting](noodler-automatic-posting.md)

## Purpose

Let the user influence what a NoodleR character posts over time without scripting every final post.

A creator project is an ongoing, private content arc owned by one NoodleR creator page. The user supplies direction, milestones, timing, and optional roleplay context. The character remains responsible for the actual in-character wording when a post is generated.

Example:

```text
Project: Preparing for the Moonlight Concert

Brief:
Mira is rehearsing, choosing outfits, sharing backstage frustrations,
teasing songs, and eventually posting about the performance.

Milestones:
1. Hint that something important is coming.
2. Share a difficult rehearsal.
3. Preview the outfit or stage.
4. Remind subscribers on concert day.
5. React after the concert.
```

## Design principles

1. A project guides a character; it does not replace their personality.
2. Generate one post when needed, using current context, rather than writing the entire final queue in advance.
3. A project belongs to one private creator account.
4. Projects never enter public Noodle generation.
5. Projects never enter another creator's NoodleR generation.
6. Chat context enters a project only through an explicit user action.
7. The global NoodleR schedule remains the volume authority.
8. Completed milestones are remembered so later posts advance rather than repeat.
9. The user can always pause, reorder, skip, edit, or complete the plan.
10. Organic creator posts remain possible when project work is not due.

## Core concepts

### Project states

| State | Meaning | Can generate automatically |
| --- | --- | ---: |
| Draft | Being planned; not active | No |
| Active | Eligible to guide posts | Yes |
| Paused | Retained but temporarily inactive | No |
| Completed | Arc finished normally | No |
| Archived | Hidden from normal workspace | No |

Archiving is the default removal action. Hard deletion should be limited to projects without published history or require clear confirmation.

### Influence modes

| Mode | Behavior |
| --- | --- |
| Loose | Project is inspiration; organic and unrelated posts remain common |
| Balanced | Most selected project posts advance the arc, with organic posts between them |
| Focused | Automatic posts for this creator prioritize the active project until paused or completed |

Influence controls project selection, not character voice. Character profile, linked identity, stage persona, and current fictional context remain authoritative for characterization.

### Milestones

A milestone is a planned beat, not final post text.

Fields:

- Title or instruction.
- Optional notes.
- Ordered position.
- State: Planned, Ready, Completed, Skipped.
- Optional due date and time.
- Optional not-before date and time.
- Access: Public preview, Subscriber, or PPV.
- PPV price when applicable.
- Media preference: Text, Image, Text and image, or Model choice.
- Optional attached context references.
- Generated post ID after completion.
- Bounded completion summary.

“Public preview” here means a NoodleR post with public access. It remains on the NoodleR surface and must never enter public Noodle.

### One-off ideas

A one-off idea is a lightweight milestone that may exist outside a larger project:

> Complain about today's rehearsal and ask subscribers which outfit looks better.

Implementation options:

- Store it in a built-in per-creator **Inbox** project, or
- Support standalone planned posts through the same milestone contract with no project ID.

Prefer the Inbox project if it avoids a second scheduling data model.

### Cadence

A project may define:

- No cadence: only explicitly scheduled or manually generated milestones.
- Every N eligible creator posts.
- Preferred days of week.
- Preferred time windows.
- Minimum spacing between project posts.

For the first version, use optional fixed milestone times plus a simple minimum-spacing cadence. A full weekly grid can follow after usage validates the need.

## Data model

The exact schema should use shared Zod contracts and file-native storage conventions.

Conceptual project:

```ts
interface NoodlerCreatorProject {
  id: string;
  creatorAccountId: string;
  title: string;
  brief: string;
  toneGuidance: string;
  influence: "loose" | "balanced" | "focused";
  status: "draft" | "active" | "paused" | "completed" | "archived";
  startsAt: string | null;
  endsAt: string | null;
  minimumSpacingHours: number | null;
  preferredWeekdays: number[];
  preferredTimeWindow: { start: string; end: string } | null;
  createdAt: string;
  updatedAt: string;
}
```

Conceptual milestone:

```ts
interface NoodlerProjectMilestone {
  id: string;
  projectId: string;
  title: string;
  notes: string;
  position: number;
  status: "planned" | "ready" | "completed" | "skipped";
  notBefore: string | null;
  dueAt: string | null;
  access: "public" | "subscriber" | "ppv";
  ppvPrice: number | null;
  mediaPreference: "text" | "image" | "text_and_image" | "model_choice";
  generatedPostId: string | null;
  completionSummary: string;
  completedAt: string | null;
}
```

Conceptual attached context:

```ts
interface NoodlerProjectContextExcerpt {
  id: string;
  projectId: string;
  milestoneId: string | null;
  sourceChatId: string;
  sourceMessageId: string;
  speakerKind: "persona" | "character" | "narrator" | "system";
  speakerId: string | null;
  speakerName: string;
  excerpt: string;
  attachedAt: string;
}
```

Store a bounded immutable excerpt so later message edits do not silently rewrite an already planned creator arc. Retain source IDs for navigation and missing-source display.

## Project ownership and invariants

- `creatorAccountId` must reference a private NoodleR account.
- A milestone belongs to exactly one project.
- A generated post completing a milestone must be authored by that project's creator account.
- One post cannot complete milestones for multiple creators.
- Archived, completed, and paused projects are absent from automatic prompt context.
- A project ending does not delete its generated posts.
- Deleting a creator page archives or deletes its projects according to the existing account deletion policy.
- Linked public accounts cannot query project prompt context.

Multiple active projects may be allowed, but the first version should recommend one primary active project per creator. If several are active, scheduler precedence must be deterministic.

## Project workspace

### Creator page summary

Each Creator Page shows:

- Active project name.
- Progress, such as 2 of 5 milestones completed.
- Next milestone and planned time.
- Delayed or blocked state.
- Generate next action.
- Open Projects action.

### Projects list

The workspace lists Active, Draft, Paused, Completed, and Archived projects with filters.

Each card shows:

- Title and brief excerpt.
- Influence mode.
- Date range.
- Milestone progress.
- Next planned post.
- Pause, resume, complete, archive, and menu actions.

### Project editor

Desktop:

- Project settings and brief on the left.
- Milestone timeline in the center.
- Selected milestone detail and context on the right.

Mobile:

- One pane at a time.
- Clear back navigation.
- Sticky Save and Generate next actions where appropriate.

The editor supports:

- Project title, brief, tone guidance, and influence.
- Start/end and cadence.
- Add, edit, reorder, skip, and restore milestones.
- Attach or remove context excerpts.
- Set access and media preference.
- Preview completed linked posts.

### Timeline presentation

Milestones should appear as an ordered creator plan:

```text
Completed     Tease the announcement       Post #123
Ready         Share rehearsal trouble      Due today
Planned       Reveal the outfit             Friday evening
Planned       Concert reminder              Saturday afternoon
Planned       Post-concert reaction         After Saturday 22:00
```

This is a posting plan, not the Conversation presence grid.

## Manual project actions

### Generate next

1. Resolve the next eligible milestone.
2. Build a private prompt for this creator and milestone.
3. Generate one draft post.
4. If media prompt review is enabled, hold completion until review succeeds.
5. Let the user edit before publication when the action is manual.
6. Persist the post.
7. Mark the milestone completed and link the post atomically or with recoverable reconciliation.

### Skip

- Mark the milestone skipped with optional reason.
- Do not generate a post.
- Preserve it in history.
- Reordering or restoring remains possible.

### Pause and resume

- Pausing removes all project milestones from automatic eligibility.
- Existing posts remain unchanged.
- Resuming recalculates due status without immediately flooding missed milestones.

### Complete

- Marks the arc complete even if planned milestones remain.
- Remaining milestones may be skipped automatically with a completion reason or left planned but inactive; choose one consistent representation.
- Recommended: mark remaining milestones skipped as “Project completed early.”

## Prompt contract

### System rules

The private creator prompt should state:

- The creator is the only allowed post author.
- The project is private planning guidance, not text to quote verbatim.
- Preserve linked identity constraints and write in the stage persona's voice.
- Advance the current milestone without falsely claiming future milestones already happened.
- Do not repeat completed project beats.
- Do not mention “project,” “milestone,” scheduling, prompt instructions, or attached metadata in the post.
- Respect requested access and media mode.

### Context sections

Recommended ordering:

```text
# Sole Creator Account
# Underlying Linked Identity
# Private Stage Persona
# Current Creator Project
# Completed Project Beats
# Current Milestone
# Deliberately Attached Context
# Relevant Opted-In Chat Exchange
# Creator's Recent NoodleR History
# Output Contract
```

Only include sections that have content.

### Context limits

- One current project in full.
- Current milestone in full.
- Bounded summaries for completed milestones.
- A bounded number of attached excerpts, newest or explicitly pinned first.
- Target creator's recent private posts and fan replies only.
- No public Noodle history.
- No other creator project or private history.

### Character autonomy

Influence mode adjusts instructions:

- Loose: use the milestone if it naturally fits; an adjacent organic angle is acceptable.
- Balanced: clearly advance the milestone while preserving spontaneous voice.
- Focused: directly fulfill the milestone, while still avoiding verbatim brief repetition.

The output still passes the same structured post schema, validation, image generation, and retry pipeline as other private generation.

## Scheduler integration

The global creator-post scheduler asks a project planning service for due work.

Suggested result:

```ts
type CreatorPostWork =
  | { kind: "fixed_milestone"; creatorAccountId: string; projectId: string; milestoneId: string }
  | { kind: "project_cadence"; creatorAccountId: string; projectId: string; milestoneId: string }
  | { kind: "organic"; creatorAccountId: string };
```

Selection order:

1. Oldest specifically due milestone.
2. Eligible cadence milestone, balanced by creator fairness.
3. Organic post, selected by page weight and fairness.

The project service chooses work; the scheduler owns whether a global slot is available.

### Delayed work

If more milestones are due than available slots:

- Keep them Ready or Delayed.
- Show the delay in the project timeline.
- Do not silently skip them.
- Let the user Generate next manually.
- Do not exceed global daily volume automatically.

### End dates

At project end:

- Do not generate all remaining milestones at once.
- Mark overdue ungenerated work for user review.
- Offer Complete, Extend, or Reschedule.

## Conversation integration

### Chat Settings section

For each character with a private creator page, show:

- NoodleR page status.
- Automatic-post eligibility.
- Active project.
- Next milestone.
- Add project idea.
- Plan post.
- Open creator schedule.

For characters without a page, offer **Create NoodleR page** before project actions.

### Message action

Add **Use in NoodleR project** to eligible messages.

Flow:

1. Choose the creator when a group chat has multiple characters.
2. Choose an existing project or create one.
3. Attach to the project generally or to a milestone.
4. Preview the excerpt and speaker attribution.
5. Confirm attachment.

The action copies only the selected message initially. Offer adjacent context as an explicit option, not a default hidden expansion.

### Privacy and role separation

- The source chat must belong to or include the target character.
- The user can deliberately attach another speaker's message as relationship context.
- The prompt labels that speaker and never treats them as the creator.
- Attached context remains private to the target project.
- Deleting or archiving the project removes it from prompts.
- Public Noodle never reads project attachments.

## API and storage plan

Suggested endpoints, adapted to route conventions:

```text
GET    /api/noodler/accounts/:accountId/projects
POST   /api/noodler/accounts/:accountId/projects
PATCH  /api/noodler/projects/:projectId
DELETE /api/noodler/projects/:projectId
POST   /api/noodler/projects/:projectId/milestones
PATCH  /api/noodler/projects/:projectId/milestones/:milestoneId
POST   /api/noodler/projects/:projectId/milestones/reorder
POST   /api/noodler/projects/:projectId/generate-next
POST   /api/noodler/projects/:projectId/context
DELETE /api/noodler/projects/:projectId/context/:contextId
```

Archive should normally be a PATCH state change rather than DELETE. Exact endpoint shape may be simplified to match existing storage patterns.

### Atomicity

The generated post and milestone completion must not drift.

Preferred behavior:

1. Generate and validate without changing milestone state.
2. Persist post.
3. Persist milestone completion with post ID.
4. If step 3 fails, retain recoverable metadata on the post or generation run so reconciliation can link it later.

If the file-native database supports a suitable transaction abstraction, commit both together. Otherwise implement idempotent reconciliation.

## Rollout phases

### Projects MVP

- CRUD projects.
- Ordered milestones.
- Draft/Active/Paused/Completed/Archived.
- Loose/Balanced/Focused.
- Optional fixed milestone times.
- Access and media preference.
- Manual Generate next.
- Prompt isolation and completion history.

### Scheduler integration

- Due milestone selection.
- Project cadence.
- Delayed state.
- Organic fallback.
- Fairness across creators.

### Conversation integration

- Compact settings summary.
- Add idea and plan post.
- Attach one message with attribution.
- Navigate back to source message where available.

### Later enhancements

- Reusable templates such as weekly Q&A, travel log, countdown, and development diary.
- AI-assisted project and milestone drafting.
- Recurring milestone formats.
- Calendar overview across all creators.
- Optional approval queue for unattended project posts.
- Project analytics such as generated post count and milestone completion pace.

## Regression plan

Required coverage:

1. Project creation rejects public accounts.
2. Project A appears only in creator A's prompt.
3. Project A never appears in public Noodle prompts.
4. Paused, completed, and archived projects are absent from automatic selection.
5. Completed milestone summaries appear but completed instructions are not selected again.
6. Skipped milestones are not generated.
7. Fixed due milestones precede cadence and organic work.
8. Global slot exhaustion delays rather than drops milestones.
9. Failed generation does not complete a milestone.
10. Successful generation links the exact private post to the milestone.
11. Attached chat excerpts preserve speaker attribution.
12. Unattached chat messages do not appear through project context.
13. Other creators' history and projects are absent.
14. Passive pages cannot Generate next or run automatically.
15. Manual editing before publication does not lose milestone linkage.
16. Archived creator deletion handles project records consistently.

## Acceptance criteria

- The user can create an ongoing posting arc for one NoodleR creator.
- The user can arrange milestones and choose timing, access, and media preference.
- Generate next produces one in-character post for the correct creator and milestone.
- Completed milestones are visibly linked to their posts and are not repeated.
- The automatic scheduler prioritizes due project work without exceeding the global daily rate.
- Loose, Balanced, and Focused modes visibly affect how strongly the project drives posts.
- A chat message can be deliberately attached with correct speaker attribution.
- Projects, milestones, and attachments never enter public Noodle or another creator's prompt.
- Pausing or completing a project immediately removes it from automatic eligibility.

## Non-goals

- Full marketing campaign management.
- Real-world external publishing.
- Multi-creator collaborative projects in the first version.
- Automatic ingestion of every chat message.
- Using project schedules as Conversation presence schedules.
- Pre-generating every final post when the project is created.
- Allowing projects to bypass Active/Passive mode or global daily limits.
