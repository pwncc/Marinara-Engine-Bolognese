# NoodleR Automatic Creator Posting

Status: Proposed

Parent roadmap: [Noodle and NoodleR Role Separation Roadmap](noodle-noodler-roadmap.md)

Related project scheduling: [Creator Projects and Posting Plans](noodler-creator-projects.md)

## Purpose

Give NoodleR characters a visible, predictable way to post automatically, similar to public Noodle's daily refresh schedule.

The existing per-page **Automatic posting** toggle is a useful foundation, but the current behavior has three problems:

- It is buried in creator-page settings.
- Its unattended execution depends on the unrelated global fan-activity switch.
- Every page owns an independent frequency, so total volume grows with enabled page count.

The target design uses one global NoodleR creator-post schedule with per-page eligibility and selection weight.

## Product rules

### Global controls

NoodleR Settings gains **Automatic creator posts**:

- Enabled toggle, off by default.
- Posts per day, from 0 to 24.
- Generation connection, defaulting to the Noodle generation connection.
- Automatic schedule with planned slots and timezone.
- Next run, completed slots, retry state, and last error.

When disabled, planned state may remain persisted, but no unattended creator post runs.

### Per-page controls

Every creator page has:

- Posting mode: Active or Passive.
- Include in automatic posting toggle.
- Posting frequency weight: Low, Medium, or High.
- Next eligible or planned post summary.
- Generate now action.

Eligibility requires:

```text
NoodleR enabled
AND global automatic creator posts enabled
AND posts per day > 0
AND creator page is Active
AND creator page is included in automatic posting
```

### Global volume

Posts per day is the total number of unattended creator posts across all pages.

Example:

```text
Global rate: 4 posts/day
Alice: High
Bob: Medium
Carol: Low

Result: approximately 4 total posts, with Alice selected more often than Bob
and Bob selected more often than Carol over time.
```

It must not produce 4 posts per creator.

### Weight semantics

Recommended weights:

| Setting | Selection weight |
| --- | ---: |
| Low | 1 |
| Medium | 2 |
| High | 4 |

Weights influence selection over time; they are not guarantees for a single day.

Use recent selection history to reduce starvation and repeated selection of the same creator in adjacent slots. A suitable score can combine configured weight, time since last creator post, and a penalty for recent selection.

## Distinct posting paths

### Manual creator post

- Explicitly written by the user.
- Available for Active and Passive pages.
- Does not require automatic posting.
- `/noodler` is treated as this path.

### Guided AI creator post

- Explicitly requested for one page.
- Requires Active mode.
- Does not require automatic posting.
- May include user direction, access level, and image choice.

### Generate now

- Explicitly requests one AI post for one Active page.
- Does not consume or require an unattended schedule slot.
- If a project milestone is selected, it may advance that milestone after successful publication.
- If no project work is selected, it generates an organic creator post.

### Refresh eligible pages

- Explicitly runs once for each Active page included in automatic posting.
- Does not require the global unattended schedule to be enabled.
- Does not consume daily automatic slots.
- Stops cleanly on image-review boundaries and reports partial completion.

### Unattended creator post

- Runs one selected creator at one due global slot.
- Requires all eligibility conditions.
- Uses project priority when project support is enabled.

### Fan activity

- Creates fan subscriptions, unlocks, likes, and comments around existing posts.
- Never creates a creator-owned post.
- Has its own global and per-page settings.
- Has no effect on creator-post scheduling.

## Schedule behavior

### Daily slot generation

Reuse public Noodle schedule behavior where appropriate:

1. Divide the local day into equal windows based on posts per day.
2. Choose one random time inside each window.
3. Persist the times and timezone.
4. Allow future slots to be moved without duplicating or moving into the past.
5. Mark slots pending, completed, retrying, skipped, or failed.

The NoodleR schedule should use the same host/device timezone conventions as public Noodle unless the product later adds a shared social-schedule timezone setting.

### Creator selection timing

Select the creator close to execution time rather than permanently assigning every daily slot at midnight. This allows page eligibility, project due state, and recent manual posts to affect selection.

The UI may show:

- Exact time with “Creator selected when due,” or
- A tentative creator that is recalculated if eligibility changes.

Avoid promising a creator who may become Passive or disabled before execution.

### Catch-up

After downtime:

- Collapse multiple missed slots into at most one catch-up post.
- Mark covered slots consistently.
- Do not create a burst of posts.
- Resume future planned slots normally.

### Failure and retry

- Keep the due slot pending or retrying after transient provider failure.
- Use bounded backoff consistent with public Noodle.
- Re-evaluate creator eligibility before retrying.
- Do not advance a project milestone until a post is successfully persisted.
- Do not allow one failing creator to block all future creators indefinitely; after a bounded retry policy, skip or reselect and record the error.

### Concurrency

- Use the existing private account refresh lock for the selected creator.
- If the creator is already generating manually, keep the slot available for a later poll or select another eligible creator according to policy.
- Public Noodle refreshes use a separate lock scope.
- Fan activity uses separate scheduling state and may share the creator account lock only for conflicting writes.

## Scheduler architecture

Create a dedicated NoodleR creator-post scheduler service.

Responsibilities:

