import assert from "node:assert/strict";
import test from "node:test";
import {
  buildModelChoices,
  formatModelLabel,
  formatPrice,
  type ChoiceModel,
} from "./model-choices.ts";

function model(over: Partial<ChoiceModel> & Pick<ChoiceModel, "id">) {
  return {
    provider: "test",
    name: over.id,
    contextWindow: 200_000,
    reasoning: true,
    input: ["text"],
    cost: { input: 3 },
    ...over,
  } as ChoiceModel;
}

test("choices are sorted by provider then price, cheapest first", () => {
  const choices = buildModelChoices(
    [
      model({ id: "b", provider: "zed", cost: { input: 1 } }),
      model({ id: "expensive", cost: { input: 30 } }),
      model({ id: "cheap", cost: { input: 1 } }),
    ],
    {},
  );
  assert.deepEqual(
    choices.map((c) => c.value),
    ["test/cheap", "test/expensive", "zed/b"],
  );
});

test("value is always the fully qualified provider/model-id", () => {
  const [choice] = buildModelChoices([model({ id: "x", provider: "acme" })], {});
  assert.equal(choice.value, "acme/x");
});

test("the label carries the details needed to choose", () => {
  const [choice] = buildModelChoices(
    [
      model({
        id: "opus",
        provider: "acme",
        contextWindow: 1_000_000,
        cost: { input: 15 },
      }),
    ],
    {},
  );
  assert.match(choice.label, /acme\/opus/);
  assert.match(choice.label, /1M/);
  assert.match(choice.label, /\$15/);
});

test("requiring long context drops models under the threshold", () => {
  const choices = buildModelChoices(
    [
      model({ id: "small", contextWindow: 200_000 }),
      model({ id: "big", contextWindow: 1_000_000 }),
    ],
    { needs: ["long-context"], longContextThreshold: 500_000 },
  );
  assert.deepEqual(
    choices.map((c) => c.value),
    ["test/big"],
  );
});

test("requiring vision drops models without image input", () => {
  const choices = buildModelChoices(
    [
      model({ id: "blind", input: ["text"] }),
      model({ id: "seeing", input: ["text", "image"] }),
    ],
    { needs: ["vision"] },
  );
  assert.deepEqual(
    choices.map((c) => c.value),
    ["test/seeing"],
  );
});

test("requiring thinking drops models without reasoning", () => {
  const choices = buildModelChoices(
    [
      model({ id: "plain", reasoning: false }),
      model({ id: "thinker", reasoning: true }),
    ],
    { needs: ["thinking"] },
  );
  assert.deepEqual(
    choices.map((c) => c.value),
    ["test/thinker"],
  );
});

test("already-selected models are marked so they can be shown as such", () => {
  const choices = buildModelChoices(
    [model({ id: "a" }), model({ id: "b" })],
    { selected: ["test/b"] },
  );
  assert.equal(choices.find((c) => c.value === "test/b")?.selected, true);
  assert.equal(choices.find((c) => c.value === "test/a")?.selected, false);
});

test("an empty registry yields no choices rather than throwing", () => {
  assert.deepEqual(buildModelChoices([], {}), []);
});

test("context windows render in human units", () => {
  const [small] = buildModelChoices([model({ id: "s", contextWindow: 200_000 })], {});
  assert.match(small.label, /200K/);
});

test("free models say free instead of $0", () => {
  assert.equal(formatPrice(0), "free");
  assert.equal(formatPrice(3), "$3/M");
  assert.equal(formatPrice(0.25), "$0.25/M");
});

test("a model label survives a missing display name", () => {
  const label = formatModelLabel(
    model({ id: "x", provider: "p", name: undefined as never }),
  );
  assert.match(label, /p\/x/);
});
