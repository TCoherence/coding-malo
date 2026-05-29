import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { omcbHome } from "../core/paths";

function read(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/**
 * Discover project memory: a global ~/.omcb/AGENTS.md, then every `files` entry (default
 * AGENTS.md/CLAUDE.md) walking from the repo root down to the workspace, so the nearest/most
 * specific memory appears last. Each block is provenance-fenced. Returns "" when none found.
 */
export function discoverMemory(workspace: string, files: string[] = ["AGENTS.md", "CLAUDE.md"]): string {
  const blocks: { path: string; content: string }[] = [];

  const globalPath = path.join(omcbHome(), "AGENTS.md");
  const globalContent = read(globalPath);
  if (globalContent && globalContent.trim()) blocks.push({ path: globalPath, content: globalContent });

  const dirs: string[] = [];
  let dir = path.resolve(workspace);
  const stop = os.homedir();
  for (;;) {
    dirs.push(dir);
    if (dir === stop || fs.existsSync(path.join(dir, ".git"))) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  for (const d of dirs.reverse()) {
    for (const f of files) {
      const fp = path.join(d, f);
      const content = read(fp);
      if (content && content.trim()) blocks.push({ path: fp, content });
    }
  }

  if (blocks.length === 0) return "";
  const fenced = blocks.map((b) => `<!-- from ${b.path} -->\n${b.content.trim()}`).join("\n\n");
  return `<project_context>\n${fenced}\n</project_context>`;
}
