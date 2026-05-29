import { Box, Static, Text, useInput } from "ink";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";

import type { Store, StoreState, ToolCard, TranscriptItem } from "../core/store";
import type { ApprovalRequest } from "../permissions/types";

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

/** Pick the most readable argument to label a tool call (command, path, prompt, …). */
function toolArgSummary(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  for (const key of ["command", "file_path", "pattern", "prompt", "name", "url"]) {
    if (typeof i[key] === "string") return i[key] as string;
  }
  return JSON.stringify(i);
}

function Banner({ model, cwd }: { model: string; cwd: string }): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Text color="cyan" bold>
        ● oh-my-coding-buddy
      </Text>
      <Text dimColor>
        模型 {model}  ·  {cwd}
      </Text>
      <Text dimColor>输入消息开始 · /help 命令 · /model 切换模型 · /quit 退出</Text>
    </Box>
  );
}

function TranscriptLine({ item }: { item: TranscriptItem }): ReactElement {
  switch (item.kind) {
    case "banner":
      return <Banner model={item.model} cwd={item.cwd} />;
    case "user":
      return (
        <Box marginTop={1}>
          <Text color="cyan" bold>
            › {item.text}
          </Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column" marginTop={1}>
          {item.thinking ? <Text dimColor italic>  {truncate(item.thinking, 200)}</Text> : null}
          <Text>
            <Text color="green">⏺ </Text>
            {item.text}
          </Text>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={item.isError ? "red" : "gray"} paddingX={1}>
          <Text color={item.isError ? "red" : "magenta"}>
            {item.isError ? "✗" : "⚙"} <Text bold>{item.name}</Text>
            <Text dimColor> {truncate(toolArgSummary(item.input), 80)}</Text>
          </Text>
          {item.output ? <Text dimColor>{truncate(item.output, 300)}</Text> : null}
        </Box>
      );
    case "notice":
      return <Text color={item.isError ? "red" : "yellow"}>{item.text}</Text>;
  }
}

function LiveRegion({ live }: { live: NonNullable<StoreState["live"]> }): ReactElement {
  return (
    <Box flexDirection="column">
      {live.thinking ? <Text dimColor italic>{live.thinking}</Text> : null}
      {live.assistantText ? <Text>{live.assistantText}</Text> : null}
    </Box>
  );
}

function RunningTool({ tool }: { tool: ToolCard }): ReactElement {
  return (
    <Box borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow">
        ⏳ <Text bold>{tool.name}</Text>
        <Text dimColor> {truncate(toolArgSummary(tool.input), 80)}</Text>
        <Text dimColor> · running…</Text>
      </Text>
    </Box>
  );
}

function PlanPanel({ state }: { state: StoreState }): ReactElement | null {
  const plan = state.plan;
  if (!plan || plan.items.length === 0) return null;
  const icon = (s: string): string => (s === "completed" ? "✔" : s === "in_progress" ? "▸" : "○");
  const color = (s: string): string => (s === "completed" ? "green" : s === "in_progress" ? "yellow" : "gray");
  return (
    <Box flexDirection="column" marginTop={1}>
      <Text bold>{plan.title ? `Plan: ${plan.title}` : "Plan"}</Text>
      {plan.items.map((it) => (
        <Text key={it.id} color={color(it.status)}>
          {"  "}
          {icon(it.status)} {it.text}
        </Text>
      ))}
    </Box>
  );
}

function Footer({ state }: { state: StoreState }): ReactElement {
  const h = state.header;
  const u = state.usage;
  return (
    <Box marginTop={1}>
      <Text dimColor>
        {h ? `${h.provider}/${h.model}` : "omcb"} · ↑{u.input} ↓{u.output}
        {u.cacheRead > 0 ? ` · cache ${u.cacheRead}` : ""} · ${u.cost.toFixed(4)}
        {state.status === "error" ? " · error" : ""}
      </Text>
    </Box>
  );
}

function ApprovalModal({ req }: { req: ApprovalRequest }): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1} marginTop={1}>
      <Text color="yellow">
        Approval required: <Text bold>{req.toolName}</Text>{" "}
        <Text dimColor>
          ({req.effects.join(",")}, {req.danger})
        </Text>
      </Text>
      <Text dimColor>{truncate(req.resource, 100)}</Text>
      <Text>
        <Text color="green">[a]</Text> allow once {"  "}
        <Text color="green">[s]</Text> allow session {"  "}
        <Text color="green">[p]</Text> allow + remember {"  "}
        <Text color="red">[d]</Text> deny
      </Text>
    </Box>
  );
}

function Prompt({ onSubmit, history }: { onSubmit: (text: string) => void; history: string[] }): ReactElement {
  const [value, setValue] = useState("");
  const [histCursor, setHistCursor] = useState<number | null>(null); // null = editing a fresh line
  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "d")) return; // handled at App level
    if (key.return) {
      const v = value;
      setValue("");
      setHistCursor(null);
      onSubmit(v);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.upArrow) {
      if (history.length === 0) return;
      const next = histCursor === null ? history.length - 1 : Math.max(0, histCursor - 1);
      setHistCursor(next);
      setValue(history[next] ?? "");
      return;
    }
    if (key.downArrow) {
      if (histCursor === null) return;
      const next = histCursor + 1;
      if (next >= history.length) {
        setHistCursor(null);
        setValue("");
      } else {
        setHistCursor(next);
        setValue(history[next] ?? "");
      }
      return;
    }
    if (key.tab || key.leftArrow || key.rightArrow || key.escape) return;
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v + input);
      setHistCursor(null);
    }
  });
  return (
    <Box borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan">› </Text>
      <Text>{value}</Text>
      <Text inverse> </Text>
    </Box>
  );
}

export function App({
  store,
  onSubmit,
  onInterrupt,
}: {
  store: Store;
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
}): ReactElement {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [history, setHistory] = useState<string[]>([]);
  const submit = (text: string): void => {
    if (text.trim().length > 0) setHistory((h) => [...h, text]);
    onSubmit(text);
  };

  const pendingApproval = state.approvalQueue[0];

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onInterrupt();
      return;
    }
    if (pendingApproval) {
      if (input === "a") store.resolveApproval({ allow: true });
      else if (input === "s") store.resolveApproval({ allow: true, remember: "session" });
      else if (input === "p") store.resolveApproval({ allow: true, remember: "persist" });
      else if (input === "d" || key.escape) store.resolveApproval({ allow: false, reason: "denied by user" });
    }
  });

  return (
    <Box flexDirection="column">
      <Static items={state.transcript}>
        {(item: TranscriptItem, index: number) => <TranscriptLine key={index} item={item} />}
      </Static>
      {state.live ? <LiveRegion live={state.live} /> : null}
      {state.liveTools.map((t) => (
        <RunningTool key={t.id} tool={t} />
      ))}
      <PlanPanel state={state} />
      <Footer state={state} />
      {pendingApproval ? (
        <ApprovalModal req={pendingApproval} />
      ) : state.busy ? (
        <Text dimColor>… working (Ctrl+C to interrupt)</Text>
      ) : (
        <Box flexDirection="column">
          <Prompt onSubmit={submit} history={history} />
          <Text dimColor>/help · /model · /clear · /quit · ↑↓ history</Text>
        </Box>
      )}
    </Box>
  );
}
