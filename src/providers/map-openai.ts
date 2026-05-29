import type { NormalizedMessage } from "../core/types";
import type { ToolDefinition } from "./provider";

export type OpenAIContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface OpenAIToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface OpenAIChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
}

export interface OpenAITool {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
}

function userContent(msg: NormalizedMessage): string | OpenAIContentPart[] {
  const parts: OpenAIContentPart[] = [];
  let hasImage = false;
  for (const b of msg.content) {
    if (b.type === "text") parts.push({ type: "text", text: b.text });
    else if (b.type === "image") {
      hasImage = true;
      parts.push({ type: "image_url", image_url: { url: `data:${b.mediaType};base64,${b.data}` } });
    }
  }
  if (!hasImage) return parts.map((p) => (p.type === "text" ? p.text : "")).join("");
  return parts;
}

/** Map normalized messages onto OpenAI chat-completions messages (system prepended). */
export function toOpenAIMessages(system: string, messages: NormalizedMessage[]): OpenAIChatMessage[] {
  const out: OpenAIChatMessage[] = [];
  if (system) out.push({ role: "system", content: system });

  for (const msg of messages) {
    if (msg.role === "user") {
      const toolResults = msg.content.filter((b) => b.type === "tool_result");
      if (toolResults.length > 0 && toolResults.length === msg.content.length) {
        for (const b of msg.content) {
          if (b.type === "tool_result") out.push({ role: "tool", tool_call_id: b.toolUseId, content: b.output });
        }
      } else {
        out.push({ role: "user", content: userContent(msg) });
      }
      continue;
    }

    // assistant
    let text = "";
    const toolCalls: OpenAIToolCall[] = [];
    for (const b of msg.content) {
      if (b.type === "text") text += b.text;
      else if (b.type === "tool_use") {
        toolCalls.push({
          id: b.id,
          type: "function",
          function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) },
        });
      }
      // thinking blocks are dropped — OpenAI-compatible APIs cannot replay them.
    }
    const m: OpenAIChatMessage = { role: "assistant", content: text.length > 0 ? text : null };
    if (toolCalls.length > 0) m.tool_calls = toolCalls;
    out.push(m);
  }
  return out;
}

export function toOpenAITools(tools: ToolDefinition[]): OpenAITool[] {
  return tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.inputSchema },
  }));
}
