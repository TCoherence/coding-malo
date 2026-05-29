import { z } from "zod";

export const HOOK_EVENTS = [
  "SessionStart",
  "SessionEnd",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
] as const;

export const HookDefSchema = z.object({
  event: z.enum(HOOK_EVENTS),
  /** Tool-name glob for Pre/PostToolUse (trailing `*` supported); omitted = all tools. */
  matcher: z.string().optional(),
  command: z.string(),
  timeoutMs: z.number().int().positive().optional(),
});
export type HookDef = z.infer<typeof HookDefSchema>;

/** The on-disk config (global ~/.omcb/config.json + project .omcb/config.json). All fields optional. */
export const OmcbConfigSchema = z
  .object({
    defaultModel: z.string().optional(),
    provider: z.enum(["anthropic", "openai-compat"]).optional(),
    baseUrl: z.string().optional(),
    maxTurns: z.number().int().positive().optional(),
    maxTokens: z.number().int().positive().optional(),
    permissionMode: z.enum(["plan", "default", "acceptEdits", "bypass"]).optional(),
    sandbox: z.enum(["read-only", "workspace-write", "danger-full-access"]).optional(),
    allowedTools: z.array(z.string()).optional(),
    passthroughEnv: z.array(z.string()).optional(),
    parallelToolCalls: z.boolean().optional(),
    promptCaching: z.boolean().optional(),
    memory: z.object({ files: z.array(z.string()).optional() }).optional(),
    hooks: z.array(HookDefSchema).optional(),
  })
  .strict();

export type OmcbConfig = z.infer<typeof OmcbConfigSchema>;
