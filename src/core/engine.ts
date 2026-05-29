import { randomUUID } from "node:crypto";

import type { TaskManager } from "../agent/task-manager";
import type { HookRunner } from "../hooks/runner";
import type { PermissionEngine } from "../permissions/engine";
import type { SandboxTier } from "../permissions/types";
import type { Provider } from "../providers/provider";
import type { ToolRegistry } from "../tools/registry";
import type { Logger, ToolContext, ToolResultBlock } from "../tools/types";
import { classifyApiError } from "./errors";
import type { ErrorKind } from "./errors";
import { usageToWire } from "./events";
import type { McpServerStatus, OmcbEvent, PlanState } from "./events";
import type {
  ContentBlock,
  FinalResult,
  NormalizedMessage,
  NormalizedUsage,
  StopReason,
  TerminalReason,
  TextBlock,
  ThinkingBlock,
  ToolSource,
  ToolUseBlock,
  UserInput,
} from "./types";
import { addUsage, computeCost, emptyUsage } from "./usage";

const ROOT_AGENT = "root";

const noopLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

export interface AgentLoopConfig {
  provider: Provider;
  registry: ToolRegistry;
  permissions: PermissionEngine;
  systemPrompt: string;
  /** ambient context (memory etc.) appended after the base prompt; never persisted. */
  appendSystemPrompt?: string;
  maxTurns: number;
  model: string;
  maxTokens: number;
  thinking?: { budgetTokens: number };
  parallelToolCalls?: boolean;
  signal: AbortSignal;
  sessionId: string;
  workspace: string;
  env: Record<string, string>;
  sandbox: SandboxTier;
  allowedTools?: string[];
  writer?: { writeMessage(m: NormalizedMessage): void };
  hooks?: HookRunner;
  mcpServers?: McpServerStatus[];
  taskManager?: TaskManager;
  /** Identifies the agent for tool context (sub-agents get a distinct id). Defaults to "root". */
  agentId?: string;
  logger?: Logger;
}

const SUBAGENT_PROMPT =
  "You are a focused sub-agent spawned to complete one specific task. Use the available tools to do it, then report a concise result as your final message. You cannot spawn further sub-agents.";

function newId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

interface PendingTool {
  id: string;
  name: string;
  json: string;
}

function buildResult(
  cfg: AgentLoopConfig,
  cumulative: Required<NormalizedUsage>,
  turnsUsed: number,
  terminalReason: TerminalReason,
  text: string,
  opts?: { errorKind?: ErrorKind; error?: string; partialText?: string },
): { event: OmcbEvent; result: FinalResult } {
  cumulative.costUsd = computeCost(cfg.model, cumulative);
  const wire = usageToWire(cumulative);
  const result: FinalResult = {
    text,
    usage: { ...cumulative },
    terminalReason,
    sessionId: cfg.sessionId,
    turnsUsed,
    ...(opts?.errorKind ? { errorKind: opts.errorKind } : {}),
    ...(opts?.error ? { error: opts.error } : {}),
    ...(opts?.partialText ? { partialText: opts.partialText } : {}),
  };
  const event: OmcbEvent = {
    type: "result",
    session_id: cfg.sessionId,
    text,
    terminal_reason: terminalReason,
    turns_used: turnsUsed,
    usage: wire,
    ...(opts?.partialText ? { partial_text: opts.partialText } : {}),
    ...(opts?.error ? { error: opts.error } : {}),
    ...(opts?.errorKind ? { error_kind: opts.errorKind } : {}),
  };
  return { event, result };
}

function normalizeToolOutput(content: string | ToolResultBlock[]): string {
  if (typeof content === "string") return content;
  return content.map((b) => (b.type === "text" ? b.text : `[image ${b.mimeType}]`)).join("\n");
}

