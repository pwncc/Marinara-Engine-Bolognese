# Spatial Context: Hierarchical Locations Across Chat Modes

Status: Proposed V2

Audience: Product, design, and Marinara Engine contributors

Supersedes: Nothing; the original Game-focused proposal remains available as `hierarchical-locations-prd.md`

Initial scope: Shared hierarchy for Roleplay, Visual Novel, and Game Mode, with connected Conversation awareness

## Summary

Add a shared Spatial Context feature that gives Marinara chats an authoritative hierarchy of places, a current location, location-scoped memory, and validated movement. Roleplay, Visual Novel, and Game Mode can own and change spatial state. A connected Conversation can consume that state so users can text characters who remain aware of where they are in the linked story.

The first release is intentionally non-visual. It provides the spatial model and prompt behavior that a visual map, floor selector, creator template, or 3D renderer could use later.

The feature is a hierarchical location graph used by a small reactive state machine:

```text
authoritative spatial state
          ↓
resolve current place, memory, characters, and exits
          ↓
project mode-appropriate prompt context
          ↓
player movement or validated model request
          ↓
persist transition and notify connected chats
          ↺
```

## Product decision

Spatial ownership and spatial awareness are different capabilities.

| Mode | Owns a hierarchy | Changes current location | Receives scoped location memory | Receives connected spatial awareness |
| --- | ---: | ---: | ---: | ---: |
| Game | Yes | Yes | Yes | Yes |
| Roleplay | Yes | Yes | Yes | Yes |
| Visual Novel | Yes | Yes | Yes | Yes |
| Conversation | Not in the MVP | No | No | Yes, from a connected story chat |

Conversation is included because connected chats let users text characters from an ongoing Roleplay or Game. Those characters should be able to say where they are, describe what is happening around them, and remain consistent with the linked story. Conversation must not maintain a second, competing location pointer.

## Problem

Language models often lose spatial orientation during long-form storytelling. They may:

- Confuse rooms, floors, buildings, districts, or worlds.
- Move characters through nonexistent routes.
- Mention details belonging to an inactive location.
- Forget where a character is when the user switches to a connected Conversation.
- Require the entire world description in every prompt.
- Produce conflicting location truth across linked chats.

Marinara already has generated Game maps, scene state, lorebooks, connected chats, OOC influences, and durable notes. These pieces do not currently form one author-controlled hierarchy with an explicit owner and bounded projections into other modes.

## Goals

- Give Roleplay, Visual Novel, and Game a shared, persistent model of place.
- Let creators define worlds, regions, cities, buildings, floors, rooms, and other nested spaces without drawing a map.
- Inject detailed memory only for the authoritative current location.
- Allow location identity, rather than keyword coincidence, to activate attached lorebook entries.
- Validate every stored movement against the location graph.
- Let a connected Conversation know the linked story's current location and relevant character presence.
- Prevent Conversation from silently moving the linked story or forking spatial truth.
- Preserve spatial state across reload, branch, checkpoint, session continuation, import, and export.
- Establish a data model that can later support visual maps and independent character positions.

## Non-goals for the first release

- A canvas, grid, polygon, or visual map editor.
- Irregular borders, pathfinding, or 2D-to-3D generation.
- Replacing the existing Game Mode map.
- A general-purpose scenario scripting system.
- Author-supplied JavaScript.
- Arbitrary Boolean flag expressions, timed events, or probabilistic events.
- Independent persistent positions for every NPC.
- Conversation-owned movement or a separate Conversation location tree.
- Inferring movement from arbitrary prose without a structured request.
- Automatically exposing GM-only location secrets in Conversation.

## Terminology

### Story chat

A Roleplay, Visual Novel, or Game chat that owns Spatial Context.

### Connected Conversation

A Conversation linked to a story chat through Marinara's existing connected-chat relationship.

### Spatial owner

The story chat whose metadata contains the authoritative hierarchy and current location.

### Projection

A bounded, mode-specific view derived from authoritative Spatial Context and inserted into a prompt. A projection is not a copy of the underlying state.

### Current location

The active location for the story's focal party or scene. Version one tracks one shared position rather than one position per character.

## Example

```text
Eldermere
└── Ashfall City
    ├── Market District
    ├── Red Kettle Tavern
    │   ├── Common Room
    │   └── Upstairs Hallway
    │       ├── Room 1
    │       └── Room 2
    └── Castle
        ├── Courtyard
        ├── Great Hall
        └── Tower
            ├── Ground Floor
            └── Observatory
```

