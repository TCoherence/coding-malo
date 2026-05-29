import type { ZodType } from "zod";

import type { TaskManager } from "../agent/task-manager";
import type { ToolSource } from "../core/types";
import type { ApprovalRequest, Decision, PermissionEffect, SandboxTier } from "../permissions/types";

export interface SubagentResult {
  text: string;
  isError: boolean;
}

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
}

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  env: Record<string, string>;
  sandbox: SandboxTier;
  /** Live output (e.g. streaming bash stdout). Renderers may show it; safe to ignore. */
  emitChunk(chunk: string): void;
  requestApproval(req: ApprovalRequest): Promise<Decision>;
  agentId: string;
  logger: Logger;
  /** Run a child agent loop to completion (provided by the engine). Excludes the Task tool. */
  spawnSubagent?(opts: { prompt: string; allowedTools?: string[]; systemPrompt?: string }): Promise<SubagentResult>;
  /** Session-scoped background task registry (for run_in_background Tasks). */
  taskManager?: TaskManager;
}

export interface ToolPermissionSpec {
  effects: PermissionEffect[];
  /** A stable string identifying what the call touches (e.g. an absolute path or command). */
  resource(input: any, ctx: ToolContext): string;
  danger?(input: any, ctx: ToolContext): "low" | "high";
}

export interface ToolResultText {
  type: "text";
  text: string;
}
export interface ToolResultImage {
  type: "image";
  mimeType: string;
  data: string;
}
export type ToolResultBlock = ToolResultText | ToolResultImage;

export interface ToolResult {
  content: string | ToolResultBlock[];
  isError?: boolean;
  details?: Record<string, unknown>;
}

export interface Tool<I = any> {
  readonly name: string;
  readonly description: string;
  /** Zod schema for built-in tools (validates input). MCP tools carry `jsonSchema` instead. */
  readonly schema?: ZodType<I>;
  /** Raw JSON Schema (e.g. from an MCP server) when no Zod schema is available. */
  readonly jsonSchema?: Record<string, unknown>;
  readonly permission: ToolPermissionSpec;
  readonly source: ToolSource;
  readonly mcpServer?: string;
  execute(input: I, ctx: ToolContext): Promise<ToolResult>;
}
