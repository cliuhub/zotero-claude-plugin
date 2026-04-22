const test = require("node:test");
const assert = require("node:assert/strict");
const contract = require("../plugin/shared/contract.js");

function createAttachment(overrides = {}) {
  const fields = { title: "Stored PDF", ...(overrides.fields || {}) };
  return {
    key: "PDF123",
    id: 42,
    parentItemID: 7,
    attachmentContentType: "application/pdf",
    attachmentLinkMode: 1,
    isAttachment: () => true,
    getField: (field) => fields[field] || null,
    getFilePathAsync: async () => "/tmp/stored-paper.pdf",
    attachmentText: Promise.resolve("Extracted attachment text"),
    ...overrides,
  };
}

function createCollection(overrides = {}) {
  const collection = {
    key: "COLL123",
    id: 21,
    name: "Inbox",
    parentKey: null,
    deleted: false,
    saveCalls: 0,
    saveTx: async function () {
      this.saveCalls += 1;
      return this.id;
    },
    ...overrides,
  };
  return collection;
}

function createNote(overrides = {}) {
  let noteHTML = overrides.noteHTML ?? "<p>Original note</p>";
  const note = {
    key: "NOTE123",
    id: 66,
    itemType: "note",
    libraryID: 1,
    parentItemID: 88,
    parentKey: "ITEM123",
    deleted: false,
    saveCalls: 0,
    isNote: () => true,
    getNote() {
      return noteHTML;
    },
    setNote(next) {
      noteHTML = next;
    },
    saveTx: async function () {
      this.saveCalls += 1;
      return this.id;
    },
    ...overrides,
  };
  return note;
}

function createItem(overrides = {}) {
  const fields = { title: "Original Title", ...(overrides.fields || {}) };
  const collectionIDs = [...(overrides.collectionIDs || [])];
  const tags = [...(overrides.tags || [])];
  const item = {
    key: "ITEM123",
    id: 88,
    itemType: "journalArticle",
    libraryID: 1,
    deleted: false,
    saveCalls: 0,
    setField(field, value) {
      fields[field] = value;
    },
    getField(field) {
      return fields[field] ?? null;
    },
    getCollections() {
      return [...collectionIDs];
    },
    setCollections(nextCollections) {
      collectionIDs.splice(0, collectionIDs.length, ...nextCollections);
    },
    addTag(tag) {
      if (!tags.includes(tag)) {
        tags.push(tag);
      }
    },
    removeTag(tag) {
      const index = tags.indexOf(tag);
      if (index !== -1) {
        tags.splice(index, 1);
      }
    },
    getTags() {
      return tags.map((tag) => ({ tag }));
    },
    saveTx: async function () {
      this.saveCalls += 1;
      return this.id;
    },
    _fields: fields,
    _collectionIDs: collectionIDs,
    _tags: tags,
    ...overrides,
  };
  return item;
}

test("package scripts include build and test commands", async () => {
  const pkg = require("../package.json");
  assert.equal(typeof pkg.scripts["build:xpi"], "string");
  assert.equal(typeof pkg.scripts["install:source"], "string");
  assert.equal(typeof pkg.scripts.test, "string");
});

