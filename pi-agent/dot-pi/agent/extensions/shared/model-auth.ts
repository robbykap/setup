/**
 * Credential checks for an explicitly named model.
 *
 * Every extension that lets a caller name a model directly needs the same two
 * refusals, worded the same way: the model does not exist, or it exists and
 * this machine has no key for it. Resolution itself stays with each caller,
 * because the input shapes differ (a single "provider/id" hint for subagents,
 * separate provider and model options for workflows).
 *
 * The rule these encode: refuse *before* creating a session. Resolving against
 * the full catalog keeps the two failures distinguishable; checking auth keeps
 * the failure early instead of surfacing on the child's first request.
 */

export interface ModelIdentity {
  readonly provider: string;
  readonly id: string;
}

interface AuthQueryable {
  hasConfiguredAuth(model: ModelIdentity): boolean;
}

export type CredentialCheck =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Whether this machine can actually call `model`.
 *
 * Fails open: a registry that cannot answer, or throws while answering, yields
 * `ok` so the request proceeds and pi reports its own error. Blocking a model
 * because the registry was uncooperative would be worse than attempting it.
 */
export function checkModelCredentials(
  registry: AuthQueryable,
  model: ModelIdentity,
): CredentialCheck {
  if (typeof registry?.hasConfiguredAuth !== "function") return { ok: true };
  try {
    if (registry.hasConfiguredAuth(model)) return { ok: true };
  } catch {
    return { ok: true };
  }
  return {
    ok: false,
    message:
      `No credentials for "${model.provider}" on this machine, so ` +
      `"${model.provider}/${model.id}" cannot run. Use /login to authenticate ` +
      `it, or pick a model from a provider you already have.`,
  };
}

/** Companion message for a name that matches no model at all. */
export function unknownModelMessage(requested: string) {
  return `Unknown model "${requested}". Use "provider/model-id".`;
}
