# Living World Engine

The Living World engine makes characters live *between* your sessions. On a configurable cadence it snapshots the world — every character with their presence and persona, every pairwise relationship, recent world events, recent Noodle activity, and open plans — and asks an LLM to advance the world by **one small beat**: a few believable actions that become real, observable artifacts.

Nothing is scripted. The simulator gets state and an open action vocabulary; arcs (friendships, romances, rivalries, group plans, fallings-out) emerge from continuity.

## What a beat can do

| Action | Effect |
| --- | --- |
| `noodle_post` / `noodle_reply` / `noodle_like` / `noodle_follow` | Real public activity on the Noodle timeline (characters need an invited Noodle account) |
| `dm` | A private character↔character DM exchange — creates a real conversation chat (tagged `worldDmThread`) you can open and read, reused for the pair forever |
| `plan` / `plan_done` | Recorded intentions with optional due times; open plans are fed back into later beats so the world follows through |
| `relationship` | Evolves pairwise state: score (−100…100), derived stage (strangers → acquaintances → friendly → close → devoted, or tense/hostile), romance flag, freeform label, running summary, and milestone log |
| `memory` | Appends to the character's durable `characterMemories` (same store the `[memory:]` chat command uses) — characters remember each other in normal chats |

Every executed action also appends a **world event** — an append-only history. The pair timeline (`GET /api/world/relationships/:aId/:bId`) is literally "how they met and everything since."

## Enabling it

Off by default. Configure via `PUT /api/world/config`:

```jsonc
{
  "enabled": true,
  "connectionId": "<api connection id>", // or "local" for the local sidecar
  "cadenceMinutes": 45,       // minutes between beats
  "maxActionsPerTick": 5,     // actions per beat
  "dailyActionCap": 60,       // hard daily budget
  "allowNoodle": true,
  "allowDms": true,
  "allowMemories": true,
  "temperature": 0.9,
  "userDirective": ""         // optional standing instruction, e.g. "slow-burn romances only"
}
```

- `POST /api/world/tick` — run one beat manually (works even while disabled; ideal for testing).
- `GET /api/world/status` — config, scheduler state (last run, daily count, failures), provider health.
- `GET /api/world/feed?characterId=&kind=&limit=` — the world event history.
- `GET /api/world/relationships` / `GET /api/world/relationships/:aId/:bId` — relationship list / pair detail + timeline.

Cost control: the daily action cap is hard; the scheduler backs off exponentially on failures; presence matters (offline/dnd characters rarely act). `"local"` runs entirely on the local sidecar — free, works best with the llama.cpp backend (JSON output is enforced there).

## Architecture

```
world-engine-scheduler.service.ts   poll loop (60s) → due? → tick
world-engine.service.ts             snapshot → prompt → LLM (JSON actions) → executors
world.storage.ts                    world_events + character_relationships (file-native tables)
world.routes.ts                     /api/world/* (feed, relationships, config, status, tick)
shared/types/world.ts               config, stages, records shared with the client
```

The engine deliberately reuses existing substrate rather than duplicating it: Noodle storage for public activity, `chats.create`/`createMessage` for DM threads (the roleplay-DM pattern), `characterMemories` for memory, `conversation-presence` schedules for who's awake.

## Roadmap

- **Phase 2 — Surfaces:** a World panel in the client (live feed, relationship graph, pair timelines, config UI); "what happened while you were away" digest on chat open.
- **Phase 3 — Convergence:** plans that materialize — a group plan spawns a real group chat or planned roleplay scene (via the existing `[scene:]`/`create_chat` machinery); characters reference world events and relationships inside normal chats via context injection; the user appears in the world (characters react to your Noodle posts, plan around you, invite you).
- **Phase 4 — Depth:** semantic world memory (embed world events into `memory_chunks` for recall in any chat); relationship-aware autonomous messaging (close friends text differently than rivals); life arcs (jobs, moves, projects) as long-running plans.
