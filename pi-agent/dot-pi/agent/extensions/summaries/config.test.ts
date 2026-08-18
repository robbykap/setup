import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_SUMMARY_CONFIG,
  isSummaryConfigured,
  parseSummaryConfig,
} from "./src/config.ts";

test("summary config defaults to unconfigured rather than naming a model", () => {
  assert.deepEqual(parseSummaryConfig(undefined), DEFAULT_SUMMARY_CONFIG);
  assert.equal(DEFAULT_SUMMARY_CONFIG.provider, "");
  assert.equal(DEFAULT_SUMMARY_CONFIG.model, "");
});

test("the default config reports itself as unconfigured", () => {
  assert.equal(isSummaryConfigured(DEFAULT_SUMMARY_CONFIG), false);
});

test("a config naming a provider and model is configured", () => {
  assert.equal(
    isSummaryConfigured({
      provider: "acme",
      model: "m1",
      reasoning: "low",
    }),
    true,
  );
});

test("summary config accepts valid private overrides and rejects partial corruption", () => {
  assert.deepEqual(
    parseSummaryConfig({
      provider: " anthropic ",
      model: " claude-sonnet ",
      reasoning: "high",
    }),
    {
      provider: "anthropic",
      model: "claude-sonnet",
      reasoning: "high",
    },
  );

  assert.deepEqual(
    parseSummaryConfig({ provider: "", model: 42, reasoning: "turbo" }),
    DEFAULT_SUMMARY_CONFIG,
  );
  assert.deepEqual(
    parseSummaryConfig({
      provider: "anthropic",
      model: 42,
      reasoning: "high",
    }),
    DEFAULT_SUMMARY_CONFIG,
  );
});
