# Zotero Local Agent Management Design

Date: 2026-04-22
Status: Approved for planning

## Summary

Build a local-first Zotero management system for one personal library. The system should let AI agents manage Zotero naturally through a `zotero` CLI and a dedicated skill, while reusing Zotero's built-in local read API where possible and adding a small plugin-based write bridge only where needed.

Version 1 includes stable attachment retrieval so an agent can find, open, read, export, or otherwise access a paper PDF when Zotero already has it. Attachment mutation remains an explicitly experimental path because previous tests showed it could be slow or fragile.

## Goals

- Let an agent fully manage a personal Zotero library on the local machine.
- Make the primary interface agent-friendly through a JSON-first `zotero` CLI.
- Reuse Zotero's built-in `http://localhost:23119/api/...` local API for read and browse operations.
- Add a small authenticated plugin bridge for write operations not covered by the built-in local API.
- Keep destructive behavior limited to Zotero Trash rather than permanent deletion.
- Provide a dedicated skill that teaches agents how to use the CLI safely and effectively.
- Let an agent retrieve a paper PDF from Zotero in whatever form it needs for reading or downstream processing.

## Non-Goals For Version 1

- Group library support
- Permanent deletion
- Direct SQLite access
- Replacing Zotero's UI or library model
- Exposing every Zotero capability as a first-class structured command on day one

Attachment mutation is not a normal stable workflow in version 1. It may exist behind explicit experimental commands, but it is not part of the reliability promise.

## User And System Context

Primary user: one person managing a personal Zotero library locally.

Primary machine consumer: local AI agents that should be able to search, inspect, create, edit, organize, and trash Zotero records without scraping the Zotero UI.

Version 1 targets the Zotero local server on port `23119` and assumes Zotero is running with local HTTP access enabled.

## Product Principles

### 1. Zotero remains the source of truth

This system manages Zotero. It does not reimplement Zotero storage or create a parallel library model.

### 2. Hybrid by design

Read from Zotero's built-in local API. Write through a small custom plugin bridge backed by Zotero's JavaScript API.

### 3. CLI-first for agents

Agents should primarily use `zotero ...` commands, not raw `curl`. HTTP is the transport; the CLI is the normal interface.

### 4. Personal-library only

Version 1 manages only the user's personal library. Group-library complexity is deferred.

### 5. Trash, not permanent delete

Destructive operations move items or collections to Zotero Trash. Permanent deletion is out of scope.

### 6. Full control with a guarded escape hatch

The structured command surface should cover common work, but an explicitly guarded raw Zotero JavaScript fallback should exist for rare advanced cases.

## Architecture

The system has four parts.

### 1. Built-in Zotero Local Read API

Use Zotero's existing local API under `http://localhost:23119/api/users/0/...` for browsing and read-oriented tasks such as:

- listing items
- fetching item metadata
- listing collections
- searching and filtering through supported local API routes

This keeps read behavior close to official Zotero behavior and avoids rebuilding endpoints Zotero already provides.

### 2. Plugin Write Bridge

Create a Zotero plugin that exposes a small authenticated write endpoint on the local server. The plugin should not duplicate the full read API. Its job is to handle mutations that the built-in local API does not provide conveniently for local agent use.

Recommended endpoint shape:

- `POST /agent/command`
- `GET /agent/health`

The plugin executes mutations through Zotero's JavaScript API.

### 3. `zotero` CLI

Provide a first-party CLI named `zotero`.

Examples:

- `zotero collections list`
- `zotero collections create --name "To Read"`
- `zotero items get --key ABC123`
- `zotero items create --item-type journalArticle --title "Example"`
- `zotero items set-field --key ABC123 --field DOI --value 10.1000/test`
- `zotero items trash --key ABC123`
- `zotero bulk trash --keys ABC123,DEF456`
- `zotero attachments best-pdf --item-key ABC123`
- `zotero attachments path --attachment-key PDF123`
- `zotero attachments read-text --attachment-key PDF123`
- `zotero attachments export --attachment-key PDF123 --to /tmp/paper.pdf`

