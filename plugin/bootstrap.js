"use strict";

let addonRootURI = null;
let cachedContract = null;
let registeredPaths = [];

function getContract() {
  if (cachedContract) {
    return cachedContract;
  }
  if (typeof module !== "undefined" && module.exports && typeof require === "function") {
    cachedContract = require("./shared/contract.js");
    return cachedContract;
  }
  if (addonRootURI && typeof Services !== "undefined" && Services.scriptloader) {
    const scope = {};
    Services.scriptloader.loadSubScript(addonRootURI + "shared/contract.js", scope);
    if (scope.ZoteroAgentContract) {
      cachedContract = scope.ZoteroAgentContract;
      return cachedContract;
    }
  }
  throw new Error("Unable to load Zotero agent contract");
}

const contract = new Proxy({}, {
  get(_target, property) {
    return getContract()[property];
  }
});
const UNSAFE_PREF = "extensions.zotero.zoteroAgent.unsafeEnabled";
const EXPERIMENTAL_ATTACHMENTS_PREF = "extensions.zotero.zoteroAgent.experimentalAttachmentsEnabled";

function commandError(status, code, message, details = {}) {
  return new contract.CommandValidationError(status, code, message, details);
}

function requireString(value, field) {
  if (typeof value !== "string" || !value.trim()) {
    throw commandError(400, "INVALID_INPUT", `${field} is required`, { field });
  }
  return value.trim();
}

function getUserLibraryID(context) {
  if (context.libraryID !== undefined && context.libraryID !== null) {
    return context.libraryID;
  }
  return context.Zotero?.Libraries?.userLibraryID ?? 1;
}

function ensureAttachmentItem(item, attachmentKey) {
  if (!item) {
    throw commandError(404, "NOT_FOUND", `Attachment not found: ${attachmentKey}`, { attachmentKey });
  }
  const isAttachment = typeof item.isAttachment === "function"
    ? item.isAttachment()
    : item.itemType === "attachment" || item.data?.itemType === "attachment";
  if (!isAttachment) {
    throw commandError(400, "INVALID_INPUT", `${attachmentKey} is not an attachment item`, {
      attachmentKey
    });
  }
  return item;
}

async function resolveAttachmentByKey(context, attachmentKey) {
  const key = requireString(attachmentKey, "attachmentKey");
  if (typeof context.resolveAttachmentByKey === "function") {
    return ensureAttachmentItem(await context.resolveAttachmentByKey(key), key);
  }
  const items = context.items || context.Zotero?.Items;
  if (!items || typeof items.getByLibraryAndKey !== "function") {
    throw commandError(500, "NOT_AVAILABLE", "Attachment lookup is not available", {
      attachmentKey: key
    });
  }
  const item = items.getByLibraryAndKey(getUserLibraryID(context), key);
  return ensureAttachmentItem(item, key);
}

function ensureResolvedPath(path, attachment) {
  if (typeof path !== "string" || !path.trim()) {
    throw commandError(404, "FILE_NOT_FOUND", `Attachment file not found: ${attachment.key || "unknown"}`, {
      attachmentKey: attachment.key || null
    });
  }
  return path;
}

async function resolveAttachmentPath(context, attachment) {
  if (typeof context.getAttachmentPath === "function") {
    return ensureResolvedPath(await context.getAttachmentPath(attachment), attachment);
  }
  if (typeof attachment.getFilePathAsync === "function") {
    return ensureResolvedPath(await attachment.getFilePathAsync(), attachment);
  }
  if (typeof attachment.getFilePath === "function") {
    return ensureResolvedPath(attachment.getFilePath(), attachment);
  }
  throw commandError(500, "NOT_AVAILABLE", "Attachment path lookup is not available", {
    attachmentKey: attachment.key || null
  });
}

async function resolveAttachmentText(context, attachment) {
  if (typeof context.readAttachmentText === "function") {
    return await context.readAttachmentText(attachment);
  }
  if (attachment.attachmentText !== undefined) {
    return await attachment.attachmentText;
  }
  const files = context.files || context.Zotero?.File;
  if (!files || typeof files.getContentsAsync !== "function") {
    throw commandError(500, "NOT_AVAILABLE", "Attachment text retrieval is not available", {
      attachmentKey: attachment.key || null
    });
  }
  const path = await resolveAttachmentPath(context, attachment);
  return files.getContentsAsync(path);
}

