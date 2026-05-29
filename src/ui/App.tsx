import { Box, Static, Text, useInput } from "ink";
import { useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";

import type { Store, StoreState, ToolCard, TranscriptItem } from "../core/store";

function truncate(s: string, max: number): string {
  const oneLine = s.replace(/\s+/g, " ").trim();
  return oneLine.length > max ? oneLine.slice(0, max) + "…" : oneLine;
}

function TranscriptLine({ item }: { item: TranscriptItem }): ReactElement {
  switch (item.kind) {
    case "user":
      return (
        <Box>
          <Text color="cyan">› </Text>
          <Text>{item.text}</Text>
        </Box>
      );
    case "assistant":
      return (
        <Box flexDirection="column">
          {item.thinking ? <Text dimColor italic>{truncate(item.thinking, 200)}</Text> : null}
          <Text>{item.text}</Text>
        </Box>
      );
    case "tool":
      return (
        <Box flexDirection="column" marginLeft={2}>
          <Text color={item.isError ? "red" : "magenta"}>
            {item.isError ? "✗" : "⚙"} {item.name}
            <Text dimColor> {truncate(JSON.stringify(item.input ?? {}), 80)}</Text>
          </Text>
          <Text dimColor>{truncate(item.output, 240)}</Text>
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
    <Text color="yellow">
      ⏳ {tool.name}
      <Text dimColor> {truncate(JSON.stringify(tool.input ?? {}), 80)}</Text>
    </Text>
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

function Prompt({ onSubmit }: { onSubmit: (text: string) => void }): ReactElement {
  const [value, setValue] = useState("");
  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "d")) return; // handled at App level
    if (key.return) {
      const v = value;
      setValue("");
      onSubmit(v);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (key.tab || key.upArrow || key.downArrow || key.leftArrow || key.rightArrow || key.escape) {
      return;
    }
    if (input && !key.ctrl && !key.meta) setValue((v) => v + input);
  });
  return (
    <Box>
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

  useInput((input, key) => {
    if (key.ctrl && (input === "c" || input === "d")) onInterrupt();
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
      <Footer state={state} />
      {state.busy ? (
        <Text dimColor>… working (Ctrl+C to interrupt)</Text>
      ) : (
        <Prompt onSubmit={onSubmit} />
      )}
    </Box>
  );
}
