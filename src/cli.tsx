import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";

import { resolveConfig } from "./config/load";
import type { ConfigOverrides } from "./config/load";
import { AgentDriver } from "./core/driver";
import { OmcbError } from "./core/errors";
import { writeMeta } from "./core/meta";
import type { SessionMeta } from "./core/meta";
import { generateSessionId, reconstruct, SessionWriter } from "./core/session";
import { validateResume } from "./core/meta";
import type { ImageInput, NormalizedMessage } from "./core/types";
import { JsonRenderer } from "./headless/JsonRenderer";
import type { OutputFormat } from "./headless/JsonRenderer";
import { detectMode } from "./modes";
import { HeadlessPrompter } from "./permissions/prompter";
import type { PermissionMode, SandboxTier } from "./permissions/types";
import { runInteractive } from "./ui/runInteractive";

const VERSION = "0.0.0";

const HELP = `omcb — oh-my-coding-buddy

Usage:
  omcb [prompt]                 Start an interactive session (or run a one-shot prompt).
  omcb -p "prompt"              Headless print mode (NDJSON on stdout).
  echo "prompt" | omcb          Headless via piped stdin.

Options:
  -p, --print                   Headless mode.
  --output-format <fmt>         stream-json | json | text   (default: stream-json)
  --model <id>                  Model id (default: claude-sonnet-4-6).
  --provider <name>             anthropic | openai-compat.
  --resume <session_id>         Resume a prior session.
  --max-turns <n>               Turn budget (default: 25).
  --append-system-prompt <s>    Ambient context appended to the system prompt.
  --allowed-tools <a,b,...>     Restrict the tools the model may use.
  --permission-mode <mode>      plan | default | acceptEdits | bypass.
  --dangerously-skip-permissions  Shorthand for --permission-mode bypass.
  --sandbox <tier>              read-only | workspace-write | danger-full-access.
  --image <path>                Attach an image (repeatable).
  --workspace <dir>             Working directory (default: cwd).
  --force-workspace             Allow resuming a session created elsewhere.
  -h, --help                    Show this help.
  -v, --version                 Show version.
`;

interface RawValues {
  print?: boolean;
  "output-format"?: string;
  model?: string;
  provider?: string;
  resume?: string;
  "max-turns"?: string;
  system?: string;
  "append-system-prompt"?: string;
  "allowed-tools"?: string;
  "permission-mode"?: string;
  "dangerously-skip-permissions"?: boolean;
  sandbox?: string;
  image?: string[];
  workspace?: string;
  "force-workspace"?: boolean;
  help?: boolean;
  version?: boolean;
}

function guessMediaType(p: string): string {
  const ext = path.extname(p).toLowerCase();
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".gif") return "image/gif";
  if (ext === ".webp") return "image/webp";
  return "image/png";
}

