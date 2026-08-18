/**
 * The set of models this machine can actually use.
 *
 * `ModelRegistry.getAll()` is pi's entire catalog — ~1,275 models across ~40
 * providers, nearly all of which have no credentials here. `getAvailable()` is
 * the subset with configured auth. Routing and every model picker must use the
 * latter: offering a model you cannot call produces a config that looks fine
 * and then fails at spawn time, which is exactly the failure mode the provider
 * bug in child-providers.ts already demonstrated.
 */

import type { ModelLike } from "./router.ts";

interface AvailableModels {
  getAvailable(): readonly ModelLike[];
}

/**
 * Authenticated models only. Defensive because this runs on the spawn path and
 * inside command handlers, where a registry that is absent or throwing should
 * degrade to "nothing configured" rather than take the caller down.
 */
export function registrySnapshot(ctx: { modelRegistry?: unknown }): ModelLike[] {
  const registry = ctx.modelRegistry as AvailableModels | undefined;
  if (!registry || typeof registry.getAvailable !== "function") return [];
  try {
    return [...registry.getAvailable()];
  } catch {
    return [];
  }
}
