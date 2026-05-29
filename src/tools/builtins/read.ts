import fs from "node:fs";

import { z } from "zod";

import { resolveForDisplay, resolveInsideWorkspace } from "../paths";
import type { Tool } from "../types";

const schema = z.object({
  file_path: z.string().describe("Path to the file (absolute, or relative to the workspace)."),
  offset: z.number().int().min(0).optional().describe("0-based line to start at."),
  limit: z.number().int().min(1).optional().describe("Maximum number of lines to read."),
});
type Input = z.infer<typeof schema>;

export const readTool: Tool<Input> = {
  name: "Read",
  description: "Read a text file from the workspace. Returns content prefixed with 1-based line numbers.",
  schema,
  source: "builtin",
  permission: {
    effects: ["read"],
    resource: (input: Input, ctx) => resolveForDisplay(ctx.cwd, input.file_path),
  },
  async execute(input, ctx) {
    const abs = resolveInsideWorkspace(ctx.cwd, input.file_path);
    if (!fs.existsSync(abs)) {
      return { content: `File not found: ${input.file_path}`, isError: true };
    }
    if (fs.statSync(abs).isDirectory()) {
      return { content: `${input.file_path} is a directory, not a file`, isError: true };
    }
    const lines = fs.readFileSync(abs, "utf8").split("\n");
    const start = input.offset ?? 0;
    const limit = input.limit ?? 2000;
    const slice = lines.slice(start, start + limit);
    if (slice.length === 0) return { content: "(empty or past end of file)", details: { lines: lines.length } };
    const numbered = slice
      .map((line, i) => `${String(start + i + 1).padStart(5, " ")}\t${line}`)
      .join("\n");
    return { content: numbered, details: { lines: lines.length } };
  },
};
