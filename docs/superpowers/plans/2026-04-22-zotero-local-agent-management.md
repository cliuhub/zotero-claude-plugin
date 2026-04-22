# Zotero Local Agent Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local-first Zotero management system with a JSON-first `zotero` CLI, a small authenticated Zotero plugin write bridge, and a dedicated skill for agent use, including stable PDF retrieval and experimental attachment mutation boundaries.

**Architecture:** Reuse Zotero's built-in local API for reads and implement a single plugin command bus for writes and attachment helper operations. Keep the CLI as the primary entrypoint, with a dedicated skill teaching agents to prefer structured commands, use stable attachment retrieval normally, and reserve unsafe or experimental paths for explicit cases.

**Tech Stack:** Node.js 18+, Zotero plugin JavaScript, Python 3 CLI, shell wrapper, Markdown skill docs, Node test runner

---

## Planned File Structure

- `package.json`: project scripts for tests, syntax checks, token generation, and XPI build
- `README.md`: install, usage, safety model, stable versus experimental attachment support
- `plugin/manifest.json`: Zotero plugin metadata
- `plugin/bootstrap.js`: endpoint registration, command dispatch, Zotero JavaScript API execution
- `plugin/shared/contract.js`: request normalization, auth helpers, JSON response helpers
- `plugin/prefs.js.template`: local prefs template including token and unsafe/experimental toggles
- `scripts/build-plugin.mjs`: XPI build process
- `scripts/generate-token.mjs`: local token creation
- `scripts/zotero_cli.py`: main Python CLI implementation
- `bin/zotero`: shell wrapper for the CLI
- `skills/zotero-manage/SKILL.md`: agent instructions for safe Zotero management
- `tests/contract.test.cjs`: contract and normalization tests
- `tests/cli.test.cjs`: CLI argument parsing and subprocess JSON shape tests
- `tests/README.md`: manual verification checklist for real Zotero testing

### Task 1: Bootstrap the repo scaffold and build scripts

**Files:**
- Create: `package.json`
- Create: `README.md`
- Create: `plugin/manifest.json`
- Create: `plugin/prefs.js.template`
- Create: `scripts/build-plugin.mjs`
- Create: `scripts/generate-token.mjs`
- Create: `bin/zotero`
- Create: `.gitignore`
- Test: `tests/contract.test.cjs`

- [ ] **Step 1: Write the failing package-level test**

Create `tests/contract.test.cjs` with:

```js
const test = require("node:test");
const assert = require("node:assert/strict");

test("package scripts include build and test commands", async () => {
  const pkg = require("../package.json");
  assert.equal(typeof pkg.scripts["build:xpi"], "string");
  assert.equal(typeof pkg.scripts.test, "string");
  assert.equal(typeof pkg.scripts["make-token"], "string");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/contract.test.cjs
```

Expected: FAIL because `package.json` does not exist yet.

- [ ] **Step 3: Create the minimal scaffold and scripts**

Create `package.json`:

```json
{
  "name": "zotero-local-agent-management",
  "private": true,
  "scripts": {
    "make-token": "node scripts/generate-token.mjs --write",
    "test": "node --test tests/*.test.cjs",
    "check:syntax": "node --check plugin/bootstrap.js && node --check plugin/shared/contract.js && node --check scripts/build-plugin.mjs && node --check scripts/generate-token.mjs && python3 -m py_compile scripts/zotero_cli.py && sh -n bin/zotero",
    "build:xpi": "node scripts/build-plugin.mjs"
  }
}
```

Create `bin/zotero`:

```sh
#!/usr/bin/env sh
set -eu
SCRIPT_DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
REPO_ROOT="$(CDPATH= cd -- "$SCRIPT_DIR/.." && pwd)"
exec python3 "$REPO_ROOT/scripts/zotero_cli.py" "$@"
```

Create `.gitignore`:

```gitignore
.build/
.local/
builds/
```

Create `README.md`:

```md
# Zotero Local Agent Management
```

Create `plugin/manifest.json`:

```json
{
  "manifest_version": 2,
  "name": "Zotero Local Agent Management",
  "version": "0.1.0",
  "description": "Local agent-facing Zotero management bridge"
}
```

