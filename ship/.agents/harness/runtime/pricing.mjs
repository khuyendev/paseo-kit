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

const pricedModel = (prices, model) => {
  const p = prices[priceKey(model)];
  return p && typeof p.input === "number" && typeof p.output === "number" ? p : null;
};

// Unrounded USD of one request. Long-context rates apply when that request's own context passed the threshold.
function requestUsd(p, { input = 0, cachedInput = 0, output = 0, maxContext = 0 } = {}) {
  const long = p.longContext && maxContext > p.longContext.thresholdTokens ? p.longContext : null;
  const inRate = long?.input ?? p.input;
  const outRate = long?.output ?? p.output;
  const cachedRate = (p.cachedInput ?? p.input) * (long ? inRate / p.input : 1);
  return (input * inRate + cachedInput * cachedRate + output * outRate) / 1e6;
}

const usd = (value) => Math.round(value * 1e4) / 1e4;

/**
 * USD of one request per the table, or null for an unknown model or one without input/output prices. input = uncached
 * input, cachedInput = cache reads; cache writes are not reported apart and are charged as input. maxContext = the
 * request's context used.
 */
export function costUsd(prices, model, usage) {
  const p = pricedModel(prices, model);
  return p ? usd(requestUsd(p, usage)) : null;
}

/**
 * USD of a call from its turns, one `{ input, cachedInput, output, maxContext }` per request: each turn is priced with
 * its own context, so one long turn does not reprice the short ones and a short last turn does not reprice the long ones.
 */
export function costOfTurns(prices, model, turns) {
  const p = pricedModel(prices, model);
  return p ? usd(turns.reduce((sum, turn) => sum + requestUsd(p, turn), 0)) : null;
}
