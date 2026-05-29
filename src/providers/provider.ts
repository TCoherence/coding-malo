import type { NormalizedMessage, NormalizedUsage, StopReason } from "../core/types";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>; // JSON Schema
}

export interface StreamOptions {
  model: string;
  maxTokens: number;
  /** Full system prompt (base + appended ambient/memory). */
  system: string;
  thinking?: { budgetTokens: number };
  /** Anthropic: place cache_control breakpoints on the stable prefix. */
  cachePrefix?: boolean;
  signal: AbortSignal;
  /** OpenAI escape hatch — some compat endpoints (Gemini, relays) need this false. */
  parallelToolCalls?: boolean;
}

/**
 * Normalised streaming events. Both the Anthropic and OpenAI-compatible providers map their
 * native SSE onto this single shape, so the agent loop never sees provider specifics.
 */
export type ProviderStreamEvent =
  | { type: "message_start"; id: string }
  | { type: "text_delta"; index: number; text: string }
  | { type: "thinking_delta"; index: number; thinking: string }
  | { type: "thinking_signature"; index: number; signature: string }
  | { type: "tool_use_start"; index: number; id: string; name: string }
  | { type: "tool_use_input_delta"; index: number; partialJson: string }
  | { type: "tool_use_stop"; index: number }
  | { type: "usage"; usage: NormalizedUsage }
  | { type: "stop"; stopReason: StopReason };

export interface Provider {
  readonly name: string;
  stream(
    messages: NormalizedMessage[],
    tools: ToolDefinition[],
    options: StreamOptions,
  ): AsyncIterable<ProviderStreamEvent>;
}