Create `plugin/prefs.js.template`:

```js
pref("extensions.zotero.zoteroAgent.token", "__ZOTERO_AGENT_TOKEN__");
pref("extensions.zotero.zoteroAgent.unsafeEnabled", false);
pref("extensions.zotero.zoteroAgent.experimentalAttachmentsEnabled", false);
```

Create `scripts/build-plugin.mjs`:

```js
console.log("build placeholder");
```

Create `scripts/generate-token.mjs`:

```js
console.log("token placeholder");
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --test tests/contract.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add package.json README.md plugin/manifest.json plugin/prefs.js.template scripts/build-plugin.mjs scripts/generate-token.mjs bin/zotero .gitignore tests/contract.test.cjs
git commit -m "Bootstrap Zotero local agent management project"
```

### Task 2: Build the shared contract for auth, command dispatch, and JSON responses

**Files:**
- Create: `plugin/shared/contract.js`
- Modify: `tests/contract.test.cjs`

- [ ] **Step 1: Write the failing contract tests**

Append to `tests/contract.test.cjs`:

```js
const contract = require("../plugin/shared/contract.js");

test("authorize accepts the configured token", () => {
  assert.doesNotThrow(() => {
    contract.authorizeHeaders({ "x-zotero-agent-token": "secret" }, "secret");
  });
});

test("normalize command request requires a command string", () => {
  assert.throws(
    () => contract.normalizeCommandRequest({ args: {} }),
    (error) => error.code === "INVALID_INPUT"
  );
});

test("success payload is stable JSON", () => {
  const [status, headers, body] = contract.success("collections.list", { ok: true });
  assert.equal(status, 200);
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(body), {
    ok: true,
    command: "collections.list",
    data: { ok: true }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/contract.test.cjs
```

Expected: FAIL because `plugin/shared/contract.js` does not exist yet.

- [ ] **Step 3: Implement the contract helpers**

Create `plugin/shared/contract.js` with:

```js
(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
    return;
  }
  root.ZoteroAgentContract = factory();
})(this, function () {
  "use strict";

  const TOKEN_HEADER = "x-zotero-agent-token";

  class CommandValidationError extends Error {
    constructor(status, code, message, details = {}) {
      super(message);
      this.name = "CommandValidationError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  function invalidInput(field, message) {
    throw new CommandValidationError(400, "INVALID_INPUT", message, { field });
  }

  function ensureString(value, field) {
    if (typeof value !== "string" || !value.trim()) {
      invalidInput(field, `${field} must be a non-empty string`);
    }
    return value.trim();
  }

  function authorizeHeaders(headers, expectedToken) {
    const configured = ensureString(expectedToken, "expectedToken");
    const provided = headers?.[TOKEN_HEADER] ?? headers?.[TOKEN_HEADER.toLowerCase()];
    if (provided !== configured) {
      throw new CommandValidationError(401, "AUTH_REQUIRED", "Missing or invalid token");
    }
  }

  function normalizeCommandRequest(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      invalidInput("payload", "payload must be an object");
    }
    return {
      command: ensureString(payload.command, "command"),
      args: payload.args && typeof payload.args === "object" && !Array.isArray(payload.args) ? payload.args : {}
    };
  }

  function success(command, data) {
    return [
      200,
      { "Content-Type": "application/json" },
      JSON.stringify({ ok: true, command, data })
    ];
  }

  function failure(error) {
    const normalized = error instanceof CommandValidationError
      ? error
      : new CommandValidationError(500, "INTERNAL_ERROR", error?.message || "Unknown error");
    return [
      normalized.status,
      { "Content-Type": "application/json" },
      JSON.stringify({
        ok: false,
        error: {
          code: normalized.code,
          message: normalized.message,
          details: normalized.details
        }
      })
    ];
  }

  return {
    TOKEN_HEADER,
    CommandValidationError,
    authorizeHeaders,
    normalizeCommandRequest,
    success,
    failure
  };
});
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --test tests/contract.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add plugin/shared/contract.js tests/contract.test.cjs
git commit -m "Add shared plugin contract"
```

### Task 3: Implement the plugin health endpoint and command bus skeleton

