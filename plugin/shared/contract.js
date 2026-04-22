(function (root, factory) {
  if (typeof module !== "undefined" && module.exports) {
    module.exports = factory();
    return;
  }
  root.ZoteroAgentContract = factory();
})(this, function () {
  "use strict";

  const TOKEN_HEADER = "x-zotero-agent-token";

  class CommandValidationError extends Error {
    constructor(status, code, message, details = {}) {
      super(message);
      this.name = "CommandValidationError";
      this.status = status;
      this.code = code;
      this.details = details;
    }
  }

  function invalidInput(field, message) {
    throw new CommandValidationError(400, "INVALID_INPUT", message, { field });
  }

  function ensureString(value, field) {
    if (typeof value !== "string" || !value.trim()) {
      invalidInput(field, `${field} must be a non-empty string`);
    }
    return value.trim();
  }

  function authorizeHeaders(headers, expectedToken) {
    const configured = ensureString(expectedToken, "expectedToken");
    const provided = headers?.[TOKEN_HEADER] ?? headers?.[TOKEN_HEADER.toLowerCase()];
    if (provided !== configured) {
      throw new CommandValidationError(401, "AUTH_REQUIRED", "Missing or invalid token");
    }
  }

  function normalizeCommandRequest(payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      invalidInput("payload", "payload must be an object");
    }
    return {
      command: ensureString(payload.command, "command"),
      args: payload.args && typeof payload.args === "object" && !Array.isArray(payload.args) ? payload.args : {}
    };
  }

  function success(command, data) {
    return [
      200,
      { "Content-Type": "application/json" },
      JSON.stringify({ ok: true, command, data })
    ];
  }

  function failure(error) {
    const normalized = error instanceof CommandValidationError
      ? error
      : new CommandValidationError(500, "INTERNAL_ERROR", error?.message || "Unknown error");
    return [
      normalized.status,
      { "Content-Type": "application/json" },
      JSON.stringify({
        ok: false,
        error: {
          code: normalized.code,
          message: normalized.message,
          details: normalized.details
        }
      })
    ];
  }

  return {
    TOKEN_HEADER,
    CommandValidationError,
    authorizeHeaders,
    normalizeCommandRequest,
    success,
    failure
  };
});
