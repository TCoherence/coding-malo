import { OmcbError } from "../core/errors";
import { AnthropicProvider } from "./anthropic";
import { OpenAICompatProvider } from "./openai-compat";
import type { Provider } from "./provider";

export interface ProviderConfig {
  kind: "anthropic" | "openai-compat";
  apiKey?: string;
  baseUrl?: string;
  /** Anthropic only: force cache_control breakpoints on/off (default: auto by baseUrl). */
  promptCaching?: boolean;
}

export function buildProvider(cfg: ProviderConfig): Provider {
  switch (cfg.kind) {
    case "anthropic":
      return new AnthropicProvider({
        apiKey: cfg.apiKey ?? process.env.ANTHROPIC_API_KEY,
        baseUrl: cfg.baseUrl ?? process.env.ANTHROPIC_BASE_URL,
        ...(cfg.promptCaching !== undefined ? { promptCaching: cfg.promptCaching } : {}),
      });
    case "openai-compat":
      return new OpenAICompatProvider({
        apiKey: cfg.apiKey ?? process.env.OPENAI_API_KEY ?? process.env.ANTHROPIC_API_KEY,
        baseUrl: cfg.baseUrl ?? process.env.OPENAI_BASE_URL ?? process.env.OMCB_BASE_URL,
      });
    default:
      throw new OmcbError("cli_error", `unknown provider kind: ${String(cfg.kind)}`);
  }
}