If the story chat is in `Upstairs Hallway`, its prompt receives the hallway's detailed context and valid destinations. A linked Conversation receives a short awareness projection such as:

```text
Connected story context:
Mira is currently with the party in the Upstairs Hallway of the Red Kettle Tavern in Ashfall City.
The hallway is narrow and quiet, with three rented rooms and a visibly damaged eastern lock.
This context is read-only in Conversation. Do not claim that a text message moved the party.
```

It does not receive a hidden note saying that Room 2 contains stolen letters unless that fact is already visible to the character or explicitly shareable.

## Product principles

### One owner, many projections

Every Spatial Context instance has one authoritative story chat. Connected chats read a projection from that owner rather than copying the graph or current location.

### The application owns truth

The stored hierarchy, current location ID, transitions, and visibility rules are authoritative. Models narrate and may request changes; the server validates and applies them.

### Context describes; transitions happen

A context continuously states what is true. A transition records what changed. Prompt assembly must not confuse `the party is in the tavern` with `the party entered the tavern`.

### Identity beats keywords

Stable IDs control location and lorebook attachment. Keywords may supplement normal lorebook behavior but do not decide which location is current.

### Private facts stay private

Player-visible descriptions, GM-only memory, and character-shareable awareness are separate fields or policies. Connected Conversation never receives GM-only memory merely because it is linked.

### Mode adapters remain thin

Hierarchy validation, ancestry, destination resolution, persistence, and prompt budgeting are shared. Each mode owns only its prompt wording, placement, and transition lifecycle.

## User stories

### Creator

- I can define one hierarchy for a Roleplay, Visual Novel, or Game chat.
- I can give locations public descriptions, private GM memory, and lorebook attachments.
- I can link non-hierarchical destinations such as a tunnel between buildings.
- I can choose a starting location.
- I can control whether connected characters may know or discuss a location description.

### Story player

- I can see the current location as a breadcrumb.
- I can see valid destinations without opening a visual map.
- I can select a pending destination and commit it with my next turn.
- I can tell whether movement is pending or persisted.
- Branches and restored checkpoints return to the correct location.

### Conversation user

- I can text a character connected to a story and have them know where the story currently is.
- The character can discuss visible surroundings without receiving unrelated world information.
- Texting the character does not move the Roleplay or Game.
- I can send an existing one-shot influence or durable note back to the story without directly mutating spatial state.

### Model

- The story model receives authoritative current-location memory and valid destinations.
- The Conversation model receives a short, read-only connected-story awareness block.
- A story model may request a structured transition.
- A Conversation model cannot request or apply a transition in the MVP.

## Shared information model

Contracts belong in `packages/shared`. Use `SpatialContext` and `ChatLocation` terminology rather than Game-specific names.

```ts
export type SpatialOwnerMode = "roleplay" | "visual_novel" | "game";

export interface ChatLocation {
  id: string;
  name: string;
  parentId: string | null;
  description: string;
  awarenessSummary?: string;
  gmMemory?: string;
  lorebookEntryIds: string[];
  links: ChatLocationLink[];
  status: "active" | "archived";
  sortOrder: number;
}

export interface ChatLocationLink {
  targetId: string;
  label?: string;
  bidirectional: boolean;
  state: "available" | "hidden" | "blocked";
  requirementNote?: string;
}

export interface SpatialContextState {
  schemaVersion: 1;
  ownerChatId: string;
  ownerMode: SpatialOwnerMode;
  enabled: boolean;
  locations: ChatLocation[];
  currentLocationId: string | null;
  startingLocationId: string | null;
  revision: number;
}

export interface SpatialTransition {
  id: string;
  ownerChatId: string;
  fromLocationId: string | null;
  toLocationId: string;
  source: "player" | "model" | "setup" | "restore" | "migration";
  messageId?: string;
  createdAt: string;
}
```

Use a normalized location list with `parentId`, not recursively embedded children. The client derives the tree. Stable opaque IDs survive renames and reparenting.

### Why `awarenessSummary` exists

`description` is the full player-visible location description for the active story. `awarenessSummary` is an optional short, safe projection for connected chats. If omitted, the server may derive a bounded summary from `description`, but it must never derive from `gmMemory`.

Example:

