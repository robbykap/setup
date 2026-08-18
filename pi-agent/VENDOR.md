# Vendored extensions

The extensions under `dot-pi/agent/extensions/` and skills under
`dot-pi/agent/skills/` originate from:

    https://github.com/davis7dotsh/my-pi-setup
    commit 73bf4d826f39b5cab6b7865e706ba4a2669629ca (2026-08-04)

They are **vendored, not tracked**. Nothing here follows upstream `main`.
Pulling a newer upstream is a deliberate act that requires re-auditing the
diff — a clean audit of one commit says nothing about the next.

## What was taken

`file-search`, `git-info`, `ui-customization`, `model-info`, `copy-all`,
`ask-user`, `background-terminals`, `workflows`, `summaries`, plus the `extensions/shared/`
files those depend on, and the `background-terminals` skill.

## What was deliberately not taken

- `firecrawl-search` — requires a paid API key and sends queries off-machine
- `spark-strict-tools` — only fires for the `spark-deepseek` provider
- `themes/github-dark-default.json` — not selected

## What was modified

`subagents` is a stripped fork, not the upstream extension. Removed:
`src/backends/claude.ts`, `src/backends/codex.ts`, and their tests. Those
backends granted children unsupervised host access
(`permissionMode: "bypassPermissions"`, `approvalPolicy: "never"`,
`sandbox: "danger-full-access"`) and could each run only their own vendor's
models. `src/backends/stub.ts` is retained: it is a test-only fake backend
that `manager.test.ts` runs against.

`summaries` no longer ships a default recap model. Upstream defaulted to
`openai-codex/gpt-5.6-luna`, a provider this setup does not configure. Rather
than swap in another hardcoded model, the default is now empty and recaps stay
inert until `/summary-model` picks one — recaps run every turn and cost money,
so guessing is the wrong failure mode. Its picker now uses the shared
`extensions/shared/model-choices.ts` helper, so model lists look and sort the
same as `/routing`.

Added: `src/router.ts` and `routing.local.json` — intent-based,
provider-agnostic model routing. Design:
`docs/superpowers/specs/2026-08-17-subagent-router-design.md`.

Added: `src/child-providers.ts` — copies the parent session's
extension-registered providers into each subagent's registry. Without it every
subagent failed with "No API key found"; see commit 4294685 for the root cause.

Model configuration is machine-local and gitignored (`routing.local.json`,
`config.private.json`). No tracked file names a model, so a fresh clone starts
unconfigured and refuses to spawn until `/routing` runs.

The root `package.json` was rewritten rather than copied: `firecrawl` and
`acorn` dropped as unused by this subset, and `@earendil-works/pi-*` bumped
from `^0.82.0` to `^0.84.2` to match the installed pi.

## Audit summary (2026-08-17, commit 73bf4d8)

No malicious code found. No install lifecycle scripts, no `eval`, no
obfuscation, no access to `~/.ssh`, `~/.aws`, shell rc files, or keychain.
All lockfile entries resolved to `registry.npmjs.org`. Binary downloads in
`file-search` are HTTPS-only with pinned SHA-256 verified before extraction.

Residual risks accepted:

- `background-terminals` spawns arbitrary shell commands with the inherited
  environment. Same risk class as any shell tool.
- `file-search` downloads pinned `fd`/`rg` release binaries on first use when
  neither is installed. The pinned hashes are upstream's and were not
  independently verified against the vendors' published checksums.
- `prepare: "effect-tsgo patch"` in each extension's `package.json` runs on
  `npm install`. Install with `--ignore-scripts` to skip it.

`workflows` executes orchestration code, so its isolation was probed directly
rather than read. Inside the sandbox: `require`, `fetch`, and dynamic `import`
are unavailable, `process` is `undefined`, `this.constructor.constructor`
escape fails, and `globalThis` exposes only JS builtins. Benign compute still
returns normally. The child process additionally runs under Node
`--permission` with `--allow-fs-read` limited to the worker directory, a
scrubbed env (`PATH` only), a 128MB heap cap, and a random IPC token
(`sandbox.ts:84-121`).
