import type { NormalizedUsage } from "./types";

export interface ModelPricing {
  /** USD per million tokens. */
  inputPerMtok: number;
  outputPerMtok: number;
  cacheReadPerMtok?: number;
  cacheWritePerMtok?: number;
}

/**
 * Best-effort pricing table (USD / Mtok). Unknown models fall back to zero cost — cost is
 * advisory in the TUI footer and never gates behaviour. Extend in M1.
 */
const PRICING: Record<string, ModelPricing> = {
  // Anthropic
  "claude-opus-4-8": { inputPerMtok: 15, outputPerMtok: 75, cacheReadPerMtok: 1.5, cacheWritePerMtok: 18.75 },
  "claude-sonnet-4-6": { inputPerMtok: 3, outputPerMtok: 15, cacheReadPerMtok: 0.3, cacheWritePerMtok: 3.75 },
  "claude-haiku-4-5": { inputPerMtok: 1, outputPerMtok: 5, cacheReadPerMtok: 0.1, cacheWritePerMtok: 1.25 },
  // DeepSeek — https://api-docs.deepseek.com/quick_start/pricing (USD/Mtok, as of 2026-05).
  // cacheRead = cache-hit price; cache-miss is billed as full input (no separate cache-write charge).
  // deepseek-chat / deepseek-reasoner are legacy aliases of deepseek-v4-flash (identical pricing).
  "deepseek-v4-flash": { inputPerMtok: 0.14, outputPerMtok: 0.28, cacheReadPerMtok: 0.0028, cacheWritePerMtok: 0.14 },
  // deepseek-v4-pro: post-2026/05/31 permanent rate (1/4 of the original 1.74/3.48/0.0145).
  "deepseek-v4-pro": { inputPerMtok: 0.435, outputPerMtok: 0.87, cacheReadPerMtok: 0.003625, cacheWritePerMtok: 0.435 },
  "deepseek-chat": { inputPerMtok: 0.14, outputPerMtok: 0.28, cacheReadPerMtok: 0.0028, cacheWritePerMtok: 0.14 },
  "deepseek-reasoner": { inputPerMtok: 0.14, outputPerMtok: 0.28, cacheReadPerMtok: 0.0028, cacheWritePerMtok: 0.14 },
  // OpenAI
  "gpt-4o": { inputPerMtok: 2.5, outputPerMtok: 10, cacheReadPerMtok: 1.25, cacheWritePerMtok: 2.5 },
  "gpt-4o-mini": { inputPerMtok: 0.15, outputPerMtok: 0.6, cacheReadPerMtok: 0.075, cacheWritePerMtok: 0.15 },
};

function pricingFor(model: string): ModelPricing | undefined {
  if (PRICING[model]) return PRICING[model];
  // tolerate version suffixes / dates, e.g. "claude-sonnet-4-6-20260101"
  for (const key of Object.keys(PRICING)) {
    if (model.startsWith(key)) return PRICING[key];
  }
  return undefined;
}

export function computeCost(model: string, usage: NormalizedUsage): number {
  const p = pricingFor(model);
  if (!p) return 0;
  const input = usage.inputTokens ?? 0;
  const output = usage.outputTokens ?? 0;
  const cacheRead = usage.cacheReadInputTokens ?? 0;
  const cacheWrite = usage.cacheCreationInputTokens ?? 0;
  const cost =
    (input / 1e6) * p.inputPerMtok +
    (output / 1e6) * p.outputPerMtok +
    (cacheRead / 1e6) * (p.cacheReadPerMtok ?? p.inputPerMtok) +
    (cacheWrite / 1e6) * (p.cacheWritePerMtok ?? p.inputPerMtok);
  return Number(cost.toFixed(6));
}

export function emptyUsage(): Required<NormalizedUsage> {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    cacheCreationInputTokens: 0,
    costUsd: 0,
  };
}

/** Accumulate `delta` into `acc` in place. */
export function addUsage(acc: Required<NormalizedUsage>, delta: NormalizedUsage): void {
  acc.inputTokens += delta.inputTokens ?? 0;
  acc.outputTokens += delta.outputTokens ?? 0;
  acc.cacheReadInputTokens += delta.cacheReadInputTokens ?? 0;
  acc.cacheCreationInputTokens += delta.cacheCreationInputTokens ?? 0;
  acc.costUsd += delta.costUsd ?? 0;
}
