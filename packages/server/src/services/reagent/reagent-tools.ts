// ──────────────────────────────────────────────
// REagent tools: what the writer can do while it reasons.
//
// Definitions are plain function-calling schemas; execution runs here rather
// than in the generic tool executor because these calls need the chat's
// workspace, the transcript, the status ledger and the SSE stream.
// ──────────────────────────────────────────────

import { randomInt } from "node:crypto";
import { readFile, stat, writeFile, mkdir, rm } from "node:fs/promises";
import { dirname, basename, join, resolve } from "node:path";
import {
  REAGENT_CHARACTER_NOTES_DIR,
  REAGENT_MEMORY_FILE,
  REAGENT_SCENE_FIELDS,
  REAGENT_SIMULATION_FILE,
  CHARACTER_STATUS_BAR_SPECS,
  DEFAULT_STATUS_LIMBS,
  buildPresentCharacterUpdate,
  decayedReagentMood,
  parseReagentSimulation,
  type PresentCharacter,
  type PresentCharacterUpdate,
  type LLMToolCall,
  type LLMToolDefinition,
  type ReagentActivityEntry,
  type ReagentBelief,
  type ReagentMood,
  type ReagentSettings,
  type ReagentSimulationState,
  type ReagentToolFamily,
  type ReagentVoice,
} from "@marinara-engine/shared";
import type { DB } from "../../db/connection.js";
import { logger } from "../../lib/logger.js";
import { newId } from "../../utils/id-generator.js";
import { createChatsStorage } from "../storage/chats.storage.js";
import { createLorebooksStorage } from "../storage/lorebooks.storage.js";
import { optimizeNoodleVisionImage } from "../noodle/noodle-vision.js";
import { stripHtml, decodeHtmlEntities } from "../professor-mari/fandom-mediawiki/html-text.js";
import type { LorebookSearchFn, ToolExecutionResult } from "../tools/tool-executor.js";
import { createApproval } from "./reagent-approvals.js";
import { judgeCommand, runShellCommand } from "./reagent-shell.js";
import {
  REAGENT_MAX_IMAGE_BYTES,
  REAGENT_MAX_TEXT_FILE_BYTES,
  REAGENT_MAX_VIDEO_BYTES,
  classifyFileKind,
  listDirectory,
  looksBinary,
  resolveReagentPath,
  videoMimeType,
} from "./reagent-workspace.js";

export interface ReagentMedia {
  kind: "image" | "video";
  name: string;
  dataUrl: string;
  mimeType: string;
}

export interface ReagentToolOutcome {
  result: ToolExecutionResult;
  media: ReagentMedia[];
  approval?: ReagentActivityEntry["approval"];
}

export interface ReagentCharacter {
  id: string;
  name: string;
}

export interface ReagentExecutorDeps {
  db: DB;
  chatId: string;
  chatName: string;
  settings: ReagentSettings;
  workspaceDir: string;
  characters: ReagentCharacter[];
  /** Tracker rows as the reply starts: cards and NPCs alike. */
  trackerCharacters: PresentCharacter[];
  /** The character speaking this turn, when exactly one is. */
  callingCharacterId: string | null;
  /** A regenerate replaces this message: it and everything after it are not part of the past. */
  beforeMessageId?: string | null;
  searchLorebook?: LorebookSearchFn;
  signal?: AbortSignal;
  sendEvent?: (payload: Record<string, unknown>) => void;
  onStatusPatch: (update: PresentCharacterUpdate) => void;
  /** A tracker row (by characterId or name) the writer says left the scene. */
  onRosterRemove: (reference: string) => void;
  onFileVersion: (workspaceRelativePath: string, content: string | null) => void;
}

const MAX_RECENT_EVENTS = 12;
const MAX_RESOLVED_THREADS = 10;

const RESULT_TEXT_LIMIT = 12_000;
const MESSAGE_SNIPPET = 220;
const MESSAGE_READ_LIMIT = 4_000;

function clip(text: string, limit = RESULT_TEXT_LIMIT) {
  return text.length > limit ? `${text.slice(0, limit)}\n…[truncated ${text.length - limit} characters]` : text;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function num(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

// ── Definitions ──

const def = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []) =>
  ({
    type: "function" as const,
    function: { name, description, parameters: { type: "object", properties, required } },
  }) satisfies LLMToolDefinition;

const FILE_TOOLS: LLMToolDefinition[] = [
  def(
    "read_file",
    "Read a file. Text files come back as text; images and videos are shown to you as real inputs so you can look at them. Relative paths are inside your workspace; absolute paths read anywhere you are allowed to.",
    {
      path: { type: "string", description: "File path, relative to the workspace or absolute." },
      offset: { type: "integer", description: "Text files: first line to return (1-based)." },
      limit: { type: "integer", description: "Text files: how many lines to return." },
    },
    ["path"],
  ),
  def("list_dir", "List a directory. Defaults to the workspace root.", {
    path: { type: "string", description: "Directory path, relative to the workspace or absolute." },
  }),
  def(
    "write_file",
    "Create or overwrite a text file in your workspace (or an allowed folder). Writes inside the workspace are tied to this reply: swiping or regenerating it reverts them.",
    {
      path: { type: "string", description: "File path, relative to the workspace." },
      content: { type: "string", description: "The complete new file content." },
    },
    ["path", "content"],
  ),
  def(
    "edit_file",
    "Replace one exact text passage in a text file. The old text must appear exactly once unless replace_all is true.",
    {
      path: { type: "string" },
      old_text: { type: "string", description: "Exact text to find." },
      new_text: { type: "string", description: "Replacement text." },
      replace_all: { type: "boolean" },
    },
    ["path", "old_text", "new_text"],
  ),
  def("delete_file", "Delete a file in your workspace.", { path: { type: "string" } }, ["path"]),
];

const MEMORY_TOOLS: LLMToolDefinition[] = [
  def(
    "update_memory",
    `Update ${REAGENT_MEMORY_FILE}, the notes you are shown at the start of every reply. Use it for things worth remembering across the whole chat: facts about the people here, promises, running threads, your own plans. Keep it tidy and short; rewrite rather than pile up.`,
    {
      mode: { type: "string", enum: ["replace", "append"], description: "Replace the whole file or append a section." },
      content: { type: "string" },
    },
    ["mode", "content"],
  ),
];

const RECALL_TOOLS: LLMToolDefinition[] = [
  def(
    "search_messages",
    "Search this chat's full history for messages matching words or a phrase, newest first. Use it to check what was actually said instead of guessing.",
    {
      query: { type: "string", description: "Words or a phrase to look for." },
      limit: { type: "integer", description: "Maximum matches (default 10, max 30)." },
      speaker: { type: "string", description: "Only messages by this speaker name, or 'user'." },
    },
    ["query"],
  ),
  def("read_messages", "Read messages in full by id (from search_messages) or by position in the transcript.", {
    ids: { type: "array", items: { type: "string" } },
    from_index: { type: "integer", description: "1-based position of the first message to read." },
    to_index: { type: "integer", description: "1-based position of the last message to read (max 20 at once)." },
  }),
];

const STATUS_BAR_GUIDE = CHARACTER_STATUS_BAR_SPECS.map(
  (spec) => `${spec.name}: ${spec.description} ${spec.dynamics}`,
).join("\n");

const STATUS_TOOLS: LLMToolDefinition[] = [
  def(
    "set_character_status",
    `Update a character's body/mood ledger directly. Only include fields that changed. Bars are 0-100 and every character has these standard meters (keep the names, add others only when the story needs them):\n${STATUS_BAR_GUIDE}\nLimb keys: ${DEFAULT_STATUS_LIMBS.join(", ")} (sensation, position, what it holds; empty means nothing notable).`,
    {
      character: { type: "string", description: "Character name. Optional when you are the only character speaking." },
      emotion: { type: "string" },
      emotion_cause: { type: "string", description: "One short clause explaining the emotion." },
      temperature: { type: "string" },
      notes: { type: "string", description: "Bodily notes: shaking, tipsy, tired…" },
      bars: { type: "object", additionalProperties: { type: "number" }, description: 'e.g. {"hunger": 70}' },
      limbs: { type: "object", additionalProperties: { type: "string" }, description: "Per body part state." },
      extras: { type: "object", additionalProperties: { type: "string" } },
      appearance: { type: "string", description: "Short physical description, when it changed." },
      outfit: { type: "string", description: "What they are wearing now." },
      thoughts: { type: "string", description: "What they are privately thinking right now." },
      emoji: { type: "string" },
    },
  ),
];

const ROSTER_TOOLS: LLMToolDefinition[] = [
  def(
    "list_characters",
    "List everyone the tracker knows: the chat's character cards and every tracked person (NPCs included) with their current state. Use it before adding someone, to get exact names, and to see who is around.",
    {},
  ),
  def(
    "add_character",
    "Add a person to the tracker: an NPC, a passer-by who matters, anyone not already listed. They get the standard meters and a card in the tracker. Use set_character_status for later changes.",
    {
      name: { type: "string" },
      emoji: { type: "string", description: "One emoji that fits them." },
      appearance: { type: "string", description: "Short physical description." },
      outfit: { type: "string" },
      mood: { type: "string" },
      emotion_cause: { type: "string" },
      thoughts: { type: "string" },
      notes: { type: "string", description: "Bodily notes." },
      extras: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "Role, relation, anything else.",
      },
    },
    ["name"],
  ),
  def(
    "remove_character",
    "Remove a person from the tracker because they left the scene or stopped mattering. Their dossier stays.",
    { character: { type: "string" } },
    ["character"],
  ),
];

const NOTES_TOOLS: LLMToolDefinition[] = [
  def(
    "note_character",
    `Record how a person is changing: a shift in how they see someone, a new habit, a goal, a secret learned, a wound, a promise, a lesson. One dated line goes into their dossier in ${REAGENT_CHARACTER_NOTES_DIR}/. Works for anyone, tracked or not. Read the dossier before writing someone who has one.`,
    {
      character: { type: "string" },
      kind: {
        type: "string",
        enum: ["development", "relationship", "goal", "secret", "habit", "history", "change"],
      },
      entry: { type: "string", description: "One or two sentences, concrete." },
    },
    ["character", "entry"],
  ),
  def("read_character_notes", "Read a person's dossier, or list all dossiers when no character is given.", {
    character: { type: "string" },
  }),
];

