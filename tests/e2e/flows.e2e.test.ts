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

describe("TUI e2e: resize", () => {
  it("reflows the prompt box to the new width when the terminal is resized narrower", async () => {
    const sess = new TuiSession({ env: { CODINGMALO_HOME: home, CODINGMALO_SPLASH: "0" }, cols: 100, rows: 40 });
    session = sess;
    await sess.waitFor((s) => s.includes("›"));
    await sess.settle(150);
    const wide = sess.bottomBorderWidth();
    expect(wide).toBeGreaterThan(90); // prompt box spans ~100 cols

    // width of the bottom-most box-border line — i.e. the re-rendered prompt box at the new size
    const lastBorderWidth = (): number => {
      const ls = sess.screen().split("\n");
      for (let i = ls.length - 1; i >= 0; i--) {
        const l = ls[i] ?? "";
        if (l.trim() === "") continue;
        return l.includes("╰") || l.includes("╯") ? l.length : -1;
      }
      return -1;
    };

    // footer status lines, matched structurally (↑N ↓N · $cost) — not a loose substring
    const statusCount = () => sess.screen().split("\n").filter((l) => /↑\d+ ↓\d+ · \$/.test(l)).length;

    sess.resize(60, 40);
    // Wait for the SETTLED clean repaint (debounced): bottom border ~60 AND a single footer.
    // Ink's own resize render briefly shows a duplicated/overlapping frame before our repaint.
    await sess.waitFor(() => {
      const w = lastBorderWidth();
      return w >= 56 && w <= 60 && statusCount() === 1;
    }, 8000);
    const narrow = lastBorderWidth();
    expect(narrow).toBeLessThan(wide);
    expect(narrow).toBeGreaterThanOrEqual(56);
    expect(narrow).toBeLessThanOrEqual(60);
    expect(statusCount()).toBe(1); // no duplicated/overlapping frames after the repaint settles
  });
});
