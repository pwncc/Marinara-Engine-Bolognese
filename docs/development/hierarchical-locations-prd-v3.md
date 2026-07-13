# Spatial Context: Hierarchical Locations V3

Status: Proposed, implementation-ready after maintainer approval

Audience: Product, design, and Marinara Engine contributors

Supersedes: `hierarchical-locations-prd-v2.md`

## Summary

Add a shared Spatial Context feature for Roleplay, Visual Novel, and Game. It provides an author-defined location hierarchy, one authoritative focal location, bounded prompt context, and server-validated movement.

Connected Conversation can later read a safe projection of the linked story location, but it never owns or changes spatial state.

```text
authoritative hierarchy + current location
                    ↓
resolve breadcrumb, context, and valid destinations
                    ↓
build the mode-specific prompt
                    ↓
commit a validated move with the next owner turn
                    ↺
```

This is not a general scenario engine. It does not add flags, events, author JavaScript, pathfinding, or a visual map.

## Product decisions

These decisions resolve the open questions from V2:

1. The hierarchy definition and current location are stored separately.
2. Current location is snapshotted with committed message and swipe state so branches, regeneration, and checkpoints restore the correct position.
3. Manual movement commits atomically with the next owner-mode user turn, before prompt generation.
4. Spatial Context is authoritative when enabled. Game's legacy free-text location must not become a second source of truth.
5. Roleplay and Visual Novel use the same projection wording in the MVP.
6. `awarenessSummary` is author-written. When absent, Conversation receives a bounded excerpt of the public description only.
7. Conversation uses scene-level wording unless authoritative presence data proves the connected character is present.
8. Direct links are included in the MVP.
9. Spatial lorebook attachment and model-requested movement remain later phases.

## Scope

| Mode | Owns hierarchy | Moves focal location | Story projection | Connected projection |
| --- | ---: | ---: | ---: | ---: |
| Roleplay | Yes | Yes | Yes | N/A |
| Visual Novel | Yes | Yes | Yes | N/A |
| Game | Yes | Yes | Yes | N/A |
| Conversation | No | No | No | Later phase, read-only |

## User experience

### Authoring

Chat Settings shows a compact Spatial Context section with:

- Enabled state
- Current breadcrumb
- Location and warning counts
- Open Location Editor action

The editor is a lazy-loaded workspace, not a narrow settings form:

- Desktop uses a hierarchy pane and location-detail pane.
- Mobile shows one pane at a time with clear back navigation.
- Validation appears beside the affected field or node.
- Save state and revision conflicts are always visible.
- Archive is the primary removal action; hard delete is restricted.

### Runtime movement

Owner-mode chat surfaces show:

- Persisted current breadcrumb
- Valid destination picker
- Clearly labelled pending destination

Selecting a destination does not immediately change authoritative state. Sending the next message submits the destination ID and expected revision separately from visible message text. The server commits the move before assembling the reply prompt.

If validation fails, the message and movement are not partially committed. The client keeps the draft and explains the conflict.

## Data model

Definitions belong in chat metadata. Runtime position belongs in snapshot history.

```ts
export type SpatialOwnerMode = "roleplay" | "visual_novel" | "game";

export interface ChatLocation {
  id: string;
  name: string;
  parentId: string | null;
  description: string;
  awarenessSummary?: string;
  gmMemory?: string;
  links: ChatLocationLink[];
  status: "active" | "archived";
  sortOrder: number;
}

export interface ChatLocationLink {
  targetId: string;
  label?: string;
  bidirectional: boolean;
  state: "available" | "hidden" | "blocked";
}

export interface SpatialContextDefinition {
  schemaVersion: 1;
  ownerMode: SpatialOwnerMode;
  enabled: boolean;
  locations: ChatLocation[];
  startingLocationId: string | null;
  revision: number;
}

export interface SpatialContextSnapshot {
  id: string;
  chatId: string;
  messageId: string;
  swipeIndex: number;
  currentLocationId: string | null;
  definitionRevision: number;
  createdAt: string;
}

export interface PendingSpatialTransition {
  destinationId: string;
  expectedDefinitionRevision: number;
  expectedCurrentLocationId: string | null;
  commandId: string;
}
```

