import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/core/engine";
import { classifyApiError } from "../src/core/errors";
import type { NormalizedMessage } from "../src/core/types";
import { PermissionEngine } from "../src/permissions/engine";
import { HeadlessPrompter } from "../src/permissions/prompter";
import { sanitizeEnv } from "../src/permissions/sandbox";
import type { Tool, ToolContext } from "../src/tools/types";
import { resolveInsideWorkspace } from "../src/tools/paths";
import { makeConfig } from "./helpers/engineConfig";
import { MockProvider } from "./helpers/mockProvider";

describe("review fix: error classification is status-first", () => {
  it("classifies a 5xx whose body mentions 'rate limit' as api_5xx, not rate_limit", () => {
    const err = Object.assign(new Error('{"error":"rate limit exceeded"}'), { status: 502 });
    expect(classifyApiError(err).kind).toBe("api_5xx");
  });
  it("still classifies a real 429 as rate_limit", () => {
    expect(classifyApiError(Object.assign(new Error("nope"), { status: 429 })).kind).toBe("rate_limit");
  });
});

describe("review fix: workspace boundary respects path separators", () => {
  function fakeWriteTool(): Tool {
    return {
      name: "FakeWrite",
      description: "",
      schema: z.object({ p: z.string() }),
      source: "builtin",
      permission: {
        effects: ["write"],
        resource: (input: { p: string }) => input.p,
        danger: () => "low",
      },
      execute: async () => ({ content: "ok" }),
    };
  }
  const ctx = (): ToolContext => ({
    cwd: "/tmp/proj",
    signal: new AbortController().signal,
    env: sanitizeEnv(),
    emitChunk: () => {},
    requestApproval: async () => ({ allow: false, reason: "x" }),
    agentId: "root",
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });

  it("does not auto-allow a sibling dir that shares a name prefix", async () => {
    const engine = new PermissionEngine({
      mode: "acceptEdits",
      sandbox: "workspace-write",
      prompter: new HeadlessPrompter("acceptEdits"),
      workspace: "/tmp/proj",
    });
    const inside = await engine.evaluate(fakeWriteTool(), { p: "/tmp/proj/file.txt" }, ctx());
    expect(inside.allow).toBe(true);
    const sibling = await engine.evaluate(fakeWriteTool(), { p: "/tmp/proj2/evil.txt" }, ctx());
    expect(sibling.allow).toBe(false); // would have leaked with a bare startsWith
  });
});

describe("review fix: symlink-aware workspace containment", () => {
  let ws: string;
  beforeEach(() => {
    ws = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "omcb-paths-")));
  });
  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("allows creating a new file inside an existing dir", () => {
    fs.mkdirSync(path.join(ws, "sub"));
    expect(() => resolveInsideWorkspace(ws, "sub/new.txt")).not.toThrow();
  });
  it("rejects a symlink that points outside the workspace", () => {
    const outside = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-outside-"));
    fs.symlinkSync(outside, path.join(ws, "escape"));
    expect(() => resolveInsideWorkspace(ws, "escape/secret.txt")).toThrow(/escapes the workspace/);
    fs.rmSync(outside, { recursive: true, force: true });
  });
});

describe("review fix: engine thinking + abort", () => {
  let ws: string;
  beforeEach(() => {
    ws = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-eng-"));
  });
  afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

  it("persists a signed thinking block in the assistant message", async () => {
    const provider = new MockProvider([
      { kind: "thinking", thinking: "let me reason", signature: "sig-123", text: "the answer" },
    ]);
    const conversation: NormalizedMessage[] = [];
    const gen = run(makeConfig(provider, ws), { text: "hi" }, conversation);
    let step = await gen.next();
    while (!step.done) step = await gen.next();

    const assistant = conversation.find((m) => m.role === "assistant")!;
    const thinking = assistant.content.find((b) => b.type === "thinking");
    expect(thinking).toBeDefined();
    expect(thinking && thinking.type === "thinking" ? thinking.signature : undefined).toBe("sig-123");
  });

  it("marks an aborted run as terminal_reason=aborted with no error_kind", async () => {
    const ac = new AbortController();
    ac.abort();
    const provider = new MockProvider([{ kind: "error", error: new Error("boom") }]);
    const conversation: NormalizedMessage[] = [];
    const gen = run(makeConfig(provider, ws, { signal: ac.signal }), { text: "hi" }, conversation);
    let step = await gen.next();
    while (!step.done) step = await gen.next();
    expect(step.value.terminalReason).toBe("aborted");
    expect(step.value.errorKind).toBeUndefined();
    expect(step.value.error).toBe("interrupted");
  });
});
