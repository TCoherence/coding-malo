import { describe, expect, it } from "vitest";

import type { OmcbEvent } from "../src/core/events";
import { JsonRenderer } from "../src/headless/JsonRenderer";

function capture(): { stream: NodeJS.WritableStream; get: () => string } {
  let buf = "";
  const stream = {
    write(s: string | Uint8Array): boolean {
      buf += typeof s === "string" ? s : Buffer.from(s).toString();
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return { stream, get: () => buf };
}

const initEvent: OmcbEvent = {
  type: "init",
  session_id: "sess_1",
  model: "claude-sonnet-4-6",
  provider: "anthropic",
  workspace: "/tmp/ws",
  tools: ["Bash"],
  mcp_servers: [],
  max_turns: 25,
};
const resultEvent: OmcbEvent = {
  type: "result",
  session_id: "sess_1",
  text: "all done",
  terminal_reason: "end_turn",
  turns_used: 1,
  usage: {
    input_tokens: 1,
    output_tokens: 2,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    cost_usd: 0,
  },
};
const textDelta: OmcbEvent = { type: "text_delta", text: "hi", agent_id: "root" };

describe("JsonRenderer", () => {
  it("stream-json emits every event as one NDJSON line each", () => {
    const out = capture();
    const err = capture();
    const r = new JsonRenderer(out.stream, err.stream, "stream-json");
    r.handle(initEvent);
    r.handle(textDelta);
    r.handle(resultEvent);
    const lines = out.get().trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(lines.map((l) => JSON.parse(l).type)).toEqual(["init", "text_delta", "result"]);
  });

  it("json mode emits only init + result", () => {
    const out = capture();
    const err = capture();
    const r = new JsonRenderer(out.stream, err.stream, "json");
    r.handle(initEvent);
    r.handle(textDelta);
    r.handle(resultEvent);
    const lines = out.get().trim().split("\n");
    expect(lines.map((l) => JSON.parse(l).type)).toEqual(["init", "result"]);
  });

  it("text mode prints only the final text to stdout", () => {
    const out = capture();
    const err = capture();
    const r = new JsonRenderer(out.stream, err.stream, "text");
    r.handle(initEvent);
    r.handle(textDelta);
    r.handle(resultEvent);
    expect(out.get().trim()).toBe("all done");
    expect(err.get()).toBe("");
  });

  it("text mode routes an error result to stderr", () => {
    const out = capture();
    const err = capture();
    const r = new JsonRenderer(out.stream, err.stream, "text");
    r.handle({ ...resultEvent, text: "", error: "429 rate limit", error_kind: "rate_limit" });
    expect(err.get().trim()).toBe("429 rate limit");
    expect(out.get()).toBe("");
  });
});
