import { spawn } from "node:child_process";

import type { HookDef } from "../config/schema";
import { matchAllowed } from "../tools/registry";

export interface PreToolDecision {
  action: "allow" | "block" | "modify";
  reason?: string;
  toolInput?: Record<string, unknown>;
}
export interface PromptDecision {
  action: "allow" | "block" | "rewrite";
  reason?: string;
  prompt?: string;
}

interface HookOutput {
  decision?: "allow" | "block" | "modify";
  reason?: string;
  toolInput?: Record<string, unknown>;
  prompt?: string;
}

function tryParse(s: string): HookOutput | null {
  const t = s.trim();
  if (!t.startsWith("{")) return null;
  try {
    return JSON.parse(t) as HookOutput;
  } catch {
    return null;
  }
}

/**
 * Lifecycle hooks. Each hook is a shell command; the event payload is written as JSON to stdin.
 * A hook signals a decision via stdout JSON (`{decision, reason, toolInput, prompt}`) or exit code
 * (2 = block). PreToolUse runs BEFORE the permission gate so it can block or rewrite a tool call.
 */
export class HookRunner {
  constructor(
    private readonly hooks: HookDef[],
    private readonly env: Record<string, string>,
    private readonly cwd: string,
  ) {}

  hasAny(): boolean {
    return this.hooks.length > 0;
  }

  private select(event: HookDef["event"], toolName?: string): HookDef[] {
    return this.hooks.filter(
      (h) => h.event === event && (!h.matcher || (toolName !== undefined ? matchAllowed(toolName, [h.matcher]) : true)),
    );
  }

  private exec(hook: HookDef, payload: unknown): Promise<{ code: number; stdout: string }> {
    return new Promise((resolve) => {
      const child = spawn("bash", ["-c", hook.command], { cwd: this.cwd, env: this.env });
      let stdout = "";
      child.stdout.on("data", (d: Buffer) => (stdout += d.toString()));
      child.stderr.on("data", () => {});
      const timer = setTimeout(() => child.kill("SIGKILL"), hook.timeoutMs ?? 10_000);
      child.on("error", () => {
        clearTimeout(timer);
        resolve({ code: 1, stdout });
      });
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ code: code ?? 1, stdout });
      });
      child.stdin.write(JSON.stringify(payload));
      child.stdin.end();
    });
  }

  async preToolUse(toolName: string, input: unknown): Promise<PreToolDecision> {
    for (const h of this.select("PreToolUse", toolName)) {
      const { code, stdout } = await this.exec(h, { event: "PreToolUse", tool: toolName, input });
      const parsed = tryParse(stdout);
      if (parsed?.decision === "block" || code === 2) {
        return { action: "block", reason: parsed?.reason ?? `blocked by PreToolUse hook` };
      }
      if (parsed?.decision === "modify" && parsed.toolInput && typeof parsed.toolInput === "object") {
        return { action: "modify", toolInput: parsed.toolInput };
      }
    }
    return { action: "allow" };
  }

  async postToolUse(toolName: string, input: unknown, output: string): Promise<void> {
    for (const h of this.select("PostToolUse", toolName)) {
      await this.exec(h, { event: "PostToolUse", tool: toolName, input, output });
    }
  }

  async userPromptSubmit(prompt: string): Promise<PromptDecision> {
    for (const h of this.select("UserPromptSubmit")) {
      const { code, stdout } = await this.exec(h, { event: "UserPromptSubmit", prompt });
      const parsed = tryParse(stdout);
      if (parsed?.decision === "block" || code === 2) {
        return { action: "block", reason: parsed?.reason ?? "blocked by UserPromptSubmit hook" };
      }
      if (typeof parsed?.prompt === "string") return { action: "rewrite", prompt: parsed.prompt };
    }
    return { action: "allow" };
  }

  async fire(event: "SessionStart" | "SessionEnd" | "Stop", payload: Record<string, unknown> = {}): Promise<void> {
    for (const h of this.select(event)) {
      await this.exec(h, { event, ...payload });
    }
  }
}
