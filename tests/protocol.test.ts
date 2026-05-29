import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/core/engine";
import type { OmcbEvent } from "../src/core/events";
import type { FinalResult, NormalizedMessage } from "../src/core/types";
import { makeConfig } from "./helpers/engineConfig";
import { MockProvider } from "./helpers/mockProvider";
import type { MockTurn } from "./helpers/mockProvider";

let workspace: string;

beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-test-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

async function drive(turns: MockTurn[]): Promise<{ events: OmcbEvent[]; result: FinalResult }> {
  const provider = new MockProvider(turns);
  const conversation: NormalizedMessage[] = [];
  const gen = run(makeConfig(provider, workspace), { text: "hi" }, conversation);
  const events: OmcbEvent[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, result: step.value };
}

describe("protocol", () => {
  it("emits init first and exactly one terminal result last (text turn)", async () => {
    const { events, result } = await drive([{ kind: "text", text: "Hello world" }]);

    expect(events[0]?.type).toBe("init");
    const results = events.filter((e) => e.type === "result");
    expect(results).toHaveLength(1);
    expect(events.at(-1)?.type).toBe("result");

    const final = events.at(-1) as Extract<OmcbEvent, { type: "result" }>;
    expect(final.terminal_reason).toBe("end_turn");
    expect(final.text).toBe("Hello world");
    expect(final.usage).toEqual({
      input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      cost_usd: expect.any(Number),
    });
    expect(result.text).toBe("Hello world");
    expect(result.errorKind).toBeUndefined();
  });

  it("streams text deltas that reconstruct the message", async () => {
    const { events } = await drive([{ kind: "text", text: "abcdefghij" }]);
    const text = events
      .filter((e): e is Extract<OmcbEvent, { type: "text_delta" }> => e.type === "text_delta")
      .map((e) => e.text)
      .join("");
    expect(text).toBe("abcdefghij");
  });

  it("runs a tool then finishes (tool turn → text turn)", async () => {
    const { events, result } = await drive([
      { kind: "tool", text: "let me run it", tool: { id: "t1", name: "Bash", input: { command: "echo hi" } } },
      { kind: "text", text: "done" },
    ]);

    const types = events.map((e) => e.type);
    expect(types.filter((t) => t === "message_start")).toHaveLength(2);

    const toolStart = events.find((e) => e.type === "tool_start") as Extract<OmcbEvent, { type: "tool_start" }>;
    expect(toolStart.name).toBe("Bash");
    expect(toolStart.source).toBe("builtin");

    const toolResult = events.find((e) => e.type === "tool_result") as Extract<OmcbEvent, { type: "tool_result" }>;
    expect(toolResult.is_error).toBe(false);
    expect(toolResult.output).toContain("hi");

    // tool_start must come before tool_result, both before the final result.
    expect(types.indexOf("tool_start")).toBeLessThan(types.indexOf("tool_result"));
    expect(types.lastIndexOf("result")).toBe(types.length - 1);

    expect(result.text).toBe("done");
    expect(result.turnsUsed).toBe(2);
  });

  it("classifies a provider rate-limit error onto the result", async () => {
    const err = Object.assign(new Error("429 Too Many Requests"), { status: 429 });
    const { events } = await drive([{ kind: "error", error: err }]);
    const final = events.at(-1) as Extract<OmcbEvent, { type: "result" }>;
    expect(final.error_kind).toBe("rate_limit");
    expect(final.error?.toLowerCase()).toContain("rate limit");
  });

  it("reports max_turns when the budget is exhausted", async () => {
    const provider = new MockProvider([
      { kind: "tool", tool: { id: "t1", name: "Bash", input: { command: "true" } } },
      { kind: "tool", tool: { id: "t2", name: "Bash", input: { command: "true" } } },
    ]);
    const conversation: NormalizedMessage[] = [];
    const gen = run(makeConfig(provider, workspace, { maxTurns: 2 }), { text: "hi" }, conversation);
    let step = await gen.next();
    let last: OmcbEvent | undefined;
    while (!step.done) {
      last = step.value;
      step = await gen.next();
    }
    expect(last?.type).toBe("result");
    expect((last as Extract<OmcbEvent, { type: "result" }>).error_kind).toBe("max_turns");
    expect(step.value.terminalReason).toBe("max_turns");
  });
});
