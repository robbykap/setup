/**
 * Scratch file for eyeballing syntax highlighting inside a diff.
 * Safe to delete. Nothing imports this.
 */

import { readFileSync } from "node:fs";

export interface RouteConfig {
  readonly name: string;
  readonly retries: number;
  readonly timeoutMs: number;
  readonly tags: ReadonlyArray<string>;
}

const DEFAULT_TIMEOUT = 45_000;
const RETRY_LIMIT = 5;

/** A comment, so the comment colour has something to paint. */
export function loadConfig(path: string): RouteConfig {
  const raw = readFileSync(path, "utf8");
  const parsed = JSON.parse(raw) as Partial<RouteConfig>;
  return {
    name: parsed.name ?? "anonymous",
    retries: parsed.retries ?? RETRY_LIMIT,
    timeoutMs: parsed.timeoutMs ?? DEFAULT_TIMEOUT,
    tags: parsed.tags ?? [],
  };
}

export async function dispatch(config: RouteConfig, payload: string) {
  for (let attempt = 0; attempt < config.retries; attempt += 1) {
    const started = Date.now();
    try {
      return await send(payload, config.timeoutMs);
    } catch (error) {
      if (attempt >= config.retries - 1) throw error;
      console.debug(`retry ${attempt} after ${Date.now() - started}ms`);
    }
  }
  return null;
}

declare function send(payload: string, timeoutMs: number): Promise<string>;
