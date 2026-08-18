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

// --- Explicit model validation ------------------------------------------------

/** Validation only needs a model's identity, not its capabilities. */
interface ModelIdentity {
  readonly provider: string;
  readonly id: string;
}

interface AuthQueryableRegistry<T extends ModelIdentity = ModelIdentity> {
  find(provider: string, id: string): T | undefined;
  getAll(): readonly T[];
  hasConfiguredAuth(model: T): boolean;
}

export type ExplicitModelCheck =
  | { readonly _tag: "Ok" }
  | { readonly _tag: "UnknownModel"; readonly message: string }
  | { readonly _tag: "NoCredentials"; readonly message: string };

/**
 * Validate a caller-supplied `provider/model-id` before a session is created.
 *
 * Resolution deliberately searches the *whole* catalog rather than the
 * authenticated subset, so the two failures stay distinguishable: a typo
 * ("unknown model") reads very differently from a real model you have no key
 * for ("no credentials"). Both refuse here rather than at run time — spawning
 * first would leave a dead subagent holding a concurrency slot.
 */
export function validateExplicitModel<T extends ModelIdentity>(
  registry: AuthQueryableRegistry<T>,
  hint: string,
): ExplicitModelCheck {
  if (
    typeof registry?.find !== "function" ||
    typeof registry?.hasConfiguredAuth !== "function" ||
    typeof registry?.getAll !== "function"
  ) {
    // Cannot answer; let the existing resolution path report problems.
    return { _tag: "Ok" };
  }

  let model: T | undefined;
  const slash = hint.indexOf("/");
  if (slash > 0) {
    model = registry.find(hint.slice(0, slash), hint.slice(slash + 1));
  } else {
    const matches = registry.getAll().filter((m) => m.id === hint);
    if (matches.length === 1) model = matches[0];
  }

  if (!model) {
    return {
      _tag: "UnknownModel",
      message: `Unknown model "${hint}". Use "provider/model-id"; run /routing to see the models available here.`,
    };
  }

  if (!registry.hasConfiguredAuth(model)) {
    return {
      _tag: "NoCredentials",
      message:
        `No credentials for "${model.provider}" on this machine, so "${model.provider}/${model.id}" cannot run. ` +
        `Use /login to authenticate it, or pick a model from a provider you already have.`,
    };
  }

  return { _tag: "Ok" };
}
