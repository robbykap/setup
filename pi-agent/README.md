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

Each extension has its own dependencies, so the per-extension install matters:

```sh
cd ~/.pi/agent/extensions && for d in */; do
  [ -f "$d/package.json" ] && (cd "$d" && npm install --ignore-scripts)
done
```

Secrets (`auth.json`, `models-store.json`) and generated state (`node_modules/`,
`bin/`, `sessions/`) are intentionally not tracked. `settings.json` is tracked
on purpose, as a reference for a new machine.

`background-terminals` registers `bg_start` / `bg_status` / `bg_list` /
`bg_kill`. It replaces the older `tasks` extension, which registered the same
tool names — pi refuses to load both.

## Extensions

| Extension              | What it does                                              |
| ---------------------- | --------------------------------------------------------- |
| `file-search`          | `fd` and `rg` as first-class model tools                    |
| `background-terminals` | Long-lived shell commands with a `/ps` view                 |
| `subagents`            | Background subagents with intent-based model routing        |
| `file-edits`           | Collapsed edit rows, a file picker, and a diff viewer       |
| `commands`             | Collapsed bash rows, a command picker, and an output viewer  |
| `ask-user`             | Lets the model ask multiple-choice questions                |
| `git-info`             | Branch and changed-file status in the bottom bar            |
| `model-info`           | Model, context use, and cost in the bottom bar              |
| `ui-customization`     | Apple-pie header art and the bottom bar layout              |
| `copy-all`             | Copy the whole conversation                                 |
| `workflows`            | Multi-phase orchestration in a permission-restricted sandbox |
| `summaries`            | Automatic run recaps (sends transcript text to a model)     |

## Theme

