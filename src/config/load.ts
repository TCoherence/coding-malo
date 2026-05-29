import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { OmcbError } from "../core/errors";
import { omcbHome } from "../core/paths";
import type { PermissionMode, SandboxTier } from "../permissions/types";
import { OmcbConfigSchema } from "./schema";
import type { HookDef, McpServerConfig, OmcbConfig } from "./schema";

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

/** Collect config files low→high precedence: global, global.local, then project .omcb (far→near). */
function configFilePaths(workspace: string): string[] {
  const home = omcbHome();
  const paths = [path.join(home, "config.json"), path.join(home, "config.local.json")];
  const projectDirs: string[] = [];
  let dir = path.resolve(workspace);
  const stop = os.homedir();
  for (;;) {
    if (dir === stop) break; // home's .omcb/config.json is the global config, already added above
    projectDirs.push(dir);
    if (fs.existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // nearest (workspace) should win → append far→near
  for (const d of projectDirs.reverse()) {
    paths.push(path.join(d, ".omcb", "config.json"), path.join(d, ".omcb", "config.local.json"));
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

  const providerKind =
    overrides.provider ??
    (process.env.OMCB_PROVIDER as "anthropic" | "openai-compat" | undefined) ??
    file.provider ??
    "anthropic";

  const permissionMode: PermissionMode = overrides.dangerouslySkipPermissions
    ? "bypass"
    : (overrides.permissionMode ?? file.permissionMode ?? "bypass");

  const promptCaching = overrides.promptCaching ?? envBool("OMCB_PROMPT_CACHING") ?? file.promptCaching;

  return {
    providerKind,
    model: overrides.model ?? process.env.OMCB_MODEL ?? file.defaultModel ?? DEFAULT_MODEL,
    apiKey: process.env.ANTHROPIC_API_KEY ?? process.env.OPENAI_API_KEY,
    baseUrl: overrides.baseUrl ?? process.env.OMCB_BASE_URL ?? process.env.ANTHROPIC_BASE_URL ?? file.baseUrl,
    maxTurns: overrides.maxTurns ?? Number(process.env.OMCB_MAX_TURNS ?? file.maxTurns ?? 25),
    maxTokens: overrides.maxTokens ?? Number(process.env.OMCB_MAX_TOKENS ?? file.maxTokens ?? 8192),
    permissionMode,
    sandbox: overrides.sandbox ?? file.sandbox ?? "workspace-write",
    allowedTools: overrides.allowedTools ?? file.allowedTools,
    passthroughEnv:
      file.passthroughEnv ??
      (process.env.OMCB_PASSTHROUGH_ENV ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    parallelToolCalls: overrides.parallelToolCalls ?? envBool("OMCB_PARALLEL_TOOL_CALLS") ?? file.parallelToolCalls ?? true,
    ...(promptCaching !== undefined ? { promptCaching } : {}),
    hooks: file.hooks ?? [],
    memoryFiles: file.memory?.files ?? ["AGENTS.md", "CLAUDE.md"],
    mcpServers: file.mcpServers ?? [],
  };
}
