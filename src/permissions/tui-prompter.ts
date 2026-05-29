import type { ApprovalRequest, Decision, Prompter } from "./types";

/**
 * Interactive prompter: delegates to a UI-supplied async `ask` (which surfaces an approval modal
 * and resolves when the user chooses). The agent loop awaits the returned promise.
 */
export class TuiPrompter implements Prompter {
  constructor(private readonly ask: (req: ApprovalRequest) => Promise<Decision>) {}
  prompt(req: ApprovalRequest): Promise<Decision> {
    return this.ask(req);
  }
}