Do not store `ownerChatId` inside `SpatialContextDefinition`; the containing chat is the owner. Stable opaque IDs survive renames and reparenting.

Lorebook entry IDs are intentionally omitted from the first owner MVP and added in the lorebook phase.

## Graph rules

Valid destinations are active:

- Children of the current location
- The current location's parent
- Direct link targets
- Reverse targets of bidirectional links

Siblings are not automatically adjacent.

Reject:

- Duplicate IDs
- Missing parent or link targets
- Self-parenting or parent cycles
- More than 500 locations
- Depth above 20
- More than 50 links per location
- Movement to archived, hidden, blocked, or unreachable locations
- Stale revisions or a changed current location
- Reused command IDs with different contents
- Mutation attempts from Conversation

Text limits:

- Name: 200 characters
- Description: 4,000 characters
- Awareness summary: 1,000 characters
- GM memory: 8,000 characters

Direct-link cycles are valid. Parent cycles are not.

### Archive and delete

- The current or starting location needs an atomic replacement before archive.
- A location with active children cannot be archived.
- Hard delete is allowed only for an archived leaf with no inbound links.
- Descendants are never silently reparented.
- Missing later-phase lorebook references appear as warnings, not graph corruption.

## Persistence and history

### Definitions

Store `SpatialContextDefinition` in `chat.metadata.spatialContext`. Definition updates require `expectedRevision`; accepted updates increment the revision.

### Runtime position

Store the current position using message/swipe-addressable snapshots, following the existing Game State snapshot pattern.

- New owner chats begin at `startingLocationId`.
- A committed turn creates a snapshot after any accepted movement.
- Regeneration associates position with the resulting swipe.
- Switching swipes resolves the matching snapshot.
- Branching at a message copies the snapshot effective at that point, not the source chat's latest position.
- Game checkpoints reference or include the applicable spatial snapshot.
- Reload resolves the latest committed snapshot.

Definition editing is not rewound by ordinary message branching in the MVP. A branch receives a copy of the current definition, with its own future revision history. Its runtime position comes from the branch point.

## Prompt projections

A shared server projection service resolves structured projection data. Thin mode adapters turn it into final prompt text.

### Owner story projection

Include:

- Breadcrumb names
- Current location ID
- Public description
- GM memory
- Available destination names, IDs, and link labels
- An authoritative-state instruction

Exclude all unrelated location descriptions and hidden or blocked destinations.

### Connected Conversation projection

Added in Phase 2. Include only:

- Linked story name and mode
- Breadcrumb
- `awarenessSummary`, or a bounded public-description excerpt
- Read-only instruction
- Character presence only when authoritative state proves it

Never include GM memory, internal IDs, hidden destinations, the complete hierarchy, or location-attached lorebook content.

Game may prove presence through its committed `presentCharacters` state. Roleplay and Visual Novel use neutral wording such as “The linked story's current scene is…” until they gain an explicit presence source. Never infer presence by character name.

### Required prompt paths

The same projection resolver must feed:

- Roleplay generation
- Visual Novel generation
- Game GM generation
- Dry-run preview
- Live Peek Prompt assembly

Cached Peek Prompt continues to display the exact prompt originally sent. Debug logging includes the final projection but must not log GM memory at normal levels.

## Game compatibility

Existing Game maps remain independent presentation and travel systems. No name matching or automatic binding is allowed.

When Spatial Context is enabled:

- Spatial Context supplies the authoritative named location to prompts.
- The Game tracker displays the spatial breadcrumb as its location.
- Legacy model or manual patches cannot independently change the free-text Game location.
- Map clicks do not change Spatial Context without a future explicit binding.

