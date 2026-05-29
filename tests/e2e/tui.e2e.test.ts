import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { Jimp } from "jimp";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { TuiSession } from "./harness";

// Isolated home so we never touch the real ~/.codingmalo, and so the splash has a logo to render.
let home = "";
let session: TuiSession | null = null;

beforeAll(async () => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "cm-e2e-home-"));
  await new Jimp({ width: 32, height: 32, color: 0xe0883cff }).write(path.join(home, "logo.png") as `${string}.png`);
});
afterAll(() => {
  if (home) fs.rmSync(home, { recursive: true, force: true });
});
afterEach(() => {
  session?.kill();
  session = null;
});

const env = (extra: Record<string, string> = {}) => ({
  CODINGMALO_HOME: home,
  CODINGMALO_MODEL: "claude-sonnet-4-6",
  ...extra,
});

describe("TUI e2e (real PTY + headless xterm)", () => {
  it("renders inline (NOT the alternate screen)", async () => {
    session = new TuiSession({ env: env({ CODINGMALO_SPLASH: "0" }) });
    await session.waitFor((s) => s.includes("›"));
    expect(session.isAltScreen()).toBe(false);
    expect(session.screen()).toContain("Coding Malo v0.1.0");
  });

  it("plays the splash, which then self-clears (banner sits at the top, no leftover logo)", async () => {
    session = new TuiSession({ env: env({ CODINGMALO_SPLASH: "1" }), cols: 100, rows: 40 });
    await session.waitFor((s) => s.includes("Coding Malo v0.1.0") && s.includes("›"));
    await session.settle(600); // let the reveal + hold + clear finish
    const rows = session.screen().split("\n");
    // banner's top border is the very first row → nothing (no splash) lingers above it
    expect(rows[0]?.includes("╭")).toBe(true);
    // the version string appears exactly once (banner only; the splash wordmark is gone)
    expect(session.screen().split("Coding Malo v0.1.0").length - 1).toBe(1);
  });

  it("moves the caret with ← and inserts mid-string (#5)", async () => {
    session = new TuiSession({ env: env({ CODINGMALO_SPLASH: "0" }) });
    await session.waitFor((s) => s.includes("›"));
    session.type("abc");
    await session.waitFor((s) => s.includes("abc"));
    session.left(2);
    await session.settle(150);
    session.type("X");
    await session.waitFor((s) => s.includes("aXbc"));
    expect(session.screen()).toContain("aXbc");
  });

  it("recalls history with the ↑ arrow", async () => {
    session = new TuiSession({ env: env({ CODINGMALO_SPLASH: "0" }) });
    await session.waitFor((s) => s.includes("›"));
    session.type("/help"); // a builtin command — handled locally, no API call
    session.enter();
    await session.settle(200);
    session.up();
    await session.waitFor((s) => s.includes("/help"));
    expect(session.screen()).toContain("/help");
  });

  it("keeps the input cursor down at the prompt (IME anchor), not parked at the top", async () => {
    session = new TuiSession({ env: env({ CODINGMALO_SPLASH: "0" }), rows: 40 });
    await session.waitFor((s) => s.includes("›"));
    session.type("hi");
    await session.waitFor((s) => s.includes("hi"));
    await session.settle(150);
    const rows = session.screen().split("\n");
    const promptRow = rows.findIndex((l) => l.includes("›"));
    const { y } = session.cursor();
    expect(promptRow).toBeGreaterThan(5); // prompt is in the lower region, not the top
    expect(y).toBeGreaterThanOrEqual(promptRow); // cursor is at / just below the prompt line
    expect(y - promptRow).toBeLessThanOrEqual(2); // …and right next to it (IME lands here)
  });
});
