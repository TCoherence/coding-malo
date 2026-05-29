import fs from "node:fs";
import path from "node:path";

import { OmcbError } from "./errors";
import { ensureDir, sessionsDir } from "./paths";
import type { TerminalReason } from "./types";

export interface SessionMeta {
  sessionId: string;
  createdAt: string;
  usedAt: string;
  provider: string;
  model: string;
  workspace: string; // absolute
  allowedTools: string[];
  maxTurns: number;
  turnsUsed: number;
  status: "active" | "done" | "error";
  terminalReason?: TerminalReason;
}

function metaPath(id: string): string {
  return path.join(sessionsDir(), `${id}.meta.json`);
}

export function writeMeta(meta: SessionMeta): void {
  ensureDir(sessionsDir());
  fs.writeFileSync(metaPath(meta.sessionId), JSON.stringify(meta, null, 2));
}

export function readMeta(id: string): SessionMeta | undefined {
  const p = metaPath(id);
  if (!fs.existsSync(p)) return undefined;
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as SessionMeta;
  } catch {
    return undefined;
  }
}

/**
 * Validate a resume request. Error messages deliberately contain "session" + "does not exist"
 * / "invalid" so oh-my-agent's session-invalidation heuristics clear the stale id.
 */
export function validateResume(id: string, cwd: string, force: boolean): SessionMeta {
  const meta = readMeta(id);
  if (!meta) {
    throw new OmcbError("cli_error", `session ${id} does not exist (no metadata found); cannot resume`);
  }
  if (!force && path.resolve(meta.workspace) !== path.resolve(cwd)) {
    throw new OmcbError(
      "cli_error",
      `session ${id} is invalid for this directory: created in ${meta.workspace} but cwd is ${cwd} (use --force-workspace to override)`,
    );
  }
  return meta;
}