```text
description:
The rented hallway is lined with faded portraits. Room 2 has a damaged lock,
and a muffled scraping sound occasionally comes from behind it.

awarenessSummary:
A narrow rented hallway with three rooms and a damaged lock on Room 2.

gmMemory:
The scraping is caused by the innkeeper hiding confiscated letters.
```

## Storage ownership

Store the authoritative `SpatialContextState` only on the owner story chat. Do not copy it into connected Conversation metadata.

Recommended field:

```ts
metadata.spatialContext?: SpatialContextState;
```

Transitions may be stored with snapshots or in a bounded history depending on existing checkpoint and replay semantics. The implementation spike must trace:

- Chat branches.
- Roleplay scene branches.
- Game checkpoints and sessions.
- Connected-chat creation and relinking.
- Import and export.
- Completed-session replay.

The connected Conversation resolves its projection by following `connectedChatId` to the owner chat at prompt-build time. If the link is broken or the owner has no Spatial Context, no projection is inserted.

## Hierarchy and navigation rules

Valid destinations in the first release are:

- Active children of the current location.
- The active parent of the current location.
- Active direct links from the current location.
- Reverse direct links when the source link is bidirectional.

Siblings are not automatically adjacent. `Room 1` reaches `Room 2` through `Upstairs Hallway` unless an explicit link connects them.

Reject:

- Duplicate IDs.
- Missing parent or link targets.
- Self-parenting.
- Parent cycles.
- Movement to archived, hidden, or blocked destinations.
- Movement outside the resolved destination set.
- Archiving or removing the current location without a replacement.
- Transition requests from a non-owner Conversation.
- Stale revisions.

Direct-link cycles are allowed. Parent cycles are not.

## Prompt projections

### Story projection

Roleplay, Visual Novel, and Game receive a complete but bounded active-location block:

```text
<spatial_context mode="story" authority="application">
Current path: Eldermere > Ashfall City > Red Kettle Tavern > Upstairs Hallway
Current location ID: loc_upstairs_hallway

Visible location context:
A narrow hallway with three rented rooms. Room 2 has a damaged lock.

Private GM context:
The innkeeper uses Room 2 to hide confiscated letters.

Available destinations:
- Common Room [loc_common_room]
- Room 1 [loc_room_1]
- Room 2 [loc_room_2]
- City Street [loc_city_street]

Treat this location and destination list as authoritative. Request a structured
transition if narration moves the focal party to a listed destination.
</spatial_context>
```

Mode-specific differences:

- Game calls the responder the GM and aligns movement with the Game turn pipeline.
- Roleplay refers to the focal scene or participating characters.
- Visual Novel uses the Roleplay adapter but may use presentation-specific wording.

### Connected Conversation projection

Conversation receives a smaller, read-only block:

```text
<connected_spatial_awareness authority="linked_story" read_only="true">
Linked story: Red Kettle Investigation
Mode: Roleplay
Current path: Ashfall City > Red Kettle Tavern > Upstairs Hallway
Awareness: A narrow rented hallway with three rooms and a damaged lock on Room 2.

This describes the linked story's current setting. You may discuss it naturally
when relevant, but a Conversation message does not move the linked story.
</connected_spatial_awareness>
```

Do not include:

- `gmMemory`.
- Hidden or blocked destinations.
- Attached lorebook content merely because it is attached to the location.
- The complete hierarchy.
- Internal location IDs unless a tool requires them.
- Information that the connected character should not plausibly know.

### Character presence limitation

The MVP has one focal location, not independent character positions. Therefore the Conversation projection must not automatically claim that every connected character is physically at the current location.

Use conservative wording unless current game/scene state establishes presence:

```text
The linked story's current scene is the Upstairs Hallway.
```

Only use:

```text
Mira is currently in the Upstairs Hallway.
```

when the owner chat's present-character state or equivalent explicitly includes Mira.

This prevents a character who left the scene from falsely claiming to still be there.

## Context budgets

### Story priority

1. Breadcrumb names.
2. Current location description.
3. Current location GM memory.
4. Attached current-location lorebook entries.
5. Available destination names and concise labels.
6. Optional short parent context.

### Conversation priority

1. Owner chat and mode label.
2. Breadcrumb names.
3. `awarenessSummary` or bounded safe description.
4. Confirmed presence of the connected character.
5. A read-only rule.

Conversation should receive a small dedicated budget. It must not consume the story chat's full spatial/lorebook budget.

## Lorebook behavior

In owner story chats:

