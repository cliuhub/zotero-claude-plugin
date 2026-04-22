const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

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
  assert.match(result.stdout, /notes/);
  assert.match(result.stdout, /tags/);
  assert.match(result.stdout, /bulk/);
});

test("items help includes DOI lookup and create support", () => {
  const result = spawnSync("python3", ["scripts/zotero_cli.py", "items", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /lookup-doi/);
  assert.match(result.stdout, /paper/);
  assert.match(result.stdout, /create/);
});

test("attachments help includes stable retrieval commands", () => {
  const result = spawnSync("python3", ["scripts/zotero_cli.py", "attachments", "--help"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /best-pdf/);
  assert.match(result.stdout, /path/);
  assert.match(result.stdout, /read-text/);
  assert.match(result.stdout, /export/);
  assert.match(result.stdout, /open/);
});

test("attachments path posts the plugin command without auth setup", async () => {
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

test("attachments read-text uses the local PDF parser helper by default for PDFs", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body);
      requests.push(payload);
      if (payload.command === "attachments.path") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          command: "attachments.path",
          data: {
            attachmentKey: "PDF123",
            itemID: 42,
            parentItemID: 7,
            title: "Stored PDF",
            contentType: "application/pdf",
            linkMode: 1,
            path: "/tmp/stored-paper.pdf"
          }
        }));
        return;
      }
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { message: "unexpected command" } }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zotero-pdf-helper-"));
  const helperPath = path.join(tempDir, "mock-helper.py");
  fs.writeFileSync(
    helperPath,
    [
      "#!/usr/bin/env python3",
      "import json",
      "print(json.dumps({",
      "  'ok': True,",
      "  'extractor': 'local-pdfplumber',",
      "  'pageCount': 1,",
      "  'selectedPages': {'pdfplumber': 1},",
      "  'pages': [{'pageNumber': 1, 'parser': 'pdfplumber', 'textChars': 24}],",
      "  'renderToolAvailable': True,",
      "  'text': 'PDF SKILL TEXT FROM HELPER'",
      "}))",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(helperPath, 0o755);

  try {
    const result = await spawnResult(
      "python3",
      [
        "scripts/zotero_cli.py",
        "--base-url",
        baseUrl,
        "attachments",
        "read-text",
        "--attachment-key",
        "PDF123"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ZOTERO_PDF_TEXT_HELPER: helperPath
        }
      }
    );

    assert.equal(result.code, 0);
    assert.deepEqual(requests, [{
      command: "attachments.path",
      args: {
        attachmentKey: "PDF123"
      }
    }]);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "attachments.readText");
    assert.equal(payload.data.text, "PDF SKILL TEXT FROM HELPER");
    assert.equal(payload.data.extraction.extractor, "local-pdfplumber");
    assert.equal(payload.data.extraction.mode, "pdf");
    assert.equal(payload.data.extraction.renderToolAvailable, true);
    assert.equal(payload.data.extraction.selectedPages.pdfplumber, 1);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("attachments read-text can still delegate to Zotero's built-in text path", async () => {
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
        command: "attachments.readText",
        data: {
          attachmentKey: "PDF123",
          path: "/tmp/stored-paper.pdf",
          text: "Zotero built-in text"
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
        "attachments",
        "read-text",
        "--attachment-key",
        "PDF123",
        "--extractor",
        "zotero"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    assert.deepEqual(requests, [
      {
        command: "attachments.path",
        args: {
          attachmentKey: "PDF123"
        }
      },
      {
        command: "attachments.readText",
        args: {
          attachmentKey: "PDF123"
        }
      }
    ]);
    assert.equal(JSON.parse(result.stdout).data.text, "Zotero built-in text");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("attachments read-text can run OCRmyPDF and then parse the OCR output PDF", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body);
      requests.push(payload);
      if (payload.command === "attachments.path") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          command: "attachments.path",
          data: {
            attachmentKey: "PDF123",
            itemID: 42,
            parentItemID: 7,
            title: "Stored PDF",
            contentType: "application/pdf",
            linkMode: 1,
            path: "/tmp/stored-paper.pdf"
          }
        }));
        return;
      }
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { message: "unexpected command" } }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zotero-ocrmypdf-"));
  const ocrmypdfPath = path.join(tempDir, "mock-ocrmypdf.py");
  const helperPath = path.join(tempDir, "mock-parser.py");

  fs.writeFileSync(
    ocrmypdfPath,
    [
      "#!/usr/bin/env python3",
      "from pathlib import Path",
      "import sys",
      "Path(sys.argv[-1]).write_bytes(b'%PDF-1.4\\n%mock\\n')",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(ocrmypdfPath, 0o755);

  fs.writeFileSync(
    helperPath,
    [
      "#!/usr/bin/env python3",
      "import json",
      "print(json.dumps({",
      "  'ok': True,",
      "  'extractor': 'local-pdfplumber',",
      "  'pageCount': 1,",
      "  'selectedPages': {'pdfplumber': 1},",
      "  'pages': [{'pageNumber': 1, 'parser': 'pdfplumber', 'textChars': 31}],",
      "  'renderToolAvailable': True,",
      "  'text': 'OCRmyPDF PARSED TEXT FROM HELPER'",
      "}))",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(helperPath, 0o755);

  try {
    const result = await spawnResult(
      "python3",
      [
        "scripts/zotero_cli.py",
        "--base-url",
        baseUrl,
        "attachments",
        "read-text",
        "--attachment-key",
        "PDF123",
        "--extractor",
        "ocrmypdf-redo"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ZOTERO_OCRMYPDF_BIN: ocrmypdfPath,
          ZOTERO_PDF_TEXT_HELPER: helperPath
        }
      }
    );

    assert.equal(result.code, 0);
    assert.deepEqual(requests, [{
      command: "attachments.path",
      args: {
        attachmentKey: "PDF123"
      }
    }]);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "attachments.readText");
    assert.equal(payload.data.text, "OCRmyPDF PARSED TEXT FROM HELPER");
    assert.equal(payload.data.extraction.extractor, "local-ocrmypdf-redo");
    assert.equal(payload.data.extraction.mode, "ocrmypdf-redo");
    assert.equal(payload.data.extraction.ocrmypdfMode, "redo");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("attachments read-text auto mode falls back to OCRmyPDF when the first parse is clearly bad", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      const payload = JSON.parse(body);
      requests.push(payload);
      if (payload.command === "attachments.path") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          ok: true,
          command: "attachments.path",
          data: {
            attachmentKey: "PDF123",
            itemID: 42,
            parentItemID: 7,
            title: "Stored PDF",
            contentType: "application/pdf",
            linkMode: 1,
            path: "/tmp/stored-paper.pdf"
          }
        }));
        return;
      }
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: { message: "unexpected command" } }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zotero-auto-fallback-"));
  const ocrmypdfPath = path.join(tempDir, "mock-ocrmypdf.py");
  const helperPath = path.join(tempDir, "mock-parser.py");

  fs.writeFileSync(
    ocrmypdfPath,
    [
      "#!/usr/bin/env python3",
      "from pathlib import Path",
      "import sys",
      "Path(sys.argv[-1]).write_bytes(b'%PDF-1.4\\n%mock\\n')",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(ocrmypdfPath, 0o755);

  fs.writeFileSync(
    helperPath,
    [
      "#!/usr/bin/env python3",
      "import json",
      "import os",
      "import sys",
      "path = sys.argv[sys.argv.index('--path') + 1]",
      "if path.endswith('ocr-output.pdf'):",
      "  payload = {",
      "    'ok': True,",
      "    'extractor': 'local-pdfplumber',",
      "    'pageCount': 4,",
      "    'selectedPages': {'pdfplumber': 4},",
      "    'pages': [{'pageNumber': i + 1, 'parser': 'pdfplumber', 'textChars': 1200} for i in range(4)],",
      "    'renderToolAvailable': True,",
      "    'text': 'Recovered OCR text with real paper content'",
      "  }",
      "else:",
      "  payload = {",
      "    'ok': True,",
      "    'extractor': 'local-pdfplumber',",
      "    'pageCount': 4,",
      "    'selectedPages': {'pdfplumber': 4},",
      "    'pages': [{'pageNumber': i + 1, 'parser': 'pdfplumber', 'textChars': 80} for i in range(4)],",
      "    'renderToolAvailable': True,",
      "    'text': 'Reproduced with permission of the copyright owner. Reproduced with permission of the copyright owner. Reproduced with permission of the copyright owner.'",
      "  }",
      "print(json.dumps(payload))",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(helperPath, 0o755);

  try {
    const result = await spawnResult(
      "python3",
      [
        "scripts/zotero_cli.py",
        "--base-url",
        baseUrl,
        "attachments",
        "read-text",
        "--attachment-key",
        "PDF123"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ZOTERO_OCRMYPDF_BIN: ocrmypdfPath,
          ZOTERO_PDF_TEXT_HELPER: helperPath
        }
      }
    );

    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.data.text, "Recovered OCR text with real paper content");
    assert.equal(payload.data.extraction.mode, "ocrmypdf-redo");
    assert.equal(payload.data.extraction.requestedMode, "auto");
    assert.equal(payload.data.extraction.extractor, "local-ocrmypdf-redo");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
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

test("plugin-backed commands work without extra auth setup", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({
        headers: req.headers,
        body: JSON.parse(body)
      });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        command: "collections.create",
        data: {
          collectionKey: "AUTO123"
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
        "collections",
        "create",
        "--name",
        "CLI Smoke"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].body, {
      command: "collections.create",
      args: {
        name: "CLI Smoke",
        parentCollectionKey: null
      }
    });
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

test("items list supports filtering by collection key through the built-in API", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{
      key: "ITEM123",
      version: 17,
      data: {
        key: "ITEM123",
        itemType: "journalArticle",
        title: "Agent Pipeline Paper",
        DOI: "10.1000/example",
        collections: ["COLL123"],
        tags: [{ tag: "queued" }],
        creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }]
      },
      links: {
        attachment: {
          href: "http://localhost:23119/api/users/0/items/PDF123",
          attachmentType: "application/pdf",
          attachmentSize: 321
        }
      },
      meta: {
        numChildren: 1,
        creatorSummary: "Lovelace"
      },
      library: {
        id: 1,
        name: "My Library"
      }
    }]));
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
        "items",
        "list",
        "--collection-key",
        "COLL123",
        "--limit",
        "2"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    assert.deepEqual(requests, [{
      method: "GET",
      url: "/api/users/0/collections/COLL123/items?limit=2"
    }]);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "items.list");
    assert.deepEqual(payload.data, [{
      itemKey: "ITEM123",
      itemType: "journalArticle",
      title: "Agent Pipeline Paper",
      parentItemKey: null,
      collectionKeys: ["COLL123"],
      tags: ["queued"],
      creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }],
      date: null,
      dateAdded: null,
      dateModified: null,
      doi: "10.1000/example",
      url: null,
      publicationTitle: null,
      abstractNote: null,
      creatorSummary: "Lovelace",
      childCount: 1,
      parsedDate: null,
      bestAttachment: {
        attachmentKey: "PDF123",
        contentType: "application/pdf",
        size: 321
      },
      version: 17,
      libraryID: 1,
      libraryName: "My Library",
      fields: {
        key: "ITEM123",
        itemType: "journalArticle",
        title: "Agent Pipeline Paper",
        DOI: "10.1000/example",
        collections: ["COLL123"],
        tags: [{ tag: "queued" }],
        creators: [{ creatorType: "author", firstName: "Ada", lastName: "Lovelace" }]
      }
    }]);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("attachments best-pdf chooses the strongest local PDF attachment", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([
      {
        data: {
          key: "HTML123",
          itemType: "attachment",
          parentItem: "ITEM123",
          title: "Snapshot",
          filename: "paper.html",
          contentType: "text/html",
          linkMode: "imported_url"
        },
        links: {
          enclosure: {
            href: "file:///tmp/paper.html"
          }
        }
      },
      {
        data: {
          key: "PDF999",
          itemType: "attachment",
          parentItem: "ITEM123",
          title: "Full Text PDF",
          filename: "paper.pdf",
          contentType: "application/pdf",
          linkMode: "imported_file"
        },
        links: {
          enclosure: {
            href: "file:///tmp/paper.pdf",
            length: 555
          }
        }
      }
    ]));
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
        "attachments",
        "best-pdf",
        "--item-key",
        "ITEM123"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    assert.deepEqual(requests, [{
      method: "GET",
      url: "/api/users/0/items/ITEM123/children"
    }]);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "attachments.best-pdf");
    assert.deepEqual(payload.data, {
      attachmentKey: "PDF999",
      parentItemKey: "ITEM123",
      title: "Full Text PDF",
      filename: "paper.pdf",
      contentType: "application/pdf",
      linkMode: "imported_file",
      dateAdded: null,
      dateModified: null,
      size: 555,
      fileURL: "file:///tmp/paper.pdf",
      localPath: "/tmp/paper.pdf",
      version: null,
      fields: {
        key: "PDF999",
        itemType: "attachment",
        parentItem: "ITEM123",
        title: "Full Text PDF",
        filename: "paper.pdf",
        contentType: "application/pdf",
        linkMode: "imported_file"
      }
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("items paper resolves the best PDF and returns parsed text in one response", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method === "GET") {
      requests.push({ method: req.method, url: req.url });
      if (req.url === "/api/users/0/items/ITEM123") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          key: "ITEM123",
          version: 10,
          data: {
            key: "ITEM123",
            itemType: "journalArticle",
            title: "Paper Command Test",
            collections: ["COLL1"],
            tags: []
          },
          meta: {
            numChildren: 1
          }
        }));
        return;
      }
      if (req.url === "/api/users/0/items/ITEM123/children") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{
          data: {
            key: "PDF123",
            itemType: "attachment",
            parentItem: "ITEM123",
            title: "Full Text PDF",
            filename: "paper.pdf",
            contentType: "application/pdf",
            linkMode: "imported_file"
          },
          links: {
            enclosure: {
              href: "file:///tmp/paper.pdf",
              length: 555
            }
          }
        }]));
        return;
      }
    }

    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
    });
    req.on("end", () => {
      requests.push({ method: req.method, url: req.url, body: JSON.parse(body) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        ok: true,
        command: "attachments.path",
        data: {
          attachmentKey: "PDF123",
          title: "Full Text PDF",
          contentType: "application/pdf",
          path: "/tmp/paper.pdf"
        }
      }));
    });
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zotero-paper-helper-"));
  const helperPath = path.join(tempDir, "mock-paper-helper.py");
  fs.writeFileSync(
    helperPath,
    [
      "#!/usr/bin/env python3",
      "import json",
      "print(json.dumps({",
      "  'ok': True,",
      "  'extractor': 'local-pdfplumber',",
      "  'pageCount': 1,",
      "  'selectedPages': {'pdfplumber': 1},",
      "  'pages': [{'pageNumber': 1, 'parser': 'pdfplumber', 'textChars': 19}],",
      "  'renderToolAvailable': True,",
      "  'text': 'PAPER COMMAND TEXT'",
      "}))",
      ""
    ].join("\n"),
    "utf8"
  );
  fs.chmodSync(helperPath, 0o755);

  try {
    const result = await spawnResult(
      "python3",
      [
        "scripts/zotero_cli.py",
        "--base-url",
        baseUrl,
        "items",
        "paper",
        "--key",
        "ITEM123"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ZOTERO_PDF_TEXT_HELPER: helperPath
        }
      }
    );

    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "items.paper");
    assert.equal(payload.data.item.itemKey, "ITEM123");
    assert.equal(payload.data.attachment.attachmentKey, "PDF123");
    assert.equal(payload.data.attachment.text, "PAPER COMMAND TEXT");
    assert.equal(payload.data.attachment.extraction.mode, "pdf");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("notes list normalizes note children for agent use", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify([{
      data: {
        key: "NOTE123",
        itemType: "note",
        parentItem: "ITEM123",
        note: "<p>First paragraph</p><p>Second paragraph</p>",
        dateAdded: "2026-04-23T00:00:00Z",
        dateModified: "2026-04-23T01:00:00Z"
      }
    }]));
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
        "notes",
        "list",
        "--item-key",
        "ITEM123"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "notes.list");
    assert.deepEqual(payload.data, [{
      noteKey: "NOTE123",
      parentItemKey: "ITEM123",
      title: "First paragraph Second paragraph",
      preview: "First paragraph Second paragraph",
      dateAdded: "2026-04-23T00:00:00Z",
      dateModified: "2026-04-23T01:00:00Z",
      version: null,
      fields: {
        key: "NOTE123",
        itemType: "note",
        parentItem: "ITEM123",
        note: "<p>First paragraph</p><p>Second paragraph</p>",
        dateAdded: "2026-04-23T00:00:00Z",
        dateModified: "2026-04-23T01:00:00Z"
      }
    }]);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("notes upsert posts note content to the plugin command endpoint", async () => {
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
        command: "notes.upsert",
        data: {
          noteKey: "NOTE123",
          parentItemKey: "ITEM123",
          title: "Saved note",
          preview: "Saved note"
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
        "notes",
        "upsert",
        "--item-key",
        "ITEM123",
        "--note",
        "Saved note"
      ],
      { cwd: process.cwd(), encoding: "utf8" }
    );

    assert.equal(result.code, 0);
    assert.deepEqual(requests, [{
      command: "notes.upsert",
      args: {
        noteKey: null,
        parentItemKey: "ITEM123",
        note: "Saved note"
      }
    }]);
    assert.equal(JSON.parse(result.stdout).command, "notes.upsert");
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("items lookup-doi resolves CSL metadata into Zotero-shaped fields", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, headers: req.headers });
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      title: "Example DOI Title",
      type: "article-journal",
      DOI: "10.1000/example",
      URL: "https://doi.org/10.1000/example",
      "container-title": "Journal of Tests",
      author: [
        { given: "Ada", family: "Lovelace" }
      ],
      issued: { "date-parts": [[2024, 5, 1]] }
    }));
  });

  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  const doiBaseUrl = `http://127.0.0.1:${address.port}/doi`;

  try {
    const result = await spawnResult(
      "python3",
      [
        "scripts/zotero_cli.py",
        "items",
        "lookup-doi",
        "--doi",
        "10.1000/example"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ZOTERO_DOI_LOOKUP_BASE_URL: doiBaseUrl
        }
      }
    );

    assert.equal(result.code, 0);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[0].url, "/doi/10.1000%2Fexample");
    assert.equal(requests[0].headers.accept, "application/vnd.citationstyles.csl+json");
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "items.lookupDOI");
    assert.equal(payload.data.itemType, "journalArticle");
    assert.equal(payload.data.fields.title, "Example DOI Title");
    assert.equal(payload.data.fields.publicationTitle, "Journal of Tests");
    assert.equal(payload.data.fields.DOI, "10.1000/example");
    assert.deepEqual(payload.data.fields.creators, [{
      firstName: "Ada",
      lastName: "Lovelace",
      creatorType: "author"
    }]);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test("items create --doi resolves metadata before posting the create command", async () => {
  const requests = [];
  const server = http.createServer((req, res) => {
    if (req.method === "GET" && req.url.startsWith("/doi/")) {
      requests.push({ method: req.method, url: req.url, headers: req.headers });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({
        title: "Conference Paper",
        type: "proceedings-article",
        DOI: "10.1000/conf-paper",
        URL: "https://doi.org/10.1000/conf-paper",
        "container-title": "Proceedings of Testing",
        author: [
          { given: "Grace", family: "Hopper" }
        ],
        issued: { "date-parts": [[2023]] }
      }));
      return;
    }

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
        command: "items.create",
        data: {
          itemKey: "NEW123"
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
        "items",
        "create",
        "--doi",
        "10.1000/conf-paper",
        "--collection-keys",
        "COLL123"
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: {
          ...process.env,
          ZOTERO_DOI_LOOKUP_BASE_URL: `${baseUrl}/doi`
        }
      }
    );

    assert.equal(result.code, 0);
    assert.equal(requests.length, 2);
    assert.equal(requests[0].method, "GET");
    assert.equal(requests[1].method, "POST");
    assert.equal(requests[1].url, "/agent/command");
    assert.deepEqual(requests[1].body, {
      command: "items.create",
      args: {
        itemType: "conferencePaper",
        fields: {
          title: "Conference Paper",
          date: "2023",
          DOI: "10.1000/conf-paper",
          url: "https://doi.org/10.1000/conf-paper",
          proceedingsTitle: "Proceedings of Testing",
          creators: [{
            firstName: "Grace",
            lastName: "Hopper",
            creatorType: "author"
          }]
        },
        collectionKeys: ["COLL123"]
      }
    });
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.command, "items.create");
    assert.equal(payload.data.lookup.doi, "10.1000/conf-paper");
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

test("zotero-manage skill file exists", async () => {
  const fs = require("node:fs");
  assert.equal(fs.existsSync("skills/zotero-manage/SKILL.md"), true);
});
