import path from "node:path";

import { matchAllowed } from "../tools/registry";
import type { Tool, ToolContext } from "../tools/types";
import { allow, deny } from "./types";
import type { Decision, PermissionMode, Prompter, SandboxTier } from "./types";

const PROTECTED_PATTERNS: RegExp[] = [
  /\/\.git(\/|$)/,
  /\/\.ssh(\/|$)/,
  /(^|\/)\.env(\.[^/]+)?$/,
  /(^|\/)secrets?(\/|\.|$)/i,
];

function isProtected(resource: string): boolean {
  return PROTECTED_PATTERNS.some((re) => re.test(resource));
}

function safeResource(tool: Tool, input: unknown, ctx: ToolContext): string {
  try {
    return tool.permission.resource(input, ctx);
  } catch {
    return tool.name;
  }
}

export interface PermissionEngineOptions {
  mode: PermissionMode;
  sandbox: SandboxTier;
  allowedTools?: string[];
  prompter: Prompter;
  workspace: string;
}

export class PermissionEngine {
  constructor(private readonly opts: PermissionEngineOptions) {}

  get prompter(): Prompter {
    return this.opts.prompter;
  }

  async evaluate(tool: Tool, input: unknown, ctx: ToolContext): Promise<Decision> {
    const { mode, sandbox, allowedTools, workspace } = this.opts;

    if (allowedTools && allowedTools.length > 0 && !matchAllowed(tool.name, allowedTools)) {
      return deny(`tool ${tool.name} is not in the --allowed-tools list`);
    }

    const effects = tool.permission.effects;
    const resource = safeResource(tool, input, ctx);
    const danger = tool.permission.danger?.(input, ctx) ?? "low";
    const mutates = effects.some((e) => e === "write" || e === "execute" || e === "network");

    if (mutates && isProtected(resource)) {
      return deny(`refusing to act on protected path: ${resource}`);
    }

    if (mode === "bypass") return allow();

    if (mode === "plan") {
      return mutates ? deny("plan mode is active: no mutations until the plan is approved") : allow();
    }

    if (!mutates) return allow();

    if (sandbox === "read-only") {
      return deny("read-only sandbox: this action would modify state");
    }

    const root = path.resolve(workspace);
    // Boundary check must respect path separators: "/proj2" must not match workspace "/proj".
    const inWorkspace = resource === root || resource.startsWith(root + path.sep);
    const onlyReadWrite = effects.every((e) => e === "read" || e === "write");
    if (mode === "acceptEdits" && danger === "low" && inWorkspace && onlyReadWrite) {
      return allow();
    }

    return this.opts.prompter.prompt({
      toolName: tool.name,
      resource,
      effects,
      danger,
      input,
      agentId: ctx.agentId,
    });
  }
}
