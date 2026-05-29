import type { ApprovalRequest, Decision } from "../permissions/types";
import type { OmcbEvent } from "./events";
import type { SessionMeta } from "./meta";
import type { FinalResult } from "./types";

/** A consumer of the single OmcbEvent stream. The headless JSON renderer and the Ink TUI both implement it. */
export interface OmcbRenderer {
  start(meta: SessionMeta): void | Promise<void>;
  handle(event: OmcbEvent): void | Promise<void>;
  requestApproval(req: ApprovalRequest): Promise<Decision>;
  finish(result: FinalResult): void | Promise<void>;
  dispose(): void | Promise<void>;
}