async function exportAttachment(context, attachment, destinationPath) {
  const to = requireString(destinationPath, "to");
  if (typeof context.exportAttachment === "function") {
    return context.exportAttachment(attachment, to);
  }
  const files = context.files || context.Zotero?.File;
  if (!files
    || typeof files.getBinaryContentsAsync !== "function"
    || typeof files.putContentsAsync !== "function") {
    throw commandError(500, "NOT_AVAILABLE", "Attachment export is not available", {
      attachmentKey: attachment.key || null
    });
  }
  const sourcePath = await resolveAttachmentPath(context, attachment);
  const binary = await files.getBinaryContentsAsync(sourcePath);
  await files.putContentsAsync(to, binary);
  return {
    sourcePath,
    destinationPath: to
  };
}

async function openAttachment(context, attachment) {
  const path = await resolveAttachmentPath(context, attachment);
  if (typeof context.openAttachment === "function") {
    await context.openAttachment(attachment, path);
    return path;
  }
  if (context.Zotero?.FileHandlers && typeof context.Zotero.FileHandlers.open === "function") {
    await context.Zotero.FileHandlers.open(attachment, { openInWindow: false });
    return path;
  }
  if (typeof context.Zotero?.launchFile === "function") {
    context.Zotero.launchFile(path);
    return path;
  }
  throw commandError(500, "NOT_AVAILABLE", "Attachment open is not available", {
    attachmentKey: attachment.key || null
  });
}

function serializeAttachment(attachment, extra = {}) {
  const title = typeof attachment.getField === "function"
    ? attachment.getField("title")
    : attachment.title ?? null;
  return {
    attachmentKey: attachment.key ?? null,
    itemID: attachment.id ?? null,
    parentItemID: attachment.parentItemID ?? null,
    title,
    contentType: attachment.attachmentContentType ?? null,
    linkMode: attachment.attachmentLinkMode ?? null,
    ...extra
  };
}

function createAttachmentCommands(context) {
  return {
    "attachments.path": async function (args = {}) {
      const attachment = await resolveAttachmentByKey(context, args.attachmentKey);
      const path = await resolveAttachmentPath(context, attachment);
      return serializeAttachment(attachment, { path });
    },
    "attachments.readText": async function (args = {}) {
      const attachment = await resolveAttachmentByKey(context, args.attachmentKey);
      const path = await resolveAttachmentPath(context, attachment);
      const text = await resolveAttachmentText(context, attachment);
      return serializeAttachment(attachment, { path, text });
    },
    "attachments.export": async function (args = {}) {
      const attachment = await resolveAttachmentByKey(context, args.attachmentKey);
      const exportResult = await exportAttachment(context, attachment, args.to);
      return serializeAttachment(attachment, {
        path: exportResult.sourcePath,
        exportedTo: exportResult.destinationPath
      });
    },
    "attachments.open": async function (args = {}) {
      const attachment = await resolveAttachmentByKey(context, args.attachmentKey);
      const path = await openAttachment(context, attachment);
      return serializeAttachment(attachment, { path, opened: true });
    }
  };
}

function requireObject(value, field) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw commandError(400, "INVALID_INPUT", `${field} must be an object`, { field });
  }
  return value;
}

function normalizeStringList(value, field, options = {}) {
  const rawValues = Array.isArray(value)
    ? value
    : value === undefined || value === null
      ? []
      : [value];
  const normalized = rawValues.map((entry) => requireString(entry, field));
  if (options.required && normalized.length === 0) {
    throw commandError(400, "INVALID_INPUT", `${field} is required`, { field });
  }
  return Array.from(new Set(normalized));
}

async function saveEntity(entity) {
  if (typeof entity?.saveTx === "function") {
    return entity.saveTx();
  }
  if (typeof entity?.save === "function") {
    return entity.save();
  }
  return entity?.id ?? null;
}

function getTagNames(item) {
  if (typeof item?.getTags === "function") {
    return item.getTags()
      .map((entry) => typeof entry === "string" ? entry : entry?.tag)
      .filter(Boolean);
  }
  if (Array.isArray(item?._tags)) {
    return [...item._tags];
  }
  return [];
}

function serializeCollection(collection) {
  return {
    collectionKey: collection.key ?? null,
    collectionID: collection.id ?? null,
    name: collection.name ?? null,
    parentCollectionKey: collection.parentKey ?? null,
    deleted: !!collection.deleted
  };
}