- Entries attached to the current location are force-activated by location identity.
- Per-chat disabled lorebooks and entries remain disabled.
- Existing ordering, recursion, and token-budget rules are reused where possible.
- Missing IDs fail safely and appear as broken editor references.
- Active Context identifies `Current location` as the activation source.

In connected Conversation:

- Location attachment does not automatically activate the attached entry.
- Normal Conversation lorebook rules continue to apply.
- Safe awareness comes from `awarenessSummary`, not from story-only lorebook injection.

A later release may let creators explicitly mark an attached entry as shareable with connected chats.

## Movement lifecycle

### Manual movement

The user selects a destination, creating a pending move. The UI distinguishes the pending destination from persisted location.

Recommended transport:

```ts
interface PendingSpatialTransition {
  destinationId: string;
  expectedRevision: number;
}
```

The destination ID travels separately from visible player text so renames do not break movement.

The server validates and commits the transition at the mode-appropriate boundary:

- Game: with the submitted Game turn.
- Roleplay/Visual Novel: with the submitted user turn or an explicit immediate move action, as product decides.
- Conversation: unavailable in the MVP.

### Structured model movement

After manual movement is stable, story models may request:

```json
{
  "action": "change_location",
  "destinationId": "loc_room_2",
  "expectedRevision": 12,
  "reason": "The focal party enters Room 2."
}
```

The server validates mode, ownership, revision, and destination availability. Invalid requests do not mutate state.

Conversation models cannot emit `change_location` in the first release. They may use existing connected-chat influence/note mechanisms to communicate an intent such as `Meet me at the tavern`, but the story chat decides and performs any actual transition.

## Connected-chat behavior

### Owner-to-Conversation

When the story location changes:

- No duplicate spatial state is written to Conversation.
- The next Conversation generation resolves the latest owner state.
- Optional UI may show a small linked-location breadcrumb.
- An optional system note may record meaningful location changes, but the MVP should avoid adding noisy messages for every move.

### Conversation-to-owner

Existing one-shot influences and durable notes remain the write path. Examples:

```text
<influence>Mira asks the party to meet her at the market.</influence>
```

```text
<note>Mira plans to wait near the market fountain after sunset.</note>
```

These affect prompt context but do not directly update `currentLocationId`.

### Relinking

If a Conversation is relinked to another story chat, its spatial projection changes immediately to the new owner. No copied location state needs migration or cleanup.

## UI design

Do not add the full editor inline to the already-large Chat Settings drawer.

### Compact settings section

Add a small **Spatial Context** section containing:

- Enabled toggle for owner story modes.
- Current-location breadcrumb.
- Location count and broken-reference warning count.
- `Open Location Editor` action.
- Connected-owner status in Conversation.

### Dedicated editor

Open a lazy-loaded modal or editor surface containing:

- Hierarchy tree.
- Location form.
- Parent selection.
- Link management.
- Description, awareness summary, and GM memory.
- Lorebook attachments.
- Starting/current-location actions.
- Archive/delete workflow.

### Runtime control

Owner story surfaces receive a compact breadcrumb and destination picker. Connected Conversation may receive a read-only linked-location badge or tooltip.

## Feature-module architecture

Implement Spatial Context as a mode-neutral feature rather than embedding it in Game or Roleplay settings.

Suggested structure:

```text
packages/shared/src/features/spatial-context/
  spatial-context.types.ts
  spatial-context.schema.ts
  spatial-context-graph.ts
  spatial-context-manifest.ts

packages/server/src/services/spatial-context/
  spatial-context.service.ts
  spatial-context-projection.service.ts
  spatial-context-transition.service.ts

packages/server/src/routes/
  spatial-context.routes.ts

packages/client/src/features/spatial-context/
  SpatialContextSettingsSection.tsx
  SpatialContextEditor.tsx
  SpatialContextBreadcrumb.tsx
  SpatialDestinationPicker.tsx
  ConnectedSpatialBadge.tsx
  use-spatial-context.ts
```

Avoid adding substantial implementation directly to `ChatSettingsDrawer.tsx`, `GameSurface.tsx`, `game.routes.ts`, or the primary Roleplay surface.

### Optional feature manifest

If Marinara adopts a reusable chat-feature registry, Spatial Context could declare:

```ts
export const SPATIAL_CONTEXT_FEATURE = {
  id: "spatial-context",
  name: "Spatial Context",
  category: "world",
  ownerModes: ["roleplay", "visual_novel", "game"],
  projectionModes: ["conversation"],
  settingsVersion: 1,
} as const;
```