test("plugin manifest includes a Zotero addon id", async () => {
  const manifest = require("../plugin/manifest.json");
  assert.equal(typeof manifest.applications?.zotero?.id, "string");
  assert.match(manifest.applications.zotero.id, /@/);
  assert.equal(typeof manifest.applications.zotero.update_url, "string");
  assert.match(manifest.applications.zotero.update_url, /^https:\/\//);
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

test("health endpoint uses Zotero single-request signature", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  assert.equal(typeof bootstrap.createHealthEndpoint, "function");
  const Endpoint = bootstrap.createHealthEndpoint({
    "health.get": async () => ({ ok: true })
  });
  const endpoint = new Endpoint();
  assert.equal(endpoint.init.length, 1);
});

test("bootstrap registry includes stable attachment retrieval commands", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = bootstrap.createCommandRegistry({
    Zotero: {},
    contract: { CommandValidationError: Error }
  });
  assert.equal(typeof registry["attachments.path"], "function");
  assert.equal(typeof registry["attachments.readText"], "function");
  assert.equal(typeof registry["attachments.export"], "function");
  assert.equal(typeof registry["attachments.open"], "function");
});

test("bootstrap registry includes core write, note, and bulk commands", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = bootstrap.createCommandRegistry({
    Zotero: {},
    contract: { CommandValidationError: Error }
  });
  assert.equal(typeof registry["collections.create"], "function");
  assert.equal(typeof registry["collections.rename"], "function");
  assert.equal(typeof registry["collections.trash"], "function");
  assert.equal(typeof registry["items.create"], "function");
  assert.equal(typeof registry["items.update"], "function");
  assert.equal(typeof registry["items.setField"], "function");
  assert.equal(typeof registry["items.trash"], "function");
  assert.equal(typeof registry["items.addToCollection"], "function");
  assert.equal(typeof registry["items.removeFromCollection"], "function");
  assert.equal(typeof registry["items.move"], "function");
  assert.equal(typeof registry["notes.upsert"], "function");
  assert.equal(typeof registry["notes.trash"], "function");
  assert.equal(typeof registry["tags.add"], "function");
  assert.equal(typeof registry["tags.remove"], "function");
  assert.equal(typeof registry["bulk.trashItems"], "function");
  assert.equal(typeof registry["bulk.addToCollection"], "function");
  assert.equal(typeof registry["bulk.removeFromCollection"], "function");
  assert.equal(typeof registry["bulk.move"], "function");
  assert.equal(typeof registry["bulk.addTag"], "function");
  assert.equal(typeof registry["bulk.removeTag"], "function");
});

test("bootstrap registry includes unsafe and experimental attachment commands", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = bootstrap.createCommandRegistry({
    Zotero: {},
    contract: { CommandValidationError: Error }
  });
  assert.equal(typeof registry["unsafe.runJS"], "function");
  assert.equal(typeof registry["attachments.experimental.add"], "function");
  assert.equal(typeof registry["attachments.experimental.trash"], "function");
});

test("unsafe and experimental commands are disabled by default", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = bootstrap.createCommandRegistry({
    getPref: () => false,
    resolveItemByKey: async () => createItem(),
    resolveAttachmentByKey: async () => createAttachment()
  });

  await assert.rejects(
    () => registry["unsafe.runJS"]({ code: "return 1;" }),
    (error) => error.code === "UNSAFE_DISABLED"
  );
  await assert.rejects(
    () => registry["attachments.experimental.add"]({
      itemKey: "ITEM123",
      file: "/tmp/paper.pdf"
    }),
    (error) => error.code === "EXPERIMENTAL_DISABLED"
  );
  await assert.rejects(
    () => registry["attachments.experimental.trash"]({
      attachmentKey: "PDF123"
    }),
    (error) => error.code === "EXPERIMENTAL_DISABLED"
  );
});

test("unsafe and experimental commands run when the corresponding prefs are enabled", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const createdAttachment = createAttachment({
    key: "EXP123",
    id: 77,
    parentItemID: 88,
    getField: (field) => field === "title" ? "Main PDF" : null,
    getFilePathAsync: async () => "/tmp/uploaded-paper.pdf"
  });
  const trashedAttachment = createAttachment();
  const registry = bootstrap.createCommandRegistry({
    getPref: () => true,
    runUnsafeJS: async (code) => ({ echoed: code }),
    addAttachmentToItem: async () => createdAttachment,
    resolveItemByKey: async () => createItem({ key: "ITEM123", id: 88 }),
    resolveAttachmentByKey: async () => trashedAttachment
  });

  const unsafeResult = await registry["unsafe.runJS"]({ code: "return 1;" });
  const addResult = await registry["attachments.experimental.add"]({
    itemKey: "ITEM123",
    file: "/tmp/uploaded-paper.pdf",
    title: "Main PDF"
  });
  const trashResult = await registry["attachments.experimental.trash"]({
    attachmentKey: "PDF123"
  });

  assert.deepEqual(unsafeResult, {
    result: { echoed: "return 1;" }
  });
  assert.equal(addResult.attachmentKey, "EXP123");
  assert.equal(addResult.path, "/tmp/uploaded-paper.pdf");
  assert.equal(trashResult.deleted, true);
  assert.equal(trashedAttachment.deleted, true);
});

