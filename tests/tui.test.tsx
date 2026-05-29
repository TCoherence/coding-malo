import { render } from "ink-testing-library";
import { describe, expect, it } from "vitest";

import { Store } from "../src/core/store";
import type { OmcbEvent } from "../src/core/events";
import { App } from "../src/ui/App";

const tick = () => new Promise((r) => setTimeout(r, 40));

describe("TUI App", () => {
  it("renders the user prompt, streamed assistant text, and a tool card", async () => {
    const store = new Store();
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} onInterrupt={() => {}} />);

    const init: OmcbEvent = {
      type: "init",
      session_id: "sess_x",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      workspace: "/tmp",
      tools: ["Bash"],
      mcp_servers: [],
      max_turns: 25,
    };

    store.addUser("list the files");
    store.apply(init);
    store.apply({ type: "message_start", role: "assistant", agent_id: "root" });
    store.apply({ type: "text_delta", text: "Sure, ", agent_id: "root" });
    store.apply({ type: "text_delta", text: "running it.", agent_id: "root" });
    store.apply({ type: "tool_start", tool_id: "t1", name: "Bash", input: { command: "ls" }, source: "builtin", agent_id: "root" });
    store.apply({ type: "tool_result", tool_id: "t1", name: "Bash", output: "file_a.txt", is_error: false });
    store.apply({ type: "message_stop", stop_reason: "tool_use", agent_id: "root" });
    await tick();

    const frame = lastFrame() ?? "";
    expect(frame).toContain("list the files");
    expect(frame).toContain("running it.");
    expect(frame).toContain("Bash");
    expect(frame).toContain("file_a.txt");
    expect(frame).toContain("anthropic/claude-sonnet-4-6");
  });

  it("shows an approval modal and resolves the request on keypress", async () => {
    const store = new Store();
    const { lastFrame, stdin } = render(<App store={store} onSubmit={() => {}} onInterrupt={() => {}} />);
    const decision = store.requestApproval({
      toolName: "Bash",
      resource: "rm -rf /tmp/x",
      effects: ["execute"],
      danger: "high",
      input: {},
      agentId: "root",
    });
    await tick();
    expect(lastFrame() ?? "").toContain("Approval required");
    expect(lastFrame() ?? "").toContain("Bash");

    stdin.write("s"); // allow for session
    const result = await decision;
    expect(result).toEqual({ allow: true, remember: "session" });
    await tick();
    expect(lastFrame() ?? "").not.toContain("Approval required");
  });

  it("coalesces many streamed deltas into a single notification", async () => {
    const store = new Store();
    let calls = 0;
    store.subscribe(() => {
      calls += 1;
    });
    store.apply({ type: "message_start", role: "assistant", agent_id: "root" });
    store.apply({ type: "text_delta", text: "a", agent_id: "root" });
    store.apply({ type: "text_delta", text: "b", agent_id: "root" });
    expect(calls).toBe(0); // notifications are deferred/coalesced
    await new Promise((r) => setImmediate(r));
    expect(calls).toBe(1);
    expect(store.getSnapshot().live?.assistantText).toBe("ab");
  });

  it("recalls the previous input with the up arrow", async () => {
    const store = new Store();
    const { lastFrame, stdin } = render(<App store={store} onSubmit={() => {}} onInterrupt={() => {}} />);
    await tick();
    stdin.write("hello world");
    await tick();
    stdin.write("\r"); // submit → pushed to history, input cleared
    await tick();
    stdin.write("[A"); // up arrow → recall
    await tick();
    expect(lastFrame() ?? "").toContain("hello world");
  });
});
