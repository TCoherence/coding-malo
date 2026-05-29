import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { ensureDir, sessionsDir } from "./paths";
import type { NormalizedMessage } from "./types";

export function generateSessionId(): string {
  return "sess_" + crypto.randomBytes(12).toString("hex");
}

export function sessionJsonlPath(id: string): string {
  return path.join(sessionsDir(), `${id}.jsonl`);
}

export interface SessionLine {
  ts: string;
  seq: number;
  kind: "message";
  message: NormalizedMessage;
}

/** Append-only JSONL writer. One NormalizedMessage per line, written synchronously. */
export class SessionWriter {
  private seq = 0;
  private readonly filePath: string;

  constructor(public readonly sessionId: string) {
    ensureDir(sessionsDir());
    this.filePath = sessionJsonlPath(sessionId);
    // Ensure the file exists even before the first message.
    fs.closeSync(fs.openSync(this.filePath, "a"));
  }

  writeMessage(message: NormalizedMessage): void {
    const line: SessionLine = {
      ts: new Date().toISOString(),
      seq: this.seq++,
      kind: "message",
      message,
    };
    fs.appendFileSync(this.filePath, JSON.stringify(line) + "\n");
  }
}

/**
 * Rebuild the conversation from a session's JSONL. Preserves order, thinking blocks +
 * their signatures, and tool_use/tool_result pairing (they are stored verbatim).
 */
export function reconstruct(sessionId: string): NormalizedMessage[] {
  const p = sessionJsonlPath(sessionId);
  if (!fs.existsSync(p)) return [];
  const raw = fs.readFileSync(p, "utf8");
  const messages: NormalizedMessage[] = [];
  for (const line of raw.split("\n")) {
    if (line.trim().length === 0) continue;
    try {
      const obj = JSON.parse(line) as SessionLine;
      if (obj.kind === "message" && obj.message) messages.push(obj.message);
    } catch {
      // skip malformed line
    }
  }
  return messages;
}
