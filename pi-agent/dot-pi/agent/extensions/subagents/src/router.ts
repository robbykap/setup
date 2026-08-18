/**
 * Intent-based model routing.
 *
 * The caller declares intent (`effort` plus optional `needs`); the router
 * resolves it to a concrete `provider/model-id` against whatever models this
 * machine actually has. Registry metadata can verify hard constraints
 * (context window, image input, reasoning support) but cannot express which
 * model is *smarter* — so the ordered per-tier list carries that judgment and
 * the metadata check catches stale or wrong entries.
 *
 * Pure: no I/O, no registry import. `ModelLike` is structurally satisfied by
 * pi's `Model`, so tests drive this with plain objects.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReasoningEffort } from "./domain.ts";

export const ROUTING_CONFIG_FILENAME = "routing.json";

export const EFFORTS = ["quick", "standard", "deep"] as const;
export type Effort = (typeof EFFORTS)[number];

export const NEEDS = ["long-context", "vision", "thinking"] as const;
export type Need = (typeof NEEDS)[number];

/** The subset of pi's `Model` the router reads. */
export interface ModelLike {
  readonly provider: string;
  readonly id: string;
  readonly contextWindow: number;
  readonly reasoning: boolean;
  readonly input: readonly string[];
  readonly cost: { readonly input: number };
  readonly thinkingLevelMap?: Partial<Record<string, string | null>>;
}

export interface RoutingTier {
  /** Ordered `provider/model-id` (or bare id) candidates, best first. */
  readonly models: readonly string[];
  readonly thinking: ReasoningEffort;
}

export interface RoutingConfig {
  readonly tiers: Readonly<Record<Effort, RoutingTier>>;
  readonly longContextThreshold: number;
}

export interface RouteRequest {
  readonly effort?: Effort;
  readonly needs?: readonly Need[];
  readonly inherited?: { readonly provider: string; readonly id: string };
}

/** Why a model was chosen — surfaced by `/routing` so misroutes are diagnosable. */
export type RouteReason = "tier" | "inherited" | "cheapest";

export type RouteDecision =
  | {
      readonly _tag: "Routed";
      /** Always fully qualified `provider/model-id`. */
      readonly model: string;
      readonly thinking: ReasoningEffort;
      readonly reason: RouteReason;
    }
  | { readonly _tag: "Unroutable"; readonly message: string };

export const DEFAULT_ROUTING_CONFIG: RoutingConfig = {
  tiers: {
    quick: {
      models: [
        "claude-bridge/claude-haiku-4-5",
        "claude-bridge/claude-sonnet-4-6",
      ],
      thinking: "low",
    },
    standard: {
      models: [
        "claude-bridge/claude-sonnet-5",
        "claude-bridge/claude-opus-4-8",
      ],
      thinking: "medium",
    },
    deep: {
      models: ["claude-bridge/claude-opus-5", "claude-bridge/claude-fable-5"],
      thinking: "high",
    },
  },
  longContextThreshold: 500_000,
};

const DEFAULT_EFFORT: Effort = "standard";

function qualify(m: ModelLike) {
  return `${m.provider}/${m.id}`;
}

/**
 * Resolve one configured entry. `provider/model-id` is exact; a bare id
 * matches only when exactly one provider offers it, so an ambiguous entry is
 * skipped rather than silently resolving to an arbitrary provider.
 */
function findModel(models: readonly ModelLike[], entry: string) {
  const slash = entry.indexOf("/");
  if (slash > 0) {
    const provider = entry.slice(0, slash);
    const id = entry.slice(slash + 1);
    return models.find((m) => m.provider === provider && m.id === id);
  }
  const matches = models.filter((m) => m.id === entry);
  return matches.length === 1 ? matches[0] : undefined;
}

/** The first unmet need, or undefined when the model satisfies all of them. */
function unmetNeed(
  model: ModelLike,
  needs: readonly Need[],
  config: RoutingConfig,
  thinking: ReasoningEffort,
): Need | undefined {
  for (const need of needs) {
    if (
      need === "long-context" &&
      model.contextWindow < config.longContextThreshold
    ) {
      return need;
    }
    if (need === "vision" && !model.input.includes("image")) return need;
    if (need === "thinking") {
      if (!model.reasoning) return need;
      if (model.thinkingLevelMap?.[thinking] === null) return need;
    }
  }
  return undefined;
}

