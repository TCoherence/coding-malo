import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { TaskManager } from "../src/agent/task-manager";
import { run } from "../src/core/engine";
import type { OmcbEvent } from "../src/core/events";
import type { FinalResult, NormalizedMessage } from "../src/core/types";
import { makeConfig } from "./helpers/engineConfig";
import { MockProvider } from "./helpers/mockProvider";
import type { MockTurn } from "./helpers/mockProvider";

let ws: string;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-sub-"));
});
afterEach(() => fs.rmSync(ws, { recursive: true, force: true }));

async function drive(turns: MockTurn[]): Promise<{ events: OmcbEvent[]; result: FinalResult }> {
  const provider = new MockProvider(turns);
  const conversation: NormalizedMessage[] = [];
  const gen = run(makeConfig(provider, ws), { text: "hi" }, conversation);
  const events: OmcbEvent[] = [];
  let step = await gen.next();
  while (!step.done) {
    events.push(step.value);
    step = await gen.next();
  }
  return { events, result: step.value };
}

describe("planning", () => {
  it("update_plan emits a plan event with the items", async () => {
    const { events } = await drive([
      {
        kind: "tool",
        tool: {
          id: "t1",
          name: "update_plan",
          input: { title: "My plan", items: [{ text: "step one" }, { text: "step two", status: "in_progress" }] },
        },
      },
      { kind: "text", text: "planned" },
    ]);
    const plan = events.find((e) => e.type === "plan") as Extract<OmcbEvent, { type: "plan" }>;
    expect(plan).toBeDefined();
    expect(plan.plan.title).toBe("My plan");
    expect(plan.plan.items).toHaveLength(2);
    expect(plan.plan.items[0]!.text).toBe("step one");
    expect(plan.plan.items[1]!.status).toBe("in_progress");
    expect(plan.plan.proposed).toBe(false);
  });
});

describe("sub-agents", () => {
  it("Task runs a foreground sub-agent and returns its result to the parent", async () => {
    // turn0: parent calls Task; turn1: CHILD loop responds; turn2: parent resumes.
    const { events, result } = await drive([
      { kind: "tool", tool: { id: "t1", name: "Task", input: { prompt: "do the thing" } } },
      { kind: "text", text: "sub did it" },
      { kind: "text", text: "parent done" },
    ]);
    const toolResult = events.find((e) => e.type === "tool_result") as Extract<OmcbEvent, { type: "tool_result" }>;
    expect(toolResult.name).toBe("Task");
    expect(toolResult.output).toContain("sub did it");
    expect(result.text).toBe("parent done");
    // 3 provider calls (parent turn0 + child + parent turn2) @ 10 input each → child usage aggregated.
    expect(result.usage.inputTokens).toBe(30);
    expect(result.usage.outputTokens).toBe(15);
  });
});

describe("TaskManager", () => {
  it("tracks a background task to completion", async () => {
    const tm = new TaskManager();
    const id = tm.start("bg", async () => ({ text: "bg result", isError: false }));
    expect(id).toMatch(/^task_/);
    expect(tm.get(id)?.status).toBe("running");
    await new Promise((r) => setTimeout(r, 10));
    const rec = tm.get(id);
    expect(rec?.status).toBe("done");
    expect(rec?.result).toBe("bg result");
  });

  it("records a failing background task as error", async () => {
    const tm = new TaskManager();
    const id = tm.start("bg", async () => ({ text: "boom", isError: true }));
    await new Promise((r) => setTimeout(r, 10));
    expect(tm.get(id)?.status).toBe("error");
  });
});
