import type { OmcbEvent } from "../core/events";
import type { OmcbRenderer } from "../core/renderer";
import type { ApprovalRequest, Decision } from "../permissions/types";
import { deny } from "../permissions/types";

export type OutputFormat = "stream-json" | "json" | "text";

/**
 * Serializes the OmcbEvent stream to NDJSON on stdout. This is the contract oh-my-agent's
 * OmcbCLIAgent parses. `json` collapses to init+result; `text` prints only the final text.
 */
export class JsonRenderer implements OmcbRenderer {
  constructor(
    private readonly out: NodeJS.WritableStream,
    private readonly errOut: NodeJS.WritableStream,
    private readonly format: OutputFormat,
  ) {}

  start(): void {}

  handle(event: OmcbEvent): void {
    if (this.format === "text") {
      if (event.type === "result") {
        if (event.error) this.errOut.write(event.error + "\n");
        else if (event.text) this.out.write(event.text + "\n");
      }
      return;
    }
    if (this.format === "json") {
      if (event.type === "init" || event.type === "result") this.write(event);
      return;
    }
    this.write(event); // stream-json: everything
  }

  async requestApproval(req: ApprovalRequest): Promise<Decision> {
    return deny(`${req.toolName} requires approval; not available in headless mode`);
  }

  finish(): void {}
  dispose(): void {}

  private write(obj: unknown): void {
    this.out.write(JSON.stringify(obj) + "\n");
  }
}
