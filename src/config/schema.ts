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

export const McpServerSchema = z.object({
  name: z.string(),
  // stdio transport
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
  env: z.record(z.string(), z.string()).optional(),
  // streamable-http transport
  url: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
});
export type McpServerConfig = z.infer<typeof McpServerSchema>;

/**
 * A named model profile. Lets the user keep several models (each with its own provider, endpoint,
 * key, and wire model id) and switch between them with `/model <name>` or `--model <name>`.
 * Put secrets in .env and reference them here via `${env:VAR}` so config.json stays commitable.
 */
export const ModelProfileSchema = z.object({
  provider: z.enum(["anthropic", "openai-compat"]).optional(),
  model: z.string(),
  baseUrl: z.string().optional(),
  apiKey: z.string().optional(),
  maxTokens: z.number().int().positive().optional(),
});
export type ModelProfile = z.infer<typeof ModelProfileSchema>;

/** The on-disk config (global ~/.codingmalo/config.json + project .codingmalo/config.json). All fields optional. */
export const OmcbConfigSchema = z
  .object({
    /** Free-form comment key (JSON has no comments); ignored. */
    "//": z.string().optional(),
    /** Path to a banner logo image (PNG/JPG); rendered as half-block text. Default ~/.codingmalo/logo.{png,jpg,jpeg}. */
    logo: z.string().optional(),
    /** Banner logo width in terminal columns (default 22). Larger = sharper / more detail. */
    logoWidth: z.number().int().positive().optional(),
    /** Drop a white-ish logo background to transparent ("transparent", default) or keep it ("keep"). */
    logoBg: z.enum(["transparent", "keep"]).optional(),
    /** Play the animated startup splash on interactive launch (default true). */
    splash: z.boolean().optional(),
    /** Active model: a profile name from `models`, or a raw wire model id. */
    defaultModel: z.string().optional(),
    /** Named model profiles, switchable with /model. e.g. { "deepseek": { provider, model, … } }. */
    models: z.record(z.string(), ModelProfileSchema).optional(),
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
    mcpServers: z.array(McpServerSchema).optional(),
  })
  .strict();

export type OmcbConfig = z.infer<typeof OmcbConfigSchema>;
