import type { Tool } from "../types";
import { bashTool } from "./bash";
import { editTool } from "./edit";
import { readTool } from "./read";
import { taskStatusTool, taskTool } from "./task";
import { updatePlanTool } from "./update-plan";
import { writeTool } from "./write";

/** The builtin tool set. (Grep/Glob/Ls/WebFetch/WebSearch/Image are a later addition.) */
export function builtinTools(): Tool[] {
  return [bashTool, readTool, writeTool, editTool, updatePlanTool, taskTool, taskStatusTool];
}
