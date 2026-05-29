import type { ApprovalRequest, Decision } from "../permissions/types";
import type { OmcbEvent } from "./events";

export interface ToolCard {
  id: string;
  name: string;
  input: unknown;
  done: boolean;
}

export type TranscriptItem =
  | { kind: "user"; text: string }
  | { kind: "assistant"; text: string; thinking?: string }
  | { kind: "tool"; id: string; name: string; input: unknown; output: string; isError: boolean }
  | { kind: "notice"; text: string; isError?: boolean };

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
}

export interface StoreState {
  header: { model: string; provider: string; sessionId: string; workspace: string } | null;
  transcript: TranscriptItem[];
  live: { assistantText: string; thinking: string } | null;
  liveTools: ToolCard[];
  usage: UsageTotals;
  busy: boolean;
  status: "idle" | "streaming" | "error";
  /** Front of this queue is rendered as an approval modal; resolved via resolveApproval(). */
  approvalQueue: ApprovalRequest[];
}

function initialState(): StoreState {
  return {
    header: null,
    transcript: [],
    live: null,
    liveTools: [],
    usage: { input: 0, output: 0, cacheRead: 0, cost: 0 },
    busy: false,
    status: "idle",
    approvalQueue: [],
  };
}

interface PendingApproval {
  req: ApprovalRequest;
  resolve: (d: Decision) => void;
}

export class Store {
  private state: StoreState = initialState();
  private readonly listeners = new Set<() => void>();
  private readonly approvals: PendingApproval[] = [];

  getSnapshot = (): StoreState => this.state;

  subscribe = (cb: () => void): (() => void) => {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  };

  private set(next: (s: StoreState) => StoreState): void {
    this.state = next(this.state);
    for (const l of this.listeners) l();
  }

  addUser(text: string): void {
    this.set((s) => ({ ...s, transcript: [...s.transcript, { kind: "user", text }] }));
  }

  addNotice(text: string, isError = false): void {
    this.set((s) => ({ ...s, transcript: [...s.transcript, { kind: "notice", text, ...(isError ? { isError: true } : {}) }] }));
  }

  /** Called by the TuiPrompter: enqueue an approval request and resolve when the user decides. */
  requestApproval(req: ApprovalRequest): Promise<Decision> {
    return new Promise<Decision>((resolve) => {
      this.approvals.push({ req, resolve });
      this.set((s) => ({ ...s, approvalQueue: this.approvals.map((a) => a.req) }));
    });
  }

  resolveApproval(decision: Decision): void {
    const head = this.approvals.shift();
    this.set((s) => ({ ...s, approvalQueue: this.approvals.map((a) => a.req) }));
    head?.resolve(decision);
  }

  setBusy(busy: boolean): void {
    this.set((s) => ({ ...s, busy }));
  }

  apply(event: OmcbEvent): void {
    switch (event.type) {
      case "init":
        this.set((s) => ({
          ...s,
          status: "streaming",
          header: {
            model: event.model,
            provider: event.provider,
            sessionId: event.session_id,
            workspace: event.workspace,
          },
        }));
        break;
      case "message_start":
        this.set((s) => ({ ...s, live: { assistantText: "", thinking: "" } }));
        break;
      case "text_delta":
        this.set((s) => ({
          ...s,
          live: {
            assistantText: (s.live?.assistantText ?? "") + event.text,
            thinking: s.live?.thinking ?? "",
          },
        }));
        break;
      case "thinking_delta":
        this.set((s) => ({
          ...s,
          live: {
            assistantText: s.live?.assistantText ?? "",
            thinking: (s.live?.thinking ?? "") + event.text,
          },
        }));
        break;
      case "message_stop":
        this.set((s) => {
          if (!s.live || (!s.live.assistantText && !s.live.thinking)) return { ...s, live: null };
          const item: TranscriptItem = {
            kind: "assistant",
            text: s.live.assistantText,
            ...(s.live.thinking ? { thinking: s.live.thinking } : {}),
          };
          return { ...s, transcript: [...s.transcript, item], live: null };
        });
        break;
      case "tool_start":
        this.set((s) => ({
          ...s,
          liveTools: [...s.liveTools, { id: event.tool_id, name: event.name, input: event.input, done: false }],
        }));
        break;
      case "tool_result":
        this.set((s) => ({
          ...s,
          liveTools: s.liveTools.filter((t) => t.id !== event.tool_id),
          transcript: [
            ...s.transcript,
            {
              kind: "tool",
              id: event.tool_id,
              name: event.name,
              input: s.liveTools.find((t) => t.id === event.tool_id)?.input ?? {},
              output: event.output,
              isError: event.is_error,
            },
          ],
        }));
        break;
      case "usage":
        this.set((s) => ({
          ...s,
          usage: {
            input: s.usage.input + event.input_tokens,
            output: s.usage.output + event.output_tokens,
            cacheRead: s.usage.cacheRead + event.cache_read_input_tokens,
            cost: s.usage.cost + event.cost_usd,
          },
        }));
        break;
      case "result":
        this.set((s) => ({
          ...s,
          status: event.error ? "error" : "idle",
          live: null,
          transcript: event.error
            ? [...s.transcript, { kind: "notice", text: event.error, isError: true }]
            : s.transcript,
        }));
        break;
      case "plan":
        // Plan panel arrives in M6.
        break;
    }
  }
}
