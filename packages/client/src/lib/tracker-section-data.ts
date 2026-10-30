import type { GameState } from "@marinara-engine/shared";

const BUILT_IN_TRACKER_AGENT_TYPES = [
  "world-state",
  "persona-stats",
  "character-tracker",
  "quest",
  "inventory-tracker",
  "custom-tracker",
] as const;

const hasText = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const hasRows = (value: unknown) => Array.isArray(value) && value.length > 0;

/**
 * Whether the snapshot already holds data for a built-in tracker section, whoever wrote it:
 * the section's agent, the REagent tools (set_scene, add_character, …) or the user by hand.
 * The server shows such data to the model even with the agent off; the UI shows it too.
 */
export function trackerAgentTypeHasData(agentType: string, gameState: GameState | null | undefined): boolean {
  if (!gameState) return false;
  const stats = gameState.playerStats;
  switch (agentType) {
    case "world-state":
      return (
        [gameState.date, gameState.time, gameState.location, gameState.weather, gameState.temperature].some(hasText) ||
        hasRows(gameState.worldCustomFields)
      );
    case "character-tracker":
      return hasRows(gameState.presentCharacters);
    case "persona-stats":
      return hasRows(gameState.personaStats) || hasText(stats?.status);
    case "quest":
      return hasRows(stats?.activeQuests);
    case "inventory-tracker":
      return (
        hasRows(stats?.inventoryTrackerCurrencies) ||
        hasRows(stats?.inventoryTrackerEquipped) ||
        hasRows(stats?.inventoryTrackerInventory)
      );
    case "custom-tracker":
      return hasRows(stats?.customTrackerFields);
    default:
      return false;
  }
}

/** The tracker sections to show: the agents that are on, plus any section that already has data. */
export function visibleTrackerAgentTypes(
  enabledAgentTypes: ReadonlySet<string>,
  gameState: GameState | null | undefined,
): Set<string> {
  const shown = new Set(enabledAgentTypes);
  for (const type of BUILT_IN_TRACKER_AGENT_TYPES) {
    if (trackerAgentTypeHasData(type, gameState)) shown.add(type);
  }
  return shown;
}
