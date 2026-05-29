import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { discoverMemory } from "../src/memory/discover";

let home: string;
let ws: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-home-"));
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-ws-"));
  fs.mkdirSync(path.join(ws, ".git")); // stop walk-up at ws
  process.env.OMCB_HOME = home;
});
afterEach(() => {
  delete process.env.OMCB_HOME;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(ws, { recursive: true, force: true });
});

describe("discoverMemory", () => {
  it("merges ancestor memory with the nearest last, provenance-fenced", () => {
    fs.writeFileSync(path.join(ws, "AGENTS.md"), "ROOT-MEMORY");
    fs.mkdirSync(path.join(ws, "sub"));
    fs.writeFileSync(path.join(ws, "sub", "AGENTS.md"), "SUB-MEMORY");

    const mem = discoverMemory(path.join(ws, "sub"));
    expect(mem).toContain("<project_context>");
    expect(mem).toContain("<!-- from");
    expect(mem).toContain("ROOT-MEMORY");
    expect(mem).toContain("SUB-MEMORY");
    expect(mem.indexOf("ROOT-MEMORY")).toBeLessThan(mem.indexOf("SUB-MEMORY")); // nearest last
  });

  it("returns empty string when no memory files exist", () => {
    expect(discoverMemory(ws)).toBe("");
  });
});
