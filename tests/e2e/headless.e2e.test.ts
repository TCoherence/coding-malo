import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { startMockOpenAI, type MockHandle } from "./mock-provider";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(ROOT, "dist", "cli.js");

let mock: MockHandle | null = null;
let home = "";
afterEach(async () => {
  if (mock) {
    await mock.close();
    mock = null;
  }
  if (home) {
    fs.rmSync(home, { recursive: true, force: true });
    home = "";
  }
});

function runHeadless(
  args: string[],
  env: Record<string, string>,
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: ROOT, env: { ...process.env, ...env } });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("headless --print (NDJSON protocol)", () => {
  it("emits init … text_delta … exactly one terminal result, exit 0", async () => {
    mock = await startMockOpenAI({ reply: "HEADLESS_OK" });
    home = fs.mkdtempSync(path.join(os.tmpdir(), "cm-headless-"));
    const { code, stdout } = await runHeadless(["-p", "hello", "--output-format", "stream-json"], {
      CODINGMALO_HOME: home,
      CODINGMALO_PROVIDER: "openai-compat",
      CODINGMALO_MODEL: "mock-model",
      CODINGMALO_BASE_URL: mock.baseUrl,
      OPENAI_API_KEY: "test",
    });

    const events = stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((l) => JSON.parse(l) as { type: string; text?: string });

    const types = events.map((e) => e.type);
    // ordering contract: init first, then text deltas, then exactly one terminal result (last)
    expect(types.indexOf("init")).toBe(0);
    const firstDelta = types.indexOf("text_delta");
    const lastDelta = types.lastIndexOf("text_delta");
    const resultIdx = types.indexOf("result");
    expect(firstDelta).toBeGreaterThan(0); // deltas come after init
    expect(resultIdx).toBeGreaterThan(lastDelta); // result after all text
    expect(resultIdx).toBe(types.length - 1); // result is the terminal event
    expect(types.filter((t) => t === "result")).toHaveLength(1); // exactly one
    // streamed deltas (chunked by the mock) reassemble to the full reply
    const deltaText = events
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text ?? "")
      .join("");
    expect(deltaText).toContain("HEADLESS_OK");
    expect(events[resultIdx]?.text ?? "").toContain("HEADLESS_OK");
    expect(code).toBe(0); // success → exit 0
  });
});