/**
 * `needs: ["thinking"]` filters candidates by capability; the level itself
 * comes from tier config. An `off` tier is raised to `low` for this spawn
 * only, so `quick` + `thinking` stays a valid combination.
 */
function effectiveThinking(tier: RoutingTier, needs: readonly Need[]) {
  if (needs.includes("thinking") && tier.thinking === "off") return "low";
  return tier.thinking;
}

export function routeModel(
  models: readonly ModelLike[],
  config: RoutingConfig,
  request: RouteRequest,
): RouteDecision {
  const effort = request.effort ?? DEFAULT_EFFORT;
  const needs = request.needs ?? [];
  const tier = config.tiers[effort] ?? DEFAULT_ROUTING_CONFIG.tiers[effort];
  const thinking = effectiveThinking(tier, needs);

  const eligible = (model: ModelLike | undefined) =>
    model !== undefined && !unmetNeed(model, needs, config, thinking);

  for (const entry of tier.models) {
    const candidate = findModel(models, entry);
    if (eligible(candidate)) {
      return {
        _tag: "Routed",
        model: qualify(candidate!),
        thinking,
        reason: "tier",
      };
    }
  }

  const inherited = request.inherited
    ? models.find(
        (m) =>
          m.provider === request.inherited!.provider &&
          m.id === request.inherited!.id,
      )
    : undefined;
  if (eligible(inherited)) {
    return {
      _tag: "Routed",
      model: qualify(inherited!),
      thinking,
      reason: "inherited",
    };
  }

  const cheapest = models
    .filter((m) => !unmetNeed(m, needs, config, thinking))
    .sort((a, b) => a.cost.input - b.cost.input)[0];
  if (cheapest) {
    return {
      _tag: "Routed",
      model: qualify(cheapest),
      thinking,
      reason: "cheapest",
    };
  }

  const blocking = needs
    .map((need) => {
      const failing = models.every(
        (m) => unmetNeed(m, [need], config, thinking) === need,
      );
      return failing ? need : undefined;
    })
    .filter((need): need is Need => need !== undefined);

  const detail = blocking.length
    ? `no available model satisfies: ${blocking.join(", ")}`
    : `no available model satisfies: ${needs.join(", ") || "the requested effort"}`;
  return {
    _tag: "Unroutable",
    message: `Cannot route a "${effort}" subagent — ${detail}. Configured candidates: ${
      tier.models.join(", ") || "(none)"
    }. Run /routing to inspect.`,
  };
}

// --- Config parsing ----------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const THINKING_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

function parseTier(value: unknown): RoutingTier | undefined {
  if (!isRecord(value)) return undefined;
  const { models, thinking } = value;
  if (!Array.isArray(models)) return undefined;
  if (!models.every((m): m is string => typeof m === "string")) return undefined;
  if (!THINKING_LEVELS.includes(thinking as ReasoningEffort)) return undefined;
  return { models, thinking: thinking as ReasoningEffort };
}

/**
 * Lenient by design: a malformed file or tier degrades to the built-in
 * default rather than disabling subagents outright.
 */
export function parseRoutingConfig(text: string): RoutingConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return DEFAULT_ROUTING_CONFIG;
  }
  if (!isRecord(raw)) return DEFAULT_ROUTING_CONFIG;

  const rawTiers = isRecord(raw.tiers) ? raw.tiers : {};
  const tiers = Object.fromEntries(
    EFFORTS.map((effort) => [
      effort,
      parseTier(rawTiers[effort]) ?? DEFAULT_ROUTING_CONFIG.tiers[effort],
    ]),
  ) as Record<Effort, RoutingTier>;

  const threshold = raw.longContextThreshold;
  return {
    tiers,
    longContextThreshold:
      typeof threshold === "number" && Number.isFinite(threshold) && threshold > 0
        ? threshold
        : DEFAULT_ROUTING_CONFIG.longContextThreshold,
  };
}

/** Read `routing.json` from `dir`. Missing or unreadable falls back to defaults. */
export function loadRoutingConfig(dir: string): RoutingConfig {
  try {
    return parseRoutingConfig(
      readFileSync(join(dir, ROUTING_CONFIG_FILENAME), "utf8"),
    );
  } catch {
    return DEFAULT_ROUTING_CONFIG;
  }
}
