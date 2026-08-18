import assert from "node:assert/strict";
import test from "node:test";
import {
  copyRegisteredProviders,
  type ProviderSink,
  type ProviderSource,
} from "./child-providers.ts";

function makeSource(
  entries: Record<string, { native?: unknown; config?: unknown }>,
): ProviderSource {
  return {
    getRegisteredProviderIds: () => Object.keys(entries),
    getRegisteredNativeProvider: (id) => entries[id]?.native as never,
    getRegisteredProviderConfig: (id) => entries[id]?.config as never,
  };
}

function makeSink(existing: string[] = []) {
  const registered: Array<{ name?: string; value: unknown }> = [];
  const ids = [...existing];
  const sink: ProviderSink = {
    getRegisteredProviderIds: () => ids,
    registerProvider: (a: unknown, b?: unknown) => {
      if (typeof a === "string") registered.push({ name: a, value: b });
      else registered.push({ value: a });
    },
  } as ProviderSink;
  return { sink, registered };
}

test("copies a config-registered provider to the child", () => {
  const source = makeSource({ "claude-bridge": { config: { api: "x" } } });
  const { sink, registered } = makeSink();

  const copied = copyRegisteredProviders(source, sink);

  assert.deepEqual(copied, ["claude-bridge"]);
  assert.deepEqual(registered, [
    { name: "claude-bridge", value: { api: "x" } },
  ]);
});

test("prefers the native provider object when one is registered", () => {
  const native = { id: "copilot", models: [] };
  const source = makeSource({ copilot: { native, config: { api: "ignored" } } });
  const { sink, registered } = makeSink();

  const copied = copyRegisteredProviders(source, sink);

  assert.deepEqual(copied, ["copilot"]);
  assert.deepEqual(registered, [{ value: native }]);
});

test("skips providers the child already has", () => {
  const source = makeSource({ "claude-bridge": { config: { api: "x" } } });
  const { sink, registered } = makeSink(["claude-bridge"]);

  const copied = copyRegisteredProviders(source, sink);

  assert.deepEqual(copied, []);
  assert.deepEqual(registered, []);
});

test("skips an id that has neither a native provider nor a config", () => {
  const source = makeSource({ ghost: {} });
  const { sink, registered } = makeSink();

  const copied = copyRegisteredProviders(source, sink);

  assert.deepEqual(copied, []);
  assert.deepEqual(registered, []);
});

test("copies every provider, not just the first", () => {
  const source = makeSource({
    "claude-bridge": { config: { api: "a" } },
    copilot: { config: { api: "b" } },
  });
  const { sink, registered } = makeSink();

  const copied = copyRegisteredProviders(source, sink);

  assert.deepEqual(copied, ["claude-bridge", "copilot"]);
  assert.equal(registered.length, 2);
});

test("one failing registration does not prevent the others", () => {
  const source = makeSource({
    broken: { config: { api: "a" } },
    good: { config: { api: "b" } },
  });
  const registered: string[] = [];
  const sink = {
    getRegisteredProviderIds: () => [],
    registerProvider: (name: unknown) => {
      if (name === "broken") throw new Error("registration exploded");
      registered.push(name as string);
    },
  } as unknown as ProviderSink;

  const copied = copyRegisteredProviders(source, sink);

  assert.deepEqual(copied, ["good"]);
  assert.deepEqual(registered, ["good"]);
});

test("a source that throws while listing yields no copies", () => {
  const source = {
    getRegisteredProviderIds: () => {
      throw new Error("registry unavailable");
    },
  } as unknown as ProviderSource;
  const { sink, registered } = makeSink();

  const copied = copyRegisteredProviders(source, sink);

  assert.deepEqual(copied, []);
  assert.deepEqual(registered, []);
});
