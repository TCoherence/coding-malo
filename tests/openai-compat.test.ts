import { afterEach, describe, expect, it, vi } from "vitest";

import { OpenAICompatProvider } from "../src/providers/openai-compat";
import type { ProviderStreamEvent, StreamOptions } from "../src/providers/provider";

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body,
    text: async () => "",
  } as unknown as Response;
}

const SSE = [
  'data: {"id":"c1","choices":[{"delta":{"role":"assistant","content":"Hel"}}]}\n\n',
  'data: {"id":"c1","choices":[{"delta":{"content":"lo"}}]}\n\n',
  // split a tool-call event across two network chunks to exercise buffering:
  'data: {"id":"c1","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"Bash","argume',
  'nts":"{\\"command\\":"}}]}}]}\n\ndata: {"id":"c1","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"ls\\"}"}}]}}]}\n\n',
  'data: {"id":"c1","choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n',
  'data: {"id":"c1","choices":[],"usage":{"prompt_tokens":12,"completion_tokens":8,"prompt_cache_hit_tokens":4}}\n\n',
  "data: [DONE]\n\n",
];

const options: StreamOptions = {
  model: "deepseek-chat",
  maxTokens: 1024,
  system: "be helpful",
  signal: new AbortController().signal,
};

afterEach(() => vi.unstubAllGlobals());

async function collect(provider: OpenAICompatProvider): Promise<ProviderStreamEvent[]> {
  const events: ProviderStreamEvent[] = [];
  for await (const e of provider.stream(
    [{ id: "m1", role: "user", content: [{ type: "text", text: "hi" }] }],
    [{ name: "Bash", description: "run", inputSchema: { type: "object", properties: {} } }],
    options,
  )) {
    events.push(e);
  }
  return events;
}

describe("OpenAICompatProvider", () => {
  it("normalizes streamed text, tool calls (across chunk boundaries), and usage", async () => {
    const fetchMock = vi.fn(async () => sseResponse(SSE));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatProvider({ apiKey: "k", baseUrl: "https://api.deepseek.com/v1" });
    const events = await collect(provider);

    const text = events
      .filter((e): e is Extract<ProviderStreamEvent, { type: "text_delta" }> => e.type === "text_delta")
      .map((e) => e.text)
      .join("");
    expect(text).toBe("Hello");

    const toolStart = events.find((e) => e.type === "tool_use_start") as Extract<
      ProviderStreamEvent,
      { type: "tool_use_start" }
    >;
    expect(toolStart.name).toBe("Bash");
    expect(toolStart.id).toBe("call_1");

    const args = events
      .filter((e): e is Extract<ProviderStreamEvent, { type: "tool_use_input_delta" }> => e.type === "tool_use_input_delta")
      .map((e) => e.partialJson)
      .join("");
    expect(JSON.parse(args)).toEqual({ command: "ls" });

    const usage = events.find((e) => e.type === "usage") as Extract<ProviderStreamEvent, { type: "usage" }>;
    expect(usage.usage.inputTokens).toBe(12);
    expect(usage.usage.outputTokens).toBe(8);
    expect(usage.usage.cacheReadInputTokens).toBe(4);

    const stop = events.find((e) => e.type === "stop") as Extract<ProviderStreamEvent, { type: "stop" }>;
    expect(stop.stopReason).toBe("tool_use");
  });

  it("sends a well-formed request (system prepended, tools, include_usage)", async () => {
    const fetchMock = vi.fn(async () => sseResponse(['data: [DONE]\n\n']));
    vi.stubGlobal("fetch", fetchMock);

    const provider = new OpenAICompatProvider({ apiKey: "secret", baseUrl: "https://api.deepseek.com/v1/" });
    await collect(provider);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/v1/chat/completions"); // trailing slash trimmed
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer secret");
    const body = JSON.parse(init.body as string);
    expect(body.stream).toBe(true);
    expect(body.stream_options).toEqual({ include_usage: true });
    expect(body.messages[0]).toEqual({ role: "system", content: "be helpful" });
    expect(body.messages[1].role).toBe("user");
    expect(body.tools[0].function.name).toBe("Bash");
    expect(body.tool_choice).toBe("auto");
  });

  it("throws a status-bearing error on non-ok responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 429, statusText: "Too Many Requests", body: null, text: async () => "slow down" }) as unknown as Response),
    );
    const provider = new OpenAICompatProvider({ apiKey: "k", baseUrl: "https://x/v1" });
    await expect(collect(provider)).rejects.toMatchObject({ status: 429 });
  });
});