The CLI chooses the correct backend automatically:

- built-in Zotero local API for reads
- plugin write bridge for mutations

### 4. `zotero-manage` Skill

Provide a dedicated skill that instructs agents to:

- prefer the `zotero` CLI over raw HTTP
- inspect before mutating when the target is ambiguous
- treat trash operations as destructive
- use structured commands first
- use the raw JavaScript fallback only when necessary

## Data Flow

### Read flow

`agent -> skill guidance -> zotero CLI -> Zotero built-in local API -> JSON result`

### Write flow

`agent -> skill guidance -> zotero CLI -> plugin /agent/command -> Zotero JavaScript API -> JSON result`

### Attachment retrieval flow

`agent -> skill guidance -> zotero attachments ... -> built-in read API or plugin helper -> attachment metadata/path/text -> JSON result`

### Advanced fallback flow

`agent -> skill guidance -> zotero unsafe run-js -> plugin /agent/command -> guarded raw JS execution -> JSON result`

## Command Model

The plugin exposes one internal command bus:

```json
{
  "command": "items.create",
  "args": {
    "itemType": "journalArticle",
    "title": "Example"
  }
}
```

Success response:

```json
{
  "ok": true,
  "command": "items.create",
  "data": {}
}
```

Failure response:

```json
{
  "ok": false,
  "error": {
    "code": "INVALID_INPUT",
    "message": "itemKey is required"
  }
}
```

The CLI wraps this model in stable, natural commands. The plugin therefore stays small, while the CLI remains pleasant for agents and humans.

## Identifier Strategy

Preferred stable identifier: Zotero item key.

Rules:

- commands should accept item keys everywhere they can
- numeric item IDs may be accepted as a fallback input
- help text and examples should prefer keys
- collection operations should also prefer collection keys when available

## Output Strategy

The CLI outputs JSON by default.

Reasons:

- the primary consumer is an AI agent
- structured output reduces parsing ambiguity
- human-readable formatting can be added later as an optional mode

Recommended optional future flag:

- `--pretty` for readable terminal formatting

## Structured Command Surface For Version 1

### Collections

- list collections
- create collection
- rename collection
- trash collection

### Items

- list items
- get item
- create item
- update item from a patch object
- set a single field
- trash item

### Item Organization

- add item to collection
- remove item from collection
- move item between collections

### Tags

- add tag
- remove tag
- replace or patch tags through item update where appropriate

### Stable Attachment Retrieval

- list attachments for an item
- identify the best PDF attachment for a parent item
- get attachment metadata
- get local file path for a stored attachment
- open attachment
- read extracted text when available
- export or copy an attachment file to another path for downstream agent use

These commands are part of the normal stable API because they support “agent can get the paper however it needs”.

### Experimental Attachment Mutation

- add attachment
- rename attachment metadata
- trash attachment
- replace attachment

These operations may be present in version 1 only as explicitly experimental commands because they were previously observed to be slow or fragile in practice.

### Bulk Operations

Support bulk operations in version 1 for common agent workflows, including at minimum:

- bulk trash items
- bulk add to collection
- bulk remove from collection
- bulk move between collections
- bulk add tag
- bulk remove tag

Bulk commands should return per-item results rather than only one aggregate status so partial failures are visible.

## Escape Hatch

Version 1 includes a guarded advanced fallback:

- `zotero unsafe run-js --code '...'`

Purpose:

- allow full local control when a structured command does not yet exist
- prevent the system from being blocked by gaps in the structured command set

Rules:

- disabled by default
- requires explicit local enablement in plugin settings or plugin prefs
- clearly marked `unsafe` in both CLI and skill
- should return structured success/error output
- should not be the default path for normal operations

Experimental attachment mutation commands should follow a similar principle:

- clearly labeled experimental
- allowed only through explicit commands
- separated from the stable retrieval commands

## Authentication And Safety

### Authentication

