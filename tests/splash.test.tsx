import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

import { Splash } from "../src/ui/Splash";

const ESC = String.fromCharCode(27);
const strip = (s: string) => s.replace(new RegExp(ESC + "\\[[0-9;]*m", "g"), "");

async function until(pred: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!pred() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("Splash", () => {
  it("reveals the logo, shows the wordmark, then calls onDone once", async () => {
    const onDone = vi.fn();
    const { lastFrame } = render(
      <Splash lines={["AAA", "BBB", "CCC"]} onDone={onDone} frameMs={8} holdMs={20} />,
    );
    await until(() => onDone.mock.calls.length > 0);
    expect(onDone).toHaveBeenCalledTimes(1); // fires exactly once after the full reveal + hold
    const f = strip(lastFrame() ?? "");
    expect(f).toContain("CCC"); // last row revealed by the time it finishes
    expect(f).toContain("Coding Malo"); // wordmark shown at the end
  });

  it("any keypress skips immediately", async () => {
    const onDone = vi.fn();
    const { stdin } = render(
      <Splash lines={["X", "Y"]} onDone={onDone} frameMs={100000} holdMs={100000} />,
    );
    stdin.write("q");
    await until(() => onDone.mock.calls.length > 0);
    expect(onDone).toHaveBeenCalledTimes(1); // skipped without waiting for the (100s) animation
  });
});
