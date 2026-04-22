const test = require("node:test");
const assert = require("node:assert/strict");
const contract = require("../plugin/shared/contract.js");

test("package scripts include build and test commands", async () => {
  const pkg = require("../package.json");
  assert.equal(typeof pkg.scripts["build:xpi"], "string");
  assert.equal(typeof pkg.scripts.test, "string");
  assert.equal(typeof pkg.scripts["make-token"], "string");
});

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

test("createEndpoint dispatches a known command when authorized", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = {
    "collections.list": async (args) => ({ received: args })
  };
  const Endpoint = bootstrap.createEndpoint(registry, { expectedToken: "real-token" });
  const endpoint = new Endpoint();

  const response = await endpoint.init({
    headers: { "x-zotero-agent-token": "real-token" },
    data: { command: "collections.list", args: { limit: 5 } }
  });

  assert.deepEqual(response, [
    200,
    { "Content-Type": "application/json" },
    JSON.stringify({
      ok: true,
      command: "collections.list",
      data: { received: { limit: 5 } }
    })
  ]);
});

test("createEndpoint accepts an injected tokenSource", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = {
    "collections.list": async () => ({ collections: [] })
  };
  const Endpoint = bootstrap.createEndpoint(registry, {
    tokenSource: () => "runtime-token"
  });
  const endpoint = new Endpoint();

  const response = await endpoint.init({
    headers: { "x-zotero-agent-token": "runtime-token" },
    data: { command: "collections.list" }
  });

  assert.deepEqual(response, [
    200,
    { "Content-Type": "application/json" },
    JSON.stringify({
      ok: true,
      command: "collections.list",
      data: { collections: [] }
    })
  ]);
});

test("createEndpoint returns a not-found failure for unknown commands", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const Endpoint = bootstrap.createEndpoint({}, { expectedToken: "real-token" });
  const endpoint = new Endpoint();

  const response = await endpoint.init({
    headers: { "x-zotero-agent-token": "real-token" },
    data: { command: "missing.command" }
  });

  assert.deepEqual(response, [
    404,
    { "Content-Type": "application/json" },
    JSON.stringify({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Unknown command: missing.command",
        details: {}
      }
    })
  ]);
});

test("createEndpoint returns an auth failure when the token is missing", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = {
    "collections.list": async () => ({ collections: [] })
  };
  const Endpoint = bootstrap.createEndpoint(registry, { expectedToken: "real-token" });
  const endpoint = new Endpoint();

  const response = await endpoint.init({
    headers: {},
    data: { command: "collections.list" }
  });

  assert.deepEqual(response, [
    401,
    { "Content-Type": "application/json" },
    JSON.stringify({
      ok: false,
      error: {
        code: "AUTH_REQUIRED",
        message: "Missing or invalid token",
        details: {}
      }
    })
  ]);
});

test("createEndpoint rejects prototype-name commands instead of dispatching them", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = {};
  const Endpoint = bootstrap.createEndpoint(registry, { expectedToken: "real-token" });
  const endpoint = new Endpoint();

  const response = await endpoint.init({
    headers: { "x-zotero-agent-token": "real-token" },
    data: { command: "constructor", args: { limit: 5 } }
  });

  assert.deepEqual(response, [
    404,
    { "Content-Type": "application/json" },
    JSON.stringify({
      ok: false,
      error: {
        code: "NOT_FOUND",
        message: "Unknown command: constructor",
        details: {}
      }
    })
  ]);
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
