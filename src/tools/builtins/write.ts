import fs from "node:fs";
import path from "node:path";

import { z } from "zod";

import { resolveForDisplay, resolveInsideWorkspace } from "../paths";
import type { Tool } from "../types";

const schema = z.object({
  file_path: z.string().describe("Path to write (absolute, or relative to the workspace)."),
  content: z.string().describe("Full file content to write (overwrites any existing file)."),
});
type Input = z.infer<typeof schema>;

export const writeTool: Tool<Input> = {
  name: "Write",
  description: "Write (create or overwrite) a file in the workspace with the given content.",
  schema,
  source: "builtin",
  permission: {
    effects: ["write"],
    resource: (input: Input, ctx) => resolveForDisplay(ctx.cwd, input.file_path),
    danger: () => "low",
  },
  async execute(input, ctx) {
    const abs = resolveInsideWorkspace(ctx.cwd, input.file_path);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, input.content, "utf8");
    return { content: `Wrote ${Buffer.byteLength(input.content)} bytes to ${input.file_path}` };
  },
};