function serializeItem(item, extra = {}) {
  const title = typeof item?.getField === "function"
    ? item.getField("title")
    : item?.title ?? null;
  const collectionKeys = Array.isArray(item?.collectionKeys) ? [...item.collectionKeys] : [];
  return {
    itemKey: item?.key ?? null,
    itemID: item?.id ?? null,
    itemType: item?.itemType ?? null,
    title,
    collectionKeys,
    tags: getTagNames(item),
    deleted: !!item?.deleted,
    ...extra
  };
}

function normalizeError(error) {
  if (error instanceof contract.CommandValidationError) {
    return {
      code: error.code,
      message: error.message,
      details: error.details
    };
  }
  return {
    code: "INTERNAL_ERROR",
    message: error?.message || "Unknown error",
    details: {}
  };
}

function readBooleanPref(context, prefName, fallback = false) {
  if (typeof context.getPref === "function") {
    const value = context.getPref(prefName);
    return value === undefined ? fallback : !!value;
  }
  if (context.Zotero?.Prefs && typeof context.Zotero.Prefs.get === "function") {
    const value = context.Zotero.Prefs.get(prefName);
    return value === undefined ? fallback : !!value;
  }
  return fallback;
}

function requirePrefEnabled(context, prefName, code, message) {
  if (!readBooleanPref(context, prefName, false)) {
    throw commandError(403, code, message, { pref: prefName });
  }
}

async function resolveCollectionByKey(context, collectionKey) {
  const key = requireString(collectionKey, "collectionKey");
  if (typeof context.resolveCollectionByKey === "function") {
    const collection = await context.resolveCollectionByKey(key);
    if (collection) {
      return collection;
    }
  }
  const collections = context.collections || context.Zotero?.Collections;
  if (collections && typeof collections.getByLibraryAndKey === "function") {
    const collection = collections.getByLibraryAndKey(getUserLibraryID(context), key);
    if (collection) {
      return collection;
    }
  }
  throw commandError(404, "NOT_FOUND", `Collection not found: ${key}`, { collectionKey: key });
}

async function resolveItemByKey(context, itemKey) {
  const key = requireString(itemKey, "itemKey");
  if (typeof context.resolveItemByKey === "function") {
    const item = await context.resolveItemByKey(key);
    if (item) {
      return item;
    }
  }
  const items = context.items || context.Zotero?.Items;
  if (items && typeof items.getByLibraryAndKey === "function") {
    const item = items.getByLibraryAndKey(getUserLibraryID(context), key);
    if (item) {
      return item;
    }
  }
  throw commandError(404, "NOT_FOUND", `Item not found: ${key}`, { itemKey: key });
}

async function resolveCollectionKeysForItem(context, item) {
  if (Array.isArray(item?.collectionKeys) && item.collectionKeys.length > 0) {
    return [...item.collectionKeys];
  }
  if (typeof context.collectionKeysForItem === "function") {
    const keys = await context.collectionKeysForItem(item);
    return Array.isArray(keys) ? [...keys] : [];
  }
  if (typeof item?.getCollections !== "function") {
    return [];
  }
  const collectionIDs = item.getCollections();
  if (!Array.isArray(collectionIDs) || collectionIDs.length === 0) {
    return [];
  }
  const collections = context.collections || context.Zotero?.Collections;
  if (collections) {
    if (typeof collections.get === "function") {
      return collectionIDs
        .map((collectionID) => collections.get(collectionID))
        .map((collection) => collection?.key ?? null)
        .filter(Boolean);
    }
    if (typeof collections.getByLibrary === "function") {
      const knownCollections = collections.getByLibrary(getUserLibraryID(context), true, true);
      const lookup = new Map(knownCollections.map((collection) => [collection.id, collection.key]));
      return collectionIDs.map((collectionID) => lookup.get(collectionID) ?? String(collectionID));
    }
  }
  return collectionIDs.map((collectionID) => String(collectionID));
}

async function listCollections(context) {
  if (typeof context.listCollections === "function") {
    return context.listCollections();
  }
  const collections = context.collections || context.Zotero?.Collections;
  if (collections && typeof collections.getByLibrary === "function") {
    return collections.getByLibrary(getUserLibraryID(context), false, false);
  }
  return [];
}

