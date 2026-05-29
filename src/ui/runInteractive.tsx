import { render } from "ink";

import type { ResolvedConfig } from "../config/load";
import type { AgentDriver } from "../core/driver";
import { OmcbError } from "../core/errors";
import { writeMeta } from "../core/meta";
import type { SessionMeta } from "../core/meta";
import { Store } from "../core/store";
import { App } from "./App";

export interface InteractiveOptions {
  driver: AgentDriver;
  sessionId: string;
  workspace: string;
  config: ResolvedConfig;
}

export async function runInteractive(opts: InteractiveOptions): Promise<void> {
  const store = new Store();
  let busy = false;
  let currentAbort: AbortController | null = null;
  let totalTurns = 0;
  let exit!: () => void;
  const finished = new Promise<void>((resolve) => {
    exit = resolve;
  });

  const persistMeta = (
    status: SessionMeta["status"],
    terminalReason?: SessionMeta["terminalReason"],
  ): void => {
    const now = new Date().toISOString();
    writeMeta({
      sessionId: opts.sessionId,
      createdAt: now,
      usedAt: now,
      provider: opts.config.providerKind,
      model: opts.config.model,
      workspace: opts.workspace,
      allowedTools: opts.driver.toolNames(),
      maxTurns: opts.config.maxTurns,
      turnsUsed: totalTurns,
      status,
      ...(terminalReason ? { terminalReason } : {}),
    });
  };
  persistMeta("active");

  const runTurn = async (text: string): Promise<void> => {
    busy = true;
    store.setBusy(true);
    store.addUser(text);
    const ac = new AbortController();
    currentAbort = ac;
    try {
      const gen = opts.driver.runTurn({ text }, ac.signal);
      let step = await gen.next();
      while (!step.done) {
        store.apply(step.value);
        step = await gen.next();
      }
      const result = step.value;
      totalTurns += result.turnsUsed;
      persistMeta(result.errorKind ? "error" : "done", result.terminalReason);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      store.apply({
        type: "result",
        session_id: opts.sessionId,
        text: "",
        terminal_reason: "error",
        turns_used: 0,
        error: message,
        error_kind: "cli_error",
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
          cost_usd: 0,
        },
      });
      persistMeta("error", "error");
    } finally {
      busy = false;
      store.setBusy(false);
      currentAbort = null;
    }
  };

  const onSubmit = (text: string): void => {
    if (busy) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (trimmed === "/quit" || trimmed === "/exit") {
      exit();
      return;
    }
    void runTurn(trimmed);
  };

  const onInterrupt = (): void => {
    if (busy && currentAbort) currentAbort.abort(new OmcbError("timeout", "interrupted by user"));
    else exit();
  };

  const instance = render(<App store={store} onSubmit={onSubmit} onInterrupt={onInterrupt} />, {
    exitOnCtrlC: false,
  });
  await finished;
  instance.unmount();
}