When disabled, existing Game location behavior is unchanged.

## API shape

```text
GET  /api/chats/:chatId/spatial-context
PUT  /api/chats/:chatId/spatial-context
```

Definition update:

```ts
interface UpdateSpatialContextRequest {
  expectedRevision: number;
  definition: SpatialContextDefinition;
}
```

Pending movement is submitted through the existing owner-mode turn request rather than a separate immediate-transition endpoint.

The server validates definition integrity, owner mode, expected revision, expected current location, reachability, and command idempotency inside the same transaction as message submission.

Return `409 Conflict` for stale state and `400 Bad Request` for invalid graphs or destinations. Errors must not reveal hidden destinations.

## Implementation plan

### Phase 0: shared core and proof fixtures

- Add shared types and Zod schemas.
- Add pure graph validation, breadcrumb, and destination helpers.
- Add deterministic fixtures for valid and invalid graphs.
- Confirm message/swipe snapshot integration points for all owner modes.
- Measure representative prompt projections.

Exit condition: schema, movement semantics, and snapshot behavior are proven without UI.

### Phase 1: owner MVP

1. Add definition persistence with optimistic concurrency.
2. Add spatial snapshot storage and resolution.
3. Integrate atomic pending movement into owner-mode turn submission.
4. Handle reload, swipes, branches, and Game checkpoints.
5. Add the shared projection service to every required prompt path.
6. Add the compact settings section and editor workspace.
7. Add breadcrumb, destination picker, and pending state to owner surfaces.
8. Reconcile the Game tracker location when enabled.

Exit condition: all three owner modes author, move, persist, restore, and prompt from the same spatial model.

### Phase 2: connected Conversation

- Resolve the latest owner state through `connectedChatId` at generation time.
- Add a bounded read-only projection.
- Use conservative presence wording.
- Add an optional read-only linked-location badge.
- Cover unlink, relink, deleted owner, malformed links, and concluded stories.

### Phase 3: location lorebooks

- Add `lorebookEntryIds` to locations.
- Force-activate current-location entries in owner prompts under a reserved budget.
- Respect disabled books and entries.
- Report broken references and activation source.
- Prove no automatic leakage into Conversation.

### Phase 4: model-requested movement

- Add a typed `change_location` request for owner modes.
- Apply the same revision, reachability, and idempotency validation.
- Record accepted and rejected requests in debug diagnostics.
- Conversation remains unable to request transitions.

## Acceptance criteria

- Rename and reparent operations preserve location identity.
- Invalid graphs and stale writes never mutate state.
- Movement commits with a user turn or not at all.
- Reload, swipe selection, earlier-message branching, and Game checkpoint restore resolve the correct location.
- Owner prompts contain only active-location context and valid destinations.
- Game does not display or prompt from a competing free-text location when enabled.
- Dry-run and Peek Prompt use the same projection behavior as generation.
- Existing chats and disabled Spatial Context retain current behavior.
- Conversation cannot own or mutate spatial state.
- GM memory never enters Conversation projection.

## Validation

Deterministic coverage must include graph limits, cycles, navigation directions, hidden and blocked links, stale revisions, idempotency, branch points, swipes, checkpoints, privacy boundaries, and inactive-location negative controls.

Repository checks:

```bash
pnpm check
pnpm regression:prompt
pnpm smoke:ui
```

Manual verification covers desktop and mobile authoring, deep breadcrumbs, long names, conflict recovery, archive protections, all owner modes, reload, branching, checkpoint restore, and Peek Prompt. PR validation checkboxes remain unchecked for human verification.

## Deferred

- Visual maps and map bindings
- Independent character positions
- Generic flags, events, or scripts
- Location templates and scenario packages
- Immediate movement without a chat turn
- Per-character spatial knowledge
- Shareable location lore in Conversation
