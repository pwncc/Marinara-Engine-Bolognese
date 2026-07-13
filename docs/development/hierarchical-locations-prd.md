# Hierarchical Locations and Scoped Context

Status: Proposed

Audience: Product, design, and Marinara Engine contributors

Initial scope: Game Mode, hierarchy-only; no visual map editor or 3D renderer

## Summary

Add an authorable hierarchy of locations to Game Mode so the application, player, and Game Master share a persistent understanding of where the party is. Each location can contain a concise description, child locations, explicit links, and attached lorebook entries. Only context relevant to the current location is injected into the GM prompt.

The feature is intentionally non-visual. It provides the spatial and prompt foundations that a visual map could use later without requiring map drawing, irregular borders, or 3D rendering in the first release.

The system is best described as a hierarchical location graph used by a small reactive state machine:

```text
current location + location state
              ↓
resolve scoped context and valid destinations
              ↓
build the GM prompt
              ↓
player moves or the GM requests movement
              ↓
validate and persist the transition
              ↺
```

## Problem

Free-form roleplay models often lose spatial orientation. They may move characters between places without a valid route, confuse rooms or floors, reactivate details from an unrelated location, or require the entire setting description in every prompt.

Marinara's current Game Mode maps provide grids, node graphs, discovery state, multiple maps, and party position. They do not provide a first-class hierarchy of worlds, regions, buildings, floors, rooms, and location-scoped memories. The generated map is also not an author-controlled scenario context system.

Creators and players need a lightweight way to establish truths such as:

```text
Ashfall City
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

When the party is in the upstairs hallway, the GM should receive that location's memory, its ancestry, and valid nearby destinations—not the complete description of every location in the city.

## Goals

- Give the GM reliable, persistent spatial orientation.
- Let creators define nested locations without drawing a map.
- Activate location descriptions and lorebook entries by location identity rather than keyword coincidence.
- Keep prompt cost bounded by resolving only the current spatial context.
- Make movement explicit, validated, inspectable, and reversible through normal chat/session history behavior.
- Support both manual movement and optional structured GM movement requests.
- Establish a stable data model that can later power visual maps, floors, multiple character markers, scenario templates, or richer state rules.

## Non-goals for the first release

- A canvas or visual map editor.
- Grid drawing, polygons, irregular borders, or pathfinding.
- 2D-to-3D generation or a Maze War-style renderer.
- A general-purpose Voxta-style scenario scripting engine.
- Arbitrary JavaScript supplied by scenario authors.
- Timed, probabilistic, or chained events.
- General Boolean expressions over flags.
- Independent location tracking for every NPC.
- Automatic acceptance of location changes written in ordinary model prose.
- Replacing existing Game Mode maps.

## Product principles

### The application owns truth

The stored location graph, current location ID, and location state are authoritative. The model receives those facts and may request a transition, but it cannot mutate them merely by narrating that movement happened.

### Contexts describe; transitions happen

A location description continuously tells the GM what is currently true. A movement record tells the GM what changed. The prompt should not confuse a persistent fact such as "the party is in the library" with the event "the party entered the library."

### Identity beats keywords

Location attachment uses stable IDs. A lorebook entry attached to the active location is force-included according to a defined budget. Keywords may remain useful inside ordinary lorebook behavior, but they are not the authority for location activation.

### Start constrained

Version one tracks one party position and permits transitions only to defined destinations. A broader scenario engine can be considered independently after the location workflow proves useful.

## User stories

### Creator

- I can create a root location and nested child locations.
- I can give each location a name, description, and optional GM-only memory.
- I can attach existing lorebook entries to a location.
- I can connect two locations that are not parent and child, such as a hidden tunnel between buildings.
- I can choose the party's starting location.
- I can include a location hierarchy in a reusable Game Mode setup or template.

### Player

- I can see the current location as a breadcrumb.
- I can see valid destinations without needing a visual map.
- I can select a destination and include that movement in my next turn.
- I am warned when a destination is unavailable.
- I can distinguish a pending movement choice from the persisted current location.

### Game Master model

- I receive an authoritative current-location block every turn.
- I receive only the detailed location memory relevant to the current position.
- I know the current location's ancestors and valid destinations.
- I can request a location transition using structured output when the story clearly moves the party.
- I cannot invent a destination ID or bypass an unavailable link.

## Proposed experience

### Authoring

Add a **Locations** section to Game setup and Game chat settings. The initial editor can be a tree/list rather than a canvas.

Each location editor contains:

- Name
- Parent location
- Player-visible description
- Optional GM-only memory
- Attached lorebook entries
- Direct links to locations outside the parent/child relationship
- Availability: active or archived
- Starting-location selector

Core actions:

- Add child
- Add root
- Rename
- Move within hierarchy
- Link destination
- Duplicate subtree
- Archive or delete

Deletion must require explicit handling of children, links, and the current party position. The safe default is archive. Hard deletion should be unavailable while a location is referenced unless the user chooses a replacement and confirms the change.

### Playing

Show a compact location control near the existing Game Mode map or session controls:

```text
Ashfall City › Red Kettle Tavern › Upstairs Hallway