The plugin write bridge is local-only and accepts direct local requests for mutating operations and unsafe commands.

The built-in read API remains governed by Zotero's own local API behavior.

### Safety boundaries

- item delete means move to Trash
- collection delete means move to Trash
- permanent delete is not exposed
- unsafe JS execution is disabled by default
- bulk operations should report partial failures explicitly
- stable attachment retrieval should remain usable even if experimental attachment mutation is disabled

### Ambiguity handling

The skill should instruct agents to confirm or restate the intended target when:

- multiple items match a search
- a trash operation may affect many items
- the agent is about to use `unsafe run-js`

## Plugin Responsibilities

- register local write endpoints
- validate command names and arguments
- authenticate mutating requests
- execute write operations through Zotero's JavaScript API
- expose health/config information
- gate unsafe mode behind an explicit preference
- provide attachment helper operations needed for stable retrieval when the built-in read API is insufficient

## CLI Responsibilities

- provide the main interface for agents
- wrap built-in reads and plugin writes behind consistent commands
- normalize arguments and identifiers
- emit JSON by default
- expose a stable command hierarchy independent of Zotero internal implementation details
- give attachment retrieval first-class commands separate from experimental attachment mutation

## Skill Responsibilities

- teach the agent to use `zotero ...` first
- explain the hybrid read/write model
- prefer structured commands over raw HTTP
- avoid unsafe mode unless needed
- describe destructive behavior honestly
- provide examples for common workflows
- teach attachment retrieval as a normal workflow and attachment mutation as experimental

## Error Handling

All plugin-backed commands should use structured error objects with:

- machine-readable `code`
- human-readable `message`
- optional `details`

Suggested error classes:

- `INVALID_INPUT`
- `NOT_FOUND`
- `NOT_EDITABLE`
- `AUTH_REQUIRED`
- `UNSAFE_DISABLED`
- `PARTIAL_FAILURE`
- `INTERNAL_ERROR`

The CLI should preserve these codes in JSON output and exit nonzero on failure.

## Suggested Repository Layout

- `plugin/`: Zotero plugin source
- `cli/` or `scripts/`: CLI implementation
- `skills/zotero-manage/`: skill instructions
- `tests/`: contract, CLI, and plugin tests
- `README.md`: install, usage, safety model

The old bridge-specific naming should be simplified. The new skill name should be `zotero-manage`.

## Testing Strategy

### Automated tests

- command contract validation
- argument parsing tests for CLI
- plugin command dispatch tests
- error-shape tests
- bulk result-shape tests
- attachment retrieval contract tests
- attachment export/path/read-text tests where practical at the contract boundary

### Manual verification

Against a real local Zotero install:

- health check works
- reads through built-in local API work
- collection create/rename/trash works
- item create/update/set-field/trash works
- move/add/remove collection membership works
- tag operations work
- attachment list/path/open/read or export works for a stored PDF
- bulk operations work
- unsafe mode is blocked when disabled
- unsafe mode works only after explicit enablement
- experimental attachment mutation, if enabled, is tested separately and not treated as a blocker for stable retrieval

## Rollout Strategy

Version 1 should land in this order:

1. plugin health/config plus authenticated command endpoint
2. CLI read wrappers over built-in Zotero local API
3. stable attachment retrieval commands
4. CLI write wrappers for collections, items, and tags
5. bulk operations
6. `zotero-manage` skill
7. guarded unsafe fallback
8. optional experimental attachment mutation commands

This keeps the first working version useful early while still moving toward full management capability.

## Success Criteria

The design is successful when:

1. an agent can manage the personal Zotero library without scraping the UI
2. reads use Zotero's built-in local API instead of duplicating it
3. writes use a small authenticated plugin bridge
4. the normal agent path is a JSON-first `zotero` CLI
5. delete means Trash, not permanent deletion
6. version 1 includes stable attachment retrieval for PDFs already in Zotero
7. attachment mutation is clearly separated as experimental or deferred
8. a guarded raw-JS fallback exists for advanced operations not yet wrapped
