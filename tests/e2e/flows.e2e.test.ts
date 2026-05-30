import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { TuiSession } from "./harness";
import { startMockOpenAI, type MockHandle } from "./mock-provider";

let home = ""; // empty home — model/provider come from env
let modelsHome = ""; // home with config.models for the /model picker
let session: TuiSession | null = null;
let mock: MockHandle | null = null;

beforeAll(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "cm-flows-"));
  modelsHome = fs.mkdtempSync(path.join(os.tmpdir(), "cm-models-"));
  fs.writeFileSync(
    path.join(modelsHome, "config.json"),
    JSON.stringify({
      defaultModel: "alpha",
      models: {
        alpha: { provider: "openai-compat", model: "alpha-model", baseUrl: "http://127.0.0.1:1", apiKey: "x" },
        beta: { provider: "openai-compat", model: "beta-model", baseUrl: "http://127.0.0.1:1", apiKey: "x" },
      },
    }),
  );
});
afterAll(() => {
  for (const d of [home, modelsHome]) if (d) fs.rmSync(d, { recursive: true, force: true });
});
afterEach(async () => {
  session?.kill();
  session = null;
  if (mock) {
    await mock.close();
    mock = null;
  }
});

const mockEnv = (baseUrl: string) => ({
  CODINGMALO_HOME: home,
  CODINGMALO_SPLASH: "0",
  CODINGMALO_PROVIDER: "openai-compat",
  CODINGMALO_MODEL: "mock-model",
  CODINGMALO_BASE_URL: baseUrl,
  OPENAI_API_KEY: "test",
});

describe("TUI e2e flows (mock provider)", () => {
  it("runs a full streamed turn and updates the usage footer", async () => {
    mock = await startMockOpenAI({ reply: "HELLO_FROM_MOCK_PROVIDER" });
    session = new TuiSession({ env: mockEnv(mock.baseUrl) });
    await session.waitFor((s) => s.includes("›"));
    session.type("hi there");
    session.enter();
    await session.waitFor((s) => s.includes("HELLO_FROM_MOCK_PROVIDER"));
    await session.settle(150);
    const scr = session.screen();
    expect(scr).toContain("HELLO_FROM_MOCK_PROVIDER"); // streamed assistant text, committed to transcript
    expect(scr).toContain("↑11 ↓7"); // per-turn usage flowed into the footer
    expect(mock.requestCount()).toBe(1);
  });

  it("runs a tool-call round: approval modal → tool output → final reply", async () => {
    mock = await startMockOpenAI({ tool: { name: "Bash", args: { command: "echo E2E_TOOL_OK" }, then: "all done" } });
    const sess = new TuiSession({ env: mockEnv(mock.baseUrl) });
    session = sess;
    await sess.waitFor((s) => s.includes("›"));
    sess.type("run it");
    sess.enter();
    await sess.waitFor((s) => s.includes("Approval required") && s.includes("Bash")); // execute is gated → prompts
    await sess.settle(150); // let the modal fully commit before answering
    sess.type("a"); // allow once
    await sess.waitFor((s) => s.includes("E2E_TOOL_OK")); // tool executed, output rendered
    await sess.waitFor((s) => s.includes("all done")); // model's follow-up reply
    expect(mock.requestCount()).toBe(2); // round 1 (tool_call) + round 2 (final)
  });

  it("a denied tool (press d) never runs, but the model still continues", async () => {
    // output "RAN_2" only appears if the echo actually executed; the command text shows "RAN_$((1+1))"
    mock = await startMockOpenAI({ tool: { name: "Bash", args: { command: "echo RAN_$((1+1))" }, then: "continued without it" } });
    const sess = new TuiSession({ env: mockEnv(mock.baseUrl) });
    session = sess;
    await sess.waitFor((s) => s.includes("›"));
    sess.type("run it");
    sess.enter();
    await sess.waitFor((s) => s.includes("Approval required") && s.includes("Bash"));
    await sess.settle(150);
    sess.type("d"); // deny
    await sess.waitFor((s) => s.includes("continued without it")); // model adapts to the denial
    expect(sess.screen()).not.toContain("RAN_2"); // the command never executed
    expect(mock.requestCount()).toBe(2);
  });
});

describe("TUI e2e: /model picker", () => {
  it("opens the picker, navigates with ↓, and switches the model", async () => {
    const sess = new TuiSession({ env: { CODINGMALO_HOME: modelsHome, CODINGMALO_SPLASH: "0" } });
    session = sess;
    await sess.waitFor((s) => s.includes("›"));
    sess.type("/model");
    sess.enter();
    await sess.waitFor((s) => s.includes("选择模型") && s.includes("alpha") && s.includes("beta"));
    expect(sess.screen()).toContain("❯ alpha"); // current selection highlighted first
    await sess.settle(150);
    sess.down();
    await sess.waitFor((s) => s.includes("❯ beta")); // selection moved
    await sess.settle(150);
    sess.enter();
    await sess.waitFor((s) => s.includes("已切换") && s.includes("beta-model"));
    expect(sess.screen()).toContain("beta-model");
  });
});

describe("TUI e2e: resize (history is preserved — the terminal reflows natively)", () => {
  it("shrinking keeps prior turns and reflows the prompt narrower", async () => {
    mock = await startMockOpenAI({ reply: "okreply" });
    const sess = new TuiSession({ env: mockEnv(mock.baseUrl), cols: 100, rows: 20 });
    session = sess;
    await sess.waitFor((s) => s.includes("›"));
    sess.type("HISTMARK");
    sess.enter();
    await sess.waitFor((s) => s.includes("HISTMARK") && s.includes("okreply"));
    await sess.settle(150);
    const wide = sess.bottomBorderWidth();
    expect(wide).toBeGreaterThan(90); // prompt box ~100 cols

    sess.resize(60, 20);
    await sess.waitFor(() => sess.bottomBorderWidth() >= 56 && sess.bottomBorderWidth() <= 60);
    expect(sess.bottomBorderWidth()).toBeLessThan(wide); // prompt reflowed narrower
    expect(sess.screen()).toContain("HISTMARK"); // ← the prior turn is NOT lost on resize
  });

  it("widening keeps prior turns and reflows the prompt wider", async () => {
    mock = await startMockOpenAI({ reply: "okreply" });
    const sess = new TuiSession({ env: mockEnv(mock.baseUrl), cols: 80, rows: 20 });
    session = sess;
    await sess.waitFor((s) => s.includes("›"));
    sess.type("WIDEMARK");
    sess.enter();
    await sess.waitFor((s) => s.includes("WIDEMARK") && s.includes("okreply"));
    await sess.settle(150);
    const narrow = sess.bottomBorderWidth(); // prompt box ~80

    sess.resize(120, 20);
    await sess.waitFor(() => sess.bottomBorderWidth() >= 116); // prompt reflowed wider
    expect(sess.bottomBorderWidth()).toBeGreaterThan(narrow);
    expect(sess.screen()).toContain("WIDEMARK"); // prior turn preserved
  });
});
