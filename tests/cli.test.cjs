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
