import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { run } from "../src/core/engine";
import type { OmcbEvent } from "../src/core/events";
import type { NormalizedMessage } from "../src/core/types";
import { HookRunner } from "../src/hooks/runner";
import { sanitizeEnv } from "../src/permissions/sandbox";
import { makeConfig } from "./helpers/engineConfig";
import { MockProvider } from "./helpers/mockProvider";

const env = () => sanitizeEnv();

let ws: string;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-hooks-"));
});
afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

describe("HookRunner", () => {
  it("PreToolUse blocks via exit code 2", async () => {
    const hr = new HookRunner([{ event: "PreToolUse", command: "exit 2" }], env(), ws);
    expect((await hr.preToolUse("Bash", { command: "rm -rf /" })).action).toBe("block");
  });

  it("PreToolUse modifies via stdout JSON", async () => {
    const hr = new HookRunner(
      [{ event: "PreToolUse", command: `echo '{"decision":"modify","toolInput":{"command":"echo safe"}}'` }],
      env(),
      ws,
    );
    const d = await hr.preToolUse("Bash", { command: "echo x" });
    expect(d.action).toBe("modify");
    expect(d.toolInput).toEqual({ command: "echo safe" });
  });

  it("UserPromptSubmit can rewrite the prompt", async () => {
    const hr = new HookRunner([{ event: "UserPromptSubmit", command: `echo '{"prompt":"REWRITTEN"}'` }], env(), ws);
    const d = await hr.userPromptSubmit("orig");
    expect(d).toEqual({ action: "rewrite", prompt: "REWRITTEN" });
  });

  it("matcher scopes a hook to matching tool names", async () => {
    const hr = new HookRunner([{ event: "PreToolUse", matcher: "Bash", command: "exit 2" }], env(), ws);
    expect((await hr.preToolUse("Read", {})).action).toBe("allow");
    expect((await hr.preToolUse("Bash", {})).action).toBe("block");
  });
});

describe("engine honors a blocking PreToolUse hook", () => {
  it("turns a blocked tool call into an error tool_result", async () => {
    const provider = new MockProvider([
      { kind: "tool", tool: { id: "t1", name: "Bash", input: { command: "echo hi" } } },
      { kind: "text", text: "ok done" },
    ]);
    const hooks = new HookRunner([{ event: "PreToolUse", matcher: "Bash", command: "exit 2" }], env(), ws);
    const conversation: NormalizedMessage[] = [];
    const gen = run(makeConfig(provider, ws, { hooks }), { text: "hi" }, conversation);
    const events: OmcbEvent[] = [];
    let step = await gen.next();
    while (!step.done) {
      events.push(step.value);
      step = await gen.next();
    }
    const toolResult = events.find((e) => e.type === "tool_result") as Extract<OmcbEvent, { type: "tool_result" }>;
    expect(toolResult.is_error).toBe(true);
    expect(toolResult.output).toContain("Blocked by PreToolUse hook");
  });
});
