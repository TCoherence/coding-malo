import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { expandCommand, loadCommands } from "../src/commands/loader";

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

describe("slash commands", () => {
  it("loads markdown commands with frontmatter and expands args", () => {
    fs.mkdirSync(path.join(ws, ".omcb", "commands"), { recursive: true });
    fs.writeFileSync(
      path.join(ws, ".omcb", "commands", "greet.md"),
      "---\ndescription: greet someone\n---\nSay hello to $1. Full message: $ARGUMENTS",
    );
    const cmds = loadCommands(ws);
    const c = cmds.get("greet");
    expect(c?.description).toBe("greet someone");
    expect(expandCommand(c!, "Alice how are you")).toBe("Say hello to Alice. Full message: Alice how are you");
  });

  it("handles a command with no frontmatter", () => {
    fs.mkdirSync(path.join(ws, ".omcb", "commands"), { recursive: true });
    fs.writeFileSync(path.join(ws, ".omcb", "commands", "plain.md"), "just do $ARGUMENTS");
    const c = loadCommands(ws).get("plain");
    expect(c?.description).toBeUndefined();
    expect(expandCommand(c!, "the thing")).toBe("just do the thing");
  });
});
