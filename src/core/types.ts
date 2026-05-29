import type { ErrorKind } from "./errors";

export type Role = "user" | "assistant";

export type StopReason =
  | "end_turn"
  | "tool_use"
  | "max_tokens"
  | "stop_sequence"
  | "refusal";

export type ToolSource = "builtin" | "mcp" | "skill" | "subagent";

export type TerminalReason =
  | "end_turn"
  | "max_turns"
  | "max_tokens"
  | "timeout"
  | "aborted"
  | "error";

export interface TextBlock {
  type: "text";
  text: string;
}
export interface ThinkingBlock {
  type: "thinking";
  thinking: string;
  /** Opaque provider signature; MUST round-trip on resume or Anthropic rejects the message. */
  signature?: string;
}
export interface ToolUseBlock {
  type: "tool_use";
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: "tool_result";
  toolUseId: string;
  output: string;
  isError: boolean;
}
export interface ImageBlock {
  type: "image";
  mediaType: string;
  data: string; // base64
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ImageBlock;

export interface NormalizedUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens?: number;
  cacheCreationInputTokens?: number;
  costUsd?: number;
}

export interface NormalizedMessage {
  id: string;
  role: Role;
  content: ContentBlock[];
  stopReason?: StopReason; // assistant only
  usage?: NormalizedUsage; // assistant only
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ImageInput {
  mediaType: string;
  data: string; // base64
}

export interface UserInput {
  text: string;
  images?: ImageInput[];
}

/** The value the agent loop generator returns (not an event). */
export interface FinalResult {
  text: string;
  usage: NormalizedUsage; // cumulative across turns
  terminalReason: TerminalReason;
  errorKind?: ErrorKind;
  error?: string;
  partialText?: string;
  sessionId: string;
  turnsUsed: number;
}
