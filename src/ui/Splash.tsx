import { Box, render, Text, useInput } from "ink";
import { useEffect, useRef, useState } from "react";
import type { ReactElement } from "react";

/**
 * Animated startup splash: reveals a half-block logo row by row (top→bottom), holds briefly, then
 * calls onDone. Any keypress skips straight to onDone. Intended to be shown full-screen on an
 * interactive launch and then unmounted before the real app mounts.
 */
export function Splash({
  lines,
  onDone,
  frameMs = 45,
  holdMs = 320,
}: {
  lines: string[];
  onDone: () => void;
  frameMs?: number;
  holdMs?: number;
}): ReactElement {
  const [revealed, setRevealed] = useState(0);
  const fired = useRef(false);
  const holdTimer = useRef<NodeJS.Timeout | null>(null);
  const total = lines.length;

  const finish = (): void => {
    if (fired.current) return;
    fired.current = true;
    onDone();
  };

  useEffect(() => {
    let i = 0;
    const id = setInterval(() => {
      i += 1;
      if (i <= total) {
        setRevealed(i);
      } else {
        clearInterval(id);
        holdTimer.current = setTimeout(finish, holdMs);
        if (typeof holdTimer.current.unref === "function") holdTimer.current.unref();
      }
    }, frameMs);
    return () => {
      clearInterval(id);
      if (holdTimer.current) clearTimeout(holdTimer.current); // don't fire after unmount
    };
    // run once; finish/total/holdMs are stable for the splash's lifetime
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useInput(() => finish()); // any key skips the splash

  // Inline (no alt screen): render at the cursor, horizontally centered; runSplash erases it after.
  return (
    <Box flexDirection="column" alignItems="center">
      {lines.slice(0, revealed).map((l, i) => (
        <Text key={i}>{l}</Text>
      ))}
      {revealed >= total && total > 0 ? (
        <Box marginTop={1}>
          <Text color="cyan" bold>
            Coding Malo
          </Text>
        </Box>
      ) : null}
    </Box>
  );
}

/** Render the splash in its own Ink instance and resolve once it finishes (or is skipped). */
export function runSplash(lines: string[]): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (): void => {
      if (settled) return;
      settled = true;
      // defer out of React's render / input-handler cycle, then erase the splash frame and unmount
      setImmediate(() => {
        instance.clear(); // wipe the rendered logo so it doesn't linger in scrollback
        instance.unmount();
        resolve();
      });
    };
    // interactive:true — runSplash is only called on a real TTY; without it, CI (is-in-ci) would
    // render non-interactively and instance.clear() (interactive-only) wouldn't erase the splash.
    const instance = render(<Splash lines={lines} onDone={done} />, { exitOnCtrlC: false, interactive: true });
  });
}