function updateItemFields(item, fields) {
  const nextFields = requireObject(fields, "fields");
  if (typeof item.fromJSON === "function" && typeof item.toJSON === "function") {
    item.fromJSON({
      ...item.toJSON(),
      ...nextFields
    });
    return;
  }
  for (const [field, value] of Object.entries(nextFields)) {
    if (field === "itemType") {
      item.itemType = value;
      continue;
    }
    if (typeof item.setField === "function") {
      item.setField(field, value);
      continue;
    }
    item[field] = value;
  }
}

async function setItemCollections(context, item, collectionKeys) {
  const keys = normalizeStringList(collectionKeys, "collectionKeys");
  if (keys.length === 0) {
    item.collectionKeys = [];
    if (typeof item.setCollections === "function") {
      item.setCollections([]);
    }
    return;
  }
  const collections = [];
  for (const key of keys) {
    collections.push(await resolveCollectionByKey(context, key));
  }
  if (typeof item.setCollections === "function") {
    item.setCollections(collections.map((collection) => collection.id));
  }
  item.collectionKeys = collections.map((collection) => collection.key ?? null).filter(Boolean);
}

async function addItemToCollection(context, item, collectionKey) {
  const collection = await resolveCollectionByKey(context, collectionKey);
  if (typeof item.addToCollection === "function") {
    item.addToCollection(collection.id);
  } else if (typeof item.getCollections === "function" && typeof item.setCollections === "function") {
    const nextCollections = item.getCollections();
    if (!nextCollections.includes(collection.id)) {
      nextCollections.push(collection.id);
      item.setCollections(nextCollections);
    }
  }
  const nextKeys = new Set(Array.isArray(item.collectionKeys) ? item.collectionKeys : []);
  nextKeys.add(collection.key);
  item.collectionKeys = Array.from(nextKeys);
  await saveEntity(item);
  return serializeItem(item);
}

async function removeItemFromCollection(context, item, collectionKey) {
  const collection = await resolveCollectionByKey(context, collectionKey);
  if (typeof item.removeFromCollection === "function") {
    item.removeFromCollection(collection.id);
  } else if (typeof item.getCollections === "function" && typeof item.setCollections === "function") {
    const nextCollections = item.getCollections().filter((value) => value !== collection.id);
    item.setCollections(nextCollections);
  }
  item.collectionKeys = (Array.isArray(item.collectionKeys) ? item.collectionKeys : [])
    .filter((value) => value !== collection.key);
  await saveEntity(item);
  return serializeItem(item);
}

async function moveItemToCollection(context, item, collectionKey) {
  const collection = await resolveCollectionByKey(context, collectionKey);
  if (typeof item.setCollections === "function") {
    item.setCollections([collection.id]);
  }
  item.collectionKeys = [collection.key];
  await saveEntity(item);
  return serializeItem(item);
}

function addTagsToItem(item, tags) {
  for (const tag of normalizeStringList(tags, "tags")) {
    if (typeof item.addTag === "function") {
      item.addTag(tag);
    }
  }
}

function removeTagsFromItem(item, tags) {
  for (const tag of normalizeStringList(tags, "tags")) {
    if (typeof item.removeTag === "function") {
      item.removeTag(tag);
    }
  }
}

async function trashItems(context, items) {
  if (typeof context.trashItems === "function") {
    await context.trashItems(items.map((item) => item.id));
    for (const item of items) {
      item.deleted = true;
    }
    return;
  }
  if (context.Zotero?.Items && typeof context.Zotero.Items.trash === "function") {
    await context.Zotero.Items.trash(items.map((item) => item.id));
    for (const item of items) {
      item.deleted = true;
    }
    return;
  }
  for (const item of items) {
    item.deleted = true;
  }
}

async function runBulk(itemKeys, operation) {
  const keys = normalizeStringList(itemKeys, "itemKeys", { required: true });
  const results = [];
  for (const key of keys) {
    try {
      results.push({
        itemKey: key,
        ok: true,
        data: await operation(key)
      });
    } catch (error) {
      results.push({
        itemKey: key,
        ok: false,
        error: normalizeError(error)
      });
    }
  }
  return {
    count: keys.length,
    itemKeys: keys,
    results
  };
}

