import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export function omcbHome(): string {
  return process.env.OMCB_HOME ?? path.join(os.homedir(), ".omcb");
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
