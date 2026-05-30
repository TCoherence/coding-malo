import { Box, Static, Text, useCursor, useInput } from "ink";
import type { DOMElement } from "ink";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import stringWidth from "string-width";
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

// Fallback block-art monkey head (Coding Malo), drawn with Unicode block elements, used when no
// logo image is present. With ~/.codingmalo/logo.{png,jpg,jpeg} the banner shows that image instead.
const MALO_LOGO = [" ▟▀▙ ▟▀▙ ", "▕█▀███▀█▏", "▕███▾███▏", " ▝▜███▛▘ "];
const LOGO_COLOR = "#e0883c";

function Banner({ model, cwd, logoLines }: { model: string; cwd: string; logoLines?: string[] }): ReactElement {
  const useImg = Boolean(logoLines && logoLines.length > 0);
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1} marginBottom={1}>
      <Box>
        <Box flexDirection="column" marginRight={2}>
          {(useImg ? (logoLines as string[]) : MALO_LOGO).map((l, i) =>
            useImg ? (
              <Text key={i}>{l}</Text>
            ) : (
              <Text key={i} color={LOGO_COLOR}>
                {l}
              </Text>
            ),
          )}
        </Box>
        <Box flexDirection="column">
          <Text color="cyan" bold>
            Coding Malo <Text dimColor>v{VERSION}</Text>
          </Text>
          <Text dimColor>🐒 一只爱写代码的猴子</Text>
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
      return <Banner model={item.model} cwd={item.cwd} {...(item.logoLines ? { logoLines: item.logoLines } : {})} />;
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
        {h ? `${h.provider}/${h.model}` : "Coding Malo"} · ↑{u.input} ↓{u.output}
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

/** Absolute (x,y) of a box within the Ink dynamic frame: sum computed offsets up to <ink-root>. */
function frameAbsPos(node: DOMElement | null): { x: number; y: number } {
  let x = 0;
  let y = 0;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let n: any = node;
  while (n?.yogaNode) {
    const l = n.yogaNode.getComputedLayout();
    x += l.left ?? 0;
    y += l.top ?? 0;
    if (n.nodeName === "ink-root") break;
    n = n.parentNode;
  }
  return { x, y };
}

function Prompt({ onSubmit, history }: { onSubmit: (text: string) => void; history: string[] }): ReactElement {
  const [value, setValue] = useState("");
  const [cursor, setCursor] = useState(0); // caret index into value (0..value.length)
  const [histCursor, setHistCursor] = useState<number | null>(null); // null = editing a fresh line
  const boxRef = useRef<DOMElement | null>(null);
  const [boxPos, setBoxPos] = useState<{ x: number; y: number } | null>(null);
  const { setCursorPosition } = useCursor(); // Ink 7 places the REAL terminal cursor → IME anchors at the caret

  const load = (text: string): void => {
    setValue(text);
    setCursor(text.length); // caret to end of the recalled line
  };

  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "d")) return; // handled at App level
    if (key.return) {
      const v = value;
      setValue("");
      setCursor(0);
      setHistCursor(null);
      onSubmit(v);
      return;
    }
    if (key.upArrow) {
      if (history.length === 0) return;
      const next = histCursor === null ? history.length - 1 : Math.max(0, histCursor - 1);
      setHistCursor(next);
      load(history[next] ?? "");
      return;
    }
    if (key.downArrow) {
      if (histCursor === null) return;
      const next = histCursor + 1;
      if (next >= history.length) {
        setHistCursor(null);
        load("");
      } else {
        setHistCursor(next);
        load(history[next] ?? "");
      }
      return;
    }
    if (key.leftArrow) {
      setCursor((c) => Math.max(0, c - 1));
      return;
    }
    if (key.rightArrow) {
      setCursor((c) => Math.min(value.length, c + 1));
      return;
    }
    if (key.ctrl && input === "a") {
      setCursor(0); // Home
      return;
    }
    if (key.ctrl && input === "e") {
      setCursor(value.length); // End
      return;
    }
    if (key.backspace || key.delete) {
      if (cursor <= 0) return;
      setValue((v) => v.slice(0, cursor - 1) + v.slice(cursor)); // delete char before the caret
      setCursor((c) => Math.max(0, c - 1));
      setHistCursor(null);
      return;
    }
    if (key.tab || key.escape) return;
    if (input && !key.ctrl && !key.meta) {
      setValue((v) => v.slice(0, cursor) + input + v.slice(cursor)); // insert at the caret
      setCursor((c) => c + input.length);
      setHistCursor(null);
    }
  });

  // Re-measure the input box's frame position after every render (cheap; bails out when unchanged).
  useEffect(() => {
    if (!boxRef.current) return;
    const p = frameAbsPos(boxRef.current);
    setBoxPos((prev) => (prev && prev.x === p.x && prev.y === p.y ? prev : p));
  });

  // Drive the real terminal cursor to the caret cell. Inside the box: border(1) + paddingX(1) +
  // "› " prefix(2) = 4 cols before the text; the caret row is the box's top border + 1. Width of the
  // text before the caret is measured CJK-aware via string-width. (Ink hides the cursor when unset.)
  const before = value.slice(0, cursor);
  if (boxPos) {
    setCursorPosition({ x: boxPos.x + 4 + stringWidth(before), y: boxPos.y + 1 });
  } else {
    setCursorPosition(undefined);
  }

  return (
    <Box ref={boxRef} borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan">› </Text>
      <Text>{value}</Text>
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

  // NOTE: no manual clear-on-resize. We let the terminal reflow scrollback naturally (like Claude
  // Code / Codex) so prior turns are never lost. (An earlier "clean repaint" that wiped scrollback
  // looked like it deleted history in real terminals.) `/clear` still clears intentionally.

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
      <Static key={state.staticEpoch} items={state.transcript}>
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
          {/* hint ABOVE the input so the prompt is the last rendered line — keeps the real
              terminal cursor (and thus the IME candidate window) right at the input box. */}
          <Text dimColor>/help · /model · /clear · /quit · ←→ 移动 · ↑↓ history</Text>
          <Prompt onSubmit={submit} history={history} />
        </Box>
      )}
    </Box>
  );
}
