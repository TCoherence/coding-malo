import { Box, Static, Text, useInput } from "ink";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";

import type { Store, StoreState, ToolCard, TranscriptItem } from "../core/store";
import type { ApprovalRequest } from "../permissions/types";
import { VERSION } from "../version";

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

/** Keep at most `max` lines; report how many were hidden. */
function clampLines(s: string, max: number): { text: string; hidden: number } {
  const lines = s.split("\n");
  if (lines.length <= max) return { text: s, hidden: 0 };
  return { text: lines.slice(0, max).join("\n"), hidden: lines.length - max };
}

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
function Spinner(): ReactElement {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((x) => (x + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, []);
  return <Text color="yellow">{SPINNER_FRAMES[i]}</Text>;
}

function EditDiff({ input }: { input: unknown }): ReactElement {
  const i = (input ?? {}) as { old_string?: string; new_string?: string };
  const olds = (i.old_string ?? "").split("\n").slice(0, 6);
  const news = (i.new_string ?? "").split("\n").slice(0, 6);
  return (
    <Box flexDirection="column">
      {olds.map((l, k) => (
        <Text key={`o${k}`} color="red">
          - {l}
        </Text>
      ))}
      {news.map((l, k) => (
        <Text key={`n${k}`} color="green">
          + {l}
        </Text>
      ))}
    </Box>
  );
}

function WriteDiff({ input }: { input: unknown }): ReactElement {
  const lines = (((input ?? {}) as { content?: string }).content ?? "").split("\n");
  const shown = lines.slice(0, 8);
  return (
    <Box flexDirection="column">
      {shown.map((l, k) => (
        <Text key={k} color="green">
          + {l}
        </Text>
      ))}
      {lines.length > 8 ? <Text dimColor>… 其余 {lines.length - 8} 行</Text> : null}
    </Box>
  );
}

function ModelPicker({ picker }: { picker: NonNullable<StoreState["modelPicker"]> }): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text bold>选择模型 · ↑↓ 移动 · 回车确认 · esc 取消</Text>
      {picker.items.length === 0 ? (
        <Text dimColor>（config.json 里还没配置 models 档案）</Text>
      ) : (
        picker.items.map((name, i) => (
          <Text key={name} color={i === picker.index ? "cyan" : undefined} inverse={i === picker.index}>
            {i === picker.index ? "❯ " : "  "}
            {name}
          </Text>
        ))
      )}
    </Box>
  );
}

/** Pick the most readable argument to label a tool call (command, path, prompt, …). */
function toolArgSummary(input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  for (const key of ["command", "file_path", "pattern", "prompt", "name", "url"]) {
    if (typeof i[key] === "string") return i[key] as string;
  }
  return JSON.stringify(i);
}

const MALO_LOGO = ['  .-"-.  ', " c(o.o)ɔ ", "  >|m|<  "];

function Banner({ model, cwd }: { model: string; cwd: string }): ReactElement {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Box>
        <Box flexDirection="column" marginRight={2}>
          {MALO_LOGO.map((l, i) => (
            <Text key={i} color="yellow">
              {l}
            </Text>
          ))}
        </Box>
        <Box flexDirection="column">
          <Text color="cyan" bold>
            MALO <Text dimColor>v{VERSION}</Text>
          </Text>
          <Text dimColor>oh-my-coding-buddy 🐒</Text>
          <Text dimColor>一只爱写代码的猴子</Text>
        </Box>
      </Box>
      <Box marginTop={1} flexDirection="column">
        <Text dimColor>
          模型 {model}  ·  {cwd}
        </Text>
        <Text dimColor>/help 命令 · /model 切换 · /clear 清屏 · /quit 退出</Text>
      </Box>
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
    case "tool": {
      const isEdit = item.name === "Edit" || item.name === "MultiEdit";
      const isWrite = item.name === "Write";
      const folded = clampLines(item.output, 8);
      return (
        <Box flexDirection="column" borderStyle="round" borderColor={item.isError ? "red" : "gray"} paddingX={1}>
          <Text color={item.isError ? "red" : "magenta"}>
            {item.isError ? "✗" : "⚙"} <Text bold>{item.name}</Text>
            <Text dimColor> {truncate(toolArgSummary(item.input), 80)}</Text>
          </Text>
          {isEdit ? <EditDiff input={item.input} /> : null}
          {isWrite ? <WriteDiff input={item.input} /> : null}
          {!isEdit && !isWrite && item.output ? <Text dimColor>{folded.text}</Text> : null}
          {!isEdit && !isWrite && folded.hidden > 0 ? (
            <Text dimColor>… 其余 {folded.hidden} 行已折叠</Text>
          ) : null}
        </Box>
      );
    }
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
  onSelectModel,
}: {
  store: Store;
  onSubmit: (text: string) => void;
  onInterrupt: () => void;
  onSelectModel?: (name: string) => void;
}): ReactElement {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const [history, setHistory] = useState<string[]>([]);
  const submit = (text: string): void => {
    if (text.trim().length > 0) setHistory((h) => [...h, text]);
    onSubmit(text);
  };

  const pendingApproval = state.approvalQueue[0];
  const picker = state.modelPicker;

  useInput((input, key) => {
    if (key.ctrl && input === "c") {
      onInterrupt();
      return;
    }
    if (picker) {
      if (key.upArrow) store.movePicker(-1);
      else if (key.downArrow) store.movePicker(1);
      else if (key.return) {
        const sel = picker.items[picker.index];
        store.closeModelPicker();
        if (sel && onSelectModel) onSelectModel(sel);
      } else if (key.escape) {
        store.closeModelPicker();
      }
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
      {picker ? (
        <ModelPicker picker={picker} />
      ) : pendingApproval ? (
        <ApprovalModal req={pendingApproval} />
      ) : state.busy ? (
        <Box>
          <Spinner />
          <Text dimColor> 生成中…（Ctrl+C 中断）</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Prompt onSubmit={submit} history={history} />
          <Text dimColor>/help · /model · /clear · /quit · ↑↓ history</Text>
        </Box>
      )}
    </Box>
  );
}
