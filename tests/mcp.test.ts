import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { describe, expect, it } from "vitest";

import { loadMcpServers, wrapMcpTool } from "../src/mcp/manager";

describe("MCP manager", () => {
  it("wraps an MCP tool (namespaced) and calls it through the client", async () => {
    const server = new McpServer({ name: "test-server", version: "0.0.0" });
    server.tool("greet", "greet someone", { who: z.string() }, async ({ who }) => ({
      content: [{ type: "text", text: `hi ${who}` }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "omcb-test", version: "0.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);

    const list = (await client.listTools()) as { tools: { name: string; description?: string; inputSchema?: Record<string, unknown> }[] };
    const tool = wrapMcpTool("srv", client, list.tools[0]!);
    expect(tool.name).toBe("mcp__srv__greet");
    expect(tool.source).toBe("mcp");
    expect(tool.jsonSchema).toBeDefined();

    const res = await tool.execute({ who: "omcb" }, {} as never);
    expect(res.isError).toBeFalsy();
    expect(String(res.content)).toContain("hi omcb");

    await client.close();
  });

  it("preserves non-text (image) content instead of dropping it", async () => {
    const server = new McpServer({ name: "shot-server", version: "0.0.0" });
    server.tool("shot", "screenshot", {}, async () => ({
      content: [{ type: "image", data: "QkFTRTY0", mimeType: "image/png" }],
    }));
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "omcb-test", version: "0.0.0" }, { capabilities: {} });
    await client.connect(clientTransport);
    const list = (await client.listTools()) as { tools: { name: string; inputSchema?: Record<string, unknown> }[] };
    const tool = wrapMcpTool("srv", client, list.tools[0]!);

    const res = await tool.execute({}, {} as never);
    expect(Array.isArray(res.content)).toBe(true);
    const blocks = res.content as { type: string; mimeType?: string; data?: string }[];
    expect(blocks[0]!.type).toBe("image");
    expect(blocks[0]!.data).toBe("QkFTRTY0");
    await client.close();
  });

  it("marks an unreachable server degraded without throwing", async () => {
    const r = await loadMcpServers([{ name: "nope", command: "/nonexistent/bin/xyz", args: [] }], 3000);
    expect(r.statuses).toEqual([{ name: "nope", status: "degraded" }]);
    expect(r.tools).toEqual([]);
    await r.close();
  });
});