/** Run a child agent loop to completion (block mode). Excludes the Task tools to bound recursion. */
async function runSubagent(
  cfg: AgentLoopConfig,
  opts: { prompt: string; allowedTools?: string[]; systemPrompt?: string },
  logger: Logger,
): Promise<{ text: string; isError: boolean; usage: NormalizedUsage }> {
  const base = opts.allowedTools ?? cfg.allowedTools ?? cfg.registry.names();
  const allowed = base.filter((n) => n !== "Task" && n !== "task_status");
  const childCfg: AgentLoopConfig = {
    provider: cfg.provider,
    registry: cfg.registry,
    permissions: cfg.permissions,
    systemPrompt: opts.systemPrompt ?? SUBAGENT_PROMPT,
    maxTurns: Math.min(cfg.maxTurns, 15),
    model: cfg.model,
    maxTokens: cfg.maxTokens,
    signal: cfg.signal,
    sessionId: `${cfg.sessionId}/sub`,
    workspace: cfg.workspace,
    env: cfg.env,
    sandbox: cfg.sandbox,
    allowedTools: allowed,
    agentId: "sub",
    logger,
  };
  const conversation: NormalizedMessage[] = [];
  const gen = run(childCfg, { text: opts.prompt }, conversation);
  let step = await gen.next();
  while (!step.done) step = await gen.next();
  const result = step.value;
  return { text: result.text || "(no output)", isError: Boolean(result.errorKind), usage: result.usage };
}

async function executeTool(
  cfg: AgentLoopConfig,
  call: ToolUseBlock,
  logger: Logger,
): Promise<{ output: string; isError: boolean; plan?: PlanState; usage?: NormalizedUsage }> {
  const tool = cfg.registry.get(call.name);
  if (!tool) return { output: `unknown tool: ${call.name}`, isError: true };

  const ctx: ToolContext = {
    cwd: cfg.workspace,
    signal: cfg.signal,
    env: cfg.env,
    sandbox: cfg.sandbox,
    emitChunk: () => {}, // M0: live tool output is not yet forwarded to the protocol
    requestApproval: (req) => cfg.permissions.prompter.prompt(req),
    agentId: cfg.agentId ?? ROOT_AGENT,
    logger,
    spawnSubagent: (opts) => runSubagent(cfg, opts, logger),
    ...(cfg.taskManager ? { taskManager: cfg.taskManager } : {}),
  };

  // PreToolUse hook runs BEFORE the permission gate: it can block or rewrite the call.
  let rawInput: unknown = call.input;
  if (cfg.hooks) {
    const pre = await cfg.hooks.preToolUse(call.name, rawInput);
    if (pre.action === "block") return { output: `Blocked by PreToolUse hook: ${pre.reason}`, isError: true };
    if (pre.action === "modify" && pre.toolInput) rawInput = pre.toolInput;
  }

  // Built-in tools validate via Zod; MCP tools (jsonSchema only) pass input through to the server.
  let data: unknown = rawInput;
  if (tool.schema) {
    const parsed = tool.schema.safeParse(rawInput);
    if (!parsed.success) {
      return { output: `invalid input for ${call.name}: ${parsed.error.message}`, isError: true };
    }
    data = parsed.data;
  }
  try {
    const decision = await cfg.permissions.evaluate(tool, data, ctx);
    if (!decision.allow) return { output: `Permission denied: ${decision.reason}`, isError: true };
    const result = await tool.execute(data, ctx);
    const output = normalizeToolOutput(result.content);
    if (cfg.hooks) await cfg.hooks.postToolUse(call.name, data, output);
    const details = result.details as Record<string, unknown> | undefined;
    const plan = details && "plan" in details ? (details.plan as PlanState) : undefined;
    const usage = details && "usage" in details ? (details.usage as NormalizedUsage) : undefined;
    return { output, isError: result.isError ?? false, ...(plan ? { plan } : {}), ...(usage ? { usage } : {}) };
  } catch (err) {
    logger.error("tool execution failed", call.name, err);
    return { output: `tool error: ${err instanceof Error ? err.message : String(err)}`, isError: true };
  }
}

/**
 * The agent loop. Mutates `conversation` in place (appends the user message, each assistant
 * message, and each tool-result message), so callers can keep it for the next turn / resume.
 * Yields OmcbEvents and returns a FinalResult.
 */