Do not block the feature on a general registry. A dedicated module with an explicit mode contract is sufficient for the first implementation.

## API design

Possible operations:

```text
GET  /api/chats/:chatId/spatial-context
PUT  /api/chats/:chatId/spatial-context
POST /api/chats/:chatId/spatial-context/transition
GET  /api/chats/:chatId/spatial-context/projection
```

The projection endpoint is optional if prompt assembly resolves it internally.

Transition request:

```ts
interface TransitionSpatialContextRequest {
  destinationId: string;
  expectedRevision: number;
  source: "player" | "model";
  messageId?: string;
}
```

The server validates:

- Chat ownership.
- Owner mode.
- Graph integrity.
- Current revision.
- Destination availability.
- Source permission.
- Idempotency by message or command ID where available.

## Relationship to existing Game maps

Spatial Context and the existing generated Game map remain separate:

- Spatial Context is author-controlled prompt truth shared across modes.
- Game map position is a generated grid cell or graph node used by Game presentation and travel.

Initial behavior:

- Either feature may be enabled independently.
- Spatial Context wins when supplying the authoritative named location to story prompts.
- Game map clicks do not mutate Spatial Context without an explicit binding.
- No automatic name matching binds the systems.

Future optional binding:

```ts
interface SpatialMapBinding {
  locationId: string;
  mapId: string;
  position: string | { x: number; y: number };
}
```

## Import, export, branches, and sessions

Spatial Context must participate in:

- Roleplay and Visual Novel branching.
- Game checkpoints and session continuation.
- Connected-chat link preservation.
- Marinara export/import.
- Backup and restore.
- Session history and replay where applicable.

Creator templates are a follow-up unless the current setup export can safely carry the schema. Portable templates need location definitions, stable IDs, starting location, and a strategy for bundled or missing lorebook references.

Never repair broken relationships using name matching alone.

## Security and privacy

- Treat imported descriptions, summaries, memories, and model reasons as untrusted text.
- Escape rendered content.
- Validate all structures with shared schemas.
- Do not execute author-supplied JavaScript.
- Cap location count, depth, text size, and links.
- Do not log GM-only memory at normal levels.
- Include the exact final spatial projection in existing debug prompt logging.
- Never project `gmMemory` into Conversation.
- Avoid exposing hidden destinations through errors, badges, or counts.
- Detect connected-chat cycles or malformed reciprocal links safely.

Suggested initial storage limits:

```text
Locations per owner:         500
Maximum hierarchy depth:     20
Links per location:          50
Description:              4,000 characters
Awareness summary:        1,000 characters
GM memory:                8,000 characters
```

Prompt budgets remain smaller than storage limits.

## Delivery phases

### Phase 0: Architecture spike

- Trace Game, Roleplay, Visual Novel, and Conversation prompt assembly.
- Trace connected-chat resolution, branches, checkpoints, sessions, and exports.
- Confirm whether pending movement commits with a message or immediately.
- Prove graph validation and mode projections with deterministic fixtures.
- Measure story and Conversation prompt costs.
- Confirm presence resolution for connected characters.

Deliverable: approved schema, projection examples, and integration map.

### Phase 1: Shared core and owner modes

- Shared contracts, schemas, and pure graph helpers.
- Server persistence and validation.
- Dedicated hierarchy editor.
- Breadcrumb and destination picker.
- Manual movement for Roleplay, Visual Novel, and Game.
- Story projection in all three owner modes.
- Branch, checkpoint, and reload behavior.
- Active Context and debug prompt visibility.

This is the minimum viable owner feature.

### Phase 2: Connected Conversation awareness

- Resolve owner state through `connectedChatId`.
- Generate safe read-only Conversation projection.
- Resolve connected-character presence conservatively.
- Show optional linked-location status in Conversation.
- Cover relink, unlink, deleted owner, and concluded owner behavior.

### Phase 3: Lorebook attachments

- Attach existing lorebook entries in owner chats.
- Force activation under an explicit budget.
- Show broken references and activation source.
- Keep attached story lore out of Conversation unless separately authorized.

### Phase 4: Structured model transitions

- Add typed movement requests for owner modes.
- Validate revision and destinations.
- Show accepted/rejected transitions in logs.
- Add retry and idempotency handling.

### Future candidates

