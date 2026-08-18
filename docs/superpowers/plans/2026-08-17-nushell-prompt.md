# Nushell Inline Powerline Prompt Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a single-line Catppuccin Mocha powerline prompt for Nushell showing path, git branch state, and time, with an installer that wires it into the user's Nushell config.

**Architecture:** One Nushell script (`nushell/prompt.nu`) defines a color palette record and three independent segment-builder commands (`path-flag`, `git-flag`, `time-flag`), each returning a string or nothing. A fourth command assembles them into `$env.PROMPT_COMMAND`. Because each builder is a plain command, tests call them directly with a controlled `PWD` rather than trying to inspect a live prompt. A POSIX `sh` installer appends a marked `source` line to Nushell's `config.nu`, mirroring the existing `ghostty/install.sh`.

**Tech Stack:** Nushell 0.115, POSIX `sh`, `git` (porcelain v2 status format), ANSI truecolor escapes, Nerd Font glyphs.

---

## Background for the implementer

**Read the spec first:** `docs/superpowers/specs/2026-08-17-nushell-prompt-design.md`

**Nushell syntax notes** (verified against 0.115 — do not guess, these differ from bash and from older Nushell):

- Define a command: `def name [arg: string] { ... }`. The last expression is the return value.
- `def --env` is only needed when a command mutates the environment. None of ours do.
- Run an external binary with a `^` prefix: `^git status`. Without the caret Nushell may resolve a builtin.
- Capture an external's output and exit code: `do { ^git ... } | complete` returns a record with `stdout`, `stderr`, `exit_code`. **This does not throw on nonzero exit**, which is exactly why we use it for git — a non-repo directory exits 128 and we want that as data, not an error.
- Truecolor escape: `ansi -e "38;2;R;G;Bm"` for foreground, `48;2;R;G;Bm` for background, `ansi reset` to clear.
- String interpolation: `$"text (expression) more"`. Parens inside the string are evaluated.
- `$env.PROMPT_COMMAND` must be set to a **closure** (`{|| ... }`), which Nushell calls on each prompt.
- Path helpers: `"/a/b/c/d" | path split` gives a list; `| path join` reassembles.
- Config lives at `~/Library/Application Support/nushell/config.nu` on macOS. The space in the path means **every reference must be quoted**.

**Testing approach:** `nushell/tests/test_prompt.nu` is a Nushell script that sources `prompt.nu`, calls the builders directly, and compares against expected strings. It prints `PASS`/`FAIL` per assertion and exits nonzero if any failed — matching the style of `ghostty/tests/test_smoke.sh`. Tests that need a specific directory pass it as an argument to the builder rather than `cd`-ing, so they cannot interfere with each other.

**Design decision — builders take an explicit path argument.** `path-flag` and `git-flag` accept the directory as a parameter instead of reading `$env.PWD` internally. The prompt closure passes `$env.PWD`. This is what makes them testable without mutating global state.

---

## File Structure

| File | Responsibility |
|---|---|
| `nushell/prompt.nu` | Palette, three segment builders, prompt assembly, env hooks |
| `nushell/tests/test_prompt.nu` | Unit tests for the builders and assembly |
| `nushell/tests/test_install.sh` | Tests for installer idempotency and dry-run |
| `nushell/run-tests.sh` | Runs both test files |
| `nushell/install.sh` | Idempotent installer |
| `nushell/README.md` | Screenshot-in-text, install, uninstall |

---

### Task 1: Palette and the path flag

**Files:**
- Create: `nushell/prompt.nu`
- Create: `nushell/tests/test_prompt.nu`

- [ ] **Step 1: Write the failing test**

Create `nushell/tests/test_prompt.nu`:

