"use strict";

const contract = require("./shared/contract.js");

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

function createCommandRegistry(context = {}) {
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
    },
    ...createAttachmentCommands(context)
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

module.exports = {
  createCommandRegistry,
  createEndpoint
};
