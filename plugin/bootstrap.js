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