```nushell
#!/usr/bin/env nu
# Unit tests for prompt.nu. Run: nu nushell/tests/test_prompt.nu
source ../prompt.nu

mut failures = 0

def check [label: string, actual: any, expected: any] {
    if $actual == $expected {
        print $"(ansi green)PASS(ansi reset)  ($label)"
        true
    } else {
        print $"(ansi red)FAIL(ansi reset)  ($label)"
        print $"      expected: ($expected | to nuon)"
        print $"      actual:   ($actual | to nuon)"
        false
    }
}

# strip-ansi lets assertions target content, not escape codes. The color
# choices are verified by eye; the text is verified here.
def strip-ansi [s: string] { $s | ansi strip }

$failures += (if (check "path: home shortens to ~" (strip-ansi (path-flag $env.HOME)) " ~ ") { 0 } else { 1 })
$failures += (if (check "path: deep path keeps last 3" (strip-ansi (path-flag "/a/b/c/d/e")) " …/c/d/e ") { 0 } else { 1 })
$failures += (if (check "path: shallow path is whole" (strip-ansi (path-flag "/a/b")) " /a/b ") { 0 } else { 1 })
$failures += (if (check "path: root is /" (strip-ansi (path-flag "/")) " / ") { 0 } else { 1 })
$failures += (if (check "path: under home shortens" (strip-ansi (path-flag $"($env.HOME)/x/y")) " ~/x/y ") { 0 } else { 1 })

if $failures > 0 {
    print $"(ansi red)($failures) failing(ansi reset)"
    exit 1
}
print $"(ansi green)all passing(ansi reset)"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nushell/tests && nu test_prompt.nu`
Expected: FAIL — `source ../prompt.nu` errors because the file does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `nushell/prompt.nu`:

```nushell
# Inline powerline prompt for Nushell, Catppuccin Mocha.
#
#  ~/Documents/github/setup   main ▲2 ~1   14:32:07 ❯
#
# Sourced from config.nu by install.sh. Segment builders take an explicit
# directory so they can be tested without cd-ing around.

# Catppuccin Mocha. Every color used by the prompt is named here exactly once.
export def palette [] {
    {
        crust:     "17;17;27"
        surface1:  "69;71;90"
        subtext0:  "166;173;200"
        blue:      "137;180;250"
        mauve:     "203;166;247"
        green:     "166;227;161"
        red:       "243;139;168"
    }
}

export def fg [rgb: string] { ansi -e $"38;2;($rgb)m" }
export def bg [rgb: string] { ansi -e $"48;2;($rgb)m" }

# The working directory, ~-shortened and truncated to its last 3 components.
export def path-flag [dir: string] {
    let p = (palette)
    let home = ($env.HOME? | default "")
    let short = if ($home != "" and ($dir == $home or ($dir | str starts-with $"($home)/"))) {
        $dir | str replace $home "~"
    } else {
        $dir
    }
    let parts = ($short | path split | where {|it| $it != "/" })
    let text = if ($parts | length) > 3 {
        $"…/($parts | last 3 | str join '/')"
    } else {
        $short
    }
    $"(bg $p.blue)(fg $p.crust) ($text) "
}
```

