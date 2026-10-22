// List-price cost from the price table `.agents/model-prices.json` (PHCL-14). The kit ships the list prices of the
// models of its paseo/providers.json (owner decision 2026-10-22: prices belong to the providers, not to a project, and
// without a table every cost was null); a project may edit its copy. The daemon's own estimate is kept only as reportedCostUsd: through a proxy Claude Code prices every model
// at its own rates (2026-10-19: an agent reported $1.13 where its list price was $0.23).
import path from "node:path";
import { readJsonIf } from "../lib/io.mjs";

export const PRICES_REL = ".agents/model-prices.json";

export const loadPrices = (root) => readJsonIf(path.join(root, PRICES_REL))?.models ?? {};

// `circle-agent/model-x[1m]` -> `model-x`
export const priceKey = (model) => String(model ?? "").replace(/^[^/]*\//, "").replace(/\[[^\]]*\]$/, "");

/**
 * USD per the table, or null for an unknown model or one without input/output prices. input = uncached input,
 * cachedInput = cache reads; cache writes are not reported apart and are charged as input. Long-context rates apply
 * when the largest context used passed the model's threshold.
 */
export function costUsd(prices, model, { input = 0, cachedInput = 0, output = 0, maxContext = 0 } = {}) {
  const p = prices[priceKey(model)];
  if (!p || typeof p.input !== "number" || typeof p.output !== "number") return null;
  const long = p.longContext && maxContext > p.longContext.thresholdTokens ? p.longContext : null;
  const inRate = long?.input ?? p.input;
  const outRate = long?.output ?? p.output;
  const cachedRate = (p.cachedInput ?? p.input) * (long ? inRate / p.input : 1);
  return Math.round((input * inRate + cachedInput * cachedRate + output * outRate) / 100) / 1e4;
}
