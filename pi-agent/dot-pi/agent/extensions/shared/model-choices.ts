/**
 * Turning a live model registry into pickable choices.
 *
 * Shared by every extension that lets you configure a model, so the list looks
 * and filters the same everywhere. Nothing here names a provider: the choices
 * come from whatever the machine's registry reports, which is what makes one
 * config workflow serve Claude at home and Copilot at work.
 *
 * Pure — no pi imports, no I/O — so it is testable with plain objects.
 */

export const NEEDS = ["long-context", "vision", "thinking"] as const;
export type Need = (typeof NEEDS)[number];

/** The subset of pi's `Model` a picker needs. */
export interface ChoiceModel {
  readonly provider: string;
  readonly id: string;
  readonly name?: string;
  readonly contextWindow: number;
  readonly reasoning: boolean;
  readonly input: readonly string[];
  readonly cost: { readonly input: number };
}

export interface ModelChoice {
  /** Fully qualified `provider/model-id` — what gets written to config. */
  readonly value: string;
  readonly label: string;
  readonly selected: boolean;
}

export interface BuildChoicesOptions {
  readonly needs?: readonly Need[];
  readonly longContextThreshold?: number;
  /** Values already chosen, marked so the UI can show current state. */
  readonly selected?: readonly string[];
}

const DEFAULT_LONG_CONTEXT_THRESHOLD = 500_000;

export function formatTokens(count: number) {
  if (count >= 1_000_000) {
    const millions = count / 1_000_000;
    return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
  }
  if (count >= 1_000) return `${Math.round(count / 1_000)}K`;
  return `${count}`;
}

/** Input price per million tokens, the number worth comparing when choosing. */
export function formatPrice(perMillion: number) {
  if (perMillion <= 0) return "free";
  const rendered =
    perMillion < 1 ? perMillion.toFixed(2).replace(/0+$/, "") : `${perMillion}`;
  return `$${rendered}/M`;
}

export function formatModelLabel(model: ChoiceModel) {
  const qualified = `${model.provider}/${model.id}`;
  const parts = [
    formatTokens(model.contextWindow),
    formatPrice(model.cost.input),
  ];
  if (model.reasoning) parts.push("thinking");
  if (model.input.includes("image")) parts.push("vision");
  return `${qualified}  (${parts.join(", ")})`;
}

function satisfies(
  model: ChoiceModel,
  needs: readonly Need[],
  threshold: number,
) {
  for (const need of needs) {
    if (need === "long-context" && model.contextWindow < threshold) return false;
    if (need === "vision" && !model.input.includes("image")) return false;
    if (need === "thinking" && !model.reasoning) return false;
  }
  return true;
}

/**
 * Eligible models as choices, grouped by provider and cheapest first within
 * each — so the cheap option for a `quick` tier is the easy one to land on.
 */
export function buildModelChoices(
  models: readonly ChoiceModel[],
  options: BuildChoicesOptions,
): ModelChoice[] {
  const needs = options.needs ?? [];
  const threshold =
    options.longContextThreshold ?? DEFAULT_LONG_CONTEXT_THRESHOLD;
  const selected = new Set(options.selected ?? []);

  return models
    .filter((model) => satisfies(model, needs, threshold))
    .slice()
    .sort(
      (a, b) =>
        a.provider.localeCompare(b.provider) || a.cost.input - b.cost.input,
    )
    .map((model) => ({
      value: `${model.provider}/${model.id}`,
      label: formatModelLabel(model),
      selected: selected.has(`${model.provider}/${model.id}`),
    }));
}
