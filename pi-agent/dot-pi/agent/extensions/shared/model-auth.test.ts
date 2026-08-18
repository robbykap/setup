import assert from "node:assert/strict";
import test from "node:test";
import { checkModelCredentials, unknownModelMessage } from "./model-auth.ts";

const HAIKU = { provider: "claude-bridge", id: "haiku" };
const GPT = { provider: "openai", id: "gpt" };

function registry(authenticated: string[]) {
  return {
    hasConfiguredAuth: (m: { provider: string; id: string }) =>
      authenticated.includes(`${m.provider}/${m.id}`),
  };
}

test("a model whose provider is authenticated is usable", () => {
  const result = checkModelCredentials(
    registry(["claude-bridge/haiku"]),
    HAIKU,
  );
  assert.equal(result.ok, true);
});

test("a model without credentials is not usable", () => {
  const result = checkModelCredentials(registry([]), GPT);
  assert.equal(result.ok, false);
});

test("the message names the provider, the model, and how to fix it", () => {
  const result = checkModelCredentials(registry([]), GPT);
  const message = result.ok ? "" : result.message;
  assert.match(message, /openai/);
  assert.match(message, /openai\/gpt/);
  assert.match(message, /login/i);
});

test("a registry that cannot answer is treated as usable", () => {
  // Better to attempt the call and surface pi's own error than to block a
  // model on a registry that simply does not expose auth state.
  assert.equal(checkModelCredentials({} as never, GPT).ok, true);
});

test("a registry that throws is treated as usable rather than propagating", () => {
  const throwing = {
    hasConfiguredAuth: () => {
      throw new Error("registry unavailable");
    },
  };
  assert.equal(checkModelCredentials(throwing, GPT).ok, true);
});

test("the unknown-model message quotes the request and shows the expected form", () => {
  const message = unknownModelMessage("acme/nope");
  assert.match(message, /acme\/nope/);
  assert.match(message, /provider\/model-id/);
});