Go to:
- Common Room
- Room 1
- Room 2
- City Street
```

Selecting a destination creates a pending move. It does not immediately change the authoritative position. When the player submits the turn, the move and message are committed together from the user's perspective.

Suggested generated player text:

```text
[Travel to Room 2]
I carefully try the damaged door.
```

The structured destination ID should be sent separately from the visible text so renaming a location does not break the transition.

### GM-requested movement

The GM may emit a structured command when its narration clearly moves the whole party:

```json
{
  "action": "change_location",
  "destinationId": "loc_room_2",
  "reason": "The party enters Room 2."
}
```

The server validates the destination. In the first release, accepted GM transitions should be restricted to currently available destinations. Invalid requests are ignored, logged at debug level, and optionally surfaced as a recoverable warning in Game logs.

For ambiguous narration, no transition occurs. The system should prefer stale-but-explicit position over silently corrupting spatial state.

## Information model

Shared contracts should live under `packages/shared/src/types` and validation under `packages/shared/src/schemas`.

```ts
export interface GameLocation {
  id: string;
  name: string;
  parentId: string | null;
  description: string;
  gmMemory?: string;
  lorebookEntryIds: string[];
  links: GameLocationLink[];
  status: "active" | "archived";
  sortOrder: number;
}

export interface GameLocationLink {
  targetId: string;
  label?: string;
  bidirectional: boolean;
  state?: "available" | "hidden" | "blocked";
  requirementNote?: string;
}

export interface GameLocationState {
  locations: GameLocation[];
  currentLocationId: string | null;
  startingLocationId: string | null;
  revision: number;
}

export interface GameLocationTransition {
  id: string;
  fromLocationId: string | null;
  toLocationId: string;
  source: "player" | "gm" | "setup" | "restore";
  messageId?: string;
  createdAt: string;
}
```

Use a normalized flat list with `parentId`, not recursively embedded children. This makes updates, validation, linking, import/export, and partial UI rendering simpler. The client can derive a tree.

Stable opaque IDs must survive renames and reparenting. IDs should not be generated from names after creation.

### Storage

For the first version, store location definitions and current position in Game chat metadata, following existing map and widget persistence patterns. Session snapshots and branches must preserve them.

Recommended metadata fields:

```ts
gameLocations?: GameLocation[];
currentGameLocationId?: string | null;
startingGameLocationId?: string | null;
gameLocationRevision?: number;
gameLocationTransitions?: GameLocationTransition[];
```

If transition history duplicates existing message/session history excessively, store only the latest state plus transition records required for deterministic restore. Decide this during implementation after tracing current checkpoint and branch semantics.

## Hierarchy and navigation rules

The hierarchy establishes containment, not automatically every valid movement edge.

Version-one destination resolution should include:

- Active children of the current location.
- The active parent of the current location.
- Active direct links declared on the current location.
- Reverse direct links when the source link is bidirectional.

Siblings are not automatically reachable. A party in `Room 1` travels to the hallway before entering `Room 2` unless an explicit link says otherwise.

The graph must reject:

- Duplicate IDs.
- Missing parent or link targets.
- A location parenting itself.
- Parent cycles.
- Movement to archived, hidden, or blocked destinations.
- Movement to a destination outside the resolved destination set.
- Removing or archiving the current location without selecting a replacement.

Direct-link cycles are valid. Parent cycles are not.

## Prompt assembly

Add one bounded spatial-context section to the final GM prompt after committed game state and before the immediate turn instruction. Exact placement should be verified against the existing Game GM prompt runtime.

Example:

```text
<location_context>
Current path: Ashfall City > Red Kettle Tavern > Upstairs Hallway
Current location ID: loc_upstairs_hallway