**Files:**
- Create: `plugin/bootstrap.js`
- Modify: `tests/contract.test.cjs`
- Modify: `plugin/manifest.json`
- Modify: `plugin/prefs.js.template`

- [ ] **Step 1: Write the failing command-registry test**

Append to `tests/contract.test.cjs`:

```js
test("bootstrap exports a command registry with health and collections.list", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  assert.equal(typeof bootstrap.createCommandRegistry, "function");
  const registry = bootstrap.createCommandRegistry({
    Zotero: {},
    contract: { CommandValidationError: Error }
  });
  assert.equal(typeof registry["health.get"], "function");
  assert.equal(typeof registry["collections.list"], "function");
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/contract.test.cjs
```

Expected: FAIL because `plugin/bootstrap.js` does not export the registry.

- [ ] **Step 3: Implement the plugin skeleton**

Create `plugin/bootstrap.js` with:

```js
"use strict";

const contract = require("./shared/contract.js");

function createCommandRegistry(context) {
  return {
    "health.get": async function () {
      return {
        ok: true,
        zoteroVersion: context.Zotero?.version || null,
        unsafeEnabled: false,
        experimentalAttachmentsEnabled: false
      };
    },
    "collections.list": async function () {
      return { collections: [] };
    }
  };
}

function createEndpoint(registry) {
  function Endpoint() {}
  Endpoint.prototype = {
    supportedMethods: ["POST"],
    supportedDataTypes: ["application/json"],
    init: async function (request) {
      try {
        contract.authorizeHeaders(request.headers, "__ZOTERO_AGENT_TOKEN__");
        const normalized = contract.normalizeCommandRequest(request.data || {});
        const handler = registry[normalized.command];
        if (!handler) {
          throw new contract.CommandValidationError(404, "NOT_FOUND", `Unknown command: ${normalized.command}`);
        }
        const data = await handler(normalized.args);
        return contract.success(normalized.command, data);
      } catch (error) {
        return contract.failure(error);
      }
    }
  };
  return Endpoint;
}

module.exports = {
  createCommandRegistry,
  createEndpoint
};
```

Set `plugin/manifest.json` to a minimal valid plugin manifest and set `plugin/prefs.js.template` to include:

```js
pref("extensions.zotero.zoteroAgent.token", "__ZOTERO_AGENT_TOKEN__");
pref("extensions.zotero.zoteroAgent.unsafeEnabled", false);
pref("extensions.zotero.zoteroAgent.experimentalAttachmentsEnabled", false);
```

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --test tests/contract.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add plugin/bootstrap.js plugin/manifest.json plugin/prefs.js.template tests/contract.test.cjs
git commit -m "Add plugin command bus skeleton"
```

### Task 4: Build the read-only CLI over Zotero's built-in local API

**Files:**
- Create: `scripts/zotero_cli.py`
- Create: `tests/cli.test.cjs`
- Modify: `README.md`

- [ ] **Step 1: Write the failing CLI test for read commands**

Create `tests/cli.test.cjs` with:

```js
const test = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");

