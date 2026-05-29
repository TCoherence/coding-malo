import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { loadFileConfig, resolveConfig } from "../src/config/load";

let home: string;
let ws: string;

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-home-"));
  ws = fs.mkdtempSync(path.join(os.tmpdir(), "omcb-ws-"));
  fs.mkdirSync(path.join(ws, ".git")); // stop walk-up at ws
  process.env.OMCB_HOME = home;
});
afterEach(() => {
  delete process.env.OMCB_HOME;
  delete process.env.OMCB_TESTVAR;
  fs.rmSync(home, { recursive: true, force: true });
  fs.rmSync(ws, { recursive: true, force: true });
});

describe("layered config", () => {
  it("layers global < project and interpolates ${env:}", () => {
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ defaultModel: "global-model", maxTurns: 10, baseUrl: "${env:OMCB_TESTVAR}" }),
    );
    fs.mkdirSync(path.join(ws, ".omcb"));
    fs.writeFileSync(path.join(ws, ".omcb", "config.json"), JSON.stringify({ defaultModel: "project-model" }));
    process.env.OMCB_TESTVAR = "https://gw.example";

    const cfg = loadFileConfig(ws);
    expect(cfg.defaultModel).toBe("project-model"); // project wins over global
    expect(cfg.maxTurns).toBe(10); // inherited from global
    expect(cfg.baseUrl).toBe("https://gw.example"); // env-interpolated
  });

  it("resolveConfig: flags override file, file overrides defaults", () => {
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ defaultModel: "file-model", permissionMode: "plan" }),
    );
    const cfg = resolveConfig({ model: "flag-model" }, ws);
    expect(cfg.model).toBe("flag-model");
    expect(cfg.permissionMode).toBe("plan");
  });

  it("rejects an invalid config loudly", () => {
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ permissionMode: "nope" }));
    expect(() => loadFileConfig(ws)).toThrow(/invalid config/);
  });
});
