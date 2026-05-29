import type { ToolDefinition } from "../providers/provider";
import { toInputSchema } from "./schema-serialize";
import type { Tool } from "./types";

/** Match a tool name against an allow/deny list supporting trailing-`*` wildcards. */
export function matchAllowed(name: string, patterns: string[]): boolean {
  for (const pat of patterns) {
    if (pat === name) return true;
    if (pat.endsWith("*") && name.startsWith(pat.slice(0, -1))) return true;
  }
  return false;
}

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.name, tool);
  }
  registerAll(tools: Tool[]): void {
    for (const tool of tools) this.register(tool);
  }
  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }
  list(allowed?: string[]): Tool[] {
    const all = [...this.tools.values()];
    if (!allowed || allowed.length === 0) return all;
    return all.filter((t) => matchAllowed(t.name, allowed));
  }
  names(allowed?: string[]): string[] {
    return this.list(allowed).map((t) => t.name);
  }
  toToolDefinitions(allowed?: string[]): ToolDefinition[] {
    return this.list(allowed).map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.jsonSchema ?? (t.schema ? toInputSchema(t.schema) : { type: "object", properties: {} }),
    }));
  }
}