test("collection write commands create rename and trash collections", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const parent = createCollection({ key: "PARENT1", id: 8, name: "Parent" });
  const created = createCollection({ key: "CHILD1", id: 9, name: "Draft" });
  const registry = bootstrap.createCommandRegistry({
    createCollectionObject: () => created,
    resolveCollectionByKey: async (key) => {
      if (key === "PARENT1") {
        return parent;
      }
      if (key === "CHILD1") {
        return created;
      }
      return null;
    }
  });

  const createdResult = await registry["collections.create"]({
    name: "To Read",
    parentCollectionKey: "PARENT1"
  });
  const renamedResult = await registry["collections.rename"]({
    collectionKey: "CHILD1",
    name: "Renamed"
  });
  const trashedResult = await registry["collections.trash"]({
    collectionKey: "CHILD1"
  });

  assert.equal(created.name, "Renamed");
  assert.equal(created.parentKey, "PARENT1");
  assert.equal(created.saveCalls, 2);
  assert.equal(created.deleted, true);
  assert.deepEqual(createdResult, {
    collectionKey: "CHILD1",
    collectionID: 9,
    name: "To Read",
    parentCollectionKey: "PARENT1",
    deleted: false
  });
  assert.deepEqual(renamedResult, {
    collectionKey: "CHILD1",
    collectionID: 9,
    name: "Renamed",
    parentCollectionKey: "PARENT1",
    deleted: false
  });
  assert.deepEqual(trashedResult, {
    collectionKey: "CHILD1",
    collectionID: 9,
    name: "Renamed",
    parentCollectionKey: "PARENT1",
    deleted: true
  });
});

test("item write commands update fields collections tags and trash state", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const primaryCollection = createCollection({ key: "COLL1", id: 101, name: "Inbox" });
  const targetCollection = createCollection({ key: "COLL2", id: 202, name: "Reading" });
  const createdItem = createItem({ key: "NEW123", id: 300, tags: ["existing"] });
  const existingItem = createItem({ key: "ITEM123", id: 301, collectionIDs: [101], tags: ["old"] });
  const registry = bootstrap.createCommandRegistry({
    createItemObject: (itemType) => {
      assert.equal(itemType, "journalArticle");
      return createdItem;
    },
    resolveItemByKey: async (key) => {
      if (key === "ITEM123") {
        return existingItem;
      }
      return null;
    },
    resolveCollectionByKey: async (key) => {
      if (key === "COLL1") {
        return primaryCollection;
      }
      if (key === "COLL2") {
        return targetCollection;
      }
      return null;
    }
  });

  const createdResult = await registry["items.create"]({
    itemType: "journalArticle",
    fields: {
      title: "Created Title",
      DOI: "10.1000/example"
    },
    collectionKeys: ["COLL1"],
    tags: ["queue", "existing"]
  });

  await registry["items.update"]({
    itemKey: "ITEM123",
    fields: {
      title: "Updated Title"
    }
  });
  await registry["items.setField"]({
    itemKey: "ITEM123",
    field: "DOI",
    value: "10.1000/updated"
  });
  await registry["items.addToCollection"]({
    itemKey: "ITEM123",
    collectionKey: "COLL2"
  });
  await registry["items.removeFromCollection"]({
    itemKey: "ITEM123",
    collectionKey: "COLL1"
  });
  const movedResult = await registry["items.move"]({
    itemKey: "ITEM123",
    collectionKey: "COLL2"
  });
  const trashedResult = await registry["items.trash"]({
    itemKey: "ITEM123"
  });

  assert.deepEqual(createdItem._fields, {
    title: "Created Title",
    DOI: "10.1000/example"
  });
  assert.deepEqual(createdItem._collectionIDs, [101]);
  assert.deepEqual(createdItem._tags, ["existing", "queue"]);
  assert.equal(createdItem.saveCalls, 1);
  assert.equal(createdResult.itemKey, "NEW123");
  assert.equal(createdResult.itemType, "journalArticle");

  assert.equal(existingItem._fields.title, "Updated Title");
  assert.equal(existingItem._fields.DOI, "10.1000/updated");
  assert.deepEqual(existingItem._collectionIDs, [202]);
  assert.equal(existingItem.deleted, true);
  assert.equal(movedResult.collectionKeys[0], "COLL2");
  assert.equal(trashedResult.deleted, true);
});

