import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

import { Store } from "../src/core/store";
import type { OmcbEvent } from "../src/core/events";
import { App } from "../src/ui/App";
import { VERSION } from "../src/version";

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

  it("shows the model in the header and reflects /model switching", async () => {
    const store = new Store();
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} onInterrupt={() => {}} />);
    store.apply({
      type: "init",
      session_id: "s",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      workspace: "/tmp/ws",
      tools: [],
      mcp_servers: [],
      max_turns: 25,
    });
    await tick();
    expect(lastFrame() ?? "").toContain("claude-sonnet-4-6");
    store.setModel("deepseek-chat");
    await tick();
    expect(lastFrame() ?? "").toContain("deepseek-chat");
  });

  it("clears the transcript", async () => {
    const store = new Store();
    store.addUser("hello");
    store.clearTranscript();
    expect(store.getSnapshot().transcript).toEqual([]);
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

  it("moves the caret with ←/→ and inserts mid-string", async () => {
    const store = new Store();
    let submitted: string | null = null;
    const { stdin } = render(
      <App store={store} onSubmit={(t) => (submitted = t)} onInterrupt={() => {}} />,
    );
    await tick();
    stdin.write("abc"); // caret at end (3)
    await tick();
    stdin.write(String.fromCharCode(27) + "[D"); // ← caret 3→2
    stdin.write(String.fromCharCode(27) + "[D"); // ← caret 2→1
    await tick();
    stdin.write("X"); // insert at caret(1) → "aXbc"
    await tick();
    stdin.write("\r"); // submit
    await tick();
    expect(submitted).toBe("aXbc");
  });

  it("welcome banner shows the Coding Malo logo, model and version", async () => {
    const store = new Store();
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} onInterrupt={() => {}} />);
    store.addBanner("deepseek-v4-flash", "/tmp/ws");
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("Coding Malo");
    expect(f).toContain(`v${VERSION}`);
    expect(f).toContain("deepseek-v4-flash");
  });

  it("shows a spinner while generating", async () => {
    const store = new Store();
    const { lastFrame, unmount } = render(<App store={store} onSubmit={() => {}} onInterrupt={() => {}} />);
    store.setBusy(true);
    await tick();
    expect(lastFrame() ?? "").toContain("生成中");
    unmount(); // clear the spinner interval
  });

  it("renders an Edit tool card as a -/+ diff", async () => {
    const store = new Store();
    const { lastFrame } = render(<App store={store} onSubmit={() => {}} onInterrupt={() => {}} />);
    store.apply({ type: "init", session_id: "s", model: "m", provider: "anthropic", workspace: "/tmp", tools: [], mcp_servers: [], max_turns: 25 });
    store.apply({ type: "tool_start", tool_id: "t1", name: "Edit", input: { file_path: "a.ts", old_string: "foo", new_string: "bar" }, source: "builtin", agent_id: "root" });
    store.apply({ type: "tool_result", tool_id: "t1", name: "Edit", output: "Edited a.ts", is_error: false });
    await tick();
    const f = lastFrame() ?? "";
    expect(f).toContain("- foo");
    expect(f).toContain("+ bar");
  });

  it("/model picker: arrow-key select + enter confirms", async () => {
    const store = new Store();
    const onSelectModel = vi.fn();
    const { lastFrame, stdin, unmount } = render(
      <App store={store} onSubmit={() => {}} onInterrupt={() => {}} onSelectModel={onSelectModel} />,
    );
    store.openModelPicker(["deepseek-v4-flash", "deepseek-v4-pro", "gpt-4o"], "deepseek-v4-flash");
    await tick();
    expect(lastFrame() ?? "").toContain("选择模型");
    expect(lastFrame() ?? "").toContain("deepseek-v4-pro");
    stdin.write(String.fromCharCode(27) + "[B"); // down arrow → index 1
    await tick();
    stdin.write("\r"); // confirm
    await tick();
    expect(onSelectModel).toHaveBeenCalledWith("deepseek-v4-pro");
    unmount();
  });
});