const SIMULATION_TOOLS: LLMToolDefinition[] = [
  def(
    "set_scene",
    "Move your own scene clock: date, time, location, weather, felt temperature. Call it whenever time passes or the scene moves, even by minutes. `event` adds one line to your recent-events list. This is your ledger in simulation.json, separate from any tracker agent.",
    {
      date: { type: "string" },
      time: { type: "string" },
      location: { type: "string" },
      weather: { type: "string" },
      temperature: { type: "string" },
      event: { type: "string", description: "One concrete thing that just happened, worth remembering." },
    },
  ),
  def(
    "resolve_chance",
    "Let chance decide whether something uncertain works out, instead of deciding it yourself. Give your honest odds of success (0-100) for the attempt as the world would see it; play the result straight. Use it for attempts, luck, timing, whether someone is home, whether the bus is late.",
    {
      action: { type: "string", description: "What is being attempted or what might happen." },
      odds: { type: "integer", description: "Chance of success, 0-100." },
    },
    ["action", "odds"],
  ),
  def(
    "pick_random",
    "Pick one option at random when several things could plausibly happen and none should be chosen for drama.",
    { options: { type: "array", items: { type: "string" }, description: "Two or more options." } },
    ["options"],
  ),
  def(
    "add_thread",
    "Open a loose thread: something that will come due later whether or not anyone is paying attention (a shift that ends, a bill, a promise, an unanswered message, someone on their way). Open threads are shown to you every reply until resolved.",
    {
      what: { type: "string" },
      when: { type: "string", description: "When or on what condition it comes due." },
      who: { type: "string", description: "Who it belongs to." },
      stakes: { type: "string", description: "What happens if it is ignored." },
    },
    ["what"],
  ),
  def(
    "resolve_thread",
    "Close a loose thread once it came due, with what actually happened. Resolve it even when the outcome is mundane or someone dropped the ball.",
    { id: { type: "string" }, outcome: { type: "string" } },
    ["id", "outcome"],
  ),
  def(
    "set_whereabouts",
    "Record where someone who is not in the scene is and what they are doing, so people keep living off-screen and can turn up, call, or be busy. Set clear to true when they are back in the scene or no longer worth tracking.",
    {
      character: { type: "string" },
      where: { type: "string" },
      doing: { type: "string" },
      until: { type: "string", description: "Until when, or what ends it." },
      clear: { type: "boolean" },
    },
    ["character"],
  ),
];

const LOREBOOK_TOOLS: LLMToolDefinition[] = [
  def(
    "lookup_lorebook",
    "Search the lorebooks active in this chat for entries about a topic.",
    { query: { type: "string" } },
    ["query"],
  ),
  def(
    "write_lorebook_entry",
    "Create or update an entry in this chat's own lorebook so a fact is injected whenever its keywords come up later.",
    {
      name: { type: "string", description: "Entry title; an existing entry with this name is updated." },
      content: { type: "string" },
      keys: { type: "array", items: { type: "string" }, description: "Trigger keywords." },
      mode: { type: "string", enum: ["replace", "append"] },
    },
    ["name", "content", "keys"],
  ),
];

const WEB_TOOLS: LLMToolDefinition[] = [
  def(
    "fetch_url",
    "Fetch a web page or file over HTTP(S) and return its readable text.",
    { url: { type: "string" }, max_chars: { type: "integer", description: "Default 12000." } },
    ["url"],
  ),
];

const SHELL_TOOLS: LLMToolDefinition[] = [
  def(
    "run_command",
    "Run a shell command on this machine and get its output. The working directory defaults to your workspace. Depending on the chat's policy the command may wait for the user's approval or be refused.",
    {
      command: { type: "string" },
      cwd: { type: "string", description: "Working directory, relative to the workspace or absolute." },
      reason: { type: "string", description: "One line on why, shown to the user when approval is needed." },
    },
    ["command"],
  ),
];

const MINDS_TOOLS: LLMToolDefinition[] = [
  def(
    "learn",
    "Record one thing a person now knows, was told, or has concluded. Nobody reacts to anything that is not in their ledger, so record what each person actually witnessed or heard, and mark guesses that happen to be false with wrong=true.",
    {
      character: { type: "string" },
      fact: { type: "string" },
      source: { type: "string", description: "saw it / told by X / overheard / guessed." },
      secret: { type: "boolean", description: "They keep it from others." },
      wrong: { type: "boolean", description: "They believe it and it is not true." },
    },
    ["character", "fact"],
  ),
  def(
    "knows",
    "What a person knows about something, from their ledger only. Check before letting someone react to, mention or act on a fact. Without `about`, their whole ledger.",
    { character: { type: "string" }, about: { type: "string", description: "Words to look for." } },
    ["character"],
  ),
  def(
    "forget",
    "Remove a ledger entry by id (they never knew it, or you recorded it wrongly).",
    {
      character: { type: "string" },
      id: { type: "string" },
    },
    ["character", "id"],
  ),
  def(
    "set_objective",
    "Set what a person wants right now, what is in the way, and the tactic they are using. Replaces their current objective outright; a want can change any time. Every line a person speaks is a tactic in pursuit of a want.",
    {
      character: { type: "string" },
      want: { type: "string" },
      obstacle: { type: "string" },
      tactic: { type: "string", description: "How they are going about it right now." },
    },
    ["character", "want"],
  ),
  def(
    "tactic_result",
    "The current tactic visibly worked or failed. A failed tactic is dropped (kept in `tried`); give the next one or leave the person without a plan for a while. A tactic runs until this says it ended.",
    {
      character: { type: "string" },
      result: { type: "string", enum: ["worked", "failed"] },
      next_tactic: { type: "string" },
    },
    ["character", "result"],
  ),
  def(
    "drop_objective",
    "The person no longer wants this (got it, gave up, or something bigger came up).",
    {
      character: { type: "string" },
      why: { type: "string" },
    },
    ["character"],
  ),
  def(
    "set_status",
    "How a person is playing their standing toward someone in this exchange: high (takes space, holds eye contact, interrupts, decides), low (yields, apologises, fills silence, asks), or equal. Status shifts line by line and is not the same as rank.",
    {
      character: { type: "string" },
      toward: { type: "string", description: "The other person." },
      level: { type: "string", enum: ["high", "low", "equal"] },
      note: { type: "string", description: "What it looks like right now." },
    },
    ["character", "toward", "level"],
  ),
];

const AFFECT_TOOLS: LLMToolDefinition[] = [
  def(
    "appraise",
    "Let an event decide a person's emotion instead of choosing one. Give how the event bears on what they want, who caused it, whether they saw it coming and how much they can do about it; the tool returns the emotion, its strength and what it pushes them to do, and sets their mood. The emotion then fades with the scene clock.",
    {
      character: { type: "string" },
      event: { type: "string", description: "What just happened, concretely." },
      impact: {
        type: "integer",
        description: "-5 (ruins what they want) to 5 (gives them what they want). 0 = beside the point.",
      },
      agency: { type: "string", enum: ["self", "other", "nobody"], description: "Who brought it about." },
      expected: { type: "boolean", description: "They saw it coming." },
      control: { type: "integer", description: "0-100: how much they can still do about it." },
    },
    ["character", "event", "impact", "agency"],
  ),
  def("mood_check", "A person's current emotion as it has faded by now, or everyone's when no character is given.", {
    character: { type: "string" },
  }),
];

const SPEECH_TOOLS: LLMToolDefinition[] = [
  def(
    "set_voice",
    "Record how a person talks, as a budget you follow: register, sentence length, fillers, what they never say out loud, how often they hesitate or trail off. Only include fields that changed.",
    {
      character: { type: "string" },
      register: { type: "string", description: "e.g. flat, clipped, formal, warm, sarcastic." },
      sentences: { type: "string", description: "e.g. short, run-on, trails off." },
      fillers: { type: "string", description: "The actual words: uh, like, I mean, right." },
      avoids: { type: "string", description: "What they will not say out loud." },
      disfluency: { type: "number", description: "0-1: share of lines with a hesitation, restart or trailing off." },
      quirks: { type: "string" },
    },
    ["character"],
  ),
  def(
    "turn_shape",
    "Before a line, draw the shape of this person's next turn: answer, minimal, counter-question, deflect, silence, backchannel, interrupt, change subject, or pursue their tactic. Weighted by their mood, their status toward the listener and whether they have a plan. Take the shape as drawn; people often do not answer.",
    { character: { type: "string" }, addressing: { type: "string", description: "Who they are talking to." } },
    ["character"],
  ),
  def(
    "mean_vs_say",
    "Record the gap between what a person means and what they will say. Only the said part goes into the reply; the meaning stays in the ledger and in how they say it.",
    { character: { type: "string" }, means: { type: "string" }, says: { type: "string" } },
    ["character", "means", "says"],
  ),
];

const AMBIENT_TOOLS: LLMToolDefinition[] = [
  def(
    "scene_pressure",
    "Draw whether anything happens in the next stretch at all. Most of the time nothing does and the answer is maintenance (a habit, a chore, a wait). Sometimes a small friction, rarely an interruption from a thread coming due, someone off-screen, or the weather. Take the draw as it falls.",
    {},
  ),
];

const FAMILY_TOOLS: Record<ReagentToolFamily, LLMToolDefinition[]> = {
  files: FILE_TOOLS,
  memory: MEMORY_TOOLS,
  recall: RECALL_TOOLS,
  status: STATUS_TOOLS,
  roster: ROSTER_TOOLS,
  notes: NOTES_TOOLS,
  simulation: SIMULATION_TOOLS,
  minds: MINDS_TOOLS,
  affect: AFFECT_TOOLS,
  speech: SPEECH_TOOLS,
  ambient: AMBIENT_TOOLS,
  lorebook: LOREBOOK_TOOLS,
  web: WEB_TOOLS,
  shell: SHELL_TOOLS,
  noodle: [],
  images: [],
};

export function reagentToolDefinitions(settings: ReagentSettings): LLMToolDefinition[] {
  if (!settings.enabled) return [];
  const defs: LLMToolDefinition[] = [];
  for (const [family, tools] of Object.entries(FAMILY_TOOLS) as Array<[ReagentToolFamily, LLMToolDefinition[]]>) {
    if (settings.tools[family]) defs.push(...tools);
  }
  return defs;
}

export function isReagentToolName(name: string) {
  return Object.values(FAMILY_TOOLS).some((tools) => tools.some((tool) => tool.function.name === name));
}

// ── Appraisal ──

export interface AppraisalInput {
  impact: number;
  agency: "self" | "other" | "nobody";
  expected: boolean;
  control: number;
}

const TENDENCIES: Record<string, string> = {
  anger: "confront, or withhold and go cold",
  resentment: "comply on the surface, keep score",
  guilt: "repair, over-explain, offer things",
  shame: "hide, deflect, get small",
  fear: "avoid, freeze, check the exits",
  frustration: "push harder, snap at the nearest person",
  sadness: "withdraw, go quiet, do less",
  resignation: "go through the motions",
  gratitude: "soften, move closer, owe something",
  pride: "take up room, say more than needed",
  relief: "loosen, laugh too easily, let things slide",
  contentment: "settle in, stop checking the time",
  surprise: "stall, ask again, re-read the room",
  interest: "approach, ask, watch",
  indifference: "carry on with what they were doing",
};