test("items.create does not overwrite getter-only itemType on live Zotero items", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const createdItem = createItem({ key: "DOI123", id: 777, itemType: "conferencePaper" });
  Object.defineProperty(createdItem, "itemType", {
    configurable: true,
    enumerable: true,
    get() {
      return "conferencePaper";
    }
  });
  const registry = bootstrap.createCommandRegistry({
    createItemObject: (itemType) => {
      assert.equal(itemType, "conferencePaper");
      return createdItem;
    }
  });

  const result = await registry["items.create"]({
    itemType: "conferencePaper",
    fields: {
      title: "DOI Imported Title"
    }
  });

  assert.equal(result.itemKey, "DOI123");
  assert.equal(result.itemType, "conferencePaper");
  assert.equal(createdItem._fields.title, "DOI Imported Title");
});

test("items.trash prefers Zotero.Items.trashTx for live runtime compatibility", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const item = createItem({ key: "TRASH1", id: 444 });
  const calls = [];
  const registry = bootstrap.createCommandRegistry({
    Zotero: {
      Items: {
        trashTx: async (ids) => {
          calls.push(ids);
        }
      }
    },
    resolveItemByKey: async (key) => key === "TRASH1" ? item : null
  });

  const result = await registry["items.trash"]({
    itemKey: "TRASH1"
  });

  assert.deepEqual(calls, [[444]]);
  assert.equal(result.deleted, true);
});

test("note commands create update and trash notes", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const parentItem = createItem({ key: "ITEM123", id: 88 });
  const createdNote = createNote({ key: "NOTE999", id: 999, parentItemID: 88, parentKey: "ITEM123" });
  const existingNote = createNote({ key: "NOTE123", id: 66, parentItemID: 88, parentKey: "ITEM123" });
  const registry = bootstrap.createCommandRegistry({
    createItemObject: (itemType) => {
      assert.equal(itemType, "note");
      return createdNote;
    },
    resolveItemByKey: async (key) => {
      if (key === "ITEM123") {
        return parentItem;
      }
      if (key === "NOTE123") {
        return existingNote;
      }
      return null;
    }
  });

  const createdResult = await registry["notes.upsert"]({
    parentItemKey: "ITEM123",
    note: "First paragraph\n\nSecond paragraph"
  });
  const updatedResult = await registry["notes.upsert"]({
    noteKey: "NOTE123",
    note: "<p>Updated note</p>"
  });
  const trashedResult = await registry["notes.trash"]({
    noteKey: "NOTE123"
  });

  assert.match(createdNote.getNote(), /^<p>First paragraph<\/p><p>Second paragraph<\/p>$/);
  assert.equal(createdNote.saveCalls, 1);
  assert.equal(createdResult.noteKey, "NOTE999");
  assert.equal(createdResult.parentItemKey, "ITEM123");
  assert.equal(createdResult.title, "First paragraph Second paragraph");

  assert.equal(existingNote.getNote(), "<p>Updated note</p>");
  assert.equal(updatedResult.noteKey, "NOTE123");
  assert.equal(updatedResult.noteText, "Updated note");
  assert.equal(trashedResult.deleted, true);
});