Current location:
A narrow hallway with three rented rooms. The eastern door has a damaged lock.

Private GM memory:
The innkeeper uses Room 2 to hide confiscated letters.

Available destinations:
- Common Room [loc_common_room]
- Room 1 [loc_room_1]
- Room 2 [loc_room_2]
- City Street [loc_city_street]

Rules:
- Treat the current location and available destinations as authoritative.
- Do not place the party elsewhere unless a valid location transition occurs.
- If narration moves the whole party, request change_location with a listed destination ID.
</location_context>
```

### Context budget

Resolve context in this order:

1. Current breadcrumb names.
2. Current location description.
3. Current location GM memory.
4. Attached location lorebook entries.
5. Destination names and concise labels.
6. Optional short parent summary.

Do not inject full descriptions for every ancestor, child, sibling, or linked destination by default. Attached lorebook content must use a configurable or existing Game Mode lorebook budget and report truncation in Active Context.

### Lorebook behavior

- Location attachment force-activates the referenced entry while the location is current.
- Per-chat disabled lorebooks and entries remain disabled.
- Existing inclusion, recursion, ordering, and token-budget rules should be reused where possible.
- Missing entry IDs are ignored safely and shown as broken references in the editor.
- The Active Context UI should identify entries activated by `Current location` separately from keyword or semantic activation.

## Reactive state-machine interpretation

The location hierarchy defines the possible state space. `currentLocationId` is the active state. Available destinations define permitted transitions. Scoped descriptions and lorebook attachments are derived contexts.

This is intentionally narrower than a general scenario state machine:

| Concept | First release equivalent |
| --- | --- |
| Enum flag such as `location.bedroom` | `currentLocationId` |
| Conditional context | Active location description and attached lore |
| Eligible actions | Resolved destinations |
| State transition | Validated location change |
| Persistent variables | Existing game metadata/state; no new generic variable engine |
| Events and scripts | Out of scope |

Location-specific facts such as a locked door should initially remain in existing tracker, lorebook, or game-state systems. A future phase may add typed location flags and link requirements after the basic model proves stable.

## API design

Exact route shapes may be consolidated, but the feature needs these operations:

```text
GET    /api/game/:chatId/locations
PUT    /api/game/:chatId/locations
POST   /api/game/:chatId/locations/transition
```

Suggested transition request:

```ts
interface TransitionGameLocationRequest {
  destinationId: string;
  expectedRevision: number;
  source: "player" | "gm";
  messageId?: string;
}
```

Suggested response:

```ts
interface TransitionGameLocationResponse {
  locationState: GameLocationState;
  transition: GameLocationTransition;
}
```

Use an expected revision or equivalent concurrency check so a delayed GM action cannot overwrite a newer player transition.

The server must validate ownership, graph integrity, destination availability, and source permissions. Client filtering is presentation, not authorization.

## Integration with existing Game Mode maps

The hierarchy must not silently reuse `gameMap.partyPosition` as its source of truth. The systems have different purposes:

- Existing map position represents a generated grid cell or graph node.
- Hierarchical location represents author-controlled spatial context and prompt scope.

First release behavior:

- Both systems may be enabled independently.
- Hierarchical location context wins when describing the authoritative named location to the GM.
- Existing map movement does not change `currentLocationId` unless an explicit binding exists.
- No automatic binding is included initially.

A later phase can add optional bindings:

```ts
interface GameLocationMapBinding {
  locationId: string;
  mapId: string;
  position: string | { x: number; y: number };
}
```

That would allow a visual map click to request the same validated hierarchy transition without merging the two schemas.

## Import, export, branching, and templates

Location state must participate in:

- Game session creation and continuation.
- Checkpoints and restore.
- Chat branching.
- Marinara export/import.
- Backup and restore.
- Session history and replay where appropriate.

Creator templates are a follow-up deliverable unless existing Game setup export can carry the fields safely. A portable template must include location definitions, stable IDs, starting location, and lorebook references. Referenced lorebook entries need either bundled copies or an explicit unresolved-reference strategy.

Import validation should reject cycles and repair only unambiguous omissions. Never silently redirect broken links based only on matching names.

## Security and reliability

- Treat imported location text and model-generated transition reasons as untrusted content.
- Escape rendered names, descriptions, and labels.
- Do not execute scenario-authored JavaScript.
- Validate all structured GM commands with shared schemas.
- Cap location count, text size, link count, and hierarchy depth to prevent pathological prompt or UI behavior.
- Avoid logging full private location memory at normal log levels.
- In debug mode, log the final spatial prompt section through the existing Game prompt-debug path.
- Make transition operations idempotent where a message or command ID is available.

Initial suggested limits, subject to product review:

```text
Locations per game:       500
Maximum hierarchy depth:   20
Links per location:        50
Description:            4,000 characters
GM memory:              8,000 characters
```

Prompt budgets, not storage limits, determine how much text is sent on a turn.

## Proposed code ownership

These are intended homes, not a requirement to enlarge existing monoliths:

```text
packages/shared/src/types/game-location.ts
packages/shared/src/schemas/game-location.schema.ts

