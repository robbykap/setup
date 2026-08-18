/**
 * Resolve the model a workflow `agent()` call asked for.
 *
 * Extracted from index.ts so the resolution rules are testable without running
 * a workflow. Three outcomes, deliberately distinct:
 *
 * - `Inherit`  — nothing named; the caller keeps the parent session's model.
 * - `Resolved` — a real model this machine has credentials for.
 * - `Failed`   — a message explaining which of the several ways it went wrong.
 *
 * Resolution searches the whole catalog rather than the authenticated subset,
 * so "no such model" stays distinguishable from "no key for that model". The
 * credential check then refuses before the agent starts, instead of letting it
 * fail on its first request.
 */

import {
  checkModelCredentials,
  unknownModelMessage,
  type ModelIdentity,
} from "../shared/model-auth.ts";

interface ResolvingRegistry<T extends ModelIdentity> {
  find(provider: string, id: string): T | undefined;
  getAll(): readonly T[];
  hasConfiguredAuth(model: ModelIdentity): boolean;
}

export interface AgentModelOptions {
  readonly provider?: unknown;
  readonly model?: unknown;
}

export type AgentModelResolution<T> =
  | { readonly _tag: "Inherit" }
  | { readonly _tag: "Resolved"; readonly model: T }
  | { readonly _tag: "Failed"; readonly message: string };

export function resolveAgentModel<T extends ModelIdentity>(
  registry: ResolvingRegistry<T>,
  options: AgentModelOptions,
): AgentModelResolution<T> {
  if (options.model === undefined && options.provider === undefined) {
    return { _tag: "Inherit" };
  }

  const modelOpt = typeof options.model === "string" ? options.model : undefined;
  const providerOpt =
    typeof options.provider === "string" ? options.provider : undefined;

  if (!modelOpt) {
    return {
      _tag: "Failed",
      message: "`provider` requires `model` as well",
    };
  }

  let resolved: T | undefined;
  if (providerOpt) {
    resolved = registry.find(providerOpt, modelOpt);
  } else {
    const slash = modelOpt.indexOf("/");
    if (slash > 0) {
      resolved = registry.find(
        modelOpt.slice(0, slash),
        modelOpt.slice(slash + 1),
      );
    }
    if (!resolved) {
      // A bare id must be unambiguous: silently taking the first provider that
      // happens to offer it would pick a model the caller never asked for.
      const matches = registry.getAll().filter((m) => m.id === modelOpt);
      if (matches.length > 1) {
        return {
          _tag: "Failed",
          message:
            `Model "${modelOpt}" is ambiguous — it exists on ` +
            `${matches.map((m) => m.provider).join(", ")}. ` +
            `Use "provider/${modelOpt}".`,
        };
      }
      resolved = matches[0];
    }
  }

  if (!resolved) {
    const requested = providerOpt ? `${providerOpt}/${modelOpt}` : modelOpt;
    return { _tag: "Failed", message: unknownModelMessage(requested) };
  }

  const credentials = checkModelCredentials(registry, resolved);
  if (!credentials.ok) {
    return { _tag: "Failed", message: credentials.message };
  }

  return { _tag: "Resolved", model: resolved };
}