function createCollectionCommands(context) {
  return {
    "collections.list": async function () {
      const collections = await listCollections(context);
      return {
        collections: collections.map(serializeCollection)
      };
    },
    "collections.create": async function (args = {}) {
      const name = requireString(args.name, "name");
      const parentCollectionKey = args.parentCollectionKey ? requireString(args.parentCollectionKey, "parentCollectionKey") : null;
      let collection;
      if (typeof context.createCollection === "function") {
        collection = await context.createCollection({ name, parentCollectionKey });
      } else if (typeof context.createCollectionObject === "function") {
        collection = context.createCollectionObject();
      } else if (context.Zotero?.Collection) {
        collection = new context.Zotero.Collection();
        collection.libraryID = getUserLibraryID(context);
      } else {
        throw commandError(500, "NOT_AVAILABLE", "Collection creation is not available");
      }
      if (!collection) {
        throw commandError(500, "NOT_AVAILABLE", "Collection creation returned no collection");
      }
      if (collection.name === undefined || collection.name === null) {
        collection.name = name;
      } else {
        collection.name = name;
      }
      if (parentCollectionKey) {
        const parent = await resolveCollectionByKey(context, parentCollectionKey);
        collection.parentKey = parent.key ?? parentCollectionKey;
        if (parent.id !== undefined) {
          collection.parentID = parent.id;
        }
      }
      if (typeof context.createCollection !== "function") {
        await saveEntity(collection);
      }
      return serializeCollection(collection);
    },
    "collections.rename": async function (args = {}) {
      const collection = await resolveCollectionByKey(context, args.collectionKey);
      collection.name = requireString(args.name, "name");
      await saveEntity(collection);
      return serializeCollection(collection);
    },
    "collections.trash": async function (args = {}) {
      const collection = await resolveCollectionByKey(context, args.collectionKey);
      collection.deleted = true;
      if (!context.createCollectionObject && typeof context.trashCollection !== "function") {
        await saveEntity(collection);
      } else if (typeof context.trashCollection === "function") {
        await context.trashCollection(collection);
      }
      return serializeCollection(collection);
    }
  };
}

function createItemCommands(context) {
  return {
    "items.create": async function (args = {}) {
      const itemType = requireString(args.itemType, "itemType");
      let item;
      if (typeof context.createItem === "function") {
        item = await context.createItem(args);
      } else if (typeof context.createItemObject === "function") {
        item = context.createItemObject(itemType);
      } else if (context.Zotero?.Item) {
        item = new context.Zotero.Item(itemType);
        item.libraryID = getUserLibraryID(context);
      } else {
        throw commandError(500, "NOT_AVAILABLE", "Item creation is not available");
      }
      item.itemType = itemType;
      updateItemFields(item, args.fields || {});
      await setItemCollections(context, item, args.collectionKeys || []);
      addTagsToItem(item, args.tags || []);
      if (typeof context.createItem !== "function") {
        await saveEntity(item);
      }
      return serializeItem(item, {
        collectionKeys: await resolveCollectionKeysForItem(context, item)
      });
    },
    "items.update": async function (args = {}) {
      const item = await resolveItemByKey(context, args.itemKey);
      updateItemFields(item, args.fields || args.patch || {});
      await saveEntity(item);
      return serializeItem(item, {
        collectionKeys: await resolveCollectionKeysForItem(context, item)
      });
    },
    "items.setField": async function (args = {}) {
      const item = await resolveItemByKey(context, args.itemKey);
      const field = requireString(args.field, "field");
      if (typeof item.setField === "function") {
        item.setField(field, args.value);
      } else {
        item[field] = args.value;
      }
      await saveEntity(item);
      return {
        ...serializeItem(item, {
          collectionKeys: await resolveCollectionKeysForItem(context, item)
        }),
        field
      };
    },
    "items.trash": async function (args = {}) {
      const item = await resolveItemByKey(context, args.itemKey);
      await trashItems(context, [item]);
      return serializeItem(item, {
        collectionKeys: await resolveCollectionKeysForItem(context, item)
      });
    },
    "items.addToCollection": async function (args = {}) {
      const item = await resolveItemByKey(context, args.itemKey);
      return addItemToCollection(context, item, args.collectionKey);
    },
    "items.removeFromCollection": async function (args = {}) {
      const item = await resolveItemByKey(context, args.itemKey);
      return removeItemFromCollection(context, item, args.collectionKey);
    },
    "items.move": async function (args = {}) {
      const item = await resolveItemByKey(context, args.itemKey);
      return moveItemToCollection(context, item, args.collectionKey);
    }
  };
}