packages/server/src/services/game/location-graph.service.ts
packages/server/src/services/game/location-context.service.ts
packages/server/src/routes/game-location.routes.ts

packages/client/src/components/game/locations/GameLocationBreadcrumb.tsx
packages/client/src/components/game/locations/GameLocationPicker.tsx
packages/client/src/components/game/locations/GameLocationEditor.tsx
packages/client/src/hooks/use-game-locations.ts
```

Pure graph validation, ancestry resolution, and destination resolution may live in `packages/shared` if both client and server need identical behavior. The server remains authoritative.

Avoid adding substantial location orchestration directly to `GameSurface.tsx` or `game.routes.ts`; both are already identified as large mixed-responsibility files.

## Delivery phases

### Phase 0: Product and proof spike

- Confirm whether locations are game-scoped or reusable at launch.
- Trace Game prompt assembly, checkpoints, branches, and exports.
- Prototype graph validation and scoped prompt output with fixtures.
- Measure prompt size for shallow, deep, and lore-heavy hierarchies.
- Decide how a pending player move commits relative to message creation and generation.

Deliverable: approved schema and prompt example, with no user-facing feature.

### Phase 1: Core hierarchy and manual movement

- Shared contracts and schemas.
- Server-side graph validation and destination resolution.
- Persistence in game metadata and snapshots.
- Tree/list authoring UI.
- Breadcrumb and destination picker.
- Manual, validated party transitions.
- Scoped location description in GM prompts.
- Active Context reporting and prompt debug logging.

This is the minimum viable feature.

### Phase 2: Lorebook attachment and portability

- Attach existing lorebook entries.
- Force activation under the normal token budget.
- Surface broken references.
- Preserve location state through import/export and reusable setup/template flows.
- Add duplicate-subtree and larger-authoring affordances.

### Phase 3: Structured GM transitions

- Add a typed `change_location` command/tool.
- Filter eligible destinations into the GM instruction.
- Validate revision and adjacency.
- Show accepted/rejected transitions in Game logs.
- Add retry and idempotency coverage.

### Future candidates

- Location-specific typed flags and conditional links.
- Separate character or party-member positions.
- Bindings to existing generated maps.
- Visual hierarchy/map rendering.
- Floors and layer selectors as presentation over child locations.
- Creator-distributed scenario packages.
- Deterministic 2D/3D renderers using the same authoritative graph.

These candidates should not be bundled into the MVP.

## Acceptance criteria for the MVP

### Authoring

- A user can create, rename, reparent, archive, and order nested locations.
- The editor prevents parent cycles and broken required references.
- A user can choose exactly one starting location.
- Reloading the chat preserves the hierarchy and current location.

### Runtime

- The current location is displayed as a breadcrumb.
- The destination picker contains only the current parent, active children, and valid direct links.
- Selecting an invalid or stale destination cannot change stored state.
- A successful transition updates the location once and survives reload.
- A branch or restored checkpoint receives the correct location state for that point.

### Prompt behavior

- The final GM prompt includes the current path, current description, and valid destination names.
- It does not include unrelated location descriptions.
- Renaming a location does not break current position or links.
- Missing or archived locations fail safely without injecting misleading context.
- Debug mode exposes the exact final spatial context sent to the provider.

### Lorebooks, if included in the same release

- Entries attached to the current location activate without keyword matches.
- Entries attached only to inactive locations do not activate because of the attachment.
- Disabled lorebooks and entries remain disabled.
- Active Context identifies location-based activation and any truncation.

## Validation plan

Automated or deterministic regression coverage should include:

- Valid and cyclic parent graphs.
- Destination resolution for parent, child, one-way link, bidirectional link, hidden link, blocked link, and archived locations.
- Stale revision rejection.
- Rename and reparent stability.
- Branch, checkpoint, export, and import round trips.
- Prompt inclusion for the active location and negative controls for inactive locations.
- Lorebook activation, disabled-entry behavior, ordering, and token truncation.
- Duplicate GM command idempotency.

Repository validation:

```bash
pnpm check
pnpm regression:prompt
pnpm smoke:ui
```

Manual verification must cover desktop and mobile authoring, empty state, deep breadcrumbs, long names, deletion/archive protections, reload, branching, and a real GM turn with Peek Prompt. PR test-plan checkboxes must remain unchecked for the human contributor.

## Open product decisions

1. Should the MVP be limited to Game Mode, or should Roleplay mode share the same location contracts later?
2. Does selecting a destination immediately move the party, or commit only with the next message?
3. Should parent/child containment imply movement, or should every movement require an explicit link? This proposal uses parent/child movement for usability.
4. Should GM-requested transitions ship with the MVP or only after manual movement is stable?
5. Are location descriptions visible to players, or can creators mark them GM-only independently from `gmMemory`?
6. Do location-attached lorebook entries consume the ordinary lorebook budget, a reserved location budget, or both?
7. Should location hierarchies be copied into each game or reference a reusable template with per-game overrides?
8. How should concluded-session replay expose historical location changes?

## Recommended first issue boundary

Before implementation, open a feature request and confirm ownership. The first implementation issue should be limited to:

> Add a game-scoped hierarchical location model with one party position, server-validated parent/child navigation, a tree editor, a breadcrumb/destination picker, persistence across reload and branches, and current-location prompt injection. Exclude lorebook attachment, GM-controlled movement, visual maps, generic flags, scripts, and reusable templates.

That boundary is large enough to prove the core user value while remaining reviewable. Lorebook attachment and structured GM transitions can follow as separate issues after the persistence and prompt behavior are demonstrated.
