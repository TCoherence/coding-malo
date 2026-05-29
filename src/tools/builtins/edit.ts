import fs from "node:fs";

import { z } from "zod";

import { resolveForDisplay, resolveInsideWorkspace } from "../paths";
import type { Tool } from "../types";

const schema = z.object({
  file_path: z.string().describe("Path to the file to edit."),
  old_string: z.string().describe("Exact text to replace. Must be unique unless replace_all is true."),
  new_string: z.string().describe("Replacement text."),
  replace_all: z.boolean().optional().describe("Replace every occurrence instead of requiring uniqueness."),
});
type Input = z.infer<typeof schema>;

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) return 0;
  let count = 0;
  let idx = haystack.indexOf(needle);
  while (idx !== -1) {
    count++;
    idx = haystack.indexOf(needle, idx + needle.length);
  }
  return count;
}

export const editTool: Tool<Input> = {
  name: "Edit",
  description: "Replace an exact string in a file. Fails if old_string is missing or not unique (unless replace_all).",
  schema,
  source: "builtin",
  permission: {
    effects: ["write"],
    resource: (input: Input, ctx) => resolveForDisplay(ctx.cwd, input.file_path),
    danger: () => "low",
  },
  async execute(input, ctx) {
    const abs = resolveInsideWorkspace(ctx.cwd, input.file_path);
    if (!fs.existsSync(abs)) return { content: `File not found: ${input.file_path}`, isError: true };
    if (input.old_string === input.new_string) {
      return { content: "old_string and new_string are identical", isError: true };
    }
    const original = fs.readFileSync(abs, "utf8");
    const count = countOccurrences(original, input.old_string);
    if (count === 0) {
      return { content: `old_string not found in ${input.file_path}`, isError: true };
    }
    if (count > 1 && !input.replace_all) {
      return {
        content: `old_string is not unique in ${input.file_path} (${count} matches); pass replace_all or add more context`,
        isError: true,
      };
    }
    const updated = input.replace_all
      ? original.split(input.old_string).join(input.new_string)
      : original.replace(input.old_string, input.new_string);
    fs.writeFileSync(abs, updated, "utf8");
    return { content: `Edited ${input.file_path} (${input.replace_all ? count : 1} replacement${count > 1 && input.replace_all ? "s" : ""})` };
  },
};
