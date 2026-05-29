import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LEGACY_HOME = path.join(os.homedir(), ".omcb");

export function omcbHome(): string {
  return process.env.CODINGMALO_HOME ?? path.join(os.homedir(), ".codingmalo");
}

/**
 * One-time rename of the pre-"Coding Malo" home directory: if the new ~/.codingmalo doesn't exist
 * yet but the legacy ~/.omcb does, move it across (preserving config.json, sessions, logo, …).
 * No-op once migrated, or when CODINGMALO_HOME points somewhere explicit. Best-effort.
 */
export function migrateLegacyHome(): void {
  if (process.env.CODINGMALO_HOME) return;
  const home = path.join(os.homedir(), ".codingmalo");
  try {
    if (!fs.existsSync(home) && fs.existsSync(LEGACY_HOME)) {
      fs.renameSync(LEGACY_HOME, home);
    }
  } catch {
    // best-effort; a fresh ~/.codingmalo is created on demand if this fails
  }
}

export function sessionsDir(): string {
  return path.join(omcbHome(), "sessions");
}
export function logsDir(): string {
  return path.join(omcbHome(), "logs");
}
export function approvalsDir(): string {
  return path.join(omcbHome(), "approvals");
}
export function historyPath(): string {
  return path.join(omcbHome(), "history");
}
export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}