function createTagCommands(context) {
  return {
    "tags.add": async function (args = {}) {
      const item = await resolveItemByKey(context, args.itemKey);
      addTagsToItem(item, [requireString(args.tag, "tag")]);
      await saveEntity(item);
      return {
        itemKey: item.key ?? null,
        tags: getTagNames(item)
      };
    },
    "tags.remove": async function (args = {}) {
      const item = await resolveItemByKey(context, args.itemKey);
      removeTagsFromItem(item, [requireString(args.tag, "tag")]);
      await saveEntity(item);
      return {
        itemKey: item.key ?? null,
        tags: getTagNames(item)
      };
    }
  };
}

function createBulkCommands(context) {
  return {
    "bulk.trashItems": async function (args = {}) {
      return runBulk(args.itemKeys, async (itemKey) => {
        const item = await resolveItemByKey(context, itemKey);
        await trashItems(context, [item]);
        return serializeItem(item);
      });
    },
    "bulk.addToCollection": async function (args = {}) {
      return runBulk(args.itemKeys, async (itemKey) => {
        const item = await resolveItemByKey(context, itemKey);
        return addItemToCollection(context, item, args.collectionKey);
      });
    },
    "bulk.removeFromCollection": async function (args = {}) {
      return runBulk(args.itemKeys, async (itemKey) => {
        const item = await resolveItemByKey(context, itemKey);
        return removeItemFromCollection(context, item, args.collectionKey);
      });
    },
    "bulk.move": async function (args = {}) {
      return runBulk(args.itemKeys, async (itemKey) => {
        const item = await resolveItemByKey(context, itemKey);
        return moveItemToCollection(context, item, args.collectionKey);
      });
    },
    "bulk.addTag": async function (args = {}) {
      return runBulk(args.itemKeys, async (itemKey) => {
        const item = await resolveItemByKey(context, itemKey);
        addTagsToItem(item, [requireString(args.tag, "tag")]);
        await saveEntity(item);
        return {
          itemKey: item.key ?? null,
          tags: getTagNames(item)
        };
      });
    },
    "bulk.removeTag": async function (args = {}) {
      return runBulk(args.itemKeys, async (itemKey) => {
        const item = await resolveItemByKey(context, itemKey);
        removeTagsFromItem(item, [requireString(args.tag, "tag")]);
        await saveEntity(item);
        return {
          itemKey: item.key ?? null,
          tags: getTagNames(item)
        };
      });
    }
  };
}

async function runUnsafeJS(context, code) {
  if (typeof context.runUnsafeJS === "function") {
    return context.runUnsafeJS(code);
  }
  if (!context.Zotero) {
    throw commandError(500, "NOT_AVAILABLE", "Unsafe JavaScript execution is not available");
  }
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const executor = new AsyncFunction("Zotero", code);
  return executor(context.Zotero);
}

async function addExperimentalAttachment(context, args = {}) {
  const item = await resolveItemByKey(context, args.itemKey);
  const file = requireString(args.file, "file");
  const title = args.title ? requireString(args.title, "title") : null;
  if (typeof context.addAttachmentToItem === "function") {
    return context.addAttachmentToItem({
      itemKey: item.key ?? args.itemKey,
      file,
      title
    });
  }
  if (context.Zotero?.Attachments && typeof context.Zotero.Attachments.importFromFile === "function") {
    return context.Zotero.Attachments.importFromFile({
      file,
      parentItemID: item.id,
      title: title || undefined,
      contentType: "application/pdf"
    });
  }
  throw commandError(500, "NOT_AVAILABLE", "Experimental attachment add is not available");
}

function createUnsafeCommands(context) {
  return {
    "unsafe.runJS": async function (args = {}) {
      requirePrefEnabled(context, UNSAFE_PREF, "UNSAFE_DISABLED", "Unsafe JavaScript execution is disabled");
      const code = requireString(args.code, "code");
      return {
        result: await runUnsafeJS(context, code)
      };
    }
  };
}

