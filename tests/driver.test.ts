import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { resolveConfig } from "../src/config/load";
import { AgentDriver } from "../src/core/driver";
import { HeadlessPrompter } from "../src/permissions/prompter";
import { MockProvider } from "./helpers/mockProvider";

let ws: string;
let home: string;
beforeEach(() => {
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-drv-"));
  home = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-home-"));
  process.env.OMCB_HOME = home;
});
afterEach(() => {
  delete process.env.OMCB_HOME;
  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("AgentDriver model switching", () => {
  it("reports and switches the active model live", () => {
    const config = resolveConfig({ model: "m1" }, ws);
    const driver = new AgentDriver({
      config,
      sessionId: "s",
      workspace: ws,
      prompter: new HeadlessPrompter("bypass"),
      provider: new MockProvider([]),
    });
    expect(driver.getModel()).toBe("m1");
    driver.setModel("m2");
    expect(driver.getModel()).toBe("m2");
    expect(driver.availableModels()).toEqual([]);
  });

  it("exposes configured models for the /model picker", () => {
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ models: ["deepseek-chat", "deepseek-reasoner"] }));
    const config = resolveConfig({}, ws);
    const driver = new AgentDriver({
      config,
      sessionId: "s",
      workspace: ws,
      prompter: new HeadlessPrompter("bypass"),
      provider: new MockProvider([]),
    });
    expect(driver.availableModels()).toEqual(["deepseek-chat", "deepseek-reasoner"]);
  });
});
