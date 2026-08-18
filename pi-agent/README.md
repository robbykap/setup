# pi-agent

`dot-pi/agent/*` → `~/.pi/agent/`

Extensions, skills, and settings for [pi](https://github.com/badlogic/pi-mono).
Provenance and audit notes for the vendored extensions are in `VENDOR.md`.

## Install

```sh
cp -R dot-pi/agent/. ~/.pi/agent/
cd ~/.pi/agent && npm install --ignore-scripts
```

`--ignore-scripts` skips each extension's `prepare: "effect-tsgo patch"` hook.
Drop the flag if you want it to run.

Secrets (`auth.json`, `models-store.json`) and generated state (`node_modules/`,
`bin/`, `sessions/`) are intentionally not tracked.

## Extensions

| Extension              | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `file-search`          | `fd` and `rg` as first-class model tools                    |
| `background-terminals` | Long-lived shell commands with a `/ps` view                 |
| `subagents`            | Background subagents with intent-based model routing        |
| `ask-user`             | Lets the model ask multiple-choice questions                |
| `git-info`             | Branch and changed-file status in the bottom bar            |
| `model-info`           | Model, context use, and cost in the bottom bar              |
| `ui-customization`     | Bottom bar layout                                           |
| `copy-all`             | Copy the whole conversation                                 |

## Subagent routing

`subagent_spawn` takes an intent (`effort`: `quick` / `standard` / `deep`,
plus optional `needs`) rather than a model name. `extensions/subagents/routing.json`
maps each tier to an ordered candidate list; the router picks the first model
that exists on this machine and satisfies the declared needs.

Adding a provider is a one-line edit to that file. Candidates naming models a
machine does not have are skipped rather than erroring, so one config works
everywhere. Run `/routing` to see what each tier resolves to locally.

```sh
cd ~/.pi/agent/extensions/subagents && npm test   # 34 tests
```
