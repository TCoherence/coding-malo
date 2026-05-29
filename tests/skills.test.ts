import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverSkills, makeSkillTool, skillsSystemBlock } from "../src/skills/loader";

let home: string;
let ws: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-home-"));
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-ws-"));
  process.env.OMCB_HOME = home;
});
afterEach(() => {
  delete process.env.OMCB_HOME;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(ws, { recursive: true, force: true });
});

describe("skills", () => {
  it("discovers a skill, builds a system block, and loads the body on demand", async () => {
    const dir = path.join(ws, ".omcb", "skills", "foo");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "SKILL.md"),
      "---\nname: foo\ndescription: does the foo thing\n---\nDetailed foo instructions here.",
    );

    const skills = discoverSkills(ws);
    expect(skills.map((s) => s.name)).toContain("foo");

    const block = skillsSystemBlock(skills);
    expect(block).toContain("## Available Skills");
    expect(block).toContain("foo: does the foo thing");

    const tool = makeSkillTool(skills);
    expect(tool.name).toBe("Skill");
    const res = await tool.execute({ name: "foo" }, {} as never);
    expect(String(res.content)).toContain("Detailed foo instructions here.");

    const bad = await tool.execute({ name: "missing" }, {} as never);
    expect(bad.isError).toBe(true);
  });

  it("returns no skills and an empty block when none exist", () => {
    const skills = discoverSkills(ws);
    expect(skills).toEqual([]);
    expect(skillsSystemBlock(skills)).toBe("");
  });
});