function createExperimentalAttachmentCommands(context) {
  return {
    "attachments.experimental.add": async function (args = {}) {
      requirePrefEnabled(
        context,
        EXPERIMENTAL_ATTACHMENTS_PREF,
        "EXPERIMENTAL_DISABLED",
        "Experimental attachment mutation is disabled"
      );
      const attachment = await addExperimentalAttachment(context, args);
      const path = await resolveAttachmentPath(context, attachment);
      return serializeAttachment(attachment, {
        path,
        experimental: true
      });
    },
    "attachments.experimental.trash": async function (args = {}) {
      requirePrefEnabled(
        context,
        EXPERIMENTAL_ATTACHMENTS_PREF,
        "EXPERIMENTAL_DISABLED",
        "Experimental attachment mutation is disabled"
      );
      const attachment = await resolveAttachmentByKey(context, args.attachmentKey);
      await trashItems(context, [attachment]);
      return serializeAttachment(attachment, {
        deleted: !!attachment.deleted,
        experimental: true
      });
    }
  };
}

function createCommandRegistry(context = {}) {
  return {
    "health.get": async function () {
      return {
        ok: true,
        zoteroVersion: context.Zotero?.version || null,
        unsafeEnabled: readBooleanPref(context, UNSAFE_PREF, false),
        experimentalAttachmentsEnabled: readBooleanPref(context, EXPERIMENTAL_ATTACHMENTS_PREF, false)
      };
    },
    ...createCollectionCommands(context),
    ...createItemCommands(context),
    ...createTagCommands(context),
    ...createBulkCommands(context),
    ...createUnsafeCommands(context),
    ...createAttachmentCommands(context)
    ,
    ...createExperimentalAttachmentCommands(context)
  };
}

function resolveExpectedToken(options = {}) {
  if (typeof options.tokenSource === "function") {
    return options.tokenSource();
  }
  return options.expectedToken;
}

function createEndpoint(registry, options = {}) {
  const hasOwn = Object.prototype.hasOwnProperty.call.bind(Object.prototype.hasOwnProperty);

  function Endpoint() {}
  Endpoint.prototype = {
    supportedMethods: ["POST"],
    supportedDataTypes: ["application/json"],
    init: async function (request) {
      try {
        const expectedToken = resolveExpectedToken(options);
        contract.authorizeHeaders(request.headers, expectedToken);
        const normalized = contract.normalizeCommandRequest(request.data || {});
        const handler = hasOwn(registry, normalized.command) ? registry[normalized.command] : undefined;
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

function getRuntimeContext() {
  if (typeof Zotero === "undefined") {
    return {};
  }
  return {
    Zotero,
    getPref: (prefName) => Zotero.Prefs.get(prefName)
  };
}

function getRuntimeToken() {
  if (typeof Zotero === "undefined" || !Zotero.Prefs) {
    return "";
  }
  const value = Zotero.Prefs.get("extensions.zotero.zoteroAgent.token");
  return typeof value === "string" ? value.trim() : "";
}

function createHealthEndpoint(registry) {
  function Endpoint() {}
  Endpoint.prototype = {
    supportedMethods: ["GET"],
    supportedDataTypes: "*",
    init: async function () {
      try {
        return contract.success("health.get", await registry["health.get"]());
      } catch (error) {
        return contract.failure(error);
      }
    }
  };
  return Endpoint;
}

function registerRuntimeEndpoints() {
  if (typeof Zotero === "undefined" || !Zotero.Server) {
    return;
  }
  const registry = createCommandRegistry(getRuntimeContext());
  Zotero.Server.init();
  Zotero.Server.Endpoints["/agent/command"] = createEndpoint(registry, {
    tokenSource: getRuntimeToken
  });
  Zotero.Server.Endpoints["/agent/health"] = createHealthEndpoint(registry);
  registeredPaths = ["/agent/command", "/agent/health"];
}

function unregisterRuntimeEndpoints() {
  if (typeof Zotero === "undefined" || !Zotero.Server?.Endpoints) {
    return;
  }
  for (const path of registeredPaths) {
    delete Zotero.Server.Endpoints[path];
  }
  registeredPaths = [];
}

function install() {}

function startup(addonData) {
  addonRootURI = addonData?.rootURI || null;
  cachedContract = null;
  registerRuntimeEndpoints();
}

function shutdown() {
  unregisterRuntimeEndpoints();
}

function uninstall() {}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    createCommandRegistry,
    createEndpoint,
    install,
    startup,
    shutdown,
    uninstall
  };
}
