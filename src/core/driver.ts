import { TaskManager } from "../agent/task-manager";
import type { ResolvedConfig } from "../config/load";
import { HookRunner } from "../hooks/runner";
import { loadMcpServers } from "../mcp/manager";
import { discoverMemory } from "../memory/discover";
import { discoverSkills, makeSkillTool, skillsSystemBlock } from "../skills/loader";
import type { ApprovalStore } from "../permissions/approvals";
import { PermissionEngine } from "../permissions/engine";
import { sanitizeEnv } from "../permissions/sandbox";
import type { Prompter } from "../permissions/types";
import { buildProvider } from "../providers/registry";
import type { Provider } from "../providers/provider";
import { builtinTools } from "../tools/builtins";
import { ToolRegistry } from "../tools/registry";
import { run } from "./engine";
import type { McpServerStatus, OmcbEvent } from "./events";
import { buildSystemPrompt } from "./system-prompt";
import type { FinalResult, NormalizedMessage, UserInput } from "./types";

export interface DriverOptions {
  config: ResolvedConfig;
  sessionId: string;
  workspace: string;
  prompter: Prompter;
  approvals?: ApprovalStore;
  appendSystemPrompt?: string;
  writer?: { writeMessage(m: NormalizedMessage): void };
  history?: NormalizedMessage[];
  /** Injectable for tests; defaults to the real provider registry. */
  provider?: Provider;
}

/**
 * Owns the conversation across turns and wires the engine. The interactive TUI and the
 * headless one-shot both drive turns through this.
 */
export class AgentDriver {
  readonly conversation: NormalizedMessage[];
  private readonly registry: ToolRegistry;
  private readonly permissions: PermissionEngine;
  private readonly provider: Provider;
  private readonly env: Record<string, string>;
  private readonly hooks: HookRunner;
  private readonly memory: string;
  private readonly skillsBlock: string;
  private mcpStatuses: McpServerStatus[] = [];
  private mcpClose: () => Promise<void> = async () => {};
  private readonly taskManager = new TaskManager();
  private currentModel: string;

  constructor(private readonly opts: DriverOptions) {
    this.currentModel = opts.config.model;
    this.conversation = opts.history ?? [];
    this.registry = new ToolRegistry();
    this.registry.registerAll(builtinTools());
    this.permissions = new PermissionEngine({
      mode: opts.config.permissionMode,
      sandbox: opts.config.sandbox,
      allowedTools: opts.config.allowedTools,
      prompter: opts.prompter,
      workspace: opts.workspace,
      ...(opts.approvals ? { approvals: opts.approvals } : {}),
    });
    this.provider =
      opts.provider ??
      buildProvider({
        kind: opts.config.providerKind,
        apiKey: opts.config.apiKey,
        baseUrl: opts.config.baseUrl,
        ...(opts.config.promptCaching !== undefined ? { promptCaching: opts.config.promptCaching } : {}),
      });
    this.env = sanitizeEnv(opts.config.passthroughEnv, { OMA_AGENT_HOME: ".omcb" });
    this.hooks = new HookRunner(opts.config.hooks, this.env, opts.workspace);
    this.memory = discoverMemory(opts.workspace, opts.config.memoryFiles);

    const skills = discoverSkills(opts.workspace);
    if (skills.length > 0) this.registry.register(makeSkillTool(skills));
    this.skillsBlock = skillsSystemBlock(skills);
  }

  hookRunner(): HookRunner {
    return this.hooks;
  }

  getModel(): string {
    return this.currentModel;
  }
  setModel(model: string): void {
    this.currentModel = model;
  }
  availableModels(): string[] {
    return this.opts.config.models;
  }

  /** Connect MCP servers and register their tools. Call once before the first turn. */
  async init(): Promise<void> {
    if (this.opts.config.mcpServers.length === 0) return;
    const result = await loadMcpServers(this.opts.config.mcpServers);
    this.registry.registerAll(result.tools);
    this.mcpStatuses = result.statuses;
    this.mcpClose = result.close;
  }

  async close(): Promise<void> {
    await this.mcpClose();
  }

  toolNames(): string[] {
    return this.registry.names(this.opts.config.allowedTools);
  }

  runTurn(input: UserInput, signal: AbortSignal): AsyncGenerator<OmcbEvent, FinalResult, void> {
    const c = this.opts.config;
    const base = buildSystemPrompt({
      workspace: this.opts.workspace,
      platform: process.platform,
      permissionMode: c.permissionMode,
      sandbox: c.sandbox,
    });
    const planDirective =
      c.permissionMode === "plan"
        ? "## Plan mode\nInvestigate, then propose a plan via the update_plan tool. Do NOT edit files or run state-changing commands until the plan is approved."
        : "";
    const systemPrompt = [base, this.memory, this.skillsBlock, planDirective]
      .filter((s) => s.length > 0)
      .join("\n\n");
    return run(
      {
        provider: this.provider,
        registry: this.registry,
        permissions: this.permissions,
        hooks: this.hooks,
        mcpServers: this.mcpStatuses,
        taskManager: this.taskManager,
        systemPrompt,
        appendSystemPrompt: this.opts.appendSystemPrompt,
        maxTurns: c.maxTurns,
        model: this.currentModel,
        maxTokens: c.maxTokens,
        parallelToolCalls: c.parallelToolCalls,
        signal,
        sessionId: this.opts.sessionId,
        workspace: this.opts.workspace,
        env: this.env,
        sandbox: c.sandbox,
        allowedTools: c.allowedTools,
        writer: this.opts.writer,
      },
      input,
      this.conversation,
    );
  }
}
