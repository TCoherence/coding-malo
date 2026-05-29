import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { McpServerConfig } from "../config/schema";
import type { McpServerStatus } from "../core/events";
import type { Tool, ToolResult } from "../tools/types";

interface McpToolSpec {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Wrap one MCP tool as an OMCB Tool, namespaced `mcp__<server>__<tool>`. */
export function wrapMcpTool(server: string, client: Client, spec: McpToolSpec): Tool {
  const wireName = `mcp__${server}__${spec.name}`;
  return {
    name: wireName,
    description: spec.description ?? `MCP tool "${spec.name}" from server "${server}"`,
    jsonSchema: spec.inputSchema ?? { type: "object", properties: {} },
    source: "mcp",
    mcpServer: server,
    permission: { effects: ["execute", "network"], resource: () => wireName, danger: () => "high" },
    async execute(input: Record<string, unknown>): Promise<ToolResult> {
      const res = (await client.callTool({
        name: spec.name,
        arguments: (input ?? {}) as Record<string, unknown>,
      })) as { content?: unknown; isError?: boolean };
      const content = Array.isArray(res.content) ? res.content : [];
      const text = content
        .filter((c): c is { type: "text"; text: string } => !!c && (c as { type?: string }).type === "text")
        .map((c) => c.text)
        .join("\n");
      return { content: text || "(no output)", isError: Boolean(res.isError) };
    },
  };
}

export interface McpLoadResult {
  tools: Tool[];
  statuses: McpServerStatus[];
  close: () => Promise<void>;
}

function makeTransport(cfg: McpServerConfig) {
  if (cfg.url) return new StreamableHTTPClientTransport(new URL(cfg.url));
  if (cfg.command) {
    return new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      ...(cfg.env ? { env: cfg.env } : {}),
    });
  }
  throw new Error(`MCP server "${cfg.name}" has neither a url nor a command`);
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("MCP connect timed out")), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function connectOne(cfg: McpServerConfig): Promise<{ client: Client; tools: Tool[] }> {
  const client = new Client({ name: "omcb", version: "0.0.0" }, { capabilities: {} });
  await client.connect(makeTransport(cfg));
  const list = (await client.listTools()) as { tools?: McpToolSpec[] };
  const tools = (list.tools ?? []).map((t) => wrapMcpTool(cfg.name, client, t));
  return { client, tools };
}

/**
 * Connect to all configured MCP servers concurrently. A server that fails to connect is marked
 * "degraded" and skipped (never fatal). Returns the wrapped tools, per-server status, and a closer.
 */
export async function loadMcpServers(
  servers: McpServerConfig[],
  defaultTimeoutMs = 15_000,
): Promise<McpLoadResult> {
  const tools: Tool[] = [];
  const statuses: McpServerStatus[] = [];
  const clients: Client[] = [];

  await Promise.all(
    servers.map(async (s) => {
      try {
        const conn = await withTimeout(connectOne(s), s.timeoutMs ?? defaultTimeoutMs);
        clients.push(conn.client);
        tools.push(...conn.tools);
        statuses.push({ name: s.name, status: "ok" });
      } catch {
        statuses.push({ name: s.name, status: "degraded" });
      }
    }),
  );

  return {
    tools,
    statuses,
    close: async () => {
      for (const c of clients) {
        try {
          await c.close();
        } catch {
          /* ignore */
        }
      }
    },
  };
}