- Read global automatic creator-post settings.
- Maintain daily slots and scheduler status.
- Resolve eligible creator pages.
- Ask project planning for due work.
- Select one creator fairly.
- Invoke the existing single-private-account refresh pipeline.
- Persist completion, retry, and selection history.

Do not continue housing creator-post execution behind `enableFanActivityScheduler`.

Suggested separation:

```text
noodle-refresh-scheduler.service.ts
  -> public Noodle batch refreshes

noodler-creator-post-scheduler.service.ts
  -> one private creator post per due global slot

noodle-fan-activity-scheduler.service.ts
  -> fan subscriptions, unlocks, likes, and comments
```

## Settings model

The exact shared schema should follow repository conventions. Conceptually:

```ts
interface NoodlerCreatorPostScheduleSettings {
  enabled: boolean;
  postsPerDay: number;
  generationConnectionId: string | null;
}

interface NoodleAutoPostSettings {
  enabled: boolean;
  intensity: "low" | "medium" | "high";
  lastAutomaticPostAt: string | null;
}
```

Per-page `nextRunAt` should be removed or treated as compatibility data once the global slot scheduler is authoritative. Keeping both global slots and independent page timestamps would create two scheduling truths.

Scheduler status may mirror `NoodleRefreshSchedulerStatus` or use a shared generic daily scheduler contract if that can be done without broad refactoring.

## UI plan

### NoodleR settings

Add a global card containing:

- Automatic creator posts toggle.
- Posts per day number control.
- Connection selection or “Use Noodle connection.”
- Schedule timezone.
- Automatic schedule list.
- Status and last error.

Copy should say that posts per day is shared across all eligible pages.

### Creator Pages list

Each creator row shows:

- Active or Passive.
- Auto-post on or off.
- Low, Medium, or High.
- Active project, if any.
- Next planned project milestone, if any.
- Last automatic post time.

Provide a compact auto-post toggle. Detailed frequency and project controls remain inside the page.

### Creator page settings

Rename the current helper text from “Include this page when refreshing NoodleR automatically” to wording that distinguishes:

- Inclusion in bulk manual refresh.
- Eligibility for the unattended global schedule.

If one toggle controls both, state both effects explicitly. If user testing finds that confusing, split them later; do not add two toggles initially without evidence.

### Manual controls

Keep separate buttons:

- Write post.
- Generate post.
- Generate next project post, when applicable.
- Simulate fan activity now.

Never label fan simulation as posting.

## Selection algorithm requirements

The implementation may choose a weighted-random or deficit-based algorithm. It must satisfy:

1. Disabled and Passive pages are never selected.
2. Low-weight pages remain selectable.
3. High-weight pages are selected more often over a sufficiently long deterministic test run.
4. A recently selected page receives a temporary penalty.
5. A long-waiting page gains priority to prevent starvation.
6. A specifically due project milestone takes priority, subject to global slot limits.
7. Selection is testable with an injected random source and clock.

## Project-aware precedence

When creator projects land, each due slot resolves work in this order:

1. Specifically scheduled milestone that is due.
2. Next milestone from an active project whose cadence is due.
3. Organic post for an eligible creator.

If several fixed milestones are due:

- Prefer the oldest due milestone.
- Use page fairness as a tie-breaker.
- Leave remaining milestones delayed, not silently completed.

## Migration

Existing per-page auto-post settings map as follows:

- `enabled` remains page inclusion.
- `intensity` becomes page selection weight.
- `nextRunAt` is ignored after the new scheduler takes authority.

Global automatic creator posting should default off during migration to avoid surprising additional activity. Existing enabled pages remain ready but dormant until the user enables the global schedule and chooses a daily rate.

## Regression plan

Required deterministic coverage:

1. Global disabled means no unattended creator post.
2. NoodleR disabled means no unattended creator post.
3. Zero posts per day means no slots.
4. Passive pages are excluded.
5. Per-page auto-post-disabled pages are excluded.
6. Fan global switch off does not stop creator posts.
7. Creator schedule off does not stop fan activity.
8. Four global slots create at most four normal unattended posts across many pages.
9. Missed slots collapse into one catch-up post.
10. Manual Generate now does not consume a slot.
11. `/noodler` works while auto-post is disabled.
12. Concurrent generation does not duplicate a post.
13. Failed generation does not advance a project milestone.
14. Fan and creator schedule settings do not overwrite each other.
15. Weighted selection favors High over Medium over Low without starving Low.

## Acceptance criteria

- A user can enable automatic creator posts globally and see the planned schedule.
- A user can include or exclude each creator page and choose its relative frequency.
- The configured daily rate is total across all creator pages.
- Automatic creator posts continue when fan activity is globally disabled.
- Passive pages never generate automatically.
- Manual posting remains available on Passive pages.
- Guided and Generate now paths do not require auto-post enablement.
- Scheduler status survives restart and avoids catch-up floods.
- Project due work can be selected without creating a second scheduler.

## Non-goals

- Exact per-creator daily quotas.
- Separate timezone per creator.
- Posting while the Marinara server is not running.
- Real external social publishing.
- Fan activity controlling creator posts.
- Projects bypassing the global daily rate.
