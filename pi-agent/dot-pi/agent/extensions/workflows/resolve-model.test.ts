import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgentModel } from "./resolve-model.ts";

const CATALOG = [
  { provider: "claude-bridge", id: "haiku" },
  { provider: "claude-bridge", id: "opus" },
  { provider: "openai", id: "gpt" },
  { provider: "google", id: "gpt" },
];

function registry(authenticated: string[]) {
  return {
    find: (provider: string, id: string) =>
      CATALOG.find((m) => m.provider === provider && m.id === id),
    getAll: () => CATALOG,
    hasConfiguredAuth: (m: { provider: string; id: string }) =>
      authenticated.includes(`${m.provider}/${m.id}`),
  };
}

const AUTHED = registry(["claude-bridge/haiku", "claude-bridge/opus"]);

test("separate provider and model options resolve to that model", () => {
  const result = resolveAgentModel(AUTHED, {
    provider: "claude-bridge",
    model: "haiku",
  });
  assert.equal(result._tag, "Resolved");
  assert.equal(result._tag === "Resolved" && result.model.id, "haiku");
});

test("a qualified provider/model-id string resolves", () => {
  const result = resolveAgentModel(AUTHED, { model: "claude-bridge/opus" });
  assert.equal(result._tag === "Resolved" && result.model.id, "opus");
});

test("a bare model id resolves when exactly one provider offers it", () => {
  const result = resolveAgentModel(AUTHED, { model: "haiku" });
  assert.equal(result._tag === "Resolved" && result.model.provider, "claude-bridge");
});

test("a bare id offered by several providers is ambiguous, not arbitrary", () => {
  const result = resolveAgentModel(registry(["openai/gpt", "google/gpt"]), {
    model: "gpt",
  });
  assert.equal(result._tag, "Failed");
  assert.match(result._tag === "Failed" ? result.message : "", /ambiguous/i);
});

test("a provider without a model is rejected", () => {
  const result = resolveAgentModel(AUTHED, { provider: "claude-bridge" });
  assert.equal(result._tag, "Failed");
  assert.match(result._tag === "Failed" ? result.message : "", /requires/i);
});

test("a name matching no model reports it as unknown", () => {
  const result = resolveAgentModel(AUTHED, { model: "acme/nope" });
  assert.equal(result._tag, "Failed");
  assert.match(result._tag === "Failed" ? result.message : "", /unknown/i);
});

test("a real model without credentials is refused before the agent runs", () => {
  const result = resolveAgentModel(AUTHED, { model: "openai/gpt" });
  assert.equal(result._tag, "Failed");
  assert.match(result._tag === "Failed" ? result.message : "", /credentials/i);
});

test("the credentials refusal is distinguishable from the unknown-model one", () => {
  const unknown = resolveAgentModel(AUTHED, { model: "acme/nope" });
  const unauthed = resolveAgentModel(AUTHED, { model: "openai/gpt" });
  assert.notEqual(
    unknown._tag === "Failed" && unknown.message,
    unauthed._tag === "Failed" && unauthed.message,
  );
});

test("omitting both options inherits, resolving nothing", () => {
  const result = resolveAgentModel(AUTHED, {});
  assert.equal(result._tag, "Inherit");
});

test("non-string options are treated as absent rather than coerced", () => {
  const result = resolveAgentModel(AUTHED, { model: 42 as never });
  assert.equal(result._tag, "Failed");
});