// --image paths are operator-supplied (like the prompt itself), not model-controlled, so they are
// intentionally NOT confined to the workspace.
function loadImages(paths: string[] | undefined): ImageInput[] | undefined {
  if (!paths || paths.length === 0) return undefined;
  return paths.map((p) => ({
    mediaType: guessMediaType(p),
    data: fs.readFileSync(p).toString("base64"),
  }));
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

function persistMeta(args: {
  sessionId: string;
  providerKind: string;
  model: string;
  workspace: string;
  allowedTools: string[];
  maxTurns: number;
  turnsUsed: number;
  status: SessionMeta["status"];
  terminalReason?: SessionMeta["terminalReason"];
}): void {
  const now = new Date().toISOString();
  writeMeta({
    sessionId: args.sessionId,
    createdAt: now,
    usedAt: now,
    provider: args.providerKind,
    model: args.model,
    workspace: args.workspace,
    allowedTools: args.allowedTools,
    maxTurns: args.maxTurns,
    turnsUsed: args.turnsUsed,
    status: args.status,
    ...(args.terminalReason ? { terminalReason: args.terminalReason } : {}),
  });
}

async function main(): Promise<void> {
  const { values: raw, positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
    options: {
      print: { type: "boolean", short: "p" },
      "output-format": { type: "string" },
      model: { type: "string" },
      provider: { type: "string" },
      resume: { type: "string" },
      "max-turns": { type: "string" },
      system: { type: "string" },
      "append-system-prompt": { type: "string" },
      "allowed-tools": { type: "string" },
      "permission-mode": { type: "string" },
      "dangerously-skip-permissions": { type: "boolean" },
      sandbox: { type: "string" },
      image: { type: "string", multiple: true },
      workspace: { type: "string" },
      "force-workspace": { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
  });
  const values = raw as RawValues;

  if (values.help) {
    process.stdout.write(HELP);
    return;
  }
  if (values.version) {
    process.stdout.write(VERSION + "\n");
    return;
  }

  const workspace = path.resolve(values.workspace ?? process.cwd());

  const mode = detectMode({ print: Boolean(values.print), stdinIsTty: Boolean(process.stdin.isTTY) });

  // Permission default: explicit flag wins; otherwise interactive sessions default to acceptEdits
  // (with the approval modal handling escalations), while headless stays unattended (bypass).
  let permMode = values["permission-mode"] as PermissionMode | undefined;
  if (!permMode && !values["dangerously-skip-permissions"] && mode === "interactive") {
    permMode = "acceptEdits";
  }

  const overrides: ConfigOverrides = {
    ...(values.provider ? { provider: values.provider as "anthropic" | "openai-compat" } : {}),
    ...(values.model ? { model: values.model } : {}),
    ...(values["max-turns"] ? { maxTurns: Number(values["max-turns"]) } : {}),
    ...(permMode ? { permissionMode: permMode } : {}),
    ...(values.sandbox ? { sandbox: values.sandbox as SandboxTier } : {}),
    ...(values["allowed-tools"]
      ? { allowedTools: values["allowed-tools"].split(",").map((s) => s.trim()).filter(Boolean) }
      : {}),
    ...(values["dangerously-skip-permissions"] ? { dangerouslySkipPermissions: true } : {}),
  };
  const config = resolveConfig(overrides);

  // Resume or start fresh.
  let sessionId: string;
  let history: NormalizedMessage[];
  if (values.resume) {
    validateResume(values.resume, workspace, Boolean(values["force-workspace"]));
    sessionId = values.resume;
    history = reconstruct(sessionId);
  } else {
    sessionId = generateSessionId();
    history = [];
  }

  const writer = new SessionWriter(sessionId);

  if (mode === "interactive") {
    await runInteractive({
      config,
      sessionId,
      workspace,
      writer,
      history,
      ...(values["append-system-prompt"] ? { appendSystemPrompt: values["append-system-prompt"] } : {}),
    });
    return;
  }

  // Headless print mode — non-interactive prompter (auto-denies gated actions).
  const driver = new AgentDriver({
    config,
    sessionId,
    workspace,
    prompter: new HeadlessPrompter(config.permissionMode),
    writer,
    history,
    ...(values["append-system-prompt"] ? { appendSystemPrompt: values["append-system-prompt"] } : {}),
  });

  const promptText = positionals.join(" ").trim() || (await readStdin());
  const format = (values["output-format"] as OutputFormat) ?? "stream-json";
  const renderer = new JsonRenderer(process.stdout, process.stderr, format);

  const ac = new AbortController();
  const onSig = (): void => ac.abort(new OmcbError("timeout", "interrupted"));
  process.once("SIGINT", onSig);
  process.once("SIGTERM", onSig);

  const images = loadImages(values.image);
  const gen = driver.runTurn({ text: promptText, ...(images ? { images } : {}) }, ac.signal);
  let step = await gen.next();
  while (!step.done) {
    renderer.handle(step.value);
    step = await gen.next();
  }
  const result = step.value;

  persistMeta({
    sessionId,
    providerKind: config.providerKind,
    model: config.model,
    workspace,
    allowedTools: driver.toolNames(),
    maxTurns: config.maxTurns,
    turnsUsed: result.turnsUsed,
    status: result.errorKind ? "error" : "done",
    terminalReason: result.terminalReason,
  });

  process.exitCode = result.errorKind ? 1 : result.terminalReason === "aborted" ? 130 : 0;
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`omcb: ${message}\n`);
  process.exitCode = 1;
});
