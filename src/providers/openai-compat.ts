import { OmcbError } from "../core/errors";
import { emptyUsage } from "../core/usage";
import type { NormalizedMessage, NormalizedUsage, StopReason } from "../core/types";
import { toOpenAIMessages, toOpenAITools } from "./map-openai";
import type { Provider, ProviderStreamEvent, StreamOptions, ToolDefinition } from "./provider";

const THINK_INDEX = 0;
const TEXT_INDEX = 1;
const TOOL_OFFSET = 2;

export interface OpenAICompatProviderOptions {
  apiKey?: string;
  baseUrl?: string;
}

interface OpenAIDelta {
  content?: string | null;
  reasoning_content?: string | null;
  tool_calls?: {
    index: number;
    id?: string;
    function?: { name?: string; arguments?: string };
  }[];
}
interface OpenAIChoice {
  delta?: OpenAIDelta;
  finish_reason?: string | null;
}
interface OpenAIUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  prompt_tokens_details?: { cached_tokens?: number };
  prompt_cache_hit_tokens?: number;
  prompt_cache_miss_tokens?: number;
}
interface OpenAIChunk {
  id?: string;
  choices?: OpenAIChoice[];
  usage?: OpenAIUsage | null;
}

function mapFinish(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "tool_calls":
      return "tool_use";
    case "length":
      return "max_tokens";
    case "content_filter":
      return "refusal";
    default:
      return "end_turn";
  }
}

function mapUsage(u: OpenAIUsage | null | undefined): NormalizedUsage {
  const usage = emptyUsage();
  if (!u) return usage;
  const cacheRead = u.prompt_cache_hit_tokens ?? u.prompt_tokens_details?.cached_tokens ?? 0;
  // OpenAI's prompt_tokens INCLUDES cached tokens; bill only the cache-miss portion at full input
  // price (cached is billed separately as cacheRead) so cache hits aren't double-counted in cost.
  usage.inputTokens = u.prompt_cache_miss_tokens ?? Math.max(0, (u.prompt_tokens ?? 0) - cacheRead);
  usage.outputTokens = u.completion_tokens ?? 0;
  usage.cacheReadInputTokens = cacheRead;
  return usage;
}

export class OpenAICompatProvider implements Provider {
  readonly name = "openai-compat";
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(opts: OpenAICompatProviderOptions) {
    this.apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY ?? "";
    this.baseUrl = (opts.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  }

  async *stream(
    messages: NormalizedMessage[],
    tools: ToolDefinition[],
    options: StreamOptions,
  ): AsyncIterable<ProviderStreamEvent> {
    const body = {
      model: options.model,
      messages: toOpenAIMessages(options.system, messages),
      stream: true,
      stream_options: { include_usage: true },
      max_tokens: options.maxTokens,
      ...(tools.length > 0 ? { tools: toOpenAITools(tools), tool_choice: "auto" } : {}),
      ...(options.parallelToolCalls === false ? { parallel_tool_calls: false } : {}),
    };

    const resp = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify(body),
      signal: options.signal,
    });

    if (!resp.ok || !resp.body) {
      const text = await resp.text().catch(() => "");
      throw Object.assign(new Error(`${resp.status} ${resp.statusText}: ${text.slice(0, 500)}`), {
        status: resp.status,
      });
    }

    const reader = resp.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let started = false;
    let usage: NormalizedUsage = emptyUsage();
    let stopReason: StopReason = "end_turn";
    const toolsSeen = new Set<number>();

    while (true) {
      if (options.signal.aborted) {
        await reader.cancel().catch(() => {});
        throw options.signal.reason ?? new OmcbError("timeout", "request aborted");
      }
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (data === "[DONE]") continue;
        let chunk: OpenAIChunk;
        try {
          chunk = JSON.parse(data) as OpenAIChunk;
        } catch {
          continue;
        }
        if (!started) {
          started = true;
          yield { type: "message_start", id: chunk.id ?? "msg" };
        }
        if (chunk.usage) usage = mapUsage(chunk.usage);
        const choice = chunk.choices?.[0];
        if (!choice) continue;
        const delta = choice.delta;
        if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0) {
          yield { type: "thinking_delta", index: THINK_INDEX, thinking: delta.reasoning_content };
        }
        if (typeof delta?.content === "string" && delta.content.length > 0) {
          yield { type: "text_delta", index: TEXT_INDEX, text: delta.content };
        }
        for (const tc of delta?.tool_calls ?? []) {
          const idx = TOOL_OFFSET + tc.index;
          if (!toolsSeen.has(tc.index)) {
            toolsSeen.add(tc.index);
            yield { type: "tool_use_start", index: idx, id: tc.id ?? `call_${tc.index}`, name: tc.function?.name ?? "" };
          }
          if (tc.function?.arguments) {
            yield { type: "tool_use_input_delta", index: idx, partialJson: tc.function.arguments };
          }
        }
        if (choice.finish_reason) stopReason = mapFinish(choice.finish_reason);
      }
    }

    for (const i of toolsSeen) yield { type: "tool_use_stop", index: TOOL_OFFSET + i };
    yield { type: "usage", usage };
    yield { type: "stop", stopReason };
  }
}