- Independent character locations.
- Location-specific typed flags and conditional links.
- Creator templates and scenario packages.
- Existing Game map bindings.
- Visual hierarchy or map editor.
- Floor and layer navigation.
- Deterministic 2D/3D renderers.
- Explicitly shareable location lore with Conversation.
- Conversation commands that propose, but do not directly commit, story movement.

## Acceptance criteria

### Shared core

- Location IDs survive rename and reparent operations.
- Parent cycles and broken references are rejected.
- Destination resolution is identical across owner modes.
- Reload preserves hierarchy, current location, and revision.

### Roleplay, Visual Novel, and Game

- Each owner mode can enable the same Spatial Context schema.
- The current breadcrumb and valid destinations are visible.
- Invalid or stale movement cannot mutate state.
- The final prompt contains active-location context and excludes unrelated locations.
- Branches and restored checkpoints receive the correct spatial state.
- Mode-specific prompt wording does not change the underlying graph behavior.

### Conversation

- A connected Conversation receives the latest owner location on its next generation.
- It receives no location projection when disconnected or when the owner has Spatial Context disabled.
- It cannot directly change the owner location.
- It never receives `gmMemory`.
- It does not claim the connected character is present unless owner state establishes presence.
- Relinking changes the projection without copying or migrating spatial state.

### Lorebooks

- Current-location attachments activate only in owner story prompts.
- Inactive-location attachments do not activate through the attachment.
- Disabled entries remain disabled.
- Conversation does not inherit attached story lore by default.

## Validation plan

Deterministic coverage:

- Valid hierarchy and parent-cycle rejection.
- Parent, child, one-way, bidirectional, hidden, blocked, and archived destinations.
- Stale revision rejection and command idempotency.
- Rename and reparent stability.
- Owner-mode prompt inclusion and inactive-location negative controls.
- Connected Conversation projection, unlink, relink, deleted owner, and malformed-link behavior.
- Public description versus awareness summary versus GM memory privacy boundaries.
- Character presence positive and negative controls.
- Branch, checkpoint, export, and import round trips.
- Lorebook activation and token truncation.

Repository validation:

```bash
pnpm check
pnpm regression:prompt
pnpm smoke:ui
```

Manual verification must cover desktop and mobile authoring, deep breadcrumbs, long names, archive/delete protections, all owner modes, connected Conversation, reload, branching, and Peek Prompt. PR checkboxes remain unchecked for human verification.

## Open decisions

1. Should manual movement commit immediately or with the next message in each owner mode?
2. Should Visual Novel share Roleplay wording exactly or have a distinct projection adapter?
3. Is `awarenessSummary` author-written only, or may Marinara draft it from the public description?
4. What source definitively establishes that a connected character is present?
5. What should Conversation see when the linked story is concluded or replaying history?
6. Should spatial lore use the normal lorebook budget or a reserved sub-budget?
7. Should the first release include direct links, or only parent/child navigation?
8. Does a story chat own Spatial Context directly, or should related Game sessions share one game-scoped owner record?
9. Should connected Conversation display the location badge even when the character is not currently present?
10. When multiple connected characters have different known information, does awareness eventually require per-character visibility?

## Recommended issue boundaries

### Issue 1: shared owner-mode MVP

> Add a shared Spatial Context hierarchy for Roleplay, Visual Novel, and Game with one focal position, server-validated parent/child and direct-link movement, a dedicated editor, breadcrumb/destination controls, persistence through reload and branches/checkpoints, and bounded owner-mode prompt injection. Exclude lorebook attachment, Conversation projection, model-controlled movement, visual maps, generic flags, and templates.

### Issue 2: connected Conversation projection

> Allow a Conversation linked to a Spatial Context owner to receive a safe, read-only current-location projection with conservative character-presence wording. Do not copy state, expose GM memory, activate story-only location lore, or permit Conversation to move the owner.

### Issue 3: location lorebook attachments

> Allow owner locations to force-activate attached lorebook entries under an explicit prompt budget, with Active Context reporting, broken-reference handling, and negative controls proving attached lore does not leak into connected Conversation.

### Issue 4: structured model movement

> Let Roleplay, Visual Novel, and Game models request typed location transitions restricted to currently valid destinations, with revision checks, idempotency, debug logging, and visible rejection diagnostics.

This sequencing establishes one shared spatial truth first, then adds cross-mode awareness and automation without turning Conversation into a competing scenario owner.
