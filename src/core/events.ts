import type { ErrorKind } from "./errors";
import type { NormalizedUsage, ToolSource } from "./types";

export interface PlanItem {
  id: string;
  text: string;
  status: "pending" | "in_progress" | "completed";
}
export interface PlanState {
  title?: string;
  items: PlanItem[];
  proposed: boolean;
}

/** snake_case wire shape — matches oh-my-agent's AgentResponse.usage keys exactly. */
export interface UsageWire {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
}

export interface McpServerStatus {
  name: string;
  status: "ok" | "degraded";
}

/**
 * THE wire protocol. The agent loop is the single producer of these events; the Ink TUI,
 * the headless NDJSON renderer, and the session writer are independent consumers.
 *
 * Note: a `control` event for OMA_CONTROL frame synthesis is intentionally NOT part of v1.
 * Control frames the model itself writes simply ride through in the assistant text / result.text.
 */
export type OmcbEvent =
  | {
      type: "init";
      session_id: string;
      model: string;
      provider: string;
      workspace: string;
      tools: string[];
      mcp_servers: McpServerStatus[];
      max_turns: number;
    }
  | { type: "message_start"; role: "assistant"; agent_id: string }
  | { type: "thinking_delta"; text: string; agent_id: string }
  | { type: "text_delta"; text: string; agent_id: string }
  | {
      type: "tool_start";
      tool_id: string;
      name: string;
      input: unknown;
      source: ToolSource;
      agent_id: string;
      parent_tool_id?: string;
    }
  | { type: "tool_result"; tool_id: string; name: string; output: string; is_error: boolean }
  | { type: "plan"; plan: PlanState }
  | {
      type: "message_stop";
      stop_reason: "end_turn" | "tool_use" | "max_tokens" | "stop";
      agent_id: string;
    }
  | ({ type: "usage" } & UsageWire) // per-turn
  | {
      type: "result";
      session_id: string;
      text: string;
      terminal_reason: string;
      turns_used: number;
      partial_text?: string;
      error?: string;
      error_kind?: ErrorKind;
      usage: UsageWire; // cumulative
    };

export type OmcbEventType = OmcbEvent["type"];

export function usageToWire(u: NormalizedUsage): UsageWire {
  return {
    input_tokens: u.inputTokens ?? 0,
    output_tokens: u.outputTokens ?? 0,
    cache_read_input_tokens: u.cacheReadInputTokens ?? 0,
    cache_creation_input_tokens: u.cacheCreationInputTokens ?? 0,
    cost_usd: u.costUsd ?? 0,
  };
}