test("tag and bulk commands mutate multiple resolved items", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const homeCollection = createCollection({ key: "HOME1", id: 501, name: "Home" });
  const workCollection = createCollection({ key: "WORK1", id: 502, name: "Work" });
  const items = {
    AAA111: createItem({ key: "AAA111", id: 1, collectionIDs: [501], tags: ["old"] }),
    BBB222: createItem({ key: "BBB222", id: 2, collectionIDs: [501], tags: ["old"] })
  };
  const registry = bootstrap.createCommandRegistry({
    resolveItemByKey: async (key) => items[key] || null,
    resolveCollectionByKey: async (key) => {
      if (key === "HOME1") {
        return homeCollection;
      }
      if (key === "WORK1") {
        return workCollection;
      }
      return null;
    }
  });

  const addTagResult = await registry["tags.add"]({
    itemKey: "AAA111",
    tag: "priority"
  });
  const removeTagResult = await registry["tags.remove"]({
    itemKey: "AAA111",
    tag: "old"
  });
  await registry["bulk.addToCollection"]({
    itemKeys: ["AAA111", "BBB222"],
    collectionKey: "WORK1"
  });
  await registry["bulk.removeFromCollection"]({
    itemKeys: ["AAA111", "BBB222"],
    collectionKey: "HOME1"
  });
  const movedResult = await registry["bulk.move"]({
    itemKeys: ["AAA111", "BBB222"],
    collectionKey: "WORK1"
  });
  await registry["bulk.addTag"]({
    itemKeys: ["AAA111", "BBB222"],
    tag: "queued"
  });
  await registry["bulk.removeTag"]({
    itemKeys: ["AAA111", "BBB222"],
    tag: "queued"
  });
  const trashedResult = await registry["bulk.trashItems"]({
    itemKeys: ["AAA111", "BBB222"]
  });

  assert.deepEqual(addTagResult.tags, ["old", "priority"]);
  assert.deepEqual(removeTagResult.tags, ["priority"]);
  assert.deepEqual(items.AAA111._collectionIDs, [502]);
  assert.deepEqual(items.BBB222._collectionIDs, [502]);
  assert.deepEqual(items.AAA111._tags, ["priority"]);
  assert.deepEqual(items.BBB222._tags, ["old"]);
  assert.equal(movedResult.count, 2);
  assert.deepEqual(movedResult.itemKeys, ["AAA111", "BBB222"]);
  assert.equal(trashedResult.count, 2);
  assert.equal(items.AAA111.deleted, true);
  assert.equal(items.BBB222.deleted, true);
});

test("attachments.path resolves attachment metadata and file path", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = bootstrap.createCommandRegistry({
    resolveAttachmentByKey: async () => createAttachment()
  });

  const result = await registry["attachments.path"]({ attachmentKey: "PDF123" });

  assert.deepEqual(result, {
    attachmentKey: "PDF123",
    itemID: 42,
    parentItemID: 7,
    parentItemKey: null,
    title: "Stored PDF",
    filename: null,
    contentType: "application/pdf",
    linkMode: 1,
    deleted: false,
    path: "/tmp/stored-paper.pdf"
  });
});

test("attachments.readText returns extracted text for a stored attachment", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = bootstrap.createCommandRegistry({
    resolveAttachmentByKey: async () => createAttachment()
  });

  const result = await registry["attachments.readText"]({ attachmentKey: "PDF123" });

  assert.equal(result.attachmentKey, "PDF123");
  assert.equal(result.path, "/tmp/stored-paper.pdf");
  assert.equal(result.text, "Extracted attachment text");
});

