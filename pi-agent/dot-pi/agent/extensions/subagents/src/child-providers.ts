/**
 * Carry extension-registered providers from the parent session into a child.
 *
 * Subagents run in-process, so `globalThis` is shared with the parent. A
 * provider extension that guards against double-registration (claude-bridge
 * does this at `src/index.ts:2060`) therefore sees its own guard already set
 * when it loads in the child and skips registering — on the assumption that
 * the child shares the parent's registry.
 *
 * It does not. `createAgentSession` builds a fresh `ModelRuntime` from
 * `auth.json` whenever `modelRuntime` is not supplied, so the child's registry
 * has no extension providers at all and any model from one fails with
 * "No API key found for <provider>".
 *
 * Copying the parent's registrations across closes that gap using only public
 * `ModelRegistry` API, and it is provider-agnostic: whatever the parent has
 * registered (claude-bridge, Copilot, anything future) comes along.
 */

/** The parent-side reads. Structurally satisfied by `ModelRegistry`. */
export interface ProviderSource {
  getRegisteredProviderIds(): readonly string[];
  getRegisteredNativeProvider(id: string): unknown;
  getRegisteredProviderConfig(id: string): unknown;
}

/** The child-side writes. Structurally satisfied by `ModelRegistry`. */
export interface ProviderSink {
  getRegisteredProviderIds(): readonly string[];
  registerProvider(provider: unknown): void;
  registerProvider(name: string, config: unknown): void;
}

/**
 * Register every parent provider the child is missing. Returns the ids copied.
 *
 * Best-effort by design: this runs on the spawn path, where losing one
 * provider should not take down the whole subagent. A provider that fails to
 * register is skipped and the rest still land.
 */
export function copyRegisteredProviders(
  from: ProviderSource,
  to: ProviderSink,
): string[] {
  let ids: readonly string[];
  let existing: ReadonlySet<string>;
  try {
    ids = from.getRegisteredProviderIds();
    existing = new Set(to.getRegisteredProviderIds());
  } catch {
    return [];
  }

  const copied: string[] = [];
  for (const id of ids) {
    if (existing.has(id)) continue;
    try {
      const native = from.getRegisteredNativeProvider(id);
      if (native) {
        to.registerProvider(native);
        copied.push(id);
        continue;
      }
      const config = from.getRegisteredProviderConfig(id);
      if (!config) continue;
      to.registerProvider(id, config);
      copied.push(id);
    } catch {
      // Skip this provider; the remaining ones are still worth copying.
    }
  }
  return copied;
}
