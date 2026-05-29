import type { ResolvedConfig } from "../config/load";
import { HookRunner } from "../hooks/runner";
import { discoverMemory } from "../memory/discover";
import type { ApprovalStore } from "../permissions/approvals";
import { PermissionEngine } from "../permissions/engine";
import { sanitizeEnv } from "../permissions/sandbox";
import type { Prompter } from "../permissions/types";
import { buildProvider } from "../providers/registry";
import type { Provider } from "../providers/provider";
import { builtinTools } from "../tools/builtins";
import { ToolRegistry } from "../tools/registry";
import { run } from "./engine";
import type { OmcbEvent } from "./events";
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

  constructor(private readonly opts: DriverOptions) {
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
  }

  hookRunner(): HookRunner {
    return this.hooks;
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
    return run(
      {
        provider: this.provider,
        registry: this.registry,
        permissions: this.permissions,
        hooks: this.hooks,
        systemPrompt: this.memory ? `${base}\n\n${this.memory}` : base,
        appendSystemPrompt: this.opts.appendSystemPrompt,
        maxTurns: c.maxTurns,
        model: c.model,
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
