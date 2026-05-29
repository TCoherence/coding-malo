import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import type { McpServerConfig } from "../config/schema";
import type { McpServerStatus } from "../core/events";
import type { Tool, ToolResult, ToolResultBlock } from "../tools/types";

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
      const isError = Boolean(res.isError);
      const raw = Array.isArray(res.content) ? res.content : [];
      const blocks: ToolResultBlock[] = [];
      for (const c of raw) {
        if (!c || typeof c !== "object") continue;
        const b = c as { type?: string; text?: string; data?: string; mimeType?: string };
        if (b.type === "text" && typeof b.text === "string") blocks.push({ type: "text", text: b.text });
        else if (b.type === "image" && typeof b.data === "string") {
          blocks.push({ type: "image", mimeType: b.mimeType ?? "image/png", data: b.data });
        } else if (b.type) {
          blocks.push({ type: "text", text: `[${b.type} content]` }); // don't silently drop non-text
        }
      }
      if (blocks.length === 0) return { content: "(no output)", isError };
      // Preserve structured (image/…) content as blocks; collapse pure-text to a string.
      if (blocks.some((b) => b.type !== "text")) return { content: blocks, isError };
      return { content: blocks.map((b) => (b.type === "text" ? b.text : "")).join("\n"), isError };
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
  const client = new Client({ name: "codingmalo", version: "0.0.0" }, { capabilities: {} });
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