`themes/catppuccin-mocha.json` is a full [Catppuccin
Mocha](https://catppuccin.com/palette) theme, selected by `settings.json`
(`"theme": "catppuccin-mocha"`). It is written here, not vendored. Pi picks it
up from `~/.pi/agent/themes/` and hot-reloads edits to the active theme.

`ui-customization` draws its header art from the same palette, so the pie, the
footer accents, and the rest of the TUI stay in one world. The footer is one
line:

```
~/Documents/github/setup ◆ ⎇ main ±3 PR #12 ◆ claude-bridge/claude-opus-5 (high)   [▰▰▰▰▰▰▱▱▱▱] 62% $0.41
```

The current directory is shaded apart from the path leading to it, the effort
tag reuses pi's `thinking*` tokens so a level looks the same there as on the
editor border, and the gauge drains as context fills (green → yellow at 25% →
red at 10%). Ghostty is on Catppuccin Mocha too
(`ghostty/dot-config/ghostty/config`).

## Shared UI kit

`extensions/shared/tui-kit/` is the visual language every overlay is built
from, so a panel in `/cmds` and a panel in `/files` are the same object with
different contents. It was lifted out of `file-edits` once a second extension
needed the same geometry; extensions reach it by relative path. Anything new
that draws an overlay should be assembled from these rather than grow its own
chrome:

| Unit        | What it owns                                                   |
| ----------- | -------------------------------------------------------------- |
| `frame`     | Panel chrome and exact-width lines, measured in visible cells    |
| `icons`     | File-type and UI glyphs, all Mocha accents                       |
| `paint`     | Selection fills and diff tints that survive a row's own resets   |
| `highlight` | Syntax highlighting that never changes a line count              |
| `scroll`    | One scroll model, so `j` means the same thing in every viewer    |
| `copy`      | Clipboard writes with a one-line receipt, and no throwing        |
| `status`    | The one shape a status-bar segment takes                         |
| `grouping`  | Render-time picker grouping, selection staying flat underneath   |

```sh
cd ~/.pi/agent/extensions/shared && npm test   # 99 tests
```

## Status bar

Extension statuses (`file-edits`, `commands`, `subagents`,
`background-terminals`, `workflows`, `summaries`) share one line directly above
the prompt, joined
with the same `◆` separator the footer uses. Segments have a fixed order and
drop from the right when the line will not fit. Extensions publish through
`ctx.ui.setStatus`; `ui-customization` renders the line.

`file-edits` collapses every `edit` and `write` to two lines in the
transcript. `alt+e` (or `/files`) opens the picker; Enter opens the diff
viewer, `s` toggles stacked and split, `n`/`p` move between files. `ctrl+o`
still expands a row inline. The shortcut is `alt+e` rather than `ctrl+f`
because `ctrl+f` is pi's built-in forward-char binding and `ctrl+shift+f` is
also already bound; `/files` opens the same picker if you'd rather skip the
shortcut. `file-edits` has no `effect` dependency; install it the
same way as the other extensions, per [Install](#install) above.

`commands` does the same for shell work. Every `bash` call collapses to two
lines — the command, its outcome, and a peek at the LAST line it printed, since
for a command the tail is the result. `alt+c` (or `/cmds`) opens the picker;
Enter opens the output viewer, `n`/`p` move between commands, `j`/`k` and
pgup/pgdn scroll. Failures and `ctrl+o`-expanded rows are never collapsed —
that output is exactly what you want to see.

The history covers `bash`, `fd` and `rg`, including the ones subagents and
workflow children run (tagged with who ran them). Producers announce on
`shared/command-log.ts`'s `COMMAND_CHANNEL`; `commands` owns the store and the
UI, so no extension has to know it exists. Background terminals stay in `/ps`:
duplicating them would mean two places to kill the same process.

The viewer can show more than the transcript ever did. When bash truncates
output it spills the full run to a temp file, and the viewer reads that back on
open (capped at the last 2 MB); `f` toggles between the full log and what the
model actually saw.

## Model configuration

Model choices are **machine-local and never tracked**, because the right models
differ per machine — Claude here, Copilot CLI at work, something else later.
Nothing in git names a model, so a fresh clone starts unconfigured on purpose.

| Command          | Configures                                    | Writes                                     |
| ---------------- | --------------------------------------------- | ------------------------------------------ |
| `/routing`       | Which models each subagent effort tier uses    | `extensions/subagents/routing.local.json`   |
| `/summary-model` | The model and reasoning level for run recaps   | `extensions/summaries/config.private.json`  |

Both list only models from providers you are **authenticated with** on this
machine (`getAvailable()`, not pi's ~1,275-model catalog), so at work they show
Copilot's models and here they show claude-bridge's. Both files are gitignored.

Routing resolves against the same authenticated set, so a tier naming a model
you have no credentials for is skipped rather than failing at spawn time.

An explicitly named model — `subagent_spawn`'s `model`, or a workflow
`agent()` call's `model`/`provider` — is resolved against the full catalog and
then checked for credentials, so the two failures stay distinguishable and
both refuse before any child session exists:

- `Unknown model "acme/not-real"` — no such model
- `No credentials for "openai" … Use /login to authenticate it` — real model,
  no key here

A bare model id (no provider) must be unambiguous; one offered by several
providers is reported as ambiguous rather than resolving to whichever provider
happened to come first.

### Subagent routing

`subagent_spawn` takes an intent (`effort`: `quick` / `standard` / `deep`, plus
optional `needs`) rather than a model name. Each tier holds an ordered
candidate list; the router takes the first model that exists here and satisfies
the declared needs.

An **unconfigured tier refuses to spawn** and tells you to run `/routing`,
rather than guessing a model you'd be paying for. A *configured* tier whose
candidates all fail a `needs` check still falls back — to the inherited model
if eligible, else the cheapest eligible one — since that is about satisfying a
hard constraint, not guessing a capability tier.

Candidates naming models a machine lacks are skipped rather than erroring, so
the same file survives moving between machines.

Recaps are similarly inert until `/summary-model` picks a model.

```sh
cd ~/.pi/agent/extensions/subagents && npm test   # 72 tests
```
