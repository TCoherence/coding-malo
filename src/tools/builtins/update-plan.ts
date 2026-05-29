import { z } from "zod";

import type { PlanState } from "../../core/events";
import type { Tool, ToolResult } from "../types";

const itemSchema = z.object({
  id: z.string().optional(),
  text: z.string(),
  status: z.enum(["pending", "in_progress", "completed"]).optional(),
});
const schema = z.object({
  title: z.string().optional().describe("Optional plan title."),
  items: z.array(itemSchema).describe("The full todo list (pass the complete list each call)."),
});
type Input = z.infer<typeof schema>;

/** TodoWrite-style plan tool: replaces the live plan and emits a `plan` event via ToolResult.details. */
export const updatePlanTool: Tool<Input> = {
  name: "update_plan",
  description:
    "Create or update the visible task plan / todo list. Pass the complete list of items each time (with their statuses).",
  schema,
  source: "builtin",
  permission: { effects: ["read"], resource: () => "plan" },
  async execute(input): Promise<ToolResult> {
    const plan: PlanState = {
      ...(input.title ? { title: input.title } : {}),
      items: input.items.map((it, i) => ({
        id: it.id ?? `p${i + 1}`,
        text: it.text,
        status: it.status ?? "pending",
      })),
      proposed: false,
    };
    const done = plan.items.filter((i) => i.status === "completed").length;
    return { content: `Plan updated (${done}/${plan.items.length} completed).`, details: { plan } };
  },
};
