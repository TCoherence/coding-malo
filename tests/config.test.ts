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

  it("resolves a named model profile (provider/model/baseUrl/apiKey via ${env:})", () => {
    process.env.DS_KEY = "sk-ds";
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({
        defaultModel: "ds",
        models: {
          ds: { provider: "openai-compat", model: "deepseek-chat", baseUrl: "https://api.deepseek.com", apiKey: "${env:DS_KEY}" },
        },
      }),
    );
    const cfg = resolveConfig({}, ws);
    expect(cfg.providerKind).toBe("openai-compat");
    expect(cfg.model).toBe("deepseek-chat");
    expect(cfg.baseUrl).toBe("https://api.deepseek.com");
    expect(cfg.apiKey).toBe("sk-ds");
    expect(Object.keys(cfg.modelProfiles)).toContain("ds");
    delete process.env.DS_KEY;
  });

  it("--model can select a profile and override the active provider", () => {
    fs.writeFileSync(
      path.join(home, "config.json"),
      JSON.stringify({ models: { gpt: { provider: "openai-compat", model: "gpt-4o", baseUrl: "https://x/v1" } } }),
    );
    const cfg = resolveConfig({ model: "gpt" }, ws);
    expect(cfg.providerKind).toBe("openai-compat");
    expect(cfg.model).toBe("gpt-4o");
  });

  it("accepts a // comment key", () => {
    fs.writeFileSync(path.join(home, "config.json"), JSON.stringify({ "//": "notes", defaultModel: "x" }));
    expect(() => loadFileConfig(ws)).not.toThrow();
  });
});
