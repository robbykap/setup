import assert from "node:assert/strict";
import test from "node:test";
import { registrySnapshot } from "./src/registry-snapshot.ts";

const AUTHENTICATED = [
  { provider: "claude-bridge", id: "haiku" },
  { provider: "claude-bridge", id: "opus" },
];
const ENTIRE_CATALOG = [
  ...AUTHENTICATED,
  { provider: "openai", id: "gpt" },
  { provider: "google", id: "gemini" },
];

function registry(over: Partial<Record<"getAll" | "getAvailable", unknown>> = {}) {
  return {
    getAll: () => ENTIRE_CATALOG,
    getAvailable: () => AUTHENTICATED,
    ...over,
  };
}

test("only models from authenticated providers are returned", () => {
  const models = registrySnapshot({ modelRegistry: registry() });
  assert.deepEqual(
    models.map((m) => `${m.provider}/${m.id}`),
    ["claude-bridge/haiku", "claude-bridge/opus"],
  );
});

test("the full catalog is never used, however large it is", () => {
  const models = registrySnapshot({ modelRegistry: registry() });
  assert.equal(
    models.some((m) => m.provider === "openai" || m.provider === "google"),
    false,
  );
});

test("a missing registry yields no models rather than throwing", () => {
  assert.deepEqual(registrySnapshot({}), []);
  assert.deepEqual(registrySnapshot({ modelRegistry: undefined }), []);
});

test("a registry without getAvailable falls back to an empty list", () => {
  const models = registrySnapshot({
    modelRegistry: { getAll: () => ENTIRE_CATALOG } as never,
  });
  assert.deepEqual(models, []);
});

test("a registry that throws yields no models rather than propagating", () => {
  const models = registrySnapshot({
    modelRegistry: registry({
      getAvailable: () => {
        throw new Error("registry unavailable");
      },
    }) as never,
  });
  assert.deepEqual(models, []);
});

test("the returned array is a copy, not the registry's own", () => {
  const source = registry();
  const models = registrySnapshot({ modelRegistry: source });
  models.pop();
  assert.equal(AUTHENTICATED.length, 2);
});