test("attachments.export copies the attachment to the requested path", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const writes = [];
  const registry = bootstrap.createCommandRegistry({
    resolveAttachmentByKey: async () => createAttachment(),
    files: {
      getBinaryContentsAsync: async (path) => `binary:${path}`,
      putContentsAsync: async (path, data) => {
        writes.push({ path, data });
      }
    }
  });

  const result = await registry["attachments.export"]({
    attachmentKey: "PDF123",
    to: "/tmp/exported-paper.pdf"
  });

  assert.deepEqual(writes, [{
    path: "/tmp/exported-paper.pdf",
    data: "binary:/tmp/stored-paper.pdf"
  }]);
  assert.equal(result.path, "/tmp/stored-paper.pdf");
  assert.equal(result.exportedTo, "/tmp/exported-paper.pdf");
});

test("attachments.open delegates to the configured open helper", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const calls = [];
  const registry = bootstrap.createCommandRegistry({
    resolveAttachmentByKey: async () => createAttachment(),
    openAttachment: async (attachment, path) => {
      calls.push({ key: attachment.key, path });
    }
  });

  const result = await registry["attachments.open"]({ attachmentKey: "PDF123" });

  assert.deepEqual(calls, [{
    key: "PDF123",
    path: "/tmp/stored-paper.pdf"
  }]);
  assert.equal(result.opened, true);
  assert.equal(result.path, "/tmp/stored-paper.pdf");
});

test("createEndpoint dispatches a known command directly", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = {
    "collections.list": async (args) => ({ received: args })
  };
  const Endpoint = bootstrap.createEndpoint(registry);
  const endpoint = new Endpoint();

  const response = await endpoint.init({
    data: { command: "collections.list", args: { limit: 5 } }
  });

  assert.deepEqual(response, [
    200,
    "application/json",
    JSON.stringify({
      ok: true,
      command: "collections.list",
      data: { received: { limit: 5 } }
    })
  ]);
});

test("createEndpoint returns a not-found failure for unknown commands", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const Endpoint = bootstrap.createEndpoint({});
  const endpoint = new Endpoint();

  const response = await endpoint.init({
    data: { command: "missing.command" }
  });

  assert.deepEqual(response, [
    404,
    "application/json",
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

test("createEndpoint rejects prototype-name commands instead of dispatching them", async () => {
  const bootstrap = require("../plugin/bootstrap.js");
  const registry = {};
  const Endpoint = bootstrap.createEndpoint(registry);
  const endpoint = new Endpoint();

  const response = await endpoint.init({
    data: { command: "constructor", args: { limit: 5 } }
  });

  assert.deepEqual(response, [
    404,
    "application/json",
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

test("normalize command request requires a command string", () => {
  assert.throws(
    () => contract.normalizeCommandRequest({ args: {} }),
    (error) => error.code === "INVALID_INPUT"
  );
});

test("success payload is stable JSON", () => {
  const [status, contentType, body] = contract.success("collections.list", { ok: true });
  assert.equal(status, 200);
  assert.equal(contentType, "application/json");
  assert.deepEqual(JSON.parse(body), {
    ok: true,
    command: "collections.list",
    data: { ok: true }
  });
});

test("success payload always includes data", () => {
  const [status, contentType, body] = contract.success("collections.list", undefined);
  assert.equal(status, 200);
  assert.equal(contentType, "application/json");
  assert.deepEqual(JSON.parse(body), {
    ok: true,
    command: "collections.list",
    data: {}
  });
});

test("failure payload serializes validation errors", () => {
  const [status, contentType, body] = contract.failure(
    new contract.CommandValidationError(403, "DENIED", "Nope", { field: "reason" })
  );
  assert.equal(status, 403);
  assert.equal(contentType, "application/json");
  assert.deepEqual(JSON.parse(body), {
    ok: false,
    error: {
      code: "DENIED",
      message: "Nope",
      details: { field: "reason" }
    }
  });
});
