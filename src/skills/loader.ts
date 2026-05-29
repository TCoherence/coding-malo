import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { omcbHome } from "../core/paths";
import type { Tool, ToolResult } from "../tools/types";

export interface LoadedSkill {
  name: string;
  description: string;
  dir: string;
  skillPath: string;
}

function read(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Parse the SKILL.md frontmatter (name + description); fall back to the folder name. */
function parseSkillFrontmatter(raw: string, fallbackName: string): { name: string; description: string } {
  let name = fallbackName;
  let description = "";
  if (raw.startsWith("---\n")) {
    const end = raw.indexOf("\n---", 4);
    if (end !== -1) {
      const front = raw.slice(4, end);
      const nm = front.match(/^name:\s*(.+)$/m);
      const desc = front.match(/^description:\s*(.+)$/m);
      if (nm) name = nm[1]!.trim();
      if (desc) description = desc[1]!.trim();
    }
  }
  return { name, description };
}

function stripFrontmatter(raw: string): string {
  if (!raw.startsWith("---\n")) return raw;
  const end = raw.indexOf("\n---", 4);
  return end === -1 ? raw : raw.slice(end + 4).replace(/^\n/, "");
}

/**
 * Discover skills from ~/.omcb/skills, <ws>/.omcb/skills (== $OMA_AGENT_HOME/skills), and
 * <ws>/.claude/skills (compat). Each skill is a folder with a SKILL.md. Later roots override
 * earlier ones on name collision.
 */
export function discoverSkills(workspace: string): LoadedSkill[] {
  const roots = [
    path.join(omcbHome(), "skills"),
    path.join(path.resolve(workspace), ".omcb", "skills"),
    path.join(path.resolve(workspace), ".claude", "skills"),
  ];
  const map = new Map<string, LoadedSkill>();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const entry of fs.readdirSync(root)) {
      const dir = path.join(root, entry);
      if (!fs.statSync(dir).isDirectory()) continue;
      const skillPath = path.join(dir, "SKILL.md");
      const raw = read(skillPath);
      if (raw === null) continue;
      const { name, description } = parseSkillFrontmatter(raw, entry);
      map.set(name, { name, description, dir, skillPath });
    }
  }
  return [...map.values()];
}

export const SkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export function loadSkillBody(skill: LoadedSkill): string {
  return stripFrontmatter(read(skill.skillPath) ?? "");
}

/** A `## Available Skills` block for the system prompt (progressive disclosure: names + descriptions). */
export function skillsSystemBlock(skills: LoadedSkill[]): string {
  if (skills.length === 0) return "";
  const list = skills.map((s) => `- ${s.name}: ${s.description}`).join("\n");
  return `## Available Skills\n${list}\nCall the Skill tool with a skill name to load its full instructions before using it.`;
}

const skillSchema = z.object({ name: z.string().describe("The skill name to load.") });

/** The Skill tool: loads a skill's SKILL.md body on demand (progressive disclosure). */
export function makeSkillTool(skills: LoadedSkill[]): Tool {
  const byName = new Map(skills.map((s) => [s.name, s]));
  return {
    name: "Skill",
    description: `Load the full instructions for an available skill. Skills: ${skills.map((s) => s.name).join(", ") || "(none)"}.`,
    schema: skillSchema,
    source: "skill",
    permission: { effects: ["read"], resource: (i: { name: string }) => `skill:${i.name}` },
    async execute(input: { name: string }): Promise<ToolResult> {
      const skill = byName.get(input.name);
      if (!skill) {
        return { content: `Unknown skill: ${input.name}. Available: ${[...byName.keys()].join(", ") || "(none)"}`, isError: true };
      }
      const body = loadSkillBody(skill);
      return {
        content: `${body}\n\n(Skill working dir: ${skill.dir}. Bundled scripts resolve under $OMA_AGENT_HOME/skills/${skill.name}/.)`,
      };
    },
  };
}