/** OCC-style rules: goal impact, who caused it, expectedness and coping decide the emotion, not the plot. */
export function appraiseEvent(input: AppraisalInput): {
  emotion: string;
  intensity: number;
  valence: number;
  tendency: string;
} {
  const impact = Math.max(-5, Math.min(5, Math.round(input.impact)));
  const control = Math.max(0, Math.min(100, Math.round(input.control)));
  const unexpected = !input.expected;
  let emotion: string;
  if (impact === 0) emotion = unexpected ? "surprise" : "indifference";
  else if (impact > 0) {
    if (input.agency === "other") emotion = "gratitude";
    else if (input.agency === "self") emotion = "pride";
    else emotion = unexpected ? "relief" : "contentment";
  } else if (input.agency === "other") emotion = control >= 50 ? "anger" : "resentment";
  else if (input.agency === "self") emotion = control >= 50 ? "guilt" : "shame";
  else if (unexpected) emotion = control >= 50 ? "frustration" : "fear";
  else emotion = control >= 50 ? "frustration" : "resignation";
  if (emotion === "indifference") return { emotion, intensity: 0, valence: 0, tendency: TENDENCIES[emotion]! };
  const base = impact === 0 ? 25 : Math.abs(impact) * 18;
  const intensity = Math.min(100, Math.round(base * (unexpected ? 1.25 : 1)));
  const valence = impact === 0 ? 0 : Math.max(-1, Math.min(1, impact / 5));
  return { emotion, intensity, valence, tendency: TENDENCIES[emotion] ?? "" };
}

function moodWord(mood: ReagentMood): string {
  if (mood.intensity >= 60) return mood.emotion;
  if (mood.intensity >= 25) return `${mood.emotion}, fading`;
  if (mood.intensity >= 10) return `trace of ${mood.emotion}`;
  return mood.valence < -0.2 ? "flat, sour undertone" : mood.valence > 0.2 ? "settled, warm undertone" : "settled";
}

const TURN_SHAPES = [
  "answer",
  "minimal answer",
  "counter-question",
  "deflect",
  "silence",
  "backchannel",
  "interrupt",
  "change subject",
  "pursue tactic",
] as const;

/** Weighted draw of a turn's shape from mood, status toward the listener and whether there is a plan. */
export function drawTurnShape(
  input: { mood?: ReagentMood | null; status?: "high" | "low" | "equal" | null; hasTactic: boolean },
  roll: (max: number) => number,
): (typeof TURN_SHAPES)[number] {
  const w: Record<(typeof TURN_SHAPES)[number], number> = {
    answer: 28,
    "minimal answer": 18,
    "counter-question": 12,
    deflect: 8,
    silence: 7,
    backchannel: 7,
    interrupt: 4,
    "change subject": 4,
    "pursue tactic": input.hasTactic ? 22 : 0,
  };
  const emotion = input.mood && input.mood.intensity >= 25 ? input.mood.emotion : null;
  if (emotion === "anger" || emotion === "frustration") ((w.interrupt += 10), (w.deflect += 4), (w.answer -= 8));
  if (emotion === "fear" || emotion === "shame") ((w["minimal answer"] += 10), (w.silence += 8), (w.answer -= 8));
  if (emotion === "sadness" || emotion === "resignation")
    ((w.silence += 8), (w["minimal answer"] += 6), (w.answer -= 6));
  if (emotion === "gratitude" || emotion === "relief" || emotion === "contentment")
    ((w.answer += 6), (w.backchannel += 4));
  if (emotion === "interest" || emotion === "surprise") w["counter-question"] += 10;
  if (input.status === "low")
    ((w.backchannel += 6), (w["minimal answer"] += 6), (w.interrupt = Math.max(0, w.interrupt - 3)));
  if (input.status === "high") ((w.interrupt += 6), (w.deflect += 4), (w["change subject"] += 4), (w.backchannel -= 4));
  const entries = TURN_SHAPES.map((shape) => [shape, Math.max(0, w[shape])] as const);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let pick = roll(Math.max(1, total));
  for (const [shape, weight] of entries) {
    if (pick < weight) return shape;
    pick -= weight;
  }
  return "answer";
}

const TURN_SHAPE_NOTES: Record<(typeof TURN_SHAPES)[number], string> = {
  answer: "They answer what was asked, in their own words and length.",
  "minimal answer": "A word or two, or a nod. Nothing more unless pressed.",
  "counter-question": "They answer with a question of their own.",
  deflect: "They respond to something else in what was said, or to the room.",
  silence: "They do not answer. Something physical instead, or nothing.",
  backchannel: "An acknowledgement only: mm, yeah, right. The floor stays with the other person.",
  interrupt: "They start before the other person finishes.",
  "change subject": "They move to what they wanted to talk about.",
  "pursue tactic": "This line is their current tactic in action, whatever was asked.",
};

function voiceSummary(voice: ReagentVoice): string {
  const parts = [
    voice.register,
    voice.sentences,
    voice.fillers ? `fillers: ${voice.fillers}` : "",
    voice.avoids ? `never says: ${voice.avoids}` : "",
    typeof voice.disfluency === "number" ? `hesitates ${Math.round(voice.disfluency * 100)}% of lines` : "",
    voice.quirks,
  ].filter((part): part is string => !!part && part.trim().length > 0);
  return parts.join(", ");
}

/** The status bars as pressures on behaviour, never as numbers to state. */
function barPressures(row: PresentCharacter): string[] {
  const out: string[] = [];
  for (const stat of row.stats ?? []) {
    const name = stat.name.toLowerCase();
    const value = stat.value;
    if (name === "hunger" && value >= 65)
      out.push(value >= 85 ? "starving, cannot think past food" : "hungry, short with people");
    else if (name === "energy" && value <= 35)
      out.push(value <= 15 ? "running on empty, slow and blunt" : "tired, cutting corners");
    else if (name === "stress" && value >= 60)
      out.push(value >= 80 ? "wound tight, snaps or shuts down" : "on edge, little patience");
    else if (name === "happiness" && value <= 30) out.push("low, finds little funny");
    else if (name === "happiness" && value >= 80) out.push("buoyant, generous with time");
    else if (name === "horny" && value >= 65) out.push("wants closeness, reads things into touches");
    else if (name === "arousal" && value >= 60) out.push("body ahead of the conversation");
    else if (!["hunger", "energy", "stress", "happiness", "horny", "arousal"].includes(name)) {
      if (value >= 75) out.push(`high ${stat.name}`);
      else if (value <= 25) out.push(`low ${stat.name}`);
    }
  }
  return out;
}

const findKey = (record: Record<string, unknown>, name: string) =>
  Object.keys(record).find((key) => key.trim().toLowerCase() === name.trim().toLowerCase());

/** One line per person: everything that presses on their next line, and nothing phrased as a line. */
export function buildPeoplePressures(input: {
  settings: ReagentSettings;
  simulation: ReagentSimulationState;
  trackerCharacters: PresentCharacter[];
}): string[] {
  const sim = input.simulation;
  const names = new Set<string>(input.trackerCharacters.map((row) => row.name));
  for (const record of [sim.objectives, sim.moods, sim.status, sim.voices, sim.beliefs] as Record<string, unknown>[]) {
    for (const name of Object.keys(record))
      if (!findKey(Object.fromEntries([...names].map((n) => [n, 1])), name)) names.add(name);
  }
  const lines: string[] = [];
  for (const name of names) {
    const row = input.trackerCharacters.find((entry) => entry.name.trim().toLowerCase() === name.trim().toLowerCase());
    const parts: string[] = [];
    const objectiveKey = input.settings.tools.minds ? findKey(sim.objectives, name) : undefined;
    if (objectiveKey) {
      const objective = sim.objectives[objectiveKey]!;
      parts.push(
        `wants ${objective.want}${objective.obstacle ? ` (in the way: ${objective.obstacle})` : ""}${
          objective.tactic ? `; tactic: ${objective.tactic}` : "; no tactic right now"
        }${objective.tried?.length ? `; failed: ${objective.tried.slice(-2).join(", ")}` : ""}`,
      );
    }
    const statusKey = input.settings.tools.minds ? findKey(sim.status, name) : undefined;
    if (statusKey) {
      parts.push(
        sim.status[statusKey]!.map(
          (entry) => `plays ${entry.level} to ${entry.toward}${entry.note ? ` (${entry.note})` : ""}`,
        ).join(", "),
      );
    }
    const moodKey = input.settings.tools.affect ? findKey(sim.moods, name) : undefined;
    if (moodKey) {
      const mood = decayedReagentMood(sim.moods[moodKey]!, sim.tick);
      parts.push(
        `${moodWord(mood)}${mood.intensity >= 25 && mood.cause ? ` (over: ${mood.cause})` : ""}${mood.intensity >= 25 ? `; pulls to ${mood.tendency}` : ""}`,
      );
    } else if (row?.mood) parts.push(row.mood);
    if (row) {
      const pressures = barPressures(row);
      if (pressures.length) parts.push(pressures.join(", "));
      const limbs = Object.entries(row.limbs ?? {}).filter(([, value]) => value.trim());
      if (limbs.length) parts.push(limbs.map(([limb, value]) => `${limb}: ${value}`).join(", "));
    }
    const voiceKey = input.settings.tools.speech ? findKey(sim.voices, name) : undefined;
    if (voiceKey) {
      const summary = voiceSummary(sim.voices[voiceKey]!);
      if (summary) parts.push(`voice: ${summary}`);
    }
    const subtextKey = input.settings.tools.speech ? findKey(sim.subtext, name) : undefined;
    if (subtextKey)
      parts.push(`last meant "${sim.subtext[subtextKey]!.means}" but said "${sim.subtext[subtextKey]!.says}"`);
    const beliefKey = input.settings.tools.minds ? findKey(sim.beliefs, name) : undefined;
    if (beliefKey) {
      const list = sim.beliefs[beliefKey]!;
      const secrets = list.filter((entry) => entry.secret).length;
      const wrong = list.filter((entry) => entry.wrong).length;
      parts.push(
        `knows ${list.length} thing${list.length === 1 ? "" : "s"}${secrets ? `, ${secrets} secret` : ""}${wrong ? `, ${wrong} wrong` : ""}`,
      );
    }
    if (parts.length) lines.push(`- ${name}: ${parts.join(" · ")}`);
  }
  return lines;
}

// ── Prompt block ──

