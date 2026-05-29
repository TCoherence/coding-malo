import { z } from "zod";

import type { Tool, ToolResult } from "../types";

const taskSchema = z.object({
  description: z.string().optional().describe("Short label for the task."),
  prompt: z.string().describe("The full instructions for the sub-agent."),
  run_in_background: z.boolean().optional().describe("Start asynchronously and return a task id."),
});
type TaskInput = z.infer<typeof taskSchema>;

/** Delegate a self-contained task to a child agent loop (foreground) or start it in the background. */
export const taskTool: Tool<TaskInput> = {
  name: "Task",
  description:
    "Delegate a self-contained task to a sub-agent with its own context. Set run_in_background to start it asynchronously and poll with task_status.",
  schema: taskSchema,
  source: "subagent",
  permission: {
    effects: ["execute"],
    resource: (i: TaskInput) => i.description ?? "subagent task",
    danger: () => "high",
  },
  async execute(input, ctx): Promise<ToolResult> {
    if (!ctx.spawnSubagent) return { content: "sub-agents are not available in this context", isError: true };
    if (input.run_in_background) {
      if (!ctx.taskManager) return { content: "background tasks are not available in this context", isError: true };
      const id = ctx.taskManager.start(input.description ?? input.prompt.slice(0, 60), () =>
        ctx.spawnSubagent!({ prompt: input.prompt }),
      );
      return { content: `Started background task ${id}. Poll it with task_status.` };
    }
    const r = await ctx.spawnSubagent({ prompt: input.prompt });
    return { content: r.text, isError: r.isError };
  },
};

const statusSchema = z.object({
  task_id: z.string().optional().describe("A specific task id; omit to list all background tasks."),
});

export const taskStatusTool: Tool<z.infer<typeof statusSchema>> = {
  name: "task_status",
  description: "Check the status/result of background sub-agent task(s).",
  schema: statusSchema,
  source: "builtin",
  permission: { effects: ["read"], resource: (i: { task_id?: string }) => i.task_id ?? "tasks" },
  async execute(input, ctx): Promise<ToolResult> {
    if (!ctx.taskManager) return { content: "no background tasks in this context", isError: true };
    if (input.task_id) {
      const t = ctx.taskManager.get(input.task_id);
      if (!t) return { content: `unknown task: ${input.task_id}`, isError: true };
      return { content: `[${t.status}] ${t.label}${t.result ? `\n${t.result}` : ""}` };
    }
    const all = ctx.taskManager.list();
    if (all.length === 0) return { content: "(no background tasks)" };
    return { content: all.map((t) => `${t.id} [${t.status}] ${t.label}`).join("\n") };
  },
};
