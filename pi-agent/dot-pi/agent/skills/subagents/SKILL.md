---
name: subagents
description: invoke this skill when the user asks you to use subagents, or when a self-contained task should run in the background
---

# Subagents

Each subagent is a headless pi session with its own context window. It cannot
see the parent conversation, cannot ask the user, and cannot spawn further
subagents or workflows. Give every child a self-contained prompt with paths,
constraints, and the expected report.

## Declare intent, not a model

You do not choose the model. Pass `effort`, and the router resolves it to the
best model available on this machine using `routing.json`. This keeps the same
call working across machines with different providers configured.

| `effort`   | Use for                                                       |
| ---------- | ------------------------------------------------------------- |
| `quick`    | Lookups, mechanical edits, formatting, single-file changes      |
| `standard` | Ordinary implementation work. The default when omitted          |
| `deep`     | Planning, architecture, hard debugging, ambiguous requirements  |

Pick by the shape of the task, not by how important it feels. A large but
mechanical edit is still `quick`; a three-line change that requires figuring
out *which* three lines is `deep`.

## Declare hard requirements with `needs`

Add `needs` only when the task genuinely cannot run without it. Each entry
narrows the candidate models, and an over-constrained spawn fails outright.

| Need            | Meaning                                                  |
| --------------- | -------------------------------------------------------- |
| `long-context`  | Must read a very large amount of material in one context  |
| `vision`        | Must look at images                                       |
| `thinking`      | Must have reasoning enabled                               |

`needs: ["thinking"]` selects a model that supports reasoning; the *level*
still comes from the effort tier. `quick` + `thinking` is valid — it means
cheap model, reasoning on.

## Overriding the router

`model` takes an exact `provider/model-id` and bypasses routing entirely. Use
it only when the user names a specific model. If you find yourself reaching
for it routinely, the routing config is wrong — fix `routing.json` instead.

## Spawn and manage

Call `subagent_spawn` with a complete `prompt`, a short `name`, and `effort`.
Optionally `needs` and `working_dir`. At most four subagents run concurrently.

- `subagent_check({ id })` — peek without blocking
- `subagent_list()` — list all runs
- `subagent_wait({ ids })` — block only when you need the result to proceed
- `subagent_cancel({ ids })` — stop runs, preserving partial transcripts
- `/subagents` — inspect or take over a run interactively
- `/routing` — show what each tier resolves to here, and why

Results return automatically when a subagent settles. After spawning, continue
useful parent work instead of immediately waiting.

## Configuration

`extensions/subagents/routing.json` maps each tier to an ordered candidate list
plus a thinking level. The router walks the list in order and takes the first
model that exists here and satisfies `needs`. Entries naming models this
machine does not have are skipped, not errors — that is what makes one config
portable across machines.

If no candidate qualifies, the router falls back to the inherited parent model
when it satisfies `needs`, then to the cheapest model that does, and only then
fails with the unmet constraint named.
