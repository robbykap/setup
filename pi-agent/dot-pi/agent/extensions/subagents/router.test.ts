import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DEFAULT_ROUTING_CONFIG,
  loadRoutingConfig,
  parseRoutingConfig,
  ROUTING_CONFIG_FILENAME,
  routeModel,
  saveRoutingConfig,
  serializeRoutingConfig,
  setTierModels,
  setTierThinking,
  type ModelLike,
  type RoutingConfig,
} from "./src/router.ts";

function model(overrides: Partial<ModelLike> & Pick<ModelLike, "id">): ModelLike {
  return {
    provider: "test",
    contextWindow: 200_000,
    reasoning: true,
    input: ["text"],
    cost: { input: 1 },
    ...overrides,
  };
}

const CONFIG: RoutingConfig = {
  tiers: {
    quick: { models: ["test/cheap"], thinking: "low" },
    standard: { models: ["test/mid"], thinking: "medium" },
    deep: { models: ["test/big"], thinking: "high" },
  },
  longContextThreshold: 500_000,
};

const REGISTRY: ModelLike[] = [
  model({ id: "cheap", cost: { input: 1 } }),
  model({ id: "mid", cost: { input: 5 } }),
  model({ id: "big", cost: { input: 20 }, contextWindow: 1_000_000 }),
];

test("each effort tier resolves to its first listed model", () => {
  for (const [effort, expected] of [
    ["quick", "test/cheap"],
    ["standard", "test/mid"],
    ["deep", "test/big"],
  ] as const) {
    const decision = routeModel(REGISTRY, CONFIG, { effort });
    assert.equal(decision._tag, "Routed");
    assert.equal(decision._tag === "Routed" && decision.model, expected);
  }
});

test("effort defaults to standard when omitted", () => {
  const decision = routeModel(REGISTRY, CONFIG, {});
  assert.equal(decision._tag === "Routed" && decision.model, "test/mid");
});

test("tier thinking level comes from config", () => {
  const decision = routeModel(REGISTRY, CONFIG, { effort: "deep" });
  assert.equal(decision._tag === "Routed" && decision.thinking, "high");
});

test("long-context skips models under the threshold", () => {
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: {
      ...CONFIG.tiers,
      quick: { models: ["test/cheap", "test/big"], thinking: "low" },
    },
  };
  const decision = routeModel(REGISTRY, config, {
    effort: "quick",
    needs: ["long-context"],
  });
  assert.equal(decision._tag === "Routed" && decision.model, "test/big");
});

test("vision skips models without image input", () => {
  const registry = [
    model({ id: "textonly", input: ["text"] }),
    model({ id: "seeing", input: ["text", "image"], cost: { input: 9 } }),
  ];
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: {
      ...CONFIG.tiers,
      quick: { models: ["test/textonly", "test/seeing"], thinking: "low" },
    },
  };
  const decision = routeModel(registry, config, {
    effort: "quick",
    needs: ["vision"],
  });
  assert.equal(decision._tag === "Routed" && decision.model, "test/seeing");
});

test("thinking skips models without reasoning support", () => {
  const registry = [
    model({ id: "dumb", reasoning: false }),
    model({ id: "smart", reasoning: true, cost: { input: 9 } }),
  ];
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: {
      ...CONFIG.tiers,
      quick: { models: ["test/dumb", "test/smart"], thinking: "low" },
    },
  };
  const decision = routeModel(registry, config, {
    effort: "quick",
    needs: ["thinking"],
  });
  assert.equal(decision._tag === "Routed" && decision.model, "test/smart");
});

test("thinking skips models that map the requested level to null", () => {
  const registry = [
    model({ id: "nolow", thinkingLevelMap: { low: null } }),
    model({ id: "haslow", cost: { input: 9 } }),
  ];
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: {
      ...CONFIG.tiers,
      quick: { models: ["test/nolow", "test/haslow"], thinking: "low" },
    },
  };
  const decision = routeModel(registry, config, {
    effort: "quick",
    needs: ["thinking"],
  });
  assert.equal(decision._tag === "Routed" && decision.model, "test/haslow");
});

test("a configured model absent from the registry is skipped", () => {
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: {
      ...CONFIG.tiers,
      quick: { models: ["openai/not-installed", "test/cheap"], thinking: "low" },
    },
  };
  const decision = routeModel(REGISTRY, config, { effort: "quick" });
  assert.equal(decision._tag === "Routed" && decision.model, "test/cheap");
});

test("a bare model id matches when unambiguous", () => {
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: { ...CONFIG.tiers, quick: { models: ["cheap"], thinking: "low" } },
  };
  const decision = routeModel(REGISTRY, config, { effort: "quick" });
  assert.equal(decision._tag === "Routed" && decision.model, "test/cheap");
});

test("an unconfigured tier refuses instead of guessing a model", () => {
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: { ...CONFIG.tiers, quick: { models: [], thinking: "low" } },
  };
  const decision = routeModel(REGISTRY, config, {
    effort: "quick",
    inherited: { provider: "test", id: "mid" },
  });
  assert.equal(decision._tag, "Unroutable");
  assert.match(
    decision._tag === "Unroutable" ? decision.message : "",
    /not configured/,
  );
});

test("the refusal names the command that fixes it", () => {
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: { ...CONFIG.tiers, deep: { models: [], thinking: "high" } },
  };
  const decision = routeModel(REGISTRY, config, { effort: "deep" });
  assert.match(
    decision._tag === "Unroutable" ? decision.message : "",
    /\/routing/,
  );
});

