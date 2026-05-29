import { deny } from "./types";
import type { ApprovalRequest, Decision, Prompter } from "./types";

/**
 * Headless prompter: never blocks, never synthesizes OMA_CONTROL frames (deferred past v1).
 * A gate that would prompt is auto-denied with an explanatory reason; the agent loop feeds
 * that back as a tool_result so the model can adapt or finish cleanly.
 */
export class HeadlessPrompter implements Prompter {
  constructor(private readonly mode: string) {}
  async prompt(req: ApprovalRequest): Promise<Decision> {
    return deny(
      `${req.toolName} requires approval but this is a non-interactive (${this.mode}) run; not granted`,
    );
  }
}
