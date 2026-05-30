import http from "node:http";
import type { AddressInfo } from "node:net";

type ChatBody = { messages?: { role?: string; content?: unknown }[] };

export interface MockHandle {
  baseUrl: string;
  requestCount: () => number;
  /** Parsed request bodies in arrival order — lets tests assert what was sent (e.g. resumed history). */
  bodies: () => ChatBody[];
  close: () => Promise<void>;
}

export interface MockOptions {
  /** Plain-text mode: stream this as the assistant reply. */
  reply?: string;
  /** Tool mode: round 1 emits this tool call; round 2 (after the tool result) streams `then`. */
  tool?: { name: string; args: Record<string, unknown>; then: string };
}

/** Split into a few pieces so the provider's streaming delta assembly is actually exercised. */
function chunkString(s: string): string[] {
  if (s.length <= 3) return s ? [s] : [];
  const n = Math.ceil(s.length / 3);
  return [s.slice(0, n), s.slice(n, 2 * n), s.slice(2 * n)].filter((x) => x.length > 0);
}

/**
 * A minimal OpenAI-compatible (`/chat/completions`, SSE) provider for e2e tests. Deterministic and
 * offline. Detects round 2 of a tool exchange by the presence of a `role: "tool"` message.
 */
export async function startMockOpenAI(opts: MockOptions): Promise<MockHandle> {
  let requests = 0;
  const bodies: ChatBody[] = [];
  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      requests++;
      let body: ChatBody = {};
      try {
        body = JSON.parse(raw) as ChatBody;
      } catch {
        // leave empty
      }
      bodies.push(body);
      const messages = body.messages ?? [];
      const sawToolResult = messages.some((m) => m.role === "tool");
      res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
      const id = "chatcmpl-mock";
      const send = (o: unknown): void => void res.write(`data: ${JSON.stringify(o)}\n\n`);

      if (opts.tool && !sawToolResult) {
        send({
          id,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  { index: 0, id: "call_1", type: "function", function: { name: opts.tool.name, arguments: JSON.stringify(opts.tool.args) } },
                ],
              },
              finish_reason: null,
            },
          ],
        });
        send({ id, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] });
      } else {
        const text = opts.tool ? opts.tool.then : (opts.reply ?? "");
        for (const ch of chunkString(text)) {
          send({ id, choices: [{ index: 0, delta: { content: ch }, finish_reason: null }] });
        }
        send({ id, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      }
      send({ id, choices: [], usage: { prompt_tokens: 11, completion_tokens: 7, total_tokens: 18 } });
      res.write("data: [DONE]\n\n");
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    requestCount: () => requests,
    bodies: () => bodies,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