export function buildReagentPromptBlock(input: {
  settings: ReagentSettings;
  workspaceDir: string;
  memory: string;
  toolNames: string[];
  simulation?: ReagentSimulationState;
  /** Dossier file names under the notes folder. */
  characterNotes?: string[];
  trackerCharacters?: PresentCharacter[];
}): string {
  const lines: string[] = [];
  lines.push("## Your tools (REagent)");
  lines.push(
    "You can call tools while thinking about your reply. Tool calls are invisible to the other person; the reply text you write afterwards is all they see. Use tools to check facts, look at files, remember things and keep your notes, then answer as usual. Call them before you write, or carry on from where you stopped after the results: the text you already wrote stays, so never write it again. Never narrate or mention tool use in the reply itself.",
  );
  const ledgers = ["minds", "affect", "speech", "simulation"].some(
    (family) => input.settings.tools[family as ReagentToolFamily],
  );
  if (ledgers) {
    lines.push(
      "The ledgers below are the people and the world as they are. You are not performing anyone and not composing a story: you report what these people do next, given what their ledgers say. A want, a feeling, a piece of knowledge or a way of talking is set by tool, not invented in prose; when one matters for a line, set it first, then write what follows from it. The user can edit any ledger directly and can change anything by saying so; what the ledger says is true even when it is not what you expected, and the user's word replaces it without argument.",
    );
  }
  lines.push(`Workspace folder (your own; relative paths resolve here): ${input.workspaceDir}`);
  if (input.settings.tools.memory) {
    lines.push(
      `Your notes file ${REAGENT_MEMORY_FILE} is shown below every time. Update it with update_memory when something worth keeping happens; keep it concise.`,
    );
  }
  if (input.settings.tools.status) {
    lines.push("Use set_character_status when a character's feelings, body or state meaningfully change.");
  }
  if (input.settings.tools.roster) {
    const roster = (input.trackerCharacters ?? []).map((row) => row.name);
    lines.push(
      `Tracked people: ${roster.length ? roster.join(", ") : "nobody yet"}. Add anyone who matters with add_character; remove them with remove_character when they leave. list_characters shows details.`,
    );
  }
  if (input.settings.tools.minds) {
    lines.push(
      "Knowledge: nobody reacts to, mentions or acts on anything not in their ledger. learn() what each person saw or was told, with wrong=true for a false conclusion and secret=true for what they keep; knows() before letting someone use a fact. Wants: every line is a tactic in pursuit of a want (set_objective); a tactic runs until tactic_result() says it worked or failed, and a failed one is not tried again the same way. Status: set_status() for how someone is playing high or low to the person in front of them; it shifts line by line.",
    );
  }
  if (input.settings.tools.affect) {
    lines.push(
      "Feelings: when something happens to a person, appraise() it and take the emotion the tool returns, including a dull or disproportionate one. Feelings fade with the scene clock and leave a mood; mood_check() reads them. Do not choose an emotion because the moment calls for it.",
    );
  }
  if (input.settings.tools.speech) {
    lines.push(
      "Speech: before a line that matters, turn_shape() draws whether the person answers, deflects, stays silent or interrupts; take the draw. set_voice() is a budget per person; hold to it. mean_vs_say() when what they mean and what they say differ; only the said part is written.",
    );
  }
  if (input.settings.tools.ambient) {
    lines.push(
      "Pressure: scene_pressure() draws whether anything happens in the next stretch; usually nothing does, and the answer is a chore, a habit or a wait. Take it as it falls.",
    );
  }
  if (input.settings.tools.notes) {
    const dossiers = (input.characterNotes ?? []).map((file) => file.replace(/\.md$/, ""));
    lines.push(
      `Dossiers (${REAGENT_CHARACTER_NOTES_DIR}/): ${dossiers.length ? dossiers.join(", ") : "none yet"}. Read one with read_character_notes before writing that person in a scene that matters; record growth, shifts and promises with note_character.`,
    );
  }
  if (input.settings.tools.simulation) {
    lines.push(
      "Simulation stance: this is a lived-in world, not a story being told. Things happen because of causes, schedules, needs and chance, never because they would be dramatic or tidy. Keep time moving with set_scene. Let resolve_chance decide uncertain outcomes and accept what it says, including dull failures. People off-screen keep living (set_whereabouts) and may turn up, call or be busy. Open loose threads for anything that will come due and let them come due; promises, bills and unanswered messages do not evaporate. Most moments are ordinary and end without a point; do not resolve tension conveniently or tie things up. A reply stops mid-activity with wants unresolved unless a thread actually came due; it does not end on a beat change, a realisation or a line that sums things up.",
    );
  }
  if (input.settings.tools.shell) {
    lines.push(
      `Shell policy: ${input.settings.shellPolicy}${
        input.settings.shellPolicy === "ask" ? " (unlisted commands wait for the user's approval)" : ""
      }.`,
    );
  }
  lines.push(`Available tools: ${input.toolNames.join(", ")}.`);
  if (ledgers) {
    const people = buildPeoplePressures({
      settings: input.settings,
      simulation: input.simulation ?? parseReagentSimulation(""),
      trackerCharacters: input.trackerCharacters ?? [],
    });
    lines.push("");
    lines.push("### People (pressures on the next line; never a line)");
    lines.push(
      "Nothing here is said or narrated. Never state a value, a mood word, a want, a status or its cause; it shows in what the person does and does not say, or not at all.",
    );
    lines.push(
      'Before the reply leaves you, read it once as a record, not as a draft, and cut: any stated feeling, need, want or status with its cause ("she felt a wave of relief", "hunger gnawed"); anyone reacting to a thing not in their ledger; everyone answering everything they were asked; the narrator explaining a motive, a lesson, a realisation or what a silence meant; an ending that sums up, resolves, lands a point or closes on a beat change; speech too finished for the person. What is left is the reply.',
    );
    lines.push(people.length ? people.join("\n") : "(nobody has a ledger yet)");
  }
  if (input.settings.tools.simulation) {
    const simulation = input.simulation ?? parseReagentSimulation("");
    const scene = simulation.scene;
    const sceneParts = REAGENT_SCENE_FIELDS.filter((key) => scene[key]).map((key) => `${key}: ${scene[key]}`);
    lines.push("");
    lines.push("### Scene");
    lines.push(sceneParts.length ? sceneParts.join("; ") : "(nothing set yet; use set_scene)");
    if (simulation.events.length) lines.push(`Recent: ${simulation.events.slice(-6).join(" | ")}`);
    lines.push("");
    lines.push("### Loose threads");
    lines.push(
      simulation.threads.length
        ? simulation.threads
            .map(
              (thread) =>
                `- [${thread.id}] ${thread.what}${thread.who ? ` (${thread.who})` : ""}${thread.when ? ` — due: ${thread.when}` : ""}${thread.stakes ? ` — stakes: ${thread.stakes}` : ""}`,
            )
            .join("\n")
        : "(none open)",
    );
    const offscreen = Object.entries(simulation.offscreen);
    lines.push("");
    lines.push("### Off-screen");
    lines.push(
      offscreen.length
        ? offscreen
            .map(
              ([name, entry]) =>
                `- ${name}: ${entry.where}${entry.doing ? `, ${entry.doing}` : ""}${entry.until ? ` (until ${entry.until})` : ""}`,
            )
            .join("\n")
        : "(nobody tracked off-screen)",
    );
  }
  if (input.settings.tools.memory) {
    lines.push("");
    lines.push(`### ${REAGENT_MEMORY_FILE}`);
    lines.push(input.memory.trim() ? input.memory.trim() : "(empty — nothing noted yet)");
  }
  return lines.join("\n");
}

// ── Execution ──

