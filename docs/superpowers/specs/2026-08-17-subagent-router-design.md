# Subagent Router — Design

Date: 2026-08-17
Status: approved, pending implementation plan

## Purpose

Replace multi-harness subagents with a single pi-native subagent extension whose
model selection is provider-agnostic. The caller declares *intent*; the router
resolves intent to a concrete model against whatever providers the machine has.

Quick work should land on a cheap fast model, planning on a frontier model, and
the same configuration should work on a machine with OpenAI or Gemini providers
without code changes.

## Origin and scope

Forked from `github.com/davis7dotsh/my-pi-setup` at commit `73bf4d8`, then
stripped. This is a private fork, not a tracked upstream dependency.

Deleted:

- `src/backends/claude.ts` (701 lines)
- `src/backends/codex.ts` (1060 lines)
- `src/backends/stub.ts` (300 lines)
- the multi-harness abstraction in `src/backend.ts`
- `claude.test.ts`, `codex.test.ts`

Kept: `manager.ts`, `domain.ts`, `index.ts`, `backends/pi.ts`, `ui/takeover.ts`,
`ui/transcript.ts`, and the remaining tests.

Added: `src/router.ts`, `routing.json`, `/routing` command.

The CLI backends are removed because they can only run their own vendor's
models, which makes provider-agnostic routing impossible by construction.

## Security posture

Removing the CLI backends *is* the security fix. `permissionMode:
"bypassPermissions"` (`claude.ts:333`), `approvalPolicy: "never"` and
`sandbox: "danger-full-access"` (`codex.ts:894-895`) existed only there.

What remains:

- children are in-process `AgentSession`s under pi's own permission model
- the child tool denylist stays: `subagent_spawn`, `subagent_wait`,
  `subagent_cancel`, `subagent_check`, `subagent_list`, `workflow`, `ask_user`
- `resolveStandaloneChildProjectTrust` keeps fail-closed trust gating for
  alternate working directories
- no child inherits `process.env` wholesale

## Tool surface

```
subagent_spawn({ prompt, name, effort?, needs?, model?, working_dir? })
```

| Field    | Type                                              | Default      |
| -------- | ------------------------------------------------- | ------------ |
| `effort` | `quick` \| `standard` \| `deep`                     | `standard`   |
| `needs`  | array of `long-context` \| `vision` \| `thinking`   | `[]`         |
| `model`  | exact `provider/model-id`; bypasses the router     | unset        |

`subagent_check`, `subagent_list`, `subagent_wait`, `subagent_cancel`, and the
`/subagents` view are unchanged. Concurrency limit stays at 4.

`/routing` prints the routing table and what each effort tier resolves to on the
current machine, so a misroute is diagnosable without reading code.

## Router

A pure function — `(registry snapshot, effort, needs) -> Decision` — with no
I/O, so it is fully testable against fabricated registries.

Resolution order:

1. Candidates are `tiers[effort].models`, in listed order.
2. Skip any candidate absent from the registry (`registry.find`).
3. Validate each survivor against `needs` using real registry metadata:
   - `long-context` -> `contextWindow >= longContextThreshold`
   - `vision` -> `input.includes("image")`
   - `thinking` -> `reasoning === true` and `thinkingLevelMap[level] !== null`
4. First survivor wins.
5. Fallback, in order: the inherited parent model if it satisfies `needs`;
   otherwise the cheapest registry model satisfying `needs`, ranked by
   `cost.input`; otherwise fail, naming the unmet constraint.

Selection produces a model hint that feeds the existing
`resolvePiModel(registry, hint, inherited)` at `backends/pi.ts:63`. Everything
downstream of that call is untouched.

### Why a curated list plus metadata validation

Registry metadata (`contextWindow`, `maxTokens`, `reasoning`,
`thinkingLevelMap`, `input`, `cost`) can verify hard constraints but cannot
express which model is *smarter*. The ordered list encodes that judgment; the
metadata check catches stale or wrong entries and degrades to the next
candidate instead of failing mid-run.

## Configuration

`routing.json`, editable without touching code. Thinking level is per tier and
user-controlled.

```json
{
  "tiers": {
    "quick": {
      "models": [
        "claude-bridge/claude-haiku-4-5",
        "claude-bridge/claude-sonnet-4-6"
      ],
      "thinking": "low"
    },
    "standard": {
      "models": [
        "claude-bridge/claude-sonnet-5",
        "claude-bridge/claude-opus-4-8"
      ],
      "thinking": "medium"
    },
    "deep": {
      "models": [
        "claude-bridge/claude-opus-5",
        "claude-bridge/claude-fable-5"
      ],
      "thinking": "high"
    }
  },
  "longContextThreshold": 500000
}
```

Defaults reflect the only provider currently configured (`claude-bridge`).
Adding `openai-codex/gpt-5.6-sol` or a Gemini model on another machine is a
one-line edit. Unknown entries are skipped rather than erroring, so a single
config file works across machines with different providers.

### Interaction between `needs: ["thinking"]` and tier thinking level

`needs: ["thinking"]` filters *candidates* by capability. The *level* comes from
the tier config. If a tier's configured level is `off` and a caller passes
`needs: ["thinking"]`, the level is raised to `low` for that spawn; the tier
config is not mutated. This keeps `effort: quick` + `needs: ["thinking"]` a
valid combination rather than a rejected contradiction.

## Error handling

- An unresolvable route fails at spawn time, naming the constraint that could
  not be met. It never fails mid-run.
- An explicit `model` that does not exist errors immediately, preserving
  existing `resolvePiModel` behavior.
- Configured models absent from the registry are skipped silently. This is the
  cross-machine portability property, not an error.
- A malformed or unreadable `routing.json` falls back to built-in defaults and
  surfaces one notification, rather than disabling subagents.

## Testing

Table-driven tests over fabricated registries:

- each effort tier resolves to its first listed model
- each `need` filters correctly: `long-context`, `vision`, `thinking`
- a listed model absent from the registry is skipped
- an empty tier falls through to fallback
- no candidate satisfies `needs` -> inherited parent model when eligible
- no eligible inherited model -> cheapest by `cost.input`
- nothing satisfies -> error naming the constraint
- explicit `model` bypasses the router entirely
- `effort: quick` + `needs: ["thinking"]` raises the level to `low`
- malformed `routing.json` falls back to defaults

`manager.test.ts`, `result-delivery.test.ts`, `takeover.test.ts`,
`by-the-way.test.ts`, and `context-usage.test.ts` carry over unchanged.

## Skill rewrite

`skills/subagents/SKILL.md` is rewritten. The original documents three harnesses
and hardcodes vendor model names and thinking-budget tables. The replacement
documents `effort` and `needs`, and states that concrete model choice belongs to
the router and its config — not to the calling model.
