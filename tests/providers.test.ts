import { describe, expect, it } from "vitest";

import { computeCost } from "../src/core/usage";
import { buildAnthropicParams } from "../src/providers/anthropic";
import type { StreamOptions } from "../src/providers/provider";

const baseOptions: StreamOptions = {
  model: "claude-sonnet-4-6",
  maxTokens: 1024,
  system: "system text",
  signal: new AbortController().signal,
};

const messages = [
  { id: "m1", role: "user" as const, content: [{ type: "text" as const, text: "hello" }] },
];
const tools = [{ name: "Bash", description: "run", inputSchema: { type: "object", properties: {} } }];

describe("buildAnthropicParams caching", () => {
  it("places cache_control on system, last tool, and last message block when caching is on", () => {
    const params = buildAnthropicParams(messages, tools, baseOptions, true);
    expect(Array.isArray(params.system)).toBe(true);
    const sys = params.system as { cache_control?: unknown }[];
    expect(sys[0]?.cache_control).toEqual({ type: "ephemeral" });
    expect((params.tools?.at(-1) as { cache_control?: unknown }).cache_control).toEqual({ type: "ephemeral" });
    const lastMsg = params.messages.at(-1)!;
    const lastBlock = (lastMsg.content as { cache_control?: unknown }[]).at(-1);
    expect(lastBlock?.cache_control).toEqual({ type: "ephemeral" });
  });

  it("emits a plain string system and no cache_control when caching is off", () => {
    const params = buildAnthropicParams(messages, tools, baseOptions, false);
    expect(params.system).toBe("system text");
    expect((params.tools?.at(-1) as { cache_control?: unknown }).cache_control).toBeUndefined();
  });
});

describe("computeCost", () => {
  it("prices DeepSeek input and cache-hit tokens", () => {
    expect(computeCost("deepseek-chat", { inputTokens: 1_000_000, outputTokens: 0 })).toBeCloseTo(0.27, 5);
    expect(
      computeCost("deepseek-chat", { inputTokens: 0, outputTokens: 0, cacheReadInputTokens: 1_000_000 }),
    ).toBeCloseTo(0.07, 5);
  });

  it("returns 0 for unknown models", () => {
    expect(computeCost("some-unknown-model", { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
  });
});