export async function* run(
  cfg: AgentLoopConfig,
  userInput: UserInput,
  conversation: NormalizedMessage[],
): AsyncGenerator<OmcbEvent, FinalResult, void> {
  const logger = cfg.logger ?? noopLogger;
  const cumulative = emptyUsage();

  // UserPromptSubmit hook may rewrite or block the prompt before anything runs.
  let userText = userInput.text;
  let blockedReason: string | null = null;
  if (cfg.hooks) {
    const decision = await cfg.hooks.userPromptSubmit(userText);
    if (decision.action === "block") blockedReason = decision.reason ?? "blocked by hook";
    else if (decision.action === "rewrite" && decision.prompt) userText = decision.prompt;
  }

  const userContent: ContentBlock[] = [];
  if (userText.length > 0) userContent.push({ type: "text", text: userText });
  for (const img of userInput.images ?? []) {
    userContent.push({ type: "image", mediaType: img.mediaType, data: img.data });
  }
  const userMessage: NormalizedMessage = { id: newId("msg"), role: "user", content: userContent };
  conversation.push(userMessage);
  cfg.writer?.writeMessage(userMessage);

  yield {
    type: "init",
    session_id: cfg.sessionId,
    model: cfg.model,
    provider: cfg.provider.name,
    workspace: cfg.workspace,
    tools: cfg.registry.names(cfg.allowedTools),
    mcp_servers: cfg.mcpServers ?? [],
    max_turns: cfg.maxTurns,
  };

  if (blockedReason !== null) {
    if (cfg.hooks) await cfg.hooks.fire("Stop");
    const { event, result } = buildResult(cfg, cumulative, 0, "end_turn", blockedReason);
    yield event;
    return result;
  }

  let turnsUsed = 0;
  let lastText = "";

  while (turnsUsed < cfg.maxTurns) {
    turnsUsed++;
    yield { type: "message_start", role: "assistant", agent_id: ROOT_AGENT };

    const system = cfg.appendSystemPrompt
      ? `${cfg.systemPrompt}\n\n${cfg.appendSystemPrompt}`
      : cfg.systemPrompt;
    const tools = cfg.registry.toToolDefinitions(cfg.allowedTools);

    const texts = new Map<number, string>();
    const thinkings = new Map<number, { text: string; signature?: string }>();
    const toolsByIndex = new Map<number, PendingTool>();
    const order: number[] = [];
    const seen = new Set<number>();
    const noteIndex = (i: number): void => {
      if (!seen.has(i)) {
        seen.add(i);
        order.push(i);
      }
    };

    let turnUsage: NormalizedUsage = emptyUsage();
    let stopReason: StopReason = "end_turn";

    try {
      for await (const ev of cfg.provider.stream(conversation, tools, {
        model: cfg.model,
        maxTokens: cfg.maxTokens,
        system,
        ...(cfg.thinking ? { thinking: cfg.thinking } : {}),
        cachePrefix: true,
        ...(cfg.parallelToolCalls !== undefined ? { parallelToolCalls: cfg.parallelToolCalls } : {}),
        signal: cfg.signal,
      })) {
        switch (ev.type) {
          case "message_start":
            break;
          case "text_delta":
            noteIndex(ev.index);
            texts.set(ev.index, (texts.get(ev.index) ?? "") + ev.text);
            yield { type: "text_delta", text: ev.text, agent_id: ROOT_AGENT };
            break;
          case "thinking_delta": {
            noteIndex(ev.index);
            const cur = thinkings.get(ev.index) ?? { text: "" };
            cur.text += ev.thinking;
            thinkings.set(ev.index, cur);
            yield { type: "thinking_delta", text: ev.thinking, agent_id: ROOT_AGENT };
            break;
          }
          case "thinking_signature": {
            noteIndex(ev.index); // a signature may arrive for a block with no prior text delta
            const cur = thinkings.get(ev.index) ?? { text: "" };
            cur.signature = ev.signature;
            thinkings.set(ev.index, cur);
            break;
          }
          case "tool_use_start":
            noteIndex(ev.index);
            toolsByIndex.set(ev.index, { id: ev.id, name: ev.name, json: "" });
            break;
          case "tool_use_input_delta": {
            const t = toolsByIndex.get(ev.index);
            if (t) t.json += ev.partialJson;
            break;
          }
          case "tool_use_stop":
            break;
          case "usage":
            turnUsage = ev.usage;
            break;
          case "stop":
            stopReason = ev.stopReason;
            break;
        }
      }
    } catch (err) {
      const aborted = cfg.signal.aborted;
      const { kind, message } = classifyApiError(err);
      logger.error("provider stream failed", message);
      // A user/parent abort is not a retryable failure: omit error_kind so oh-my-agent won't
      // retry or fall back to another agent on an intentional interrupt.
      const terminal: TerminalReason = aborted ? "aborted" : kind === "timeout" ? "timeout" : "error";
      const { event, result } = buildResult(cfg, cumulative, turnsUsed, terminal, lastText, {
        ...(aborted ? {} : { errorKind: kind }),
        error: aborted ? "interrupted" : message,
        partialText: lastText || undefined,
      });
      if (cfg.hooks) await cfg.hooks.fire("Stop");
      yield event;
      return result;
    }

    // Assemble the assistant message in stream order.
    const content: ContentBlock[] = [];
    for (const i of order) {
      const think = thinkings.get(i);
      // Only persist thinking blocks that carry a signature: unsigned thinking cannot be replayed
      // to any provider, so storing it would just be silently dropped (and could break a resume).
      if (think && think.signature) {
        content.push({ type: "thinking", thinking: think.text, signature: think.signature });
      }
      const text = texts.get(i);
      if (text !== undefined) content.push({ type: "text", text });
      const tu = toolsByIndex.get(i);
      if (tu) {
        let input: Record<string, unknown> = {};
        try {
          input = tu.json.trim() ? (JSON.parse(tu.json) as Record<string, unknown>) : {};
        } catch {
          input = {};
        }
        content.push({ type: "tool_use", id: tu.id, name: tu.name, input });
      }
    }

    const assistantMessage: NormalizedMessage = {
      id: newId("msg"),
      role: "assistant",
      content,
      stopReason,
      usage: turnUsage,
    };
    conversation.push(assistantMessage);
    cfg.writer?.writeMessage(assistantMessage);

    addUsage(cumulative, turnUsage);
    const perTurnWire = usageToWire({ ...turnUsage, costUsd: computeCost(cfg.model, turnUsage) });
    yield { type: "usage", ...perTurnWire };

    const turnText = content
      .filter((b): b is TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("");
    if (turnText) lastText = turnText;

    if (stopReason !== "tool_use") {
      const stop = stopReason === "max_tokens" ? "max_tokens" : "end_turn";
      yield { type: "message_stop", stop_reason: stop, agent_id: ROOT_AGENT };
      const terminal: TerminalReason = stopReason === "max_tokens" ? "max_tokens" : "end_turn";
      const { event, result } = buildResult(cfg, cumulative, turnsUsed, terminal, turnText || lastText);
      if (cfg.hooks) await cfg.hooks.fire("Stop");
      yield event;
      return result;
    }

    yield { type: "message_stop", stop_reason: "tool_use", agent_id: ROOT_AGENT };

    const toolUses = content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    for (const tu of toolUses) {
      const source: ToolSource = cfg.registry.get(tu.name)?.source ?? "builtin";
      yield {
        type: "tool_start",
        tool_id: tu.id,
        name: tu.name,
        input: tu.input,
        source,
        agent_id: ROOT_AGENT,
      };
    }

    const results = await Promise.all(toolUses.map((tu) => executeTool(cfg, tu, logger)));
    const toolResultBlocks: ContentBlock[] = [];
    for (let i = 0; i < toolUses.length; i++) {
      const tu = toolUses[i]!;
      const r = results[i]!;
      yield { type: "tool_result", tool_id: tu.id, name: tu.name, output: r.output, is_error: r.isError };
      if (r.plan) yield { type: "plan", plan: r.plan };
      if (r.usage) {
        // Sub-agent tokens count toward this turn's total (tokens aggregate; cost is recomputed in buildResult).
        addUsage(cumulative, r.usage);
        yield { type: "usage", ...usageToWire(r.usage) };
      }
      toolResultBlocks.push({ type: "tool_result", toolUseId: tu.id, output: r.output, isError: r.isError });
    }
    const toolResultMessage: NormalizedMessage = {
      id: newId("msg"),
      role: "user",
      content: toolResultBlocks,
    };
    conversation.push(toolResultMessage);
    cfg.writer?.writeMessage(toolResultMessage);
  }

  const { event, result } = buildResult(cfg, cumulative, turnsUsed, "max_turns", lastText, {
    errorKind: "max_turns",
    error: `reached the maximum of ${cfg.maxTurns} turns`,
    partialText: lastText || undefined,
  });
  if (cfg.hooks) await cfg.hooks.fire("Stop");
  yield event;
  return result;
}
