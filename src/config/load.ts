import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OmcbError } from "../core/errors";
import { omcbHome } from "../core/paths";
import type { PermissionMode, SandboxTier } from "../permissions/types";
import { OmcbConfigSchema } from "./schema";
import type { HookDef, McpServerConfig, OmcbConfig } from "./schema";

export interface ResolvedModelProfile {
  name: string;
  providerKind: "anthropic" | "openai-compat";
  model: string;
  baseUrl?: string;
  apiKey?: string;
  maxTokens?: number;
}

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
  parallelToolCalls: boolean;
  promptCaching?: boolean;
  hooks: HookDef[];
  memoryFiles: string[];
  mcpServers: McpServerConfig[];
  /** Named model profiles, keyed by name; switch the active one with /model or --model. */
  modelProfiles: Record<string, ResolvedModelProfile>;
  /** Optional banner logo image path. */
  logo?: string;
  /** Banner logo width in terminal columns (half-block render). */
  logoWidth: number;
  /** Whether to drop a white-ish logo background to transparent, or keep it. */
  logoBg: "transparent" | "keep";
  /** Whether to play the animated startup splash (interactive TTY only). */
  splash: boolean;
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

/** Replace ${env:VAR} in every string value (so configs are commitable without secrets). */
function interpolateEnv(value: unknown): unknown {
  if (typeof value === "string") {
    return value.replace(/\$\{env:([A-Za-z_][A-Za-z0-9_]*)\}/g, (_, name: string) => process.env[name] ?? "");
  }
  if (Array.isArray(value)) return value.map(interpolateEnv);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = interpolateEnv(v);
    return out;
  }
  return value;
}

function deepMerge<T extends Record<string, unknown>>(base: T, over: Record<string, unknown>): T {
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    if (v === null) {
      delete out[k];
    } else if (Array.isArray(v)) {
      out[k] = v; // arrays replace
    } else if (v && typeof v === "object" && out[k] && typeof out[k] === "object" && !Array.isArray(out[k])) {
      out[k] = deepMerge(out[k] as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

function readConfigFile(p: string): OmcbConfig | undefined {
  if (!fs.existsSync(p)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(p, "utf8"));
  } catch (err) {
    throw new OmcbError("cli_error", `invalid JSON in config ${p}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const result = OmcbConfigSchema.safeParse(interpolateEnv(parsed));
  if (!result.success) {
    throw new OmcbError("cli_error", `invalid config ${p}: ${result.error.message}`);
  }
  return result.data;
}

/** Collect config files low→high precedence: global, global.local, then project .omcb/.codingmalo (far→near). */
function configFilePaths(workspace: string): string[] {
  const home = omcbHome();
  const paths = [path.join(home, "config.json"), path.join(home, "config.local.json")];
  const projectDirs: string[] = [];
  let dir = path.resolve(workspace);
  const stop = os.homedir();
  for (;;) {
    if (dir === stop) break; // home's config.json is the global config, already added above
    projectDirs.push(dir);
    if (fs.existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // nearest (workspace) should win → append far→near. Within a dir, .codingmalo overrides legacy .omcb.
  for (const d of projectDirs.reverse()) {
    paths.push(
      path.join(d, ".omcb", "config.json"),
      path.join(d, ".omcb", "config.local.json"),
      path.join(d, ".codingmalo", "config.json"),
      path.join(d, ".codingmalo", "config.local.json"),
    );
  }
  return paths;
}

export function loadFileConfig(workspace: string): OmcbConfig {
  let merged: OmcbConfig = {};
  for (const p of configFilePaths(workspace)) {
    const cfg = readConfigFile(p);
    if (cfg) merged = deepMerge(merged as Record<string, unknown>, cfg as Record<string, unknown>) as OmcbConfig;
  }
  return merged;
}

export function resolveConfig(overrides: ConfigOverrides, workspace?: string): ResolvedConfig {
  const file: OmcbConfig = workspace ? loadFileConfig(workspace) : {};

  const topProvider: "anthropic" | "openai-compat" =
    overrides.provider ??
    (process.env.CODINGMALO_PROVIDER as "anthropic" | "openai-compat" | undefined) ??
    file.provider ??
    "anthropic";
  const topBaseUrl =
    overrides.baseUrl ??
    process.env.CODINGMALO_BASE_URL ??
    process.env.ANTHROPIC_BASE_URL ??
    process.env.OPENAI_BASE_URL ??
    file.baseUrl;
  const envApiKey = process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY;

  // Named model profiles (their ${env:} secrets were already interpolated by the loader).
  const modelProfiles: Record<string, ResolvedModelProfile> = {};
  for (const [name, p] of Object.entries(file.models ?? {})) {
    modelProfiles[name] = {
      name,
      providerKind: p.provider ?? topProvider,
      model: p.model,
      baseUrl: p.baseUrl ?? topBaseUrl,
      apiKey: p.apiKey ?? envApiKey,
      maxTokens: p.maxTokens,
    };
  }

  // The active model: a profile name (→ use its provider/key/baseUrl) or a raw wire id on top-level.
  const requested = overrides.model ?? process.env.CODINGMALO_MODEL ?? file.defaultModel ?? DEFAULT_MODEL;
  const active = modelProfiles[requested];

  const permissionMode: PermissionMode = overrides.dangerouslySkipPermissions
    ? "bypass"
    : (overrides.permissionMode ?? file.permissionMode ?? "bypass");
  const promptCaching = overrides.promptCaching ?? envBool("CODINGMALO_PROMPT_CACHING") ?? file.promptCaching;

  return {
    providerKind: active ? active.providerKind : topProvider,
    model: active ? active.model : requested,
    apiKey: active ? active.apiKey : envApiKey,
    baseUrl: active ? active.baseUrl : topBaseUrl,
    maxTurns: overrides.maxTurns ?? Number(process.env.CODINGMALO_MAX_TURNS ?? file.maxTurns ?? 25),
    maxTokens: overrides.maxTokens ?? active?.maxTokens ?? Number(process.env.CODINGMALO_MAX_TOKENS ?? file.maxTokens ?? 8192),
    permissionMode,
    sandbox: overrides.sandbox ?? file.sandbox ?? "workspace-write",
    allowedTools: overrides.allowedTools ?? file.allowedTools,
    passthroughEnv:
      file.passthroughEnv ??
      (process.env.CODINGMALO_PASSTHROUGH_ENV ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    parallelToolCalls: overrides.parallelToolCalls ?? envBool("CODINGMALO_PARALLEL_TOOL_CALLS") ?? file.parallelToolCalls ?? true,
    ...(promptCaching !== undefined ? { promptCaching } : {}),
    hooks: file.hooks ?? [],
    memoryFiles: file.memory?.files ?? ["AGENTS.md", "CLAUDE.md"],
    mcpServers: file.mcpServers ?? [],
    modelProfiles,
    ...(file.logo ? { logo: file.logo } : {}),
    logoWidth: file.logoWidth ?? 22,
    logoBg: file.logoBg ?? "transparent",
    splash: envBool("CODINGMALO_SPLASH") ?? file.splash ?? true,
  };
}
