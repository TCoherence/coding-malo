import fs from "node:fs";
import path from "node:path";

import { omcbHome } from "../core/paths";

export interface SlashCommand {
  name: string;
  body: string;
  description?: string;
}

function read(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Minimal frontmatter: a leading `---\n...\n---` block; we only read a `description:` line. */
function parseFrontmatter(raw: string): { description?: string; body: string } {
  if (!raw.startsWith("---\n")) return { body: raw };
  const end = raw.indexOf("\n---", 4);
  if (end === -1) return { body: raw };
  const front = raw.slice(4, end);
  const body = raw.slice(end + 4).replace(/^\n/, "");
  const m = front.match(/^description:\s*(.+)$/m);
  return { ...(m ? { description: m[1]!.trim() } : {}), body };
}

/** Load markdown slash commands from ~/.omcb/commands and <workspace>/.omcb/commands (project wins). */
export function loadCommands(workspace: string): Map<string, SlashCommand> {
  const map = new Map<string, SlashCommand>();
  const dirs = [path.join(omcbHome(), "commands"), path.join(path.resolve(workspace), ".omcb", "commands")];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".md")) continue;
      const raw = read(path.join(dir, file));
      if (raw === null) continue;
      const { description, body } = parseFrontmatter(raw);
      map.set(file.slice(0, -3), { name: file.slice(0, -3), body, ...(description ? { description } : {}) });
    }
  }
  return map;
}

/** Expand a command body: $ARGUMENTS → all args, $1..$N → positional args. */
export function expandCommand(cmd: SlashCommand, args: string): string {
  const trimmed = args.trim();
  const parts = trimmed.length > 0 ? trimmed.split(/\s+/) : [];
  return cmd.body
    .replace(/\$ARGUMENTS/g, trimmed)
    .replace(/\$(\d+)/g, (_, n: string) => parts[Number(n) - 1] ?? "");
}
