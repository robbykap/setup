import assert from "node:assert/strict";
import test from "node:test";
import {
  registrySnapshot,
  validateExplicitModel,
} from "./src/registry-snapshot.ts";

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

// --- Explicit model validation ------------------------------------------------

function authRegistry(authed: string[]) {
  return {
    getAll: () => ENTIRE_CATALOG,
    getAvailable: () => AUTHENTICATED,
    find: (provider: string, id: string) =>
      ENTIRE_CATALOG.find((m) => m.provider === provider && m.id === id),
    hasConfiguredAuth: (m: { provider: string; id: string }) =>
      authed.includes(`${m.provider}/${m.id}`),
  };
}

test("an authenticated explicit model is accepted", () => {
  const result = validateExplicitModel(
    authRegistry(["claude-bridge/haiku"]),
    "claude-bridge/haiku",
  );
  assert.equal(result._tag, "Ok");
});

test("a model that does not exist is reported as unknown", () => {
  const result = validateExplicitModel(authRegistry([]), "acme/nope");
  assert.equal(result._tag, "UnknownModel");
  assert.match(result._tag === "UnknownModel" ? result.message : "", /unknown/i);
});

test("a real model without credentials is refused before spawning", () => {
  const result = validateExplicitModel(authRegistry([]), "openai/gpt");
  assert.equal(result._tag, "NoCredentials");
});

test("the no-credentials message names the provider and how to fix it", () => {
  const result = validateExplicitModel(authRegistry([]), "openai/gpt");
  const message = result._tag === "NoCredentials" ? result.message : "";
  assert.match(message, /openai/);
  assert.match(message, /login/i);
});

test("the two failures are distinguishable, not one generic error", () => {
  const unknown = validateExplicitModel(authRegistry([]), "acme/nope");
  const unauthed = validateExplicitModel(authRegistry([]), "openai/gpt");
  assert.notEqual(unknown._tag, unauthed._tag);
});

test("a bare model id resolves when exactly one provider offers it", () => {
  const result = validateExplicitModel(
    authRegistry(["openai/gpt"]),
    "gpt",
  );
  assert.equal(result._tag, "Ok");
});

test("validation is skipped gracefully when the registry cannot answer", () => {
  const result = validateExplicitModel({} as never, "openai/gpt");
  assert.equal(result._tag, "Ok");
});
