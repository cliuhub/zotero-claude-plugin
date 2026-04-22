const test = require("node:test");
const assert = require("node:assert/strict");
const contract = require("../plugin/shared/contract.js");

test("package scripts include build and test commands", async () => {
  const pkg = require("../package.json");
  assert.equal(typeof pkg.scripts["build:xpi"], "string");
  assert.equal(typeof pkg.scripts.test, "string");
  assert.equal(typeof pkg.scripts["make-token"], "string");
});

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
