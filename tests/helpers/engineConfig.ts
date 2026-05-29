import { PermissionEngine } from "../../src/permissions/engine";
import { HeadlessPrompter } from "../../src/permissions/prompter";
import { sanitizeEnv } from "../../src/permissions/sandbox";
import type { PermissionMode } from "../../src/permissions/types";
import type { Provider } from "../../src/providers/provider";
import { builtinTools } from "../../src/tools/builtins";
import { ToolRegistry } from "../../src/tools/registry";
import type { AgentLoopConfig } from "../../src/core/engine";

export function makeConfig(
  provider: Provider,
  workspace: string,
  overrides: Partial<AgentLoopConfig> = {},
  mode: PermissionMode = "bypass",
): AgentLoopConfig {
  const registry = new ToolRegistry();
  registry.registerAll(builtinTools());
  const permissions = new PermissionEngine({
    mode,
    sandbox: "workspace-write",
    prompter: new HeadlessPrompter(mode),
    workspace,
  });
  return {
    provider,
    registry,
    permissions,
    systemPrompt: "test system prompt",
    maxTurns: 10,
    model: "claude-sonnet-4-6",
    maxTokens: 1024,
    signal: new AbortController().signal,
    sessionId: "sess_test",
    workspace,
    env: sanitizeEnv([], { OMA_AGENT_HOME: ".omcb" }),
    sandbox: "workspace-write",
    ...overrides,
  };
}
