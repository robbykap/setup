import assert from "node:assert/strict";
import test from "node:test";
import {
  DONE_LABEL,
  buildTierMenu,
  describeTier,
  parseTierChoice,
} from "./src/routing-ui.ts";
import type { ModelLike, RoutingConfig } from "./src/router.ts";

const CONFIG: RoutingConfig = {
  tiers: {
    quick: { models: ["test/cheap"], thinking: "low" },
    standard: { models: [], thinking: "medium" },
    deep: { models: ["test/gone", "test/big"], thinking: "high" },
  },
  longContextThreshold: 500_000,
};

const REGISTRY: ModelLike[] = [
  {
    provider: "test",
    id: "cheap",
    contextWindow: 200_000,
    reasoning: true,
    input: ["text"],
    cost: { input: 1 },
  },
  {
    provider: "test",
    id: "big",
    contextWindow: 1_000_000,
    reasoning: true,
    input: ["text"],
    cost: { input: 20 },
  },
];

test("a configured tier shows what it resolves to and its thinking level", () => {
  const line = describeTier("quick", CONFIG, REGISTRY);
  assert.match(line, /quick/);
  assert.match(line, /test\/cheap/);
  assert.match(line, /low/);
});

test("an unconfigured tier says so instead of showing a model", () => {
  const line = describeTier("standard", CONFIG, REGISTRY);
  assert.match(line, /not configured/i);
});

test("a tier whose first candidate is missing shows the one that wins", () => {
  const line = describeTier("deep", CONFIG, REGISTRY);
  assert.match(line, /test\/big/);
});

test("the tier menu lists every effort plus a way out", () => {
  const menu = buildTierMenu(CONFIG, REGISTRY);
  assert.equal(menu.length, 4);
  assert.equal(menu.at(-1), DONE_LABEL);
  assert.match(menu[0], /^quick/);
  assert.match(menu[1], /^standard/);
  assert.match(menu[2], /^deep/);
});

test("a chosen menu line maps back to its effort", () => {
  const menu = buildTierMenu(CONFIG, REGISTRY);
  assert.equal(parseTierChoice(menu[0]), "quick");
  assert.equal(parseTierChoice(menu[2]), "deep");
});

test("the exit line maps to no effort", () => {
  assert.equal(parseTierChoice(DONE_LABEL), undefined);
});

test("an unrecognized line maps to no effort rather than throwing", () => {
  assert.equal(parseTierChoice("nonsense"), undefined);
});
