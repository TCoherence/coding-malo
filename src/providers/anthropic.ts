import Anthropic from "@anthropic-ai/sdk";

import { emptyUsage } from "../core/usage";
import type {
  ContentBlock,
  NormalizedMessage,
  NormalizedUsage,
  StopReason,
} from "../core/types";
import type { Provider, ProviderStreamEvent, StreamOptions, ToolDefinition } from "./provider";

export interface AnthropicProviderOptions {
  apiKey?: string;
  baseUrl?: string;
  /**
   * Send explicit cache_control breakpoints. Defaults to true only for the official Anthropic
   * API — third-party Anthropic-compatible gateways (e.g. DeepSeek) usually auto-cache and may
   * reject cache_control, so we leave it off for custom baseUrls.
   */
  promptCaching?: boolean;
}

const EPHEMERAL = { type: "ephemeral" as const };

function mapStopReason(reason: string | null | undefined): StopReason {
  switch (reason) {
    case "tool_use":
      return "tool_use";
    case "max_tokens":
      return "max_tokens";
    case "stop_sequence":
      return "stop_sequence";
    case "refusal":
      return "refusal";
    default:
      return "end_turn";
  }
}

function toContentParam(block: ContentBlock): Anthropic.ContentBlockParam | undefined {
  switch (block.type) {
    case "text":
      return { type: "text", text: block.text };
    case "thinking":
      if (!block.signature) return undefined; // unsigned thinking cannot be replayed
      return { type: "thinking", thinking: block.thinking, signature: block.signature };
    case "tool_use":
      return { type: "tool_use", id: block.id, name: block.name, input: block.input };
    case "tool_result":
      return {
        type: "tool_result",
        tool_use_id: block.toolUseId,
        content: block.output,
        is_error: block.isError,
      };
    case "image":
      return {
        type: "image",
        source: { type: "base64", media_type: block.mediaType as never, data: block.data },
      };
  }
}

function toMessageParams(messages: NormalizedMessage[]): Anthropic.MessageParam[] {
  const out: Anthropic.MessageParam[] = [];
  for (const msg of messages) {
    const content = msg.content
      .map(toContentParam)
      .filter((b): b is Anthropic.ContentBlockParam => b !== undefined);
    if (content.length === 0) continue;
    out.push({ role: msg.role, content });
  }
  return out;
}

function toAnthropicTools(tools: ToolDefinition[]): Anthropic.Tool[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));
}

/** Add a cache breakpoint to the final content block of the final message (caches the prefix). */
function cacheLastMessageBlock(messages: Anthropic.MessageParam[]): void {
  const lastMsg = messages.at(-1);
  if (!lastMsg || typeof lastMsg.content === "string" || lastMsg.content.length === 0) return;
  const lastBlock = lastMsg.content.at(-1) as { type: string; cache_control?: unknown };
  // thinking blocks cannot carry cache_control.
  if (lastBlock.type === "thinking" || lastBlock.type === "redacted_thinking") return;
  lastBlock.cache_control = EPHEMERAL;
}

export function buildAnthropicParams(
  messages: NormalizedMessage[],
  tools: ToolDefinition[],
  options: StreamOptions,
  promptCaching: boolean,
): Anthropic.MessageCreateParamsStreaming {
  const messageParams = toMessageParams(messages);
  const anthropicTools = toAnthropicTools(tools);

  if (promptCaching && options.cachePrefix !== false) {
    if (anthropicTools.length > 0) {
      (anthropicTools.at(-1) as { cache_control?: unknown }).cache_control = EPHEMERAL;
    }
    cacheLastMessageBlock(messageParams);
  }

  const system: Anthropic.MessageCreateParamsStreaming["system"] =
    promptCaching && options.cachePrefix !== false
      ? [{ type: "text", text: options.system, cache_control: EPHEMERAL }]
      : options.system;

  return {
    model: options.model,
    max_tokens: options.maxTokens,
    system,
    messages: messageParams,
    stream: true,
    ...(anthropicTools.length > 0 ? { tools: anthropicTools } : {}),
    ...(options.thinking
      ? { thinking: { type: "enabled", budget_tokens: options.thinking.budgetTokens } }
      : {}),
  };
}

export class AnthropicProvider implements Provider {
  readonly name = "anthropic";
  private readonly client: Anthropic;
  private readonly promptCaching: boolean;

  constructor(opts: AnthropicProviderOptions) {
    const baseUrl = opts.baseUrl;
    this.client = new Anthropic({
      apiKey: opts.apiKey ?? process.env.ANTHROPIC_API_KEY ?? "",
      ...(baseUrl ? { baseURL: baseUrl } : {}),
    });
    // Default: cache only against the official API; gateways auto-cache and may reject breakpoints.
    this.promptCaching =
      opts.promptCaching ?? (!baseUrl || baseUrl.includes("api.anthropic.com"));
  }

  async *stream(
    messages: NormalizedMessage[],
    tools: ToolDefinition[],
    options: StreamOptions,
  ): AsyncIterable<ProviderStreamEvent> {
    const params = buildAnthropicParams(messages, tools, options, this.promptCaching);
    const usage = emptyUsage();
    const toolIndices = new Set<number>();

    const stream = await this.client.messages.create(params, { signal: options.signal });

    for await (const event of stream as AsyncIterable<Anthropic.RawMessageStreamEvent>) {
      switch (event.type) {
        case "message_start": {
          const u = event.message.usage;
          usage.inputTokens = u.input_tokens ?? 0;
          usage.outputTokens = u.output_tokens ?? 0;
          usage.cacheReadInputTokens = u.cache_read_input_tokens ?? 0;
          usage.cacheCreationInputTokens = u.cache_creation_input_tokens ?? 0;
          yield { type: "message_start", id: event.message.id };
          break;
        }
        case "content_block_start": {
          const block = event.content_block;
          if (block.type === "tool_use") {
            toolIndices.add(event.index);
            yield { type: "tool_use_start", index: event.index, id: block.id, name: block.name };
          }
          break;
        }
        case "content_block_delta": {
          const delta = event.delta;
          if (delta.type === "text_delta") {
            yield { type: "text_delta", index: event.index, text: delta.text };
          } else if (delta.type === "thinking_delta") {
            yield { type: "thinking_delta", index: event.index, thinking: delta.thinking };
          } else if (delta.type === "signature_delta") {
            yield { type: "thinking_signature", index: event.index, signature: delta.signature };
          } else if (delta.type === "input_json_delta") {
            yield { type: "tool_use_input_delta", index: event.index, partialJson: delta.partial_json };
          }
          break;
        }
        case "content_block_stop": {
          if (toolIndices.has(event.index)) yield { type: "tool_use_stop", index: event.index };
          break;
        }
        case "message_delta": {
          if (typeof event.usage?.output_tokens === "number") {
            usage.outputTokens = event.usage.output_tokens;
          }
          const finalUsage: NormalizedUsage = { ...usage };
          yield { type: "usage", usage: finalUsage };
          yield { type: "stop", stopReason: mapStopReason(event.delta.stop_reason) };
          break;
        }
        case "message_stop":
          break;
      }
    }
  }
}