Note on the `where {|it| $it != "/" }` filter: `"/a/b" | path split` yields
`["/", "a", "b"]` — the leading separator counts as a component. Dropping it
means "/a/b" is 2 components, not 3, so it stays whole.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nushell/tests && nu test_prompt.nu`
Expected: all 5 path assertions PASS, `all passing`.

- [ ] **Step 5: Commit**

```bash
git add nushell/prompt.nu nushell/tests/test_prompt.nu
git commit -m "feat(nushell): add Mocha palette and path flag"
```

---

### Task 2: The git flag

**Files:**
- Modify: `nushell/prompt.nu` (append after `path-flag`)
- Modify: `nushell/tests/test_prompt.nu` (insert assertions before the `if $failures > 0` block)

- [ ] **Step 1: Write the failing test**

In `nushell/tests/test_prompt.nu`, insert immediately before the `if $failures > 0 {` block:

```nushell
# --- git flag ---------------------------------------------------------------
# Each case builds a throwaway repo so the tests never depend on the state of
# the checkout they are running inside.
let tmp = (mktemp -d)

$failures += (if (check "git: non-repo yields nothing" (git-flag $tmp) null) { 0 } else { 1 })

let repo = $"($tmp)/repo"
mkdir $repo
^git -C $repo init -q -b main
^git -C $repo config user.email "t@t.t"
^git -C $repo config user.name "t"
"one" | save $"($repo)/f.txt"
^git -C $repo add f.txt
^git -C $repo commit -qm first

$failures += (if (check "git: clean repo shows branch" (strip-ansi (git-flag $repo)) "  main ") { 0 } else { 1 })

"two" | save -f $"($repo)/f.txt"
$failures += (if (check "git: dirty repo counts changes" (strip-ansi (git-flag $repo)) "  main ~1 ") { 0 } else { 1 })

rm -rf $tmp
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nushell/tests && nu test_prompt.nu`
Expected: FAIL with `Command \`git-flag\` not found`.

- [ ] **Step 3: Write minimal implementation**

Append to `nushell/prompt.nu`:

```nushell
# Branch and working-tree state, or nothing outside a repository.
#
# `| complete` is deliberate: it captures the exit code as data instead of
# raising, so a non-repo (exit 128) or a missing git binary degrades to an
# absent segment rather than a broken prompt.
export def git-flag [dir: string] {
    let p = (palette)
    let r = (do { ^git -C $dir status --porcelain=2 --branch } | complete)
    if $r.exit_code != 0 { return null }

    let lines = ($r.stdout | lines)
    let head = ($lines | where {|l| $l starts-with "# branch.head " } | first | default "")
    let branch = ($head | str replace "# branch.head " "")
    # A detached HEAD reports the literal string "(detached)"; show the sha.
    let name = if $branch == "(detached)" {
        let oid = ($lines | where {|l| $l starts-with "# branch.oid " } | first | default "")
        $oid | str replace "# branch.oid " "" | str substring 0..7
    } else {
        $branch
    }

    # "# branch.ab +2 -1" — present only when an upstream is configured.
    let ab = ($lines | where {|l| $l starts-with "# branch.ab " } | first | default "")
    let ahead = if $ab == "" { 0 } else { $ab | split row " " | get 2 | str replace "+" "" | into int }
    let behind = if $ab == "" { 0 } else { $ab | split row " " | get 3 | str replace "-" "" | into int }

    # Entry lines start with 1/2 (changed, renamed) or u (unmerged). Untracked
    # "?" lines are excluded: they are noise in a repo with build output.
    let dirty = ($lines | where {|l| ($l starts-with "1 ") or ($l starts-with "2 ") or ($l starts-with "u ") } | length)

    mut marks = ""
    if $ahead > 0  { $marks = $"($marks) ▲($ahead)" }
    if $behind > 0 { $marks = $"($marks) ▼($behind)" }
    if $dirty > 0  { $marks = $"($marks) ~($dirty)" }

    $"(bg $p.mauve)(fg $p.crust)  ($name)($marks) "
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nushell/tests && nu test_prompt.nu`
Expected: all 8 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add nushell/prompt.nu nushell/tests/test_prompt.nu
git commit -m "feat(nushell): add git flag with ahead/behind/dirty counts"
```

---

### Task 3: Time flag, indicator, and assembly

**Files:**
- Modify: `nushell/prompt.nu` (append)
- Modify: `nushell/tests/test_prompt.nu` (insert assertions before the `if $failures > 0` block)

- [ ] **Step 1: Write the failing test**

In `nushell/tests/test_prompt.nu`, insert before the `if $failures > 0 {` block:

```nushell
# --- time, indicator, assembly ----------------------------------------------
let t = (strip-ansi (time-flag))
$failures += (if (check "time: renders HH:MM:SS" (($t | str length) == 12) true) { 0 } else { 1 })
$failures += (if (check "time: is digits and colons" (($t | str trim | parse -r '^\d\d:\d\d:\d\d$' | length) == 1) true) { 0 } else { 1 })

$env.LAST_EXIT_CODE = 0
$failures += (if (check "indicator: green on success" ((indicator) | str contains (fg (palette).green)) true) { 0 } else { 1 })
$env.LAST_EXIT_CODE = 1
$failures += (if (check "indicator: red on failure" ((indicator) | str contains (fg (palette).red)) true) { 0 } else { 1 })
$env.LAST_EXIT_CODE = 0

# Two separators in a non-repo (path→time, time→end), three inside a repo.
let tmp2 = (mktemp -d)
let sep_count = {|s| $s | split row "" | length | $in - 1 }
$failures += (if (check "assembly: non-repo has 2 separators" (do $sep_count (strip-ansi (build-prompt $tmp2))) 2) { 0 } else { 1 })

let repo2 = $"($tmp2)/r"
mkdir $repo2
^git -C $repo2 init -q -b main
$failures += (if (check "assembly: repo has 3 separators" (do $sep_count (strip-ansi (build-prompt $repo2))) 3) { 0 } else { 1 })
$failures += (if (check "assembly: repo includes branch" ((strip-ansi (build-prompt $repo2)) | str contains "main") true) { 0 } else { 1 })
rm -rf $tmp2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nushell/tests && nu test_prompt.nu`
Expected: FAIL with `Command \`time-flag\` not found`.

- [ ] **Step 3: Write minimal implementation**

Append to `nushell/prompt.nu`:

```nushell
# Wall clock at the moment the prompt is drawn.
export def time-flag [] {
    let p = (palette)
    $"(bg $p.surface1)(fg $p.subtext0)  (date now | format date '%H:%M:%S') "
}

# The only place command outcome is surfaced, since the prompt has no footer.
export def indicator [] {
    let p = (palette)
    let code = ($env.LAST_EXIT_CODE? | default 0)
    let color = if $code == 0 { fg $p.green } else { fg $p.red }
    $"($color)❯ (ansi reset)"
}

# Joins the flags, drawing each separator in the finished segment's color over
# the next one's background. Omitting git means path flows straight into time,
# so there is never an empty segment or an orphaned separator.
export def build-prompt [dir: string] {
    let p = (palette)
    let git = (git-flag $dir)
    let mid = if $git == null {
        $"(bg $p.surface1)(fg $p.blue)(time-flag)"
    } else {
        $"(bg $p.mauve)(fg $p.blue)($git)(bg $p.surface1)(fg $p.mauve)(time-flag)"
    }
    $"(path-flag $dir)($mid)(ansi reset)(fg $p.surface1)(ansi reset) "
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nushell/tests && nu test_prompt.nu`
Expected: all 15 assertions PASS.

- [ ] **Step 5: Commit**

```bash
git add nushell/prompt.nu nushell/tests/test_prompt.nu
git commit -m "feat(nushell): add time flag, exit indicator, and assembly"
```

---

### Task 4: Root warning and environment hooks

**Files:**
- Modify: `nushell/prompt.nu` (change `path-flag`, append hooks at end of file)
- Modify: `nushell/tests/test_prompt.nu`

- [ ] **Step 1: Write the failing test**

In `nushell/tests/test_prompt.nu`, insert before the `if $failures > 0 {` block:

```nushell
# --- root warning -----------------------------------------------------------
# The palette choice is driven by an argument rather than by calling `id` inside
# the builder, so the root case is testable without actually being root.
$failures += (if (check "path: non-root is blue" ((path-flag "/tmp" false) | str contains (bg (palette).blue)) true) { 0 } else { 1 })
$failures += (if (check "path: root is red" ((path-flag "/tmp" true) | str contains (bg (palette).red)) true) { 0 } else { 1 })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd nushell/tests && nu test_prompt.nu`
Expected: FAIL — `path-flag` currently takes one parameter, so the two-argument calls error with an extra-positional-argument message.

- [ ] **Step 3: Write minimal implementation**

In `nushell/prompt.nu`, change the `path-flag` signature and its final line:

```nushell
export def path-flag [dir: string, is_root: bool = false] {
```

```nushell
    let color = if $is_root { $p.red } else { $p.blue }
    $"(bg $color)(fg $p.crust) ($text) "
```

Then append to the end of `nushell/prompt.nu`:

```nushell
# --- wire it up --------------------------------------------------------------
# Resolved once at source time: the uid cannot change within a shell session,
# and shelling out to `id` on every keystroke would be waste.
export-env {
    $env.PROMPT_IS_ROOT = ((^id -u | into int) == 0)
    $env.PROMPT_COMMAND = {|| build-prompt $env.PWD ($env.PROMPT_IS_ROOT? | default false) }
    $env.PROMPT_INDICATOR = {|| indicator }
    # Nushell ships a right prompt showing the time; ours already has one.
    $env.PROMPT_COMMAND_RIGHT = {|| "" }
    # Continuation and vi-mode prompts, kept visually quiet.
    $env.PROMPT_MULTILINE_INDICATOR = {|| $"(fg (palette).surface1)::: (ansi reset)" }
}
```

Also update `build-prompt` to accept and forward the flag:

```nushell
export def build-prompt [dir: string, is_root: bool = false] {
```

```nushell
    $"(path-flag $dir $is_root)($mid)(ansi reset)(fg $p.surface1)(ansi reset) "
```

`export-env` is what makes these assignments take effect in the sourcing
shell; plain `$env.X = ...` at the top level of a sourced file does not
propagate out of the module.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd nushell/tests && nu test_prompt.nu`
Expected: all 17 assertions PASS.

- [ ] **Step 5: Verify the prompt renders in a real shell**

Run: `nu -c 'source nushell/prompt.nu; print (build-prompt $env.PWD)'` from the repo root.
Expected: a colored line reading `~/Documents/github/setup`, the branch `main` with an ahead count, and the current time, with solid triangular separators between segments and no visible escape-code text.

**If the separators or the branch icon render as boxes or question marks**, the font lacks the Nerd Font glyphs. In that case change the separator to `▏` and drop the ` ` from `git-flag`, then re-run the tests and update the expected strings in the git assertions to `" main "`.

- [ ] **Step 6: Commit**

```bash
git add nushell/prompt.nu nushell/tests/test_prompt.nu
git commit -m "feat(nushell): add root warning color and env hooks"
```

---

### Task 5: The installer

**Files:**
- Create: `nushell/install.sh`
- Create: `nushell/tests/test_install.sh`

- [ ] **Step 1: Write the failing test**

Create `nushell/tests/test_install.sh`:

```sh
#!/bin/sh
# Installer tests against a throwaway config. Run: sh nushell/tests/test_install.sh
set -u

ROOT=$(cd "$(dirname "$0")/.." && pwd)
TMP=$(mktemp -d)
failures=0

# NU_CONFIG_DIR lets install.sh target a temp dir. Without it these tests would
# have to write to the real config, which is not acceptable in a test suite.
export NU_CONFIG_DIR="$TMP"
CFG="$TMP/config.nu"

check() {
  printf '%-52s' "$1"
  if [ "$2" = "0" ]; then echo PASS; else echo FAIL; failures=$((failures + 1)); fi
}

printf '# existing user config\n$env.config.show_banner = false\n' > "$CFG"

sh "$ROOT/install.sh" --dry-run >/dev/null 2>&1
! grep -q "prompt.nu" "$CFG"
check "dry-run writes nothing" $?

sh "$ROOT/install.sh" >/dev/null 2>&1
grep -q "source .*prompt.nu" "$CFG"
check "install adds source line" $?

grep -q "show_banner" "$CFG"
check "install preserves user config" $?

[ -f "$CFG.bak" ]
check "install backs up config" $?

sh "$ROOT/install.sh" >/dev/null 2>&1
[ "$(grep -c 'source .*prompt.nu' "$CFG")" = "1" ]
check "install is idempotent" $?

ln -sf /dev/null "$TMP/link.nu"
NU_CONFIG_DIR="$TMP" CONFIG_NAME="link.nu" sh "$ROOT/install.sh" >/dev/null 2>&1
[ "$?" != "0" ]
check "install refuses a symlinked config" $?

rm -rf "$TMP"
[ "$failures" -eq 0 ] || exit 1
echo "all passing"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `sh nushell/tests/test_install.sh`
Expected: FAIL on every check — `install.sh` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `nushell/install.sh`:

```sh
#!/bin/sh
# Install the Nushell powerline prompt. Idempotent. Pass --dry-run to preview.
set -eu

ROOT=$(cd "$(dirname "$0")" && pwd)
CONFIG_DIR="${NU_CONFIG_DIR:-$HOME/Library/Application Support/nushell}"
TARGET="$CONFIG_DIR/${CONFIG_NAME:-config.nu}"
MARK="# Generated by $ROOT/install.sh"
DRY=0
[ "${1:-}" = "--dry-run" ] && DRY=1

say() { printf '%s\n' "$1"; }
act() { if [ "$DRY" -eq 1 ]; then say "would: $*"; else "$@"; fi; }

command -v nu >/dev/null 2>&1 || { say "missing: nu  ->  brew install nushell"; exit 1; }

# A symlinked target belongs to some other tool (stow, chezmoi, ...). Appending
# would write through the link into a file we never inspected.
if [ -L "$TARGET" ]; then
  say "refusing to install: $TARGET is a symlink -> $(readlink "$TARGET" 2>/dev/null || echo '?')"
  say "It looks like $TARGET is managed by another tool. Remove the symlink"
  say "and re-run this script."
  exit 1
fi

act mkdir -p "$CONFIG_DIR"
[ -e "$TARGET" ] || act touch "$TARGET"

if grep -q "prompt\.nu" "$TARGET" 2>/dev/null; then
  # Re-run: drop the previous block so the path stays correct if the repo moved.
  # Both generated lines are matched by fixed strings — no regex escaping of
  # $ROOT, which may contain characters grep would otherwise interpret.
  if [ "$DRY" -eq 1 ]; then
    say "would replace the existing prompt block in $TARGET"
  else
    grep -v -F -e "prompt.nu" -e "$MARK" "$TARGET" > "$TARGET.tmp"
    mv "$TARGET.tmp" "$TARGET"
  fi
elif [ -e "$TARGET.bak" ]; then
  say "backup already exists at $TARGET.bak — leaving it as-is"
else
  act cp "$TARGET" "$TARGET.bak"
  say "backed up existing config to $TARGET.bak"
fi

if [ "$DRY" -eq 1 ]; then
  say "would append a source line for $ROOT/prompt.nu to $TARGET"
else
  cat >> "$TARGET" <<EOF
$MARK
source "$ROOT/prompt.nu"
EOF
fi

say ""
say "Installed. Open a new Nushell session, or run: nu"
```

- [ ] **Step 4: Run test to verify it passes**

Run: `chmod +x nushell/install.sh && sh nushell/tests/test_install.sh`
Expected: all 6 checks PASS, `all passing`.

- [ ] **Step 5: Commit**

```bash
git add nushell/install.sh nushell/tests/test_install.sh
git commit -m "feat(nushell): add idempotent prompt installer"
```

---

### Task 6: Test runner and README

**Files:**
- Create: `nushell/run-tests.sh`
- Create: `nushell/README.md`

- [ ] **Step 1: Write the test runner**

Create `nushell/run-tests.sh`:

```sh
#!/bin/sh
# Run the prompt test suite. Usage: sh nushell/run-tests.sh
set -eu
cd "$(dirname "$0")"
(cd tests && nu test_prompt.nu)
sh tests/test_install.sh
```

- [ ] **Step 2: Run it**

Run: `chmod +x nushell/run-tests.sh && sh nushell/run-tests.sh`
Expected: `all passing` twice, exit 0.

- [ ] **Step 3: Write the README**

Create `nushell/README.md`:

````markdown
# Nushell prompt

A single-line powerline prompt in Catppuccin Mocha.

```
 ~/Documents/github/setup   main ▲2 ~1   14:32:07 ❯ ls
```

- **path** — `~`-shortened, truncated to the last three components. Red instead
  of blue when the shell is running as root.
- **git** — branch name, `▲` ahead, `▼` behind, `~` changed tracked files. The
  whole segment disappears outside a repository.
- **time** — local 24-hour clock, redrawn with each prompt.
- **`❯`** — green after a successful command, red after a failure.

## Install

```sh
sh nushell/install.sh          # preview first with --dry-run
```

This appends a `source` line to `~/Library/Application Support/nushell/config.nu`
and backs the file up to `config.nu.bak` on first run. Re-running replaces the
previous line rather than adding a second one.

## Uninstall

Delete the two generated lines at the bottom of `config.nu` — the comment
starting `# Generated by` and the `source` line under it.

## Requirements

A Nerd Font for the `` and `` glyphs. Ghostty's default (JetBrains Mono
Nerd Font) has them.

## Tests

```sh
sh nushell/run-tests.sh
```
````

- [ ] **Step 4: Commit**

```bash
git add nushell/run-tests.sh nushell/README.md
git commit -m "docs(nushell): add test runner and README"
```

---

### Task 7: Install and verify end to end

**Files:**
- Modify: `~/Library/Application Support/nushell/config.nu` (via the installer)

- [ ] **Step 1: Preview the install**

Run: `sh nushell/install.sh --dry-run`
Expected: `would:` lines only; `grep prompt.nu ~/Library/Application\ Support/nushell/config.nu` still finds nothing.

- [ ] **Step 2: Install**

Run: `sh nushell/install.sh`
Expected: a backup notice and `Installed.`

- [ ] **Step 3: Verify in a real session**

Run: `nu -c 'print $env.PROMPT_COMMAND; print (build-prompt $env.PWD)'`
Expected: a closure is printed, then the rendered prompt line with correct colors and glyphs.

Then start an interactive `nu` and confirm by eye: the flags appear on one line
with the cursor directly after `❯`; `cd /tmp` drops the git segment; `cd` back
restores it; a failing command such as `false` turns the `❯` red and the next
successful command turns it green again.

- [ ] **Step 4: Confirm the existing config still works**

Run: `nu -c 'which pi'`
Expected: a path under `/opt/homebrew/bin` — proving the `path add` block in the
user's existing `config.nu` still runs after the appended source line.

- [ ] **Step 5: Commit**

Nothing to commit — this task only touches files outside the repository. Verify
with `git status` that the working tree is clean.
