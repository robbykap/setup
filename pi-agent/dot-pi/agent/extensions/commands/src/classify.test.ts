import assert from "node:assert/strict";
import { test } from "node:test";
import { classify } from "./classify.ts";

function expect(cases: Record<string, string>) {
  for (const [command, want] of Object.entries(cases)) {
    assert.equal(classify(command), want, `classify(${JSON.stringify(command)})`);
  }
}

test("one command per category", () => {
  expect({
    "git status --short": "git",
    "rg needle src": "search",
    "vitest run": "test",
    "tsc --noEmit -p .": "build",
    "curl -sSf https://example.com": "network",
    "ls -la src": "files",
    "brew install fd": "packages",
    "node scripts/serve.js": "run",
    "echo hello": "other",
  });
});

test("the other members of each category", () => {
  expect({
    "grep -r needle .": "search",
    "egrep foo file": "search",
    "fd -e ts": "search",
    "find . -name '*.ts'": "search",
    "ag needle": "search",
    "jest --watch": "test",
    "pytest -q": "test",
    "make install": "build",
    "wget https://example.com/x.tar": "network",
    "http GET example.com": "network",
    "ping -c 1 example.com": "network",
    "ssh host uptime": "network",
    "scp a host:b": "network",
    "dig example.com": "network",
    "nc -z localhost 22": "network",
    "cat README.md": "files",
    "head -n 5 file": "files",
    "tail -f log": "files",
    "cp a b": "files",
    "mv a b": "files",
    "rm -rf dist": "files",
    "mkdir -p out": "files",
    "touch file": "files",
    "sed -i s/a/b/ file": "files",
    "awk '{print $1}' file": "files",
    "wc -l file": "files",
    "diff a b": "files",
    "pip install requests": "packages",
    "pip3 install requests": "packages",
    "pipx install ruff": "packages",
    "python3 script.py": "run",
    "deno run main.ts": "run",
    "npx tsx script.ts": "run",
  });
});

test("the npm family resolves test, then build, then packages, then run", () => {
  expect({
    "npm test": "test",
    "pnpm test -- --watch": "test",
    "yarn run test": "test",
    "bun test": "test",
    "cargo test": "test",
    "go test ./...": "test",
    "node --test src/x.test.ts": "test",
    "npm run build": "build",
    "pnpm run build": "build",
    "yarn build": "build",
    "cargo build --release": "build",
    "go build ./cmd/x": "build",
    "vite build": "build",
    "npm install": "packages",
    "npm i": "packages",
    "pnpm add -D typescript": "packages",
    "yarn remove lodash": "packages",
    "bun add zod": "packages",
    "cargo add serde": "packages",
    "npm run dev": "run",
    "npm start": "run",
    "pnpm dev": "run",
    "bun scripts/seed.ts": "run",
  });
});

test("the npm family's everyday verbs", () => {
  expect({
    "npm ci": "packages",
    "npm update": "packages",
    "npm uninstall lodash": "packages",
    "pnpm update --latest": "packages",
    "yarn ci": "packages",
    "npm exec tsx script.ts": "run",
    "pnpm exec prettier --write .": "run",
    // Installing a test runner is still an install.
    "bun add vitest": "packages",
    "npm i -D jest": "packages",
    // `latest` is not `test`.
    "npm run latest": "run",
  });
});

test("cargo, go and vite run as well as build", () => {
  expect({
    "cargo run": "run",
    "cargo run --release": "run",
    "go run ./cmd/x": "run",
    vite: "run",
    "vite dev": "run",
    "vite build --mode production": "build",
  });
});

test("a runtime that is running a test runner is a test", () => {
  expect({
    "python -m pytest": "test",
    "python3 -m pytest tests/": "test",
    "deno test": "test",
    "npx vitest": "test",
    "npx jest --watch": "test",
    "bun run vitest": "test",
    "python -m pytest src/x.test.py": "test",
    // A runtime with no runner in sight is still just a run.
    "python manage.py runserver": "run",
    "node scripts/serve.js": "run",
  });
});

test("docker builds, and the other tools stay other", () => {
  expect({
    "docker build -t app .": "build",
    "docker ps": "other",
    "docker compose up": "other",
    "gh pr list": "other",
    "kubectl get pods": "other",
    "terraform apply": "other",
  });
});

test("prefixes are stripped down to the real executable", () => {
  expect({
    "cd x && rg foo": "search",
    "cd /repo/pkg && npm run build": "build",
    "cd x && cd y && npm test": "test",
    'cd "my dir" && npm test': "test",
    "cd 'my dir' && rg foo": "search",
    "cd x && FOO=1 npm test": "test",
    "FOO=1 cd x && npm test": "test",
    "FOO=1 npm test": "test",
    "FOO=1 BAR=2 curl example.com": "network",
    "sudo make install": "build",
    "sudo FOO=1 rm -rf /tmp/x": "files",
    "/usr/bin/git log": "git",
  });
});

test("a multi-command line is classified by its first command", () => {
  expect({
    "git log | head": "git",
    "npm run build && npm test": "build",
    "ls; git status": "files",
    "cd x && git log | head -n 3": "git",
  });
});

test("nothing to classify is other", () => {
  expect({
    "": "other",
    "   ": "other",
    "cd /repo": "other",
    "FOO=1": "other",
  });
});
