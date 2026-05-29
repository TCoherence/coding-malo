import type { Provider, ProviderStreamEvent } from "../../src/providers/provider";

export type MockTurn =
  | { kind: "text"; text: string }
  | { kind: "thinking"; thinking: string; signature: string; text?: string }
  | { kind: "tool"; text?: string; tool: { id: string; name: string; input: unknown } }
  | { kind: "error"; error: unknown };

function chunks(s: string, size = 4): string[] {
  const out: string[] = [];
  for (let i = 0; i < s.length; i += size) out.push(s.slice(i, i + size));
  return out;
}

/** A scripted Provider for tests — each call to stream() consumes the next turn. */
export class MockProvider implements Provider {
  readonly name = "mock";
  private i = 0;
  constructor(
    private readonly turns: MockTurn[],
    private readonly usage = { input: 10, output: 5 },
  ) {}

  async *stream(): AsyncIterable<ProviderStreamEvent> {
    const turn = this.turns[this.i++];
    if (!turn) {
      yield { type: "message_start", id: "m" };
      yield { type: "usage", usage: { inputTokens: 1, outputTokens: 1 } };
      yield { type: "stop", stopReason: "end_turn" };
      return;
    }
    if (turn.kind === "error") throw turn.error;

    yield { type: "message_start", id: `m${this.i}` };
    let index = 0;

    if (turn.kind === "text") {
      for (const c of chunks(turn.text)) yield { type: "text_delta", index, text: c };
      yield { type: "usage", usage: { inputTokens: this.usage.input, outputTokens: this.usage.output } };
      yield { type: "stop", stopReason: "end_turn" };
      return;
    }

    if (turn.kind === "thinking") {
      for (const c of chunks(turn.thinking)) yield { type: "thinking_delta", index: 0, thinking: c };
      yield { type: "thinking_signature", index: 0, signature: turn.signature };
      if (turn.text) for (const c of chunks(turn.text)) yield { type: "text_delta", index: 1, text: c };
      yield { type: "usage", usage: { inputTokens: this.usage.input, outputTokens: this.usage.output } };
      yield { type: "stop", stopReason: "end_turn" };
      return;
    }

    if (turn.text) {
      for (const c of chunks(turn.text)) yield { type: "text_delta", index, text: c };
      index++;
    }
    yield { type: "tool_use_start", index, id: turn.tool.id, name: turn.tool.name };
    yield { type: "tool_use_input_delta", index, partialJson: JSON.stringify(turn.tool.input) };
    yield { type: "tool_use_stop", index };
    yield { type: "usage", usage: { inputTokens: this.usage.input, outputTokens: this.usage.output } };
    yield { type: "stop", stopReason: "tool_use" };
  }
}
