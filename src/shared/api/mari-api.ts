import type { MariApplyStagedChangesResult, MariEntryAction, MariEntryRequest, MariGatewayResponse, MariTraceEvent } from "../../engine/mari/mari-entry";
import { Channel } from "@tauri-apps/api/core";
import { invokeTauri } from "./tauri-client";

export type MariStreamEvent = { type: "trace"; event: MariTraceEvent };

export const mariApi = {
  prompt: (request: MariEntryRequest, onEvent: (event: MariStreamEvent) => void = () => undefined) => {
    const channel = new Channel<MariStreamEvent>(onEvent);
    return invokeTauri<MariGatewayResponse>("professor_mari_prompt", {
      request,
      onEvent: channel,
    });
  },
  applyStagedChanges: (action: MariEntryAction) =>
    invokeTauri<MariApplyStagedChangesResult>("professor_mari_apply_staged_changes", {
      action,
    }),
};
