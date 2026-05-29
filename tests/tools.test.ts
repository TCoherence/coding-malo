import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sanitizeEnv } from "../src/permissions/sandbox";
import { bashTool } from "../src/tools/builtins/bash";
import { editTool } from "../src/tools/builtins/edit";
import { readTool } from "../src/tools/builtins/read";
import { writeTool } from "../src/tools/builtins/write";
import type { ToolContext } from "../src/tools/types";

let workspace: string;
beforeEach(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-tools-"));
});
afterEach(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
});

function ctx(): ToolContext {
  return {
    cwd: workspace,
    signal: new AbortController().signal,
    env: sanitizeEnv(),
    emitChunk: () => {},
    requestApproval: async () => ({ allow: false, reason: "denied in test" }),
    agentId: "root",
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  };
}

describe("builtin tools", () => {
  it("writes then reads a file (round-trip)", async () => {
    const w = await writeTool.execute({ file_path: "a/b.txt", content: "line1\nline2" }, ctx());
    expect(w.isError).toBeFalsy();
    expect(fs.readFileSync(path.join(workspace, "a/b.txt"), "utf8")).toBe("line1\nline2");

    const r = await readTool.execute({ file_path: "a/b.txt" }, ctx());
    expect(String(r.content)).toContain("line1");
    expect(String(r.content)).toContain("    1\t"); // 1-based line numbers
  });

  it("read reports missing files as errors", async () => {
    const r = await readTool.execute({ file_path: "nope.txt" }, ctx());
    expect(r.isError).toBe(true);
  });

  it("edit replaces a unique string and rejects ambiguous / missing", async () => {
    fs.writeFileSync(path.join(workspace, "f.txt"), "foo bar foo");
    const ambiguous = await editTool.execute(
      { file_path: "f.txt", old_string: "foo", new_string: "x" },
      ctx(),
    );
    expect(ambiguous.isError).toBe(true);

    const all = await editTool.execute(
      { file_path: "f.txt", old_string: "foo", new_string: "x", replace_all: true },
      ctx(),
    );
    expect(all.isError).toBeFalsy();
    expect(fs.readFileSync(path.join(workspace, "f.txt"), "utf8")).toBe("x bar x");

    const missing = await editTool.execute(
      { file_path: "f.txt", old_string: "zzz", new_string: "y" },
      ctx(),
    );
    expect(missing.isError).toBe(true);
  });

  it("rejects paths that escape the workspace", async () => {
    await expect(
      writeTool.execute({ file_path: "../escape.txt", content: "x" }, ctx()),
    ).rejects.toThrow(/escapes the workspace/);
  });

  it("runs a bash command and captures output", async () => {
    const r = await bashTool.execute({ command: "echo hello-omcb" }, ctx());
    expect(r.isError).toBe(false);
    expect(String(r.content)).toContain("hello-omcb");
  });

  it("marks non-zero bash exits as errors", async () => {
    const r = await bashTool.execute({ command: "exit 3" }, ctx());
    expect(r.isError).toBe(true);
    expect(String(r.content)).toContain("exit 3");
  });
});
