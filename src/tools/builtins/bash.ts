import { spawn } from "node:child_process";

import { z } from "zod";

import { bashInvocation } from "../../permissions/sandbox";
import type { Tool, ToolResult } from "../types";

const OUTPUT_CAP = 200 * 1024; // 200KB
const DEFAULT_TIMEOUT_MS = 120_000;

const schema = z.object({
  command: z.string().describe("The shell command to run (executed via `bash -c`)."),
  description: z.string().optional().describe("A short description of what the command does."),
  timeout: z.number().int().min(1).optional().describe("Timeout in milliseconds (default 120000)."),
});
type Input = z.infer<typeof schema>;

export const bashTool: Tool<Input> = {
  name: "Bash",
  description: "Run a shell command in the workspace via bash. Output is captured (capped at 200KB).",
  schema,
  source: "builtin",
  permission: {
    effects: ["execute", "network"],
    resource: (input: Input) => input.command,
    danger: () => "high",
  },
  execute(input, ctx) {
    const timeoutMs = input.timeout ?? DEFAULT_TIMEOUT_MS;
    const { file, args } = bashInvocation(input.command, { tier: ctx.sandbox, workspace: ctx.cwd });
    return new Promise<ToolResult>((resolve) => {
      const child = spawn(file, args, {
        cwd: ctx.cwd,
        env: ctx.env,
      });

      let output = "";
      let truncated = false;
      const onData = (buf: Buffer): void => {
        const chunk = buf.toString();
        ctx.emitChunk(chunk);
        if (!truncated) {
          output += chunk;
          if (output.length >= OUTPUT_CAP) {
            output = output.slice(0, OUTPUT_CAP);
            truncated = true;
          }
        }
      };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);

      const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
      const onAbort = (): void => void child.kill("SIGKILL");
      ctx.signal.addEventListener("abort", onAbort, { once: true });

      const cleanup = (): void => {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
      };

      child.on("error", (err) => {
        cleanup();
        resolve({ content: `failed to start command: ${String(err)}`, isError: true });
      });
      child.on("close", (code, signal) => {
        cleanup();
        const tail = truncated ? "\n…[output truncated at 200KB]" : "";
        const status =
          code === 0 ? "" : `\n[exit ${code ?? "null"}${signal ? `, signal ${signal}` : ""}]`;
        const body = (output + tail + status).trim();
        resolve({ content: body.length > 0 ? body : "(no output)", isError: code !== 0 });
      });
    });
  },
};