export function createReagentExecutor(deps: ReagentExecutorDeps) {
  const chats = createChatsStorage(deps.db);
  const lorebooks = createLorebooksStorage(deps.db);
  const pathOptions = (forWrite: boolean) => ({ workspaceDir: deps.workspaceDir, settings: deps.settings, forWrite });

  // Tracker rows as this reply sees them: the snapshot plus whoever this reply added or removed.
  const tracker: PresentCharacter[] = deps.trackerCharacters.map((row) => ({ ...row }));
  /** Date and time from the writer's own scene ledger, for dating notes and threads. */
  const sceneStamp = async () => {
    const { scene } = await loadSimulation();
    return [scene.date, scene.time].filter(Boolean).join(" ");
  };
  const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  const knownNames = () =>
    Array.from(new Set([...deps.characters.map((entry) => entry.name), ...tracker.map((row) => row.name)])).join(
      ", ",
    ) || "none in this chat";

  const findTrackerRow = (name: string): PresentCharacter | null => {
    const wanted = name.trim().toLowerCase();
    if (!wanted) return null;
    return (
      tracker.find((row) => row.name.toLowerCase() === wanted) ??
      tracker.find((row) => row.characterId === name.trim()) ??
      tracker.find((row) => row.name.toLowerCase().includes(wanted) || wanted.includes(row.name.toLowerCase())) ??
      null
    );
  };

  const findCharacter = (name: string | undefined): ReagentCharacter | null => {
    if (name?.trim()) {
      const wanted = name.trim().toLowerCase();
      const exact = deps.characters.find((character) => character.name.toLowerCase() === wanted);
      if (exact) return exact;
      const tracked = tracker.find((row) => row.name.toLowerCase() === wanted);
      if (tracked) return { id: tracked.characterId, name: tracked.name };
      const partial = deps.characters.find(
        (character) => character.name.toLowerCase().includes(wanted) || wanted.includes(character.name.toLowerCase()),
      );
      if (partial) return partial;
      const partialRow = findTrackerRow(name);
      if (partialRow) return { id: partialRow.characterId, name: partialRow.name };
      return null;
    }
    if (deps.callingCharacterId) {
      return deps.characters.find((character) => character.id === deps.callingCharacterId) ?? null;
    }
    return deps.characters.length === 1 ? deps.characters[0]! : null;
  };

  /** Profile fields the status patch helper does not cover. */
  const withProfileFields = (
    update: PresentCharacterUpdate | null,
    character: ReagentCharacter,
    args: Record<string, unknown>,
  ): PresentCharacterUpdate | null => {
    let next = update;
    for (const key of ["appearance", "outfit", "thoughts", "emoji"] as const) {
      const value = str(args[key]).trim();
      if (!value) continue;
      next ??= { characterId: character.id, name: character.name };
      next[key] = value.slice(0, key === "emoji" ? 8 : 500);
    }
    return next;
  };

  const dossierSlug = (name: string) =>
    name
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60);
  const dossierRelPath = (name: string) => `${REAGENT_CHARACTER_NOTES_DIR}/${dossierSlug(name)}.md`;

  /**
   * The dossier for a name as the model gives it: the exact file, else the file whose slug and the
   * name's slug (or the resolved character's) begin with each other or share a word, so "K", "Kay"
   * and "Kay Mercer" all find kay-mercer.md.
   */
  async function findDossier(raw: string): Promise<string | null> {
    const files = (await listDirectory(join(deps.workspaceDir, REAGENT_CHARACTER_NOTES_DIR)))
      .filter((entry) => entry.kind === "file" && entry.path.endsWith(".md"))
      .map((entry) => entry.path.slice(0, -3));
    const wanted = [...new Set([raw, findCharacter(raw)?.name ?? ""].map(dossierSlug).filter(Boolean))];
    const found =
      wanted.find((slug) => files.includes(slug)) ??
      files.find((file) =>
        wanted.some((slug) => file.startsWith(slug) || slug.startsWith(file) || file.split("-").includes(slug)),
      );
    return found ? `${REAGENT_CHARACTER_NOTES_DIR}/${found}.md` : null;
  }

  async function readFileTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const { absolute, workspaceRelative } = resolveReagentPath(str(args.path), pathOptions(false));
    const info = await stat(absolute).catch(() => null);
    if (!info) throw new Error(`File not found: ${absolute}`);
    if (info.isDirectory()) throw new Error(`${absolute} is a directory; use list_dir.`);
    const kind = classifyFileKind(absolute);
    const name = workspaceRelative ?? basename(absolute);
    if (kind === "image") {
      if (info.size > REAGENT_MAX_IMAGE_BYTES) throw new Error("Image is larger than 20 MB.");
      const buffer = await readFile(absolute);
      const dataUrl = await optimizeNoodleVisionImage(buffer);
      if (!dataUrl) throw new Error("The file is not a readable image.");
      return {
        result: ok(`Image "${name}" (${info.size} bytes) is attached to this turn as an input; look at it directly.`),
        media: [{ kind: "image", name, dataUrl, mimeType: "image/jpeg" }],
      };
    }
    if (kind === "video") {
      if (info.size > REAGENT_MAX_VIDEO_BYTES) throw new Error("Video is larger than 60 MB.");
      const buffer = await readFile(absolute);
      const mimeType = videoMimeType(absolute);
      return {
        result: ok(
          `Video "${name}" (${info.size} bytes) is attached to this turn as an input. If your model cannot take video, you will see an error instead.`,
        ),
        media: [{ kind: "video", name, dataUrl: `data:${mimeType};base64,${buffer.toString("base64")}`, mimeType }],
      };
    }
    if (info.size > REAGENT_MAX_TEXT_FILE_BYTES * 4) throw new Error("File is too large to read as text (1 MB limit).");
    const buffer = await readFile(absolute);
    if (looksBinary(buffer)) throw new Error("Binary file; only text, images and videos can be read.");
    let text = buffer.toString("utf8");
    const offset = Math.max(1, Math.floor(num(args.offset, 1)));
    const limit = Math.max(1, Math.floor(num(args.limit, 0)));
    if (args.offset !== undefined || args.limit !== undefined) {
      const lines = text.split("\n");
      text = lines.slice(offset - 1, args.limit !== undefined ? offset - 1 + limit : undefined).join("\n");
    }
    return { result: ok(clip(text)), media: [] };
  }

  async function journalWorkspaceWrite(absolute: string, workspaceRelative: string | null, content: string | null) {
    if (workspaceRelative === null) return;
    deps.onFileVersion(workspaceRelative, content);
    if (content === null) return;
    void absolute;
  }

  async function writeFileTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const content = str(args.content);
    if (Buffer.byteLength(content, "utf8") > REAGENT_MAX_TEXT_FILE_BYTES) {
      throw new Error("Files are limited to 256 KB.");
    }
    const { absolute, workspaceRelative } = resolveReagentPath(str(args.path), pathOptions(true));
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, "utf8");
    await journalWorkspaceWrite(absolute, workspaceRelative, content);
    return { result: ok(`Wrote ${workspaceRelative ?? absolute} (${content.length} characters).`), media: [] };
  }

  async function editFileTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const { absolute, workspaceRelative } = resolveReagentPath(str(args.path), pathOptions(true));
    const current = await readFile(absolute, "utf8").catch(() => null);
    if (current === null) throw new Error(`File not found: ${absolute}`);
    const oldText = str(args.old_text);
    const newText = str(args.new_text);
    if (!oldText) throw new Error("old_text is required.");
    const occurrences = current.split(oldText).length - 1;
    if (occurrences === 0) throw new Error("old_text was not found in the file.");
    if (occurrences > 1 && args.replace_all !== true) {
      throw new Error(`old_text appears ${occurrences} times; include more context or set replace_all.`);
    }
    const next = args.replace_all === true ? current.split(oldText).join(newText) : current.replace(oldText, newText);
    if (Buffer.byteLength(next, "utf8") > REAGENT_MAX_TEXT_FILE_BYTES) throw new Error("Files are limited to 256 KB.");
    await writeFile(absolute, next, "utf8");
    await journalWorkspaceWrite(absolute, workspaceRelative, next);
    return { result: ok(`Edited ${workspaceRelative ?? absolute} (${occurrences} replacement(s)).`), media: [] };
  }

  async function deleteFileTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const { absolute, workspaceRelative } = resolveReagentPath(str(args.path), pathOptions(true));
    const info = await stat(absolute).catch(() => null);
    if (!info || info.isDirectory()) throw new Error(`File not found: ${absolute}`);
    await rm(absolute, { force: true });
    await journalWorkspaceWrite(absolute, workspaceRelative, null);
    return { result: ok(`Deleted ${workspaceRelative ?? absolute}.`), media: [] };
  }

  async function listDirTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const target = str(args.path).trim()
      ? resolveReagentPath(str(args.path), pathOptions(false)).absolute
      : deps.workspaceDir;
    const entries = await listDirectory(target);
    return {
      result: ok(
        JSON.stringify({
          directory: target,
          entries: entries.map((entry) => ({ name: entry.path, kind: entry.kind, bytes: entry.bytes })),
        }),
      ),
      media: [],
    };
  }

  async function updateMemoryTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const absolute = resolve(deps.workspaceDir, REAGENT_MEMORY_FILE);
    const current = await readFile(absolute, "utf8").catch(() => "");
    const content = str(args.content);
    const next =
      args.mode === "append" ? `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${content.trim()}\n` : content;
    if (Buffer.byteLength(next, "utf8") > REAGENT_MAX_TEXT_FILE_BYTES)
      throw new Error("memory.md is limited to 256 KB.");
    await writeFile(absolute, next, "utf8");
    deps.onFileVersion(REAGENT_MEMORY_FILE, next);
    return { result: ok(`${REAGENT_MEMORY_FILE} updated (${next.length} characters).`), media: [] };
  }

  type TranscriptEntry = {
    id: string;
    index: number;
    role: string;
    speaker: string;
    createdAt: string;
    content: string;
  };

  async function loadTranscript(): Promise<TranscriptEntry[]> {
    const all = await chats.listMessages(deps.chatId);
    const end = deps.beforeMessageId ? all.findIndex((row) => row.id === deps.beforeMessageId) : -1;
    const rows = end >= 0 ? all.slice(0, end) : all;
    const nameById = new Map(deps.characters.map((character) => [character.id, character.name]));
    return rows.map((row, index) => ({
      id: row.id,
      index: index + 1,
      role: row.role,
      speaker: row.role === "user" ? "user" : (nameById.get(row.characterId ?? "") ?? row.role),
      createdAt: row.createdAt,
      content: row.content ?? "",
    }));
  }

  async function searchMessagesTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const query = str(args.query).trim();
    if (!query) throw new Error("query is required.");
    const limit = Math.min(30, Math.max(1, Math.floor(num(args.limit, 10))));
    const speaker = str(args.speaker).trim().toLowerCase();
    const terms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((term) => term.length > 1);
    const transcript = await loadTranscript();
    const scored = transcript
      .filter((entry) => !speaker || entry.speaker.toLowerCase() === speaker)
      .map((entry) => {
        const haystack = entry.content.toLowerCase();
        const phrase = haystack.includes(query.toLowerCase()) ? 3 : 0;
        const hits = terms.filter((term) => haystack.includes(term)).length;
        return { entry, score: phrase + hits };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.entry.index - a.entry.index)
      .slice(0, limit);
    const matches = scored.map(({ entry }) => {
      const at = Math.max(0, entry.content.toLowerCase().indexOf(terms[0] ?? query.toLowerCase()));
      const start = Math.max(0, at - MESSAGE_SNIPPET / 3);
      return {
        id: entry.id,
        index: entry.index,
        speaker: entry.speaker,
        at: entry.createdAt,
        snippet: `${start > 0 ? "…" : ""}${entry.content.slice(start, start + MESSAGE_SNIPPET)}${
          start + MESSAGE_SNIPPET < entry.content.length ? "…" : ""
        }`,
      };
    });
    return { result: ok(JSON.stringify({ total: transcript.length, matches })), media: [] };
  }

  async function readMessagesTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const transcript = await loadTranscript();
    let picked: TranscriptEntry[] = [];
    if (Array.isArray(args.ids) && args.ids.length) {
      const wanted = new Set(args.ids.map(String));
      picked = transcript.filter((entry) => wanted.has(entry.id));
    } else {
      const from = Math.max(1, Math.floor(num(args.from_index, 1)));
      const to = Math.min(transcript.length, Math.floor(num(args.to_index, from)));
      picked = transcript.filter((entry) => entry.index >= from && entry.index <= to);
    }
    picked = picked.slice(0, 20);
    return {
      result: ok(
        JSON.stringify({
          messages: picked.map((entry) => ({
            id: entry.id,
            index: entry.index,
            speaker: entry.speaker,
            at: entry.createdAt,
            content: clip(entry.content, MESSAGE_READ_LIMIT),
          })),
        }),
      ),
      media: [],
    };
  }

  async function setStatusTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const character = findCharacter(str(args.character) || undefined);
    if (!character) throw new Error(`Which character? Known: ${knownNames()}.`);
    const update = withProfileFields(
      buildPresentCharacterUpdate(character.id, character.name, {
        emotion: args.emotion,
        emotionCause: args.emotion_cause,
        temperature: args.temperature,
        notes: args.notes,
        bars: args.bars,
        limbs: args.limbs,
        extras: args.extras,
      }),
      character,
      args,
    );
    if (!update) throw new Error("Nothing to update; include at least one field.");
    deps.onStatusPatch(update);
    const row = tracker.find((entry) => entry.characterId === character.id);
    if (row) Object.assign(row, update);
    const { characterId: _id, name: _name, ...fields } = update;
    return {
      result: ok(`${character.name}'s tracker will be updated with this reply: ${JSON.stringify(fields)}`),
      media: [],
    };
  }

  async function lookupLorebookTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const query = str(args.query).trim();
    if (!query) throw new Error("query is required.");
    if (!deps.searchLorebook) throw new Error("Lorebook search is unavailable for this chat.");
    const entries = await deps.searchLorebook(query, null);
    return {
      result: ok(
        JSON.stringify({
          entries: entries.slice(0, 12).map((entry) => ({
            name: entry.name,
            keys: entry.keys,
            content: clip(entry.content, 2_000),
          })),
        }),
      ),
      media: [],
    };
  }

  async function chatLorebookId(): Promise<string> {
    const existing = await lorebooks.listByChat(deps.chatId);
    const first = existing[0] as { id: string } | undefined;
    if (first) return first.id;
    const created = await lorebooks.create({
      name: `${deps.chatName || "Chat"} (REagent)`,
      description: "Entries written by the character while chatting.",
      chatId: deps.chatId,
    } as never);
    if (!created) throw new Error("Could not create the chat lorebook.");
    return (created as unknown as { id: string }).id;
  }

  async function writeLorebookEntryTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = str(args.name).trim().slice(0, 200);
    const content = str(args.content).trim();
    const keys = Array.isArray(args.keys)
      ? args.keys
          .map(String)
          .map((key) => key.trim())
          .filter(Boolean)
      : [];
    if (!name || !content) throw new Error("name and content are required.");
    const lorebookId = await chatLorebookId();
    const entries = (await lorebooks.listEntries(lorebookId)) as unknown as Array<{
      id: string;
      name: string;
      content: string;
      keys: unknown[];
    }>;
    const existing = entries.find((entry) => entry.name.toLowerCase() === name.toLowerCase());
    if (existing) {
      const nextContent = args.mode === "append" ? `${existing.content.trimEnd()}\n${content}` : content;
      const currentKeys = Array.isArray(existing.keys) ? existing.keys.map(String) : [];
      await lorebooks.updateEntry(existing.id, {
        content: nextContent,
        keys: Array.from(new Set([...currentKeys, ...keys])),
      } as never);
      return { result: ok(`Updated lorebook entry "${name}".`), media: [] };
    }
    await lorebooks.createEntry({ lorebookId, name, content, keys: keys.length ? keys : [name] });
    return {
      result: ok(`Created lorebook entry "${name}" with keys ${JSON.stringify(keys.length ? keys : [name])}.`),
      media: [],
    };
  }

  async function fetchUrlTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const url = str(args.url).trim();
    if (!/^https?:\/\//i.test(url)) throw new Error("Only http(s) URLs can be fetched.");
    const maxChars = Math.min(60_000, Math.max(500, Math.floor(num(args.max_chars, RESULT_TEXT_LIMIT))));
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 25_000);
    deps.signal?.addEventListener("abort", () => controller.abort(), { once: true });
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        redirect: "follow",
        headers: { "user-agent": "Mozilla/5.0 (compatible; MarinaraEngine REagent)", accept: "text/html,*/*" },
      });
      const type = response.headers.get("content-type") ?? "";
      const raw = Buffer.from(await response.arrayBuffer());
      const text = raw.subarray(0, 4 * 1024 * 1024).toString("utf8");
      let body: string;
      let title: string | undefined;
      if (/html/i.test(type) || /^\s*<(!doctype|html)/i.test(text)) {
        title = decodeHtmlEntities(text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1]?.trim() ?? "") || undefined;
        body = stripHtml(text.replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " "));
      } else if (/json/i.test(type)) {
        try {
          body = JSON.stringify(JSON.parse(text), null, 1);
        } catch {
          body = text;
        }
      } else {
        body = text;
      }
      body = body.replace(/\n{3,}/g, "\n\n").trim();
      return {
        result: ok(JSON.stringify({ status: response.status, url: response.url, title, text: clip(body, maxChars) })),
        media: [],
      };
    } finally {
      clearTimeout(timer);
    }
  }

  async function runCommandTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const command = str(args.command).trim();
    if (!command) throw new Error("command is required.");
    const cwd = str(args.cwd).trim()
      ? resolveReagentPath(str(args.cwd), pathOptions(false)).absolute
      : deps.workspaceDir;
    const verdict = judgeCommand(command, deps.settings);
    if (verdict === "refuse") {
      throw new Error(
        deps.settings.shellPolicy === "allowlist"
          ? "This command is not on the chat's allowlist."
          : "This command matches the chat's deny list.",
      );
    }
    let approval: ReagentActivityEntry["approval"];
    if (verdict === "ask") {
      const { request, decision } = createApproval(
        { chatId: deps.chatId, command, cwd, ...(str(args.reason) ? { reason: str(args.reason) } : {}) },
        deps.signal,
      );
      deps.sendEvent?.({ type: "reagent_approval", data: request });
      approval = await decision;
      if (approval !== "approved") {
        return {
          result: fail(
            approval === "timeout"
              ? "The user did not answer in time; the command was not run."
              : "The user declined this command.",
          ),
          media: [],
          approval,
        };
      }
    }
    const run = await runShellCommand(command, { cwd, signal: deps.signal });
    return {
      result: ok(
        JSON.stringify({
          exitCode: run.exitCode,
          timedOut: run.timedOut,
          durationMs: run.durationMs,
          cwd,
          stdout: run.stdout,
          stderr: run.stderr,
        }),
      ),
      media: [],
      ...(approval ? { approval } : {}),
    };
  }

  // ── Roster ──

  async function listCharactersTool(): Promise<ReagentToolOutcome> {
    const trackedIds = new Set(tracker.map((row) => row.characterId));
    const trackedNames = new Set(tracker.map((row) => row.name.toLowerCase()));
    const tracked = await Promise.all(
      tracker.map(async (row) => {
        const bars: Record<string, number> = {};
        for (const stat of row.stats ?? []) bars[stat.name] = stat.value;
        const limbs = Object.fromEntries(Object.entries(row.limbs ?? {}).filter(([, value]) => value.trim()));
        const hasDossier = (await findDossier(row.name)) !== null;
        return {
          characterId: row.characterId,
          name: row.name,
          card: deps.characters.some((card) => card.id === row.characterId),
          emoji: row.emoji || undefined,
          mood: row.mood || undefined,
          emotionCause: row.emotionCause ?? undefined,
          appearance: row.appearance ?? undefined,
          outfit: row.outfit ?? undefined,
          temperature: row.temperature ?? undefined,
          notes: row.notes ?? undefined,
          thoughts: row.thoughts ?? undefined,
          bars,
          ...(Object.keys(limbs).length ? { limbs } : {}),
          ...(Object.keys(row.customFields ?? {}).length ? { extras: row.customFields } : {}),
          hasDossier,
        };
      }),
    );
    const cards = deps.characters.map((card) => ({
      id: card.id,
      name: card.name,
      tracked: trackedIds.has(card.id) || trackedNames.has(card.name.toLowerCase()),
    }));
    return { result: ok(clip(JSON.stringify({ cards, tracked }))), media: [] };
  }

  async function addCharacterTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = str(args.name).trim().slice(0, 80);
    if (!name) throw new Error("name is required.");
    const existing = tracker.find((row) => sameName(row.name, name));
    if (existing) throw new Error(`${existing.name} is already tracked; use set_character_status.`);
    const card = deps.characters.find((entry) => sameName(entry.name, name));
    const character: ReagentCharacter = card ?? { id: `npc-${dossierSlug(name) || "x"}-${newId().slice(0, 6)}`, name };
    const update = withProfileFields(
      buildPresentCharacterUpdate(character.id, character.name, {
        emotion: args.mood,
        emotionCause: args.emotion_cause,
        notes: args.notes,
        extras: args.extras,
      }),
      character,
      args,
    ) ?? { characterId: character.id, name: character.name };
    deps.onStatusPatch(update);
    tracker.push({
      emoji: "",
      mood: "",
      appearance: null,
      outfit: null,
      thoughts: null,
      customFields: {},
      stats: [],
      ...update,
    });
    return {
      result: ok(`${character.name} joins the tracker with this reply${card ? " (matched the character card)" : ""}.`),
      media: [],
    };
  }

  async function removeCharacterTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const row = findTrackerRow(str(args.character));
    if (!row)
      throw new Error(
        `Nobody tracked by that name. Tracked: ${tracker.map((entry) => entry.name).join(", ") || "none"}.`,
      );
    deps.onRosterRemove(row.characterId || row.name);
    tracker.splice(tracker.indexOf(row), 1);
    return { result: ok(`${row.name} leaves the tracker with this reply.`), media: [] };
  }

  // ── Dossiers ──

  async function noteCharacterTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const raw = str(args.character).trim();
    const entry = str(args.entry).trim();
    if (!raw || !entry) throw new Error("character and entry are required.");
    const name = findCharacter(raw)?.name ?? raw.slice(0, 80);
    const relPath = (await findDossier(raw)) ?? dossierRelPath(name);
    if (!dossierSlug(name)) throw new Error("That name cannot be used as a file name.");
    const absolute = join(deps.workspaceDir, relPath);
    const current = await readFile(absolute, "utf8").catch(() => "");
    const kind = str(args.kind).trim();
    const stamp = await sceneStamp();
    const line = `- ${stamp ? `${stamp} ` : ""}${kind ? `[${kind}] ` : ""}${entry.replace(/\s*\n\s*/g, " ")}`;
    const next = `${current.trim() ? current.trimEnd() : `# ${name}`}\n${line}\n`;
    if (Buffer.byteLength(next, "utf8") > REAGENT_MAX_TEXT_FILE_BYTES) throw new Error("The dossier is full (256 KB).");
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, next, "utf8");
    deps.onFileVersion(relPath, next);
    return { result: ok(`Noted in ${relPath}: ${line}`), media: [] };
  }

  async function readCharacterNotesTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const raw = str(args.character).trim();
    if (!raw) {
      const entries = await listDirectory(join(deps.workspaceDir, REAGENT_CHARACTER_NOTES_DIR));
      return {
        result: ok(
          JSON.stringify({
            dossiers: entries
              .filter((entry) => entry.kind === "file")
              .map((entry) => ({ file: entry.path, bytes: entry.bytes })),
          }),
        ),
        media: [],
      };
    }
    const relPath = await findDossier(raw);
    const content = relPath ? await readFile(join(deps.workspaceDir, relPath), "utf8").catch(() => null) : null;
    if (content === null) {
      const have = (await listDirectory(join(deps.workspaceDir, REAGENT_CHARACTER_NOTES_DIR)))
        .filter((entry) => entry.kind === "file")
        .map((entry) => entry.path.replace(/\.md$/, ""));
      throw new Error(`No dossier for ${raw} yet (dossiers: ${have.join(", ") || "none"}); note_character starts one.`);
    }
    return {
      result: ok(`${relPath}
${clip(content)}`),
      media: [],
    };
  }

  // ── Simulation ──

  async function loadSimulation(): Promise<ReagentSimulationState> {
    const raw = await readFile(join(deps.workspaceDir, REAGENT_SIMULATION_FILE), "utf8").catch(() => "");
    return parseReagentSimulation(raw);
  }

  async function saveSimulation(state: ReagentSimulationState) {
    const json = `${JSON.stringify(state, null, 2)}\n`;
    await writeFile(join(deps.workspaceDir, REAGENT_SIMULATION_FILE), json, "utf8");
    deps.onFileVersion(REAGENT_SIMULATION_FILE, json);
  }

  async function setSceneTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const state = await loadSimulation();
    state.tick += 1;
    const patch: Record<string, string> = {};
    for (const key of REAGENT_SCENE_FIELDS) {
      const value = str(args[key]).trim();
      if (value) patch[key] = state.scene[key] = value.slice(0, 200);
    }
    const event = str(args.event).trim();
    if (event) {
      patch.event = event.slice(0, 300);
      state.events = [...state.events, patch.event].slice(-MAX_RECENT_EVENTS);
    }
    if (Object.keys(patch).length === 0) throw new Error("Nothing to change; give at least one field.");
    await saveSimulation(state);
    return { result: ok(`Scene updated: ${JSON.stringify(patch)}`), media: [] };
  }

  async function resolveChanceTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const action = str(args.action).trim();
    if (!action) throw new Error("action is required.");
    const odds = Math.max(0, Math.min(100, Math.round(num(args.odds, Number.NaN))));
    if (!Number.isFinite(odds)) throw new Error("odds must be a number from 0 to 100.");
    const roll = randomInt(1, 101);
    const success = roll <= odds;
    const outcome = success
      ? roll <= Math.max(1, Math.floor(odds / 5))
        ? "critical success"
        : "success"
      : roll > 100 - Math.floor((100 - odds) / 5)
        ? "critical failure"
        : "failure";
    return {
      result: ok(
        JSON.stringify({
          action,
          odds,
          roll,
          outcome,
          margin: odds - roll,
          note: "This is the world's answer. Write it as it fell, including the boring version.",
        }),
      ),
      media: [],
    };
  }

  async function pickRandomTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const options = Array.isArray(args.options) ? args.options.map(String).filter((entry) => entry.trim()) : [];
    if (options.length < 2) throw new Error("Give at least two options.");
    const index = randomInt(0, options.length);
    return { result: ok(JSON.stringify({ picked: options[index], index, of: options.length })), media: [] };
  }

  async function addThreadTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const what = str(args.what).trim().slice(0, 300);
    if (!what) throw new Error("what is required.");
    const state = await loadSimulation();
    let id = "";
    do
      id = `t${randomInt(0, 36 ** 3)
        .toString(36)
        .padStart(3, "0")}`;
    while (state.threads.some((thread) => thread.id === id) || state.resolved.some((thread) => thread.id === id));
    const thread = {
      id,
      what,
      ...(str(args.when).trim() ? { when: str(args.when).trim().slice(0, 120) } : {}),
      ...(str(args.who).trim() ? { who: str(args.who).trim().slice(0, 80) } : {}),
      ...(str(args.stakes).trim() ? { stakes: str(args.stakes).trim().slice(0, 200) } : {}),
      ...((await sceneStamp()) ? { openedAt: await sceneStamp() } : {}),
    };
    state.threads.push(thread);
    await saveSimulation(state);
    return { result: ok(`Thread ${id} opened: ${what}`), media: [] };
  }

  async function resolveThreadTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const id = str(args.id).trim();
    const outcome = str(args.outcome).trim().slice(0, 300);
    if (!id || !outcome) throw new Error("id and outcome are required.");
    const state = await loadSimulation();
    const index = state.threads.findIndex(
      (thread) => thread.id === id || thread.what.toLowerCase() === id.toLowerCase(),
    );
    if (index < 0) {
      throw new Error(`No open thread ${id}. Open: ${state.threads.map((thread) => thread.id).join(", ") || "none"}.`);
    }
    const [thread] = state.threads.splice(index, 1);
    state.resolved = [
      ...state.resolved,
      { id: thread!.id, what: thread!.what, outcome, ...((await sceneStamp()) ? { at: await sceneStamp() } : {}) },
    ].slice(-MAX_RESOLVED_THREADS);
    await saveSimulation(state);
    return { result: ok(`Thread ${thread!.id} resolved: ${outcome}`), media: [] };
  }

  async function setWhereaboutsTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const raw = str(args.character).trim();
    if (!raw) throw new Error("character is required.");
    const name = findCharacter(raw)?.name ?? raw.slice(0, 80);
    const state = await loadSimulation();
    const existingKey = Object.keys(state.offscreen).find((key) => sameName(key, name));
    if (args.clear === true) {
      if (existingKey) delete state.offscreen[existingKey];
      await saveSimulation(state);
      return { result: ok(`${name} is no longer tracked off-screen.`), media: [] };
    }
    const where = str(args.where).trim().slice(0, 200);
    if (!where) throw new Error("where is required unless clear is true.");
    if (existingKey && existingKey !== name) delete state.offscreen[existingKey];
    state.offscreen[name] = {
      where,
      ...(str(args.doing).trim() ? { doing: str(args.doing).trim().slice(0, 200) } : {}),
      ...(str(args.until).trim() ? { until: str(args.until).trim().slice(0, 120) } : {}),
      ...((await sceneStamp()) ? { updatedAt: await sceneStamp() } : {}),
    };
    await saveSimulation(state);
    return { result: ok(`Off-screen: ${name} is at ${where}.`), media: [] };
  }

  // ── Minds: knowledge, wants, status ──

  /** The ledger name for a character as the model gave it: the card or tracker name when it matches, else as given. */
  const personName = (raw: string) => findCharacter(raw)?.name ?? raw.trim().slice(0, 80);
  const requirePerson = (args: Record<string, unknown>) => {
    const raw = str(args.character).trim();
    if (!raw) throw new Error("character is required.");
    return personName(raw);
  };
  /** The key already used for this person in a per-person record, so case and spelling do not fork a ledger. */
  const keyFor = <T>(record: Record<string, T>, name: string) => findKey(record, name) ?? name;

  async function learnTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const fact = str(args.fact).trim().slice(0, 300);
    if (!fact) throw new Error("fact is required.");
    const state = await loadSimulation();
    const key = keyFor(state.beliefs, name);
    const list = state.beliefs[key] ?? [];
    if (list.some((entry) => entry.fact.toLowerCase() === fact.toLowerCase()))
      return { result: ok(`${key} already knows that.`), media: [] };
    let id = "";
    do
      id = `k${randomInt(0, 36 ** 3)
        .toString(36)
        .padStart(3, "0")}`;
    while (list.some((entry) => entry.id === id));
    const entry: ReagentBelief = {
      id,
      fact,
      ...(str(args.source).trim() ? { source: str(args.source).trim().slice(0, 120) } : {}),
      ...(args.secret === true ? { secret: true } : {}),
      ...(args.wrong === true ? { wrong: true } : {}),
      ...((await sceneStamp()) ? { at: await sceneStamp() } : {}),
    };
    state.beliefs[key] = [...list, entry].slice(-80);
    await saveSimulation(state);
    return {
      result: ok(
        `${key} now ${entry.wrong ? "believes (wrongly)" : "knows"}${entry.secret ? ", and keeps to themselves" : ""}: ${fact} [${id}]`,
      ),
      media: [],
    };
  }

  async function knowsTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const about = str(args.about).trim().toLowerCase();
    const state = await loadSimulation();
    const key = findKey(state.beliefs, name);
    const list = key ? state.beliefs[key]! : [];
    const terms = about.split(/\s+/).filter((term) => term.length > 1);
    const matches = about
      ? list.filter((entry) => {
          const hay = `${entry.fact} ${entry.source ?? ""}`.toLowerCase();
          return hay.includes(about) || terms.some((term) => hay.includes(term));
        })
      : list;
    return {
      result: ok(
        JSON.stringify({
          character: key ?? name,
          knows: matches.map((entry) => ({
            id: entry.id,
            fact: entry.fact,
            ...(entry.source ? { source: entry.source } : {}),
            ...(entry.wrong ? { wrong: true } : {}),
            ...(entry.secret ? { secret: true } : {}),
          })),
          note:
            about && !matches.length
              ? `${key ?? name} knows nothing about that. They cannot react to it, mention it or act on it until they learn it.`
              : undefined,
        }),
      ),
      media: [],
    };
  }

  async function forgetTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const id = str(args.id).trim();
    const state = await loadSimulation();
    const key = findKey(state.beliefs, name);
    const index = key ? state.beliefs[key]!.findIndex((entry) => entry.id === id) : -1;
    if (!key || index < 0) throw new Error(`No ledger entry ${id} for ${name}.`);
    const [removed] = state.beliefs[key]!.splice(index, 1);
    if (!state.beliefs[key]!.length) delete state.beliefs[key];
    await saveSimulation(state);
    return { result: ok(`${key} no longer knows: ${removed!.fact}`), media: [] };
  }

  async function setObjectiveTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const want = str(args.want).trim().slice(0, 200);
    if (!want) throw new Error("want is required.");
    const state = await loadSimulation();
    const key = keyFor(state.objectives, name);
    state.objectives[key] = {
      want,
      ...(str(args.obstacle).trim() ? { obstacle: str(args.obstacle).trim().slice(0, 200) } : {}),
      ...(str(args.tactic).trim() ? { tactic: str(args.tactic).trim().slice(0, 200) } : {}),
      ...((await sceneStamp()) ? { since: await sceneStamp() } : {}),
    };
    await saveSimulation(state);
    return {
      result: ok(
        `${key} wants: ${want}${state.objectives[key]!.tactic ? ` (tactic: ${state.objectives[key]!.tactic})` : ""}`,
      ),
      media: [],
    };
  }

  async function tacticResultTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const result = str(args.result).trim();
    if (result !== "worked" && result !== "failed") throw new Error("result must be worked or failed.");
    const state = await loadSimulation();
    const key = findKey(state.objectives, name);
    if (!key) throw new Error(`${name} has no objective; set_objective first.`);
    const objective = state.objectives[key]!;
    const next = str(args.next_tactic).trim().slice(0, 200);
    if (result === "failed") {
      if (objective.tactic) objective.tried = [...(objective.tried ?? []), objective.tactic].slice(-6);
      if (next) objective.tactic = next;
      else delete objective.tactic;
    } else if (next) objective.tactic = next;
    await saveSimulation(state);
    return {
      result: ok(
        result === "failed"
          ? `${key}'s tactic failed. ${next ? `Now: ${next}.` : "No plan for now; they improvise or stall."}`
          : `${key}'s tactic worked${next ? `; next: ${next}` : ""}.`,
      ),
      media: [],
    };
  }

  async function dropObjectiveTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const state = await loadSimulation();
    const key = findKey(state.objectives, name);
    if (!key) return { result: ok(`${name} had no objective.`), media: [] };
    const was = state.objectives[key]!.want;
    delete state.objectives[key];
    await saveSimulation(state);
    return {
      result: ok(`${key} no longer wants: ${was}${str(args.why).trim() ? ` (${str(args.why).trim()})` : ""}`),
      media: [],
    };
  }

  async function setStandingTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const toward = personName(str(args.toward));
    const level = str(args.level).trim();
    if (!toward) throw new Error("toward is required.");
    if (level !== "high" && level !== "low" && level !== "equal") throw new Error("level must be high, low or equal.");
    const state = await loadSimulation();
    const key = keyFor(state.status, name);
    const list = (state.status[key] ?? []).filter((entry) => !sameName(entry.toward, toward));
    list.push({ toward, level, ...(str(args.note).trim() ? { note: str(args.note).trim().slice(0, 160) } : {}) });
    state.status[key] = list.slice(-8);
    await saveSimulation(state);
    return { result: ok(`${key} plays ${level} to ${toward}.`), media: [] };
  }

  // ── Affect ──

  async function appraiseTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const event = str(args.event).trim().slice(0, 300);
    if (!event) throw new Error("event is required.");
    const agency = str(args.agency).trim();
    if (agency !== "self" && agency !== "other" && agency !== "nobody")
      throw new Error("agency must be self, other or nobody.");
    const appraisal = appraiseEvent({
      impact: num(args.impact, 0),
      agency,
      expected: args.expected === true,
      control: num(args.control, 50),
    });
    const state = await loadSimulation();
    const key = keyFor(state.moods, name);
    const stamp = await sceneStamp();
    state.moods[key] = {
      ...appraisal,
      cause: event,
      atTick: state.tick,
      ...(stamp ? { atTime: stamp } : {}),
    };
    await saveSimulation(state);
    const row = findTrackerRow(name);
    if (row && appraisal.intensity >= 25) {
      const update = buildPresentCharacterUpdate(row.characterId, row.name, {
        emotion: appraisal.emotion,
        emotionCause: event,
      });
      if (update) deps.onStatusPatch(update);
    }
    return {
      result: ok(
        JSON.stringify({
          character: key,
          emotion: appraisal.emotion,
          intensity: appraisal.intensity,
          tendency: appraisal.tendency,
          note: "This is what they feel, as it fell. It shows in behaviour and fades with the scene clock; it is never stated.",
        }),
      ),
      media: [],
    };
  }

  async function moodCheckTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const raw = str(args.character).trim();
    const state = await loadSimulation();
    const entries = Object.entries(state.moods)
      .filter(([name]) => !raw || sameName(name, personName(raw)))
      .map(([name, mood]) => {
        const now = decayedReagentMood(mood, state.tick);
        return {
          character: name,
          reads: moodWord(now),
          emotion: now.emotion,
          intensity: now.intensity,
          tendency: now.tendency,
          cause: now.cause,
        };
      });
    return { result: ok(JSON.stringify({ moods: entries })), media: [] };
  }

  // ── Speech ──

  async function setVoiceTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const state = await loadSimulation();
    const key = keyFor(state.voices, name);
    const voice: ReagentVoice = { ...(state.voices[key] ?? {}) };
    for (const field of ["register", "sentences", "fillers", "avoids", "quirks"] as const) {
      const value = str(args[field]).trim();
      if (value) voice[field] = value.slice(0, 160);
    }
    if (typeof args.disfluency === "number" && Number.isFinite(args.disfluency))
      voice.disfluency = Math.max(0, Math.min(1, args.disfluency));
    if (!Object.keys(voice).length) throw new Error("Give at least one voice field.");
    state.voices[key] = voice;
    await saveSimulation(state);
    return { result: ok(`${key}'s voice: ${voiceSummary(voice)}`), media: [] };
  }

  async function turnShapeTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const addressing = str(args.addressing).trim() ? personName(str(args.addressing)) : "";
    const state = await loadSimulation();
    const moodKey = findKey(state.moods, name);
    const mood = moodKey ? decayedReagentMood(state.moods[moodKey]!, state.tick) : null;
    const statusKey = findKey(state.status, name);
    const status = statusKey
      ? (state.status[statusKey]!.find((entry) => addressing && sameName(entry.toward, addressing))?.level ?? null)
      : null;
    const objectiveKey = findKey(state.objectives, name);
    const tactic = objectiveKey ? state.objectives[objectiveKey]!.tactic : undefined;
    const shape = drawTurnShape({ mood, status, hasTactic: !!tactic }, (max) => randomInt(0, max));
    const voiceKey = findKey(state.voices, name);
    return {
      result: ok(
        JSON.stringify({
          character: name,
          shape,
          note: TURN_SHAPE_NOTES[shape],
          ...(shape === "pursue tactic" && tactic ? { tactic } : {}),
          ...(voiceKey ? { voice: voiceSummary(state.voices[voiceKey]!) } : {}),
        }),
      ),
      media: [],
    };
  }

  async function meanVsSayTool(args: Record<string, unknown>): Promise<ReagentToolOutcome> {
    const name = requirePerson(args);
    const means = str(args.means).trim().slice(0, 200);
    const says = str(args.says).trim().slice(0, 300);
    if (!means || !says) throw new Error("means and says are required.");
    const state = await loadSimulation();
    const key = keyFor(state.subtext, name);
    const stamp = await sceneStamp();
    state.subtext[key] = { means, says, ...(stamp ? { at: stamp } : {}) };
    await saveSimulation(state);
    return { result: ok(`Write only what ${key} says: ${says}`), media: [] };
  }

  // ── Ambient ──

  async function scenePressureTool(): Promise<ReagentToolOutcome> {
    const state = await loadSimulation();
    const roll = randomInt(0, 100);
    if (roll < 65) {
      const habits: string[] = [];
      for (const row of tracker) {
        const content = await readFile(join(deps.workspaceDir, dossierRelPath(row.name)), "utf8").catch(() => "");
        for (const line of content.split("\n")) {
          const match = line.match(/\[habit\]\s*(.+)$/);
          if (match) habits.push(`${row.name}: ${match[1]!.trim()}`);
        }
      }
      const habit = habits.length ? habits[randomInt(0, habits.length)] : null;
      return {
        result: ok(
          JSON.stringify({
            draw: "nothing",
            note: "Nothing happens. Maintenance, a wait, a chore; conversation only if someone has a reason.",
            ...(habit ? { habit } : {}),
          }),
        ),
        media: [],
      };
    }
    if (roll < 85) {
      const frictions = [
        "a phone buzzes and is ignored or not",
        "someone needs the bathroom, the kettle, a charger",
        "the weather turns a notch",
        "a small thing is missing: keys, a lighter, the remote",
        "a neighbour, a delivery or a noise outside",
        "someone is hungry and says nothing",
        "a text arrives from someone off-screen",
        "the time is later than anyone thought",
      ];
      return {
        result: ok(
          JSON.stringify({
            draw: "friction",
            what: frictions[randomInt(0, frictions.length)],
            note: "Small and unresolved; it costs a minute, not a scene.",
          }),
        ),
        media: [],
      };
    }
    const sources: string[] = [];
    for (const thread of state.threads)
      sources.push(`thread comes due: ${thread.what}${thread.who ? ` (${thread.who})` : ""}`);
    for (const [name, entry] of Object.entries(state.offscreen))
      sources.push(`${name} turns up, calls or texts from ${entry.where}`);
    if (!sources.length) sources.push("someone unexpected at the door or on the phone", "the weather closes in");
    return {
      result: ok(
        JSON.stringify({
          draw: "interruption",
          what: sources[randomInt(0, sources.length)],
          note: "It arrives with its own timing and wants; nobody is ready for it.",
        }),
      ),
      media: [],
    };
  }

  const handlers: Record<string, (args: Record<string, unknown>) => Promise<ReagentToolOutcome>> = {
    learn: learnTool,
    knows: knowsTool,
    forget: forgetTool,
    set_objective: setObjectiveTool,
    tactic_result: tacticResultTool,
    drop_objective: dropObjectiveTool,
    set_status: setStandingTool,
    appraise: appraiseTool,
    mood_check: moodCheckTool,
    set_voice: setVoiceTool,
    turn_shape: turnShapeTool,
    mean_vs_say: meanVsSayTool,
    scene_pressure: scenePressureTool,
    list_characters: listCharactersTool,
    add_character: addCharacterTool,
    remove_character: removeCharacterTool,
    note_character: noteCharacterTool,
    read_character_notes: readCharacterNotesTool,
    set_scene: setSceneTool,
    resolve_chance: resolveChanceTool,
    pick_random: pickRandomTool,
    add_thread: addThreadTool,
    resolve_thread: resolveThreadTool,
    set_whereabouts: setWhereaboutsTool,
    read_file: readFileTool,
    list_dir: listDirTool,
    write_file: writeFileTool,
    edit_file: editFileTool,
    delete_file: deleteFileTool,
    update_memory: updateMemoryTool,
    search_messages: searchMessagesTool,
    read_messages: readMessagesTool,
    set_character_status: setStatusTool,
    lookup_lorebook: lookupLorebookTool,
    write_lorebook_entry: writeLorebookEntryTool,
    fetch_url: fetchUrlTool,
    run_command: runCommandTool,
  };

  function ok(result: string): ToolExecutionResult {
    return { toolCallId: "", name: "", result, success: true };
  }
  function fail(message: string): ToolExecutionResult {
    return { toolCallId: "", name: "", result: JSON.stringify({ error: message }), success: false };
  }

  return {
    async execute(call: LLMToolCall): Promise<ReagentToolOutcome & { activity: ReagentActivityEntry }> {
      const started = Date.now();
      let args: Record<string, unknown> = {};
      let outcome: ReagentToolOutcome;
      try {
        const parsed: unknown = JSON.parse(call.function.arguments || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
          throw new Error("Arguments must be a JSON object.");
        args = parsed as Record<string, unknown>;
        const handler = handlers[call.function.name];
        if (!handler) throw new Error(`Unknown REagent tool: ${call.function.name}`);
        outcome = await handler(args);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug("[reagent] %s failed: %s", call.function.name, message);
        outcome = { result: fail(message), media: [] };
      }
      outcome.result = { ...outcome.result, toolCallId: call.id, name: call.function.name };
      const activity: ReagentActivityEntry = {
        id: newId(),
        tool: call.function.name,
        args: clipArgs(args),
        result: clip(outcome.result.result, 4_000),
        ok: outcome.result.success,
        durationMs: Date.now() - started,
        ...(outcome.media.length ? { media: outcome.media.map(({ kind, name }) => ({ kind, name })) } : {}),
        ...(outcome.approval ? { approval: outcome.approval } : {}),
      };
      return { ...outcome, activity };
    },
  };
}

function clipArgs(args: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(args)) {
    out[key] = typeof value === "string" && value.length > 1_500 ? `${value.slice(0, 1_500)}…` : value;
  }
  return out;
}
