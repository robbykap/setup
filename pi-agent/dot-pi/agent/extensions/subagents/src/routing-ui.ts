/**
 * Pure presentation helpers for the `/routing` editor.
 *
 * Kept separate from the dialog loop in index.ts so the menu text and the
 * label-to-effort mapping are testable without a TUI.
 */

import { EFFORTS, routeModel, type Effort, type ModelLike, type RoutingConfig } from "./router.ts";

export const DONE_LABEL = "Done";

/** One line per tier: what it resolves to here, or that it needs configuring. */
export function describeTier(
  effort: Effort,
  config: RoutingConfig,
  models: readonly ModelLike[],
) {
  const tier = config.tiers[effort];
  const decision = routeModel(models, config, { effort });
  if (decision._tag === "Routed") {
    return `${effort}  →  ${decision.model}  (thinking: ${decision.thinking})`;
  }
  const detail = tier.models.length === 0 ? "not configured" : "unroutable here";
  return `${effort}  →  ${detail}  (thinking: ${tier.thinking})`;
}

export function buildTierMenu(
  config: RoutingConfig,
  models: readonly ModelLike[],
) {
  return [
    ...EFFORTS.map((effort) => describeTier(effort, config, models)),
    DONE_LABEL,
  ];
}

/** Map a chosen menu line back to its effort. Undefined means "leave". */
export function parseTierChoice(choice: string): Effort | undefined {
  return EFFORTS.find((effort) => choice.startsWith(effort));
}
