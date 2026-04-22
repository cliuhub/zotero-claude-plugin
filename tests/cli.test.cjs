const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");

function spawnResult(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}

test("help output includes collections and items read commands", () => {
  const result = spawnSync("python3", ["scripts/zotero_cli.py", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /collections/);
  assert.match(result.stdout, /items/);
  assert.match(result.stdout, /attachments/);
  assert.match(result.stdout, /tags/);
  assert.match(result.stdout, /bulk/);
});

test("attachments help includes stable retrieval commands", () => {
  const result = spawnSync("python3", ["scripts/zotero_cli.py", "attachments", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /path/);
  assert.match(result.stdout, /read-text/);
  assert.match(result.stdout, /export/);
  assert.match(result.stdout, /open/);
});

test("attachments path posts the plugin command with the auth token", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({
        method: req.method,
        url: req.url,
        headers: req.headers,
        body: JSON.parse(body)
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        command: "attachments.path",
        data: {
          attachmentKey: "PDF123",
          path: "/tmp/stored-paper.pdf"
        }
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await spawnResult(
      "python3",
      [
        "scripts/zotero_cli.py",
        "--base-url",
        baseUrl,
        "--token",
        "real-token",
        "attachments",
        "path",
        "--attachment-key",
        "PDF123"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/agent/command");
    assert.equal(requests[0].headers["x-zotero-agent-token"], "real-token");
    assert.deepEqual(requests[0].body, {
      command: "attachments.path",
      args: {
        attachmentKey: "PDF123"
      }
    });
    assert.deepEqual(JSON.parse(result.stdout), {
      ok: true,
      command: "attachments.path",
      data: {
        attachmentKey: "PDF123",
        path: "/tmp/stored-paper.pdf"
      }
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("items set-field posts the plugin command with JSON payload", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        command: "items.setField",
        data: {
          itemKey: "ITEM123",
          field: "DOI",
          value: "10.1000/test"
        }
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await spawnResult(
      "python3",
      [
        "scripts/zotero_cli.py",
        "--base-url",
        baseUrl,
        "--token",
        "real-token",
        "items",
        "set-field",
        "--key",
        "ITEM123",
        "--field",
        "DOI",
        "--value",
        "10.1000/test"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    assert.deepEqual(requests, [{
      command: "items.setField",
      args: {
        itemKey: "ITEM123",
        field: "DOI",
        value: "10.1000/test"
      }
    }]);
    assert.equal(JSON.parse(result.stdout).command, "items.setField");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("bulk trash parses comma-separated keys into an array", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        command: "bulk.trashItems",
        data: {
          count: 2,
          itemKeys: ["AAA111", "BBB222"]
        }
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await spawnResult(
      "python3",
      [
        "scripts/zotero_cli.py",
        "--base-url",
        baseUrl,
        "--token",
        "real-token",
        "bulk",
        "trash",
        "--keys",
        "AAA111,BBB222"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    assert.deepEqual(requests, [{
      command: "bulk.trashItems",
      args: {
        itemKeys: ["AAA111", "BBB222"]
      }
    }]);
    assert.equal(JSON.parse(result.stdout).command, "bulk.trashItems");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("unsafe run-js posts the raw code payload to the plugin command bus", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        command: "unsafe.runJS",
        data: {
          result: {
            echoed: "return 1;"
          }
        }
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await spawnResult(
      "python3",
      [
        "scripts/zotero_cli.py",
        "--base-url",
        baseUrl,
        "--token",
        "real-token",
        "unsafe",
        "run-js",
        "--code",
        "return 1;"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    assert.deepEqual(requests, [{
      command: "unsafe.runJS",
      args: {
        code: "return 1;"
      }
    }]);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("attachments experimental add posts the file payload to the plugin command bus", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push(JSON.parse(body));
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        command: "attachments.experimental.add",
        data: {
          attachmentKey: "EXP123",
          path: "/tmp/paper.pdf"
        }
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    const result = await spawnResult(
      "python3",
      [
        "scripts/zotero_cli.py",
        "--base-url",
        baseUrl,
        "--token",
        "real-token",
        "attachments",
        "experimental",
        "add",
        "--item-key",
        "ITEM123",
        "--file",
        "/tmp/paper.pdf",
        "--title",
        "Main PDF"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    assert.deepEqual(requests, [{
      command: "attachments.experimental.add",
      args: {
        itemKey: "ITEM123",
        file: "/tmp/paper.pdf",
        title: "Main PDF"
      }
    }]);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
