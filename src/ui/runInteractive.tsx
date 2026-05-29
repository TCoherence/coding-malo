import fs from "node:fs";
import path from "node:path";

import { render } from "ink";

import type { ResolvedConfig } from "../config/load";
import { omcbHome } from "../core/paths";
import { AgentDriver } from "../core/driver";
import { OmcbError } from "../core/errors";
import { writeMeta } from "../core/meta";
import type { SessionMeta } from "../core/meta";
import { Store } from "../core/store";
import type { NormalizedMessage } from "../core/types";
import { expandCommand, loadCommands } from "../commands/loader";
import { ApprovalStore } from "../permissions/approvals";
import { TuiPrompter } from "../permissions/tui-prompter";
import { App } from "./App";
import { renderImageHalfBlocks } from "./image";
import { runSplash } from "./Splash";

export interface InteractiveOptions {
  config: ResolvedConfig;
  sessionId: string;
  workspace: string;
  writer?: { writeMessage(m: NormalizedMessage): void };
  history?: NormalizedMessage[];
  appendSystemPrompt?: string;
}

export async function runInteractive(opts: InteractiveOptions): Promise<void> {
  const store = new Store();
  const prompter = new TuiPrompter((req) => store.requestApproval(req));
  const driver = new AgentDriver({
    config: opts.config,
    sessionId: opts.sessionId,
    workspace: opts.workspace,
    prompter,
    approvals: new ApprovalStore(),
    ...(opts.writer ? { writer: opts.writer } : {}),
    ...(opts.history ? { history: opts.history } : {}),
    ...(opts.appendSystemPrompt ? { appendSystemPrompt: opts.appendSystemPrompt } : {}),
  });
  const logoWidth = opts.config.logoWidth;
  const bgThreshold = opts.config.logoBg === "transparent" ? 235 : 0;
  let logoLines: string[] | undefined;
  const logoPath =
    opts.config.logo ??
    ["logo.png", "logo.jpg", "logo.jpeg", "logo.webp"]
      .map((n) => path.join(omcbHome(), n))
      .find((p) => fs.existsSync(p));
  if (logoPath && fs.existsSync(logoPath)) {
    try {
      logoLines = await renderImageHalfBlocks(logoPath, { maxCols: logoWidth, bgThreshold });
    } catch {
      logoLines = undefined; // fall back to the block-art monkey
    }
  }
  store.addBanner(driver.getModel(), opts.workspace, logoLines);

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
      allowedTools: driver.toolNames(),
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
      const gen = driver.runTurn({ text }, ac.signal);
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

  const commands = loadCommands(opts.workspace);
  const onSubmit = (text: string): void => {
    if (busy) return;
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    if (trimmed.startsWith("/")) {
      const tokens = trimmed.slice(1).split(/\s+/);
      const name = tokens[0] ?? "";
      const args = tokens.slice(1).join(" ").trim();
      switch (name) {
        case "quit":
        case "exit":
          exit();
          return;
        case "help": {
          const custom = [...commands.keys()].map((c) => `/${c}`).join(" ");
          store.addNotice(`命令: /help · /model [名字] · /clear · /cost · /quit${custom ? `  ·  自定义: ${custom}` : ""}`);
          return;
        }
        case "clear":
          store.clearTranscript();
          return;
        case "cost": {
          const u = store.getSnapshot().usage;
          store.addNotice(`用量: ↑${u.input} ↓${u.output}${u.cacheRead ? ` · 缓存 ${u.cacheRead}` : ""} · $${u.cost.toFixed(4)}`);
          return;
        }
        case "model": {
          if (!args) {
            const avail = driver.availableModels();
            if (avail.length > 0) {
              store.openModelPicker(avail, driver.getModel());
            } else {
              store.addNotice(`当前模型: ${driver.getModel()}。config.json 里没有 models 档案；用 /model <id> 直接指定。`);
            }
          } else {
            driver.setModel(args);
            store.setModel(driver.getModel());
            store.addNotice(`已切换 → ${driver.getModel()}`);
          }
          return;
        }
      }
      const cmd = commands.get(name);
      if (cmd) {
        void runTurn(expandCommand(cmd, args));
        return;
      }
      store.addNotice(`未知命令: /${name}`, true);
      return;
    }
    void runTurn(trimmed);
  };

  let exitArmed = false;
  let exitTimer: NodeJS.Timeout | null = null;
  const onInterrupt = (): void => {
    if (busy && currentAbort) {
      currentAbort.abort(new OmcbError("timeout", "interrupted by user"));
      return;
    }
    if (exitArmed) {
      if (exitTimer) clearTimeout(exitTimer);
      exit();
      return;
    }
    exitArmed = true;
    store.addNotice("Press Ctrl+C again to exit.");
    exitTimer = setTimeout(() => {
      exitArmed = false;
    }, 1500);
    if (typeof exitTimer.unref === "function") exitTimer.unref();
  };

  const selectModel = (name: string): void => {
    driver.setModel(name);
    store.setModel(driver.getModel());
    store.addNotice(`已切换 → ${driver.getModel()}`);
  };

  await driver.init();
  await driver.hookRunner().fire("SessionStart", { mode: "interactive" });

  // No alternate screen: render inline like Claude Code / Codex. The terminal keeps its native
  // scrollback (the mouse wheel scrolls history instead of being mistaken for ↑/↓), the whole
  // session stays visible after exit, and the IME tracks the real cursor in the normal buffer.
  const isTty = Boolean(process.stdout.isTTY);
  // Flashy startup splash: a larger, higher-detail logo revealed with a quick animation, which then
  // erases itself (instance.clear()) before the app mounts. TTY + a logo image + config.splash only.
  if (logoPath && opts.config.splash && isTty) {
    try {
      const cols = Math.max(20, Math.min((process.stdout.columns ?? 80) - 4, 60));
      const big = await renderImageHalfBlocks(logoPath, { maxCols: cols, bgThreshold });
      await runSplash(big);
    } catch {
      // ignore splash failures and fall through to the app
    }
  }
  const instance = render(
    <App store={store} onSubmit={onSubmit} onInterrupt={onInterrupt} onSelectModel={selectModel} />,
    { exitOnCtrlC: false },
  );
  try {
    await finished;
  } finally {
    store.cancelPendingApprovals(); // unblock any awaited approval before tearing down
    store.flush();
    instance.unmount();
    await driver.hookRunner().fire("SessionEnd", { mode: "interactive" });
    await driver.close();
  }
}
