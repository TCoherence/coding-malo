import type { Tool } from "../types";
import { bashTool } from "./bash";
import { editTool } from "./edit";
import { readTool } from "./read";
import { writeTool } from "./write";

/** The M0 builtin tool set. Grep/Glob/Ls/WebFetch/WebSearch/Image arrive in later milestones. */
export function builtinTools(): Tool[] {
  return [bashTool, readTool, writeTool, editTool];
}
