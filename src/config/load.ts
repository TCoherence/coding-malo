import type { PermissionMode, SandboxTier } from "../permissions/types";

export interface ResolvedConfig {
  providerKind: "anthropic" | "openai-compat";
  model: string;
  apiKey?: string;
  baseUrl?: string;
  maxTurns: number;
  maxTokens: number;
  permissionMode: PermissionMode;
  sandbox: SandboxTier;
  allowedTools?: string[];
  passthroughEnv: string[];
  /** OpenAI-compat: send parallel_tool_calls (set false for stricter Gemini/relays). */
  parallelToolCalls: boolean;
  /** Anthropic: force cache_control on/off; undefined = provider auto-decides by baseUrl. */
  promptCaching?: boolean;
}

export interface ConfigOverrides {
  provider?: "anthropic" | "openai-compat";
  model?: string;
  baseUrl?: string;
  maxTurns?: number;
  maxTokens?: number;
  permissionMode?: PermissionMode;
  sandbox?: SandboxTier;
  allowedTools?: string[];
  dangerouslySkipPermissions?: boolean;
  parallelToolCalls?: boolean;
  promptCaching?: boolean;
}

const DEFAULT_MODEL = "claude-sonnet-4-6";

function envBool(name: string): boolean | undefined {
  const v = process.env[name];
  if (v === undefined) return undefined;
  return v === "1" || v.toLowerCase() === "true";
}

/**
 * M0 config resolution: flags → env → defaults. (The full layered file-based loader is M4.)
 * NOTE: the M0 default permission mode is `bypass` so the loop runs unattended; M2 introduces
 * the interactive approval modal and flips the interactive default to `acceptEdits`.
 */
export function resolveConfig(overrides: ConfigOverrides): ResolvedConfig {
  const providerKind =
    overrides.provider ?? (process.env.OMCB_PROVIDER as "anthropic" | "openai-compat") ?? "anthropic";
  const permissionMode: PermissionMode = overrides.dangerouslySkipPermissions
    ? "bypass"
    : (overrides.permissionMode ?? "bypass");

  return {
    providerKind,
    model: overrides.model ?? process.env.OMCB_MODEL ?? DEFAULT_MODEL,
    apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY,
    baseUrl: overrides.baseUrl ?? process.env.OMCB_BASE_URL ?? process.env.ANTHROPIC_BASE_URL,
    maxTurns: overrides.maxTurns ?? Number(process.env.OMCB_MAX_TURNS ?? 25),
    maxTokens: overrides.maxTokens ?? Number(process.env.OMCB_MAX_TOKENS ?? 8192),
    permissionMode,
    sandbox: overrides.sandbox ?? "workspace-write",
    allowedTools: overrides.allowedTools,
    passthroughEnv: (process.env.OMCB_PASSTHROUGH_ENV ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    parallelToolCalls: overrides.parallelToolCalls ?? envBool("OMCB_PARALLEL_TOOL_CALLS") ?? true,
    ...(() => {
      const pc = overrides.promptCaching ?? envBool("OMCB_PROMPT_CACHING");
      return pc !== undefined ? { promptCaching: pc } : {};
    })(),
  };
}
