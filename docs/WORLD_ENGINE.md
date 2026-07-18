# Living World Engine

The Living World engine makes characters live *between* your sessions — continuously, at the pace of real life, not in bursts. Two simulation styles:

## Character minds (default — natural, emergent)

**No narrator. Every world member is its own agent** with a persistent mind: a private journal, a current intention and mood, read-cursors into the world, and their own wake clock.

Every mind owns a **permanent life chat** (`Alice's life`) — a real conversation session where their inner life accumulates forever: thoughts (saved as *italic* messages), things they say aloud, and anything you write to them. **You can intrude on any of it**: open a life chat, DM thread, or group thread from the world timeline and type — your message pulls that character's next check-in earlier (presence-shaped, minutes when they're around), they find it in their space, and they answer you there, with the entire context kept.

On their own schedule — pulled earlier by pings (a DM, a group message, your intrusion) — a character **wakes in a private first-person context**: their card, their life chat tail, their relationships *as they see them*, their memories, and only what's new **to them**: their Noodle feed since they last looked, replies and likes on their own posts, their DM and group threads with unread markers. They journal a thought, and freely choose a few small actions — post, reply, text someone, speak in their space, start or answer a **group thread** (2+ others, persistent, intrudable), make or resolve a plan, let a feeling shift, keep a memory — **or nothing, which the prompt explicitly frames as honest living**. They also choose when they'd naturally check in again.

Interaction is emergent by construction: Alice's message is just something Bob finds, in his own head, when he next checks his phone. Nobody ever writes both sides of a conversation.

**Living, not just chatting:** minds narrate their day with `do` actions (work, errands, fun) — lived moments that become their current intention and accumulate in their life chat. Noodle posts can attach a generated photo/meme (`imagePrompt`, rendered through Noodle's own image settings and connection). World members are auto-provisioned with invited Noodle accounts (immediately on config save), and every world chat files into a **"Living World" sidebar folder** so your personal DM list stays clean. When you talk in a world chat through the normal pipeline, the character card's roleplay `scenario` is suppressed and a life-space framing is injected instead — their life has no script; continuity comes from history and memory.

**Pacing:** the world trickles. Scheduled wakes keep a global minimum gap scaled to the roster (one wake per cycle; fresh worlds stagger first wakes across a wide window), so life unfolds over hours instead of bursts — only direct pings pull someone in fast, because answering a text quickly is the one thing that *is* natural.

**Memory across surfaces:** mind memories (`remember`) and world relationships inject into normal conversation prompts too — recent memories in full plus a carried tail of older ones — so when two characters meet again in one of *your* chats or group roleplays, they arrive already knowing their history.

## Director (cheap fallback — authored)

One planning call per window snapshots the whole world and writes a **timeline** (each moment carries a time offset); a no-LLM drip loop executes moments when their clock arrives. An order of magnitude cheaper (one call per window vs one per character wake), at the cost of a single authorial voice and moments written before they happen. Stale moments (missed by more than 6h) are skipped rather than dumped in a burst.

**World membership** applies to both modes: config carries `memberCharacterIds` (null = everyone) — the noodle-invite-style roster in the panel. Non-members don't exist to the simulation and executors reject them defensively.

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
character-mind.service.ts           minds mode: per-character wake context, prompt, execution, wake scheduling
world-engine-scheduler.service.ts   poll loop (45s): wake due minds — or drip + director in director mode
world-engine.service.ts             config/state, provider resolution, action executors, director planning
world.storage.ts                    world_events + character_relationships + world_actions + character_minds
world.routes.ts                     /api/world/* (feed, relationships, config, status, tick)
shared/types/world.ts               config, stages, records shared with the client
components/panels/WorldPanel.tsx    Living World panel (status, config, timeline, bonds)
```

The **Living World panel** (orbit icon in the top bar) shows engine status and queued-moment count, the world timeline as it accretes, and the Bonds browser — every pair's stage, score, milestones, and full shared history. DM events open the real chat thread. `POST /api/world/tick` (the panel's "Advance the world" button) plans a window immediately and plays anything already due.

The engine deliberately reuses existing substrate rather than duplicating it: Noodle storage for public activity, `chats.create`/`createMessage` for DM threads (the roleplay-DM pattern), `characterMemories` for memory, `conversation-presence` schedules for who's awake.

## Roadmap

- **Phase 2 — Surfaces:** a World panel in the client (live feed, relationship graph, pair timelines, config UI); "what happened while you were away" digest on chat open.
- **Phase 3 — Convergence:** plans that materialize — a group plan spawns a real group chat or planned roleplay scene (via the existing `[scene:]`/`create_chat` machinery); characters reference world events and relationships inside normal chats via context injection; the user appears in the world (characters react to your Noodle posts, plan around you, invite you).
- **Phase 4 — Depth:** semantic world memory (embed world events into `memory_chunks` for recall in any chat); relationship-aware autonomous messaging (close friends text differently than rivals); life arcs (jobs, moves, projects) as long-running plans.
