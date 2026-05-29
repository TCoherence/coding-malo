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

  it("places the real cursor exactly on the caret — English, mid-string, and CJK (IME anchor, #4)", async () => {
    const sess = new TuiSession({ env: env({ CODINGMALO_SPLASH: "0" }), rows: 40 });
    session = sess;
    await sess.waitFor((s) => s.includes("›"));
    const promptRow = () => sess.screen().split("\n").findIndex((l) => l.includes("›"));
    const PREFIX = 4; // box border(1) + paddingX(1) + "› "(2) before the text

    sess.type("hello");
    await sess.waitFor((s) => s.includes("hello"));
    await sess.settle(120);
    let cur = sess.cursor();
    expect(cur.y).toBe(promptRow()); // cursor sits on the prompt line itself
    expect(cur.x).toBe(PREFIX + 5); // caret after "hello"

    sess.left(2); // caret to "hel|lo"
    await sess.settle(120);
    expect(sess.cursor().x).toBe(PREFIX + 3); // 3 columns of text before the caret

    sess.right(2);
    sess.type("中文"); // two double-width chars
    await sess.waitFor((s) => s.includes("中文"));
    await sess.settle(120);
    cur = sess.cursor();
    expect(cur.y).toBe(promptRow());
    expect(cur.x).toBe(PREFIX + 5 + 4); // "hello"(5) + "中文"(2×width-2 = 4)
  });
});
