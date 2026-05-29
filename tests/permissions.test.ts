import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ApprovalStore } from "../src/permissions/approvals";
import { PermissionEngine } from "../src/permissions/engine";
import { buildSandboxProfile } from "../src/permissions/sandbox";
import type { Decision, Prompter } from "../src/permissions/types";
import type { Tool, ToolContext } from "../src/tools/types";

function fakeWriteTool(): Tool {
  return {
    name: "FakeWrite",
    description: "",
    schema: z.object({ p: z.string() }),
    source: "builtin",
    permission: { effects: ["write"], resource: (input: { p: string }) => input.p, danger: () => "high" },
    execute: async () => ({ content: "ok" }),
  };
}
const ctx = (): ToolContext => ({
  cwd: "/w",
  signal: new AbortController().signal,
  env: {},
  sandbox: "workspace-write",
  emitChunk: () => {},
  requestApproval: async () => ({ allow: false, reason: "x" }),
  agentId: "root",
  logger: { debug() {}, info() {}, warn() {}, error() {} },
});

describe("ApprovalStore", () => {
  let home: string;
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-appr-"));
    process.env.OMCB_HOME = home;
  });
  afterEach(() => {
    delete process.env.OMCB_HOME;
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("remembers session decisions in-process and persisted decisions on disk", () => {
    const a = new ApprovalStore();
    expect(a.isAllowed("Bash", "ls")).toBe(false);
    a.remember("Bash", "ls", "session");
    expect(a.isAllowed("Bash", "ls")).toBe(true);

    a.remember("Write", "/w/x", "persist");
    const reloaded = new ApprovalStore(); // fresh instance reads from disk
    expect(reloaded.isAllowed("Write", "/w/x")).toBe(true);
    expect(reloaded.isAllowed("Bash", "ls")).toBe(false); // session-only didn't persist
  });
});

describe("PermissionEngine + remembered approvals", () => {
  it("prompts once, then auto-allows the remembered resource", async () => {
    let calls = 0;
    const prompter: Prompter = {
      prompt: async (): Promise<Decision> => {
        calls++;
        return { allow: true, remember: "session" };
      },
    };
    const engine = new PermissionEngine({
      mode: "default",
      sandbox: "workspace-write",
      prompter,
      workspace: "/w",
      approvals: new ApprovalStore(false),
    });
    const tool = fakeWriteTool();
    const first = await engine.evaluate(tool, { p: "/w/x" }, ctx());
    const second = await engine.evaluate(tool, { p: "/w/x" }, ctx());
    expect(first.allow).toBe(true);
    expect(second.allow).toBe(true);
    expect(calls).toBe(1); // second was served from the remembered set
  });
});

describe("buildSandboxProfile", () => {
  it("confines writes to the workspace and allows network for workspace-write", () => {
    const p = buildSandboxProfile("workspace-write", "/ws", "/tmp");
    expect(p).toContain('(subpath "/ws")');
    expect(p).toContain("(allow network*)");
    expect(p).toContain("(deny file-write*)");
  });
  it("denies network and workspace writes for read-only", () => {
    const p = buildSandboxProfile("read-only", "/ws", "/tmp");
    expect(p).toContain("(deny network*)");
    expect(p).not.toContain('(subpath "/ws")');
  });
});
