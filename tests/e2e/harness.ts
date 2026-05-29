import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { Terminal } from "@xterm/headless";
import { spawn, type IPty } from "node-pty";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const CLI = path.join(ROOT, "dist", "cli.js");

/**
 * node-pty's prebuilt `spawn-helper` is sometimes unpacked without the executable bit, which makes
 * `pty.fork` fail with "posix_spawnp failed". Re-assert +x for this platform's prebuild on startup.
 */
function ensureSpawnHelperExecutable(): void {
  const dir = path.join(ROOT, "node_modules", "node-pty", "prebuilds", `${process.platform}-${process.arch}`);
  const helper = path.join(dir, "spawn-helper");
  try {
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  } catch {
    // best effort; spawn will surface a clear error if the helper is truly unusable
  }
}

export interface SessionOptions {
  args?: string[];
  cols?: number;
  rows?: number;
  env?: Record<string, string>;
}

/**
 * A real terminal session: runs the built CLI in a PTY and mirrors its byte stream into a headless
 * xterm so tests can read the *rendered* screen grid + cursor (what a user's terminal would show).
 */
export class TuiSession {
  private readonly pty: IPty;
  private readonly term: Terminal;
  private exited = false;

  constructor(opts: SessionOptions = {}) {
    ensureSpawnHelperExecutable();
    const cols = opts.cols ?? 100;
    const rows = opts.rows ?? 40;
    this.term = new Terminal({ cols, rows, allowProposedApi: true });
    this.pty = spawn(process.execPath, [CLI, ...(opts.args ?? [])], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: ROOT,
      env: { ...process.env, ...opts.env } as Record<string, string>,
    });
    this.pty.onData((d) => this.term.write(d));
    this.pty.onExit(() => {
      this.exited = true;
    });
  }

  /** Visible screen as text, one row per line, trailing blank cells/rows trimmed. */
  screen(): string {
    const b = this.term.buffer.active;
    const lines: string[] = [];
    for (let y = 0; y < b.length; y++) lines.push(b.getLine(y)?.translateToString(true) ?? "");
    return lines.join("\n").replace(/\s+$/g, "");
  }

  /** Cursor cell — the OS IME candidate window anchors here. */
  cursor(): { x: number; y: number } {
    const b = this.term.buffer.active;
    return { x: b.cursorX, y: b.cursorY };
  }

  /** True if the app switched to the alternate screen buffer. */
  isAltScreen(): boolean {
    return this.term.buffer.active.type === "alternate";
  }

  hasExited(): boolean {
    return this.exited;
  }

  write(data: string): void {
    this.pty.write(data);
  }
  type(s: string): void {
    this.write(s);
  }
  enter(): void {
    this.write("\r");
  }
  left(n = 1): void {
    this.write("\x1b[D".repeat(n));
  }
  right(n = 1): void {
    this.write("\x1b[C".repeat(n));
  }
  up(): void {
    this.write("\x1b[A");
  }
  down(): void {
    this.write("\x1b[B");
  }
  ctrlC(): void {
    this.write("\x03");
  }
  /** Resize both the PTY (the CLI gets SIGWINCH) and the emulator. */
  resize(cols: number, rows: number): void {
    try {
      this.pty.resize(cols, rows);
    } catch {
      // pty may have exited
    }
    this.term.resize(cols, rows);
  }

  /** Width (in cells) of the bottom-most box border line — handy for resize assertions. */
  bottomBorderWidth(): number {
    const lines = this.screen().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const l = lines[i] ?? "";
      if (l.includes("╰") || l.includes("╯")) return l.length;
    }
    return 0;
  }

  /** Poll the rendered screen until `pred` holds, or throw with the last screen for debugging. */
  async waitFor(pred: (screen: string) => boolean, timeoutMs = 10000): Promise<void> {
    const start = Date.now();
    for (;;) {
      if (pred(this.screen())) return;
      if (Date.now() - start >= timeoutMs) {
        throw new Error(`waitFor timed out after ${timeoutMs}ms.\n----- screen -----\n${this.screen()}\n------------------`);
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  async settle(ms = 250): Promise<void> {
    await new Promise((r) => setTimeout(r, ms));
  }

  kill(): void {
    if (this.exited) return;
    try {
      this.pty.kill();
    } catch {
      // already gone
    }
  }
}