test("a configured tier whose candidates fail needs falls back to inherited", () => {
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: { ...CONFIG.tiers, quick: { models: ["test/cheap"], thinking: "low" } },
  };
  const decision = routeModel(REGISTRY, config, {
    effort: "quick",
    needs: ["long-context"],
    inherited: { provider: "test", id: "big" },
  });
  assert.equal(decision._tag === "Routed" && decision.model, "test/big");
  assert.equal(decision._tag === "Routed" && decision.reason, "inherited");
});

test("a configured tier falls back to cheapest eligible with nothing to inherit", () => {
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: { ...CONFIG.tiers, quick: { models: ["test/cheap"], thinking: "low" } },
  };
  const decision = routeModel(REGISTRY, config, {
    effort: "quick",
    needs: ["long-context"],
  });
  assert.equal(decision._tag === "Routed" && decision.model, "test/big");
  assert.equal(decision._tag === "Routed" && decision.reason, "cheapest");
});

test("unroutable when no model satisfies needs, naming the constraint", () => {
  const registry = [model({ id: "cheap", input: ["text"] })];
  const decision = routeModel(registry, CONFIG, {
    effort: "quick",
    needs: ["vision"],
  });
  assert.equal(decision._tag, "Unroutable");
  assert.match(
    decision._tag === "Unroutable" ? decision.message : "",
    /vision/,
  );
});

test("quick plus needs thinking raises an off tier to low", () => {
  const config: RoutingConfig = {
    ...CONFIG,
    tiers: { ...CONFIG.tiers, quick: { models: ["test/cheap"], thinking: "off" } },
  };
  const decision = routeModel(REGISTRY, config, {
    effort: "quick",
    needs: ["thinking"],
  });
  assert.equal(decision._tag === "Routed" && decision.model, "test/cheap");
  assert.equal(decision._tag === "Routed" && decision.thinking, "low");
});

test("needs thinking leaves a non-off tier level alone", () => {
  const decision = routeModel(REGISTRY, CONFIG, {
    effort: "deep",
    needs: ["thinking"],
  });
  assert.equal(decision._tag === "Routed" && decision.thinking, "high");
});

test("parseRoutingConfig returns defaults for malformed input", () => {
  for (const bad of ["not json", "[]", '{"tiers":null}', "null"]) {
    assert.deepEqual(parseRoutingConfig(bad), DEFAULT_ROUTING_CONFIG);
  }
});

test("parseRoutingConfig keeps valid tiers and fills missing ones", () => {
  const parsed = parseRoutingConfig(
    JSON.stringify({ tiers: { quick: { models: ["a/b"], thinking: "off" } } }),
  );
  assert.deepEqual(parsed.tiers.quick, { models: ["a/b"], thinking: "off" });
  assert.deepEqual(parsed.tiers.deep, DEFAULT_ROUTING_CONFIG.tiers.deep);
  assert.equal(
    parsed.longContextThreshold,
    DEFAULT_ROUTING_CONFIG.longContextThreshold,
  );
});

test("the built-in default names no models, so a fresh machine must configure", () => {
  for (const effort of ["quick", "standard", "deep"] as const) {
    assert.deepEqual(DEFAULT_ROUTING_CONFIG.tiers[effort].models, []);
  }
});

test("serializeRoutingConfig round-trips through parseRoutingConfig", () => {
  const parsed = parseRoutingConfig(serializeRoutingConfig(CONFIG));
  assert.deepEqual(parsed, CONFIG);
});

test("setTierModels replaces one tier and leaves the others alone", () => {
  const next = setTierModels(CONFIG, "quick", ["x/y", "z/w"]);
  assert.deepEqual(next.tiers.quick.models, ["x/y", "z/w"]);
  assert.equal(next.tiers.quick.thinking, CONFIG.tiers.quick.thinking);
  assert.deepEqual(next.tiers.deep, CONFIG.tiers.deep);
});

test("setTierThinking replaces one tier's level and leaves models alone", () => {
  const next = setTierThinking(CONFIG, "deep", "max");
  assert.equal(next.tiers.deep.thinking, "max");
  assert.deepEqual(next.tiers.deep.models, CONFIG.tiers.deep.models);
  assert.equal(next.tiers.quick.thinking, CONFIG.tiers.quick.thinking);
});

test("parseRoutingConfig rejects a tier with a non-string model entry", () => {
  const parsed = parseRoutingConfig(
    JSON.stringify({ tiers: { quick: { models: [3], thinking: "low" } } }),
  );
  assert.deepEqual(parsed.tiers.quick, DEFAULT_ROUTING_CONFIG.tiers.quick);
});

test("loadRoutingConfig reads the machine-local config from the extension directory", () => {
  const dir = mkdtempSync(join(tmpdir(), "routing-"));
  writeFileSync(
    join(dir, ROUTING_CONFIG_FILENAME),
    JSON.stringify({ tiers: { deep: { models: ["x/y"], thinking: "max" } } }),
  );
  const config = loadRoutingConfig(dir);
  assert.deepEqual(config.tiers.deep, { models: ["x/y"], thinking: "max" });
});

test("saveRoutingConfig writes a file loadRoutingConfig can read back", () => {
  const dir = mkdtempSync(join(tmpdir(), "routing-"));
  saveRoutingConfig(dir, CONFIG);
  assert.deepEqual(loadRoutingConfig(dir), CONFIG);
});

test("loadRoutingConfig falls back to defaults when the file is missing", () => {
  const dir = mkdtempSync(join(tmpdir(), "routing-"));
  assert.deepEqual(loadRoutingConfig(dir), DEFAULT_ROUTING_CONFIG);
});