test("help output includes collections and items read commands", () => {
  const result = spawnSync("python3", ["scripts/zotero_cli.py", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /collections/);
  assert.match(result.stdout, /items/);
  assert.match(result.stdout, /attachments/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/cli.test.cjs
```

Expected: FAIL because the CLI file does not exist.

- [ ] **Step 3: Implement the read CLI**

Create `scripts/zotero_cli.py` with:

- base URL default `http://127.0.0.1:23119`
- built-in read API root `http://127.0.0.1:23119/api/users/0`
- argparse command tree:
  - `collections list`
  - `items list`
  - `items get`
  - `items search`
  - `attachments list`
  - `attachments best-pdf`
  - `attachments path`
  - `attachments read-text`
  - `attachments export`

Implement minimal functions first:

```python
def print_json(value):
    print(json.dumps(value, indent=2, sort_keys=True))
```

Use `urllib.request` for HTTP GETs to built-in local API, and keep unresolved retrieval subcommands returning structured `NOT_IMPLEMENTED` JSON until later tasks.

- [ ] **Step 4: Run the focused test**

Run:

```bash
node --test tests/cli.test.cjs
python3 -m py_compile scripts/zotero_cli.py
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add scripts/zotero_cli.py tests/cli.test.cjs README.md
git commit -m "Add Zotero CLI read scaffolding"
```

### Task 5: Implement stable attachment retrieval

**Files:**
- Modify: `plugin/bootstrap.js`
- Modify: `tests/contract.test.cjs`
- Modify: `scripts/zotero_cli.py`
- Modify: `README.md`
- Create: `tests/README.md`

- [ ] **Step 1: Write the failing contract test for attachment helper commands**

Append to `tests/contract.test.cjs`:

```js
test("bootstrap registry includes stable attachment retrieval commands", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = bootstrap.createCommandRegistry({
    Zotero: {},
    contract: { CommandValidationError: Error }
  });
  assert.equal(typeof registry["attachments.path"], "function");
  assert.equal(typeof registry["attachments.readText"], "function");
  assert.equal(typeof registry["attachments.export"], "function");
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
node --test tests/contract.test.cjs
```

Expected: FAIL because the attachment helper commands do not exist.

- [ ] **Step 3: Implement stable attachment retrieval**

Update `plugin/bootstrap.js` registry to include:

- `attachments.path`
- `attachments.readText`
- `attachments.export`
- `attachments.open`

Use Zotero JavaScript API helpers to:

- resolve attachment by key
- confirm it is an attachment
- return file path
- return extracted text when available
- copy file contents to a caller-provided path for export

Update CLI wrappers to call the plugin command endpoint for these helper commands:

```text
zotero attachments path --attachment-key PDF123
zotero attachments read-text --attachment-key PDF123
zotero attachments export --attachment-key PDF123 --to /tmp/paper.pdf
zotero attachments open --attachment-key PDF123
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --test tests/contract.test.cjs
node --test tests/cli.test.cjs
python3 -m py_compile scripts/zotero_cli.py
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add plugin/bootstrap.js tests/contract.test.cjs scripts/zotero_cli.py README.md tests/README.md
git commit -m "Add stable attachment retrieval commands"
```

### Task 6: Implement structured write commands for collections, items, tags, and bulk operations

**Files:**
- Modify: `plugin/bootstrap.js`
- Modify: `tests/contract.test.cjs`
- Modify: `scripts/zotero_cli.py`
- Modify: `README.md`

- [ ] **Step 1: Write the failing registry test for core write commands**

Append to `tests/contract.test.cjs`:

```js
test("bootstrap registry includes core write and bulk commands", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = bootstrap.createCommandRegistry({
    Zotero: {},
    contract: { CommandValidationError: Error }
  });
  assert.equal(typeof registry["collections.create"], "function");
  assert.equal(typeof registry["items.create"], "function");
  assert.equal(typeof registry["items.setField"], "function");
  assert.equal(typeof registry["tags.add"], "function");
  assert.equal(typeof registry["bulk.trashItems"], "function");
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
node --test tests/contract.test.cjs
```

Expected: FAIL because the registry does not yet include the commands.

- [ ] **Step 3: Implement the core write commands**

Update `plugin/bootstrap.js` to support:

- `collections.list`
- `collections.create`
- `collections.rename`
- `collections.trash`
- `items.create`
- `items.update`
- `items.setField`
- `items.trash`
- `items.addToCollection`
- `items.removeFromCollection`
- `items.move`
- `tags.add`
- `tags.remove`
- `bulk.trashItems`
- `bulk.addToCollection`
- `bulk.removeFromCollection`
- `bulk.move`
- `bulk.addTag`
- `bulk.removeTag`

Update CLI commands to wrap these operations:

```text
zotero collections create --name "To Read"
zotero items create --item-type journalArticle --title "Example"
zotero items set-field --key ABC123 --field DOI --value 10.1000/test
zotero bulk trash --keys ABC123,DEF456
```

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --test tests/contract.test.cjs
node --test tests/cli.test.cjs
python3 -m py_compile scripts/zotero_cli.py
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add plugin/bootstrap.js tests/contract.test.cjs scripts/zotero_cli.py README.md
git commit -m "Add structured write and bulk Zotero commands"
```

### Task 7: Add guarded unsafe mode and experimental attachment mutation

**Files:**
- Modify: `plugin/bootstrap.js`
- Modify: `plugin/prefs.js.template`
- Modify: `tests/contract.test.cjs`
- Modify: `scripts/zotero_cli.py`
- Modify: `README.md`

- [ ] **Step 1: Write the failing unsafe/experimental tests**

Append to `tests/contract.test.cjs`:

```js
test("bootstrap registry includes unsafe and experimental attachment commands", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = bootstrap.createCommandRegistry({
    Zotero: {},
    contract: { CommandValidationError: Error }
  });
  assert.equal(typeof registry["unsafe.runJS"], "function");
  assert.equal(typeof registry["attachments.experimental.add"], "function");
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
node --test tests/contract.test.cjs
```

Expected: FAIL because the commands do not exist.

- [ ] **Step 3: Implement guarded advanced commands**

Update `plugin/bootstrap.js` and `plugin/prefs.js.template` so:

- `unsafe.runJS` checks `extensions.zotero.zoteroAgent.unsafeEnabled`
- experimental attachment mutation checks `extensions.zotero.zoteroAgent.experimentalAttachmentsEnabled`

Expose CLI commands:

```text
zotero unsafe run-js --code '...'
zotero attachments experimental add --item-key ABC123 --file /path/file.pdf
zotero attachments experimental trash --attachment-key PDF123
```

These commands must return structured `UNSAFE_DISABLED` or `EXPERIMENTAL_DISABLED` errors when the corresponding pref is off.

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --test tests/contract.test.cjs
node --test tests/cli.test.cjs
python3 -m py_compile scripts/zotero_cli.py
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add plugin/bootstrap.js plugin/prefs.js.template tests/contract.test.cjs scripts/zotero_cli.py README.md
git commit -m "Add unsafe mode and experimental attachment mutation"
```

### Task 8: Write the agent skill, docs, and manual verification checklist

**Files:**
- Create: `skills/zotero-manage/SKILL.md`
- Modify: `README.md`
- Modify: `tests/README.md`

- [ ] **Step 1: Write the failing documentation presence test**

Append to `tests/cli.test.cjs`:

```js
test("zotero-manage skill file exists", async () => {
  const fs = require("node:fs");
  assert.equal(fs.existsSync("skills/zotero-manage/SKILL.md"), true);
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run:

```bash
node --test tests/cli.test.cjs
```

Expected: FAIL because the skill file does not exist.

- [ ] **Step 3: Write the skill and docs**

Create `skills/zotero-manage/SKILL.md` covering:

- preconditions: Zotero running, plugin installed, token configured
- normal workflow: use `zotero` CLI
- read before mutate
- trash semantics
- stable attachment retrieval commands
- experimental attachment mutation boundary
- unsafe mode as last resort

Update `README.md` with:

- install steps
- token setup
- stable versus experimental support
- CLI examples

Update `tests/README.md` with a manual checklist for:

- health
- reads
- writes
- bulk
- attachment retrieval
- unsafe gate
- experimental gate

- [ ] **Step 4: Run the focused tests**

Run:

```bash
node --test tests/cli.test.cjs
```

Expected: PASS.

- [ ] **Step 5: Commit**

Run:

```bash
git add skills/zotero-manage/SKILL.md README.md tests/README.md tests/cli.test.cjs
git commit -m "Add Zotero manage skill and documentation"
```

### Task 9: Run full verification and produce the packaged plugin

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run automated verification**

Run:

```bash
npm test
npm run check:syntax
```

Expected: PASS.

- [ ] **Step 2: Build the XPI**

Run:

```bash
npm run build:xpi
```

Expected: PASS and produce `builds/`.

- [ ] **Step 3: Run CLI smoke checks**

Run:

```bash
python3 scripts/zotero_cli.py --help
sh bin/zotero --help
```

Expected: PASS.

- [ ] **Step 4: Update README with final file names if needed**

Ensure `README.md` references:

- `builds/zotero-local-agent-management.xpi` if that is the final package name
- `skills/zotero-manage/SKILL.md`
- `bin/zotero`

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md package.json plugin scripts bin skills tests
git commit -m "Finalize Zotero local agent management v1"
```
