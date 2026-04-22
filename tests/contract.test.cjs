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

test("authorize accepts differently cased header keys", () => {
  assert.doesNotThrow(() => {
    contract.authorizeHeaders({ "X-Zotero-Agent-Token": "secret" }, "secret");
    contract.authorizeHeaders({ "X-ZOTERO-AGENT-TOKEN": "secret" }, "secret");
  });
});

test("authorize accepts Headers-like inputs and rejects invalid tokens", () => {
  const headers = new Map([["x-zotero-agent-token", "secret"]]);
  headers.get = Map.prototype.get;
  headers.has = Map.prototype.has;
  assert.doesNotThrow(() => {
    contract.authorizeHeaders(headers, "secret");
  });
  assert.throws(
    () => contract.authorizeHeaders({}, "secret"),
    (error) => error.code === "AUTH_REQUIRED"
  );
  assert.throws(
    () => contract.authorizeHeaders({ "x-zotero-agent-token": "wrong" }, "secret"),
    (error) => error.code === "AUTH_REQUIRED"
  );
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

test("success payload always includes data", () => {
  const [status, headers, body] = contract.success("collections.list", undefined);
  assert.equal(status, 200);
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(body), {
    ok: true,
    command: "collections.list",
    data: {}
  });
});

test("failure payload serializes validation errors", () => {
  const [status, headers, body] = contract.failure(
    new contract.CommandValidationError(403, "DENIED", "Nope", { field: "token" })
  );
  assert.equal(status, 403);
  assert.equal(headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(body), {
    ok: false,
    error: {
      code: "DENIED",
      message: "Nope",
      details: { field: "token" }
    }
  });
});
