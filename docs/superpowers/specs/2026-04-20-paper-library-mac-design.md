# Personal Paper Library for macOS: Design Spec

Date: 2026-04-20
Status: Approved for planning

## Summary

Build a native macOS app for managing a personal academic paper library. The app should feel cleaner and more controllable than Zotero, with a stronger focus on fast capture/import, reliable metadata cleanup, centralized PDF storage, and first-class AI automation.

Version 1 is a personal desktop app only. It does not need cloud sync, collaboration, publishing, or an integrated PDF reader. PDFs are opened in an external viewer, but the app owns the library metadata and stores imported files in one managed local folder.

## Product Goals

- Make a paper library easy to browse and organize through clean collections.
- Make paper capture and metadata normalization much less manual than Zotero.
- Keep all imported PDFs in one predictable managed folder instead of leaving files scattered around the Mac.
- Store enough metadata to reconstruct APA references reliably for papers.
- Expose stable automation surfaces so AI agents can import, search, update, and open papers without scraping the UI.
- Keep the UI small, calm, and human-friendly.

## Non-Goals for Version 1

- Built-in PDF viewing or annotation
- Word processor citation plugins
- Team collaboration or sync
- Mobile clients
- Full bibliographic support for every reference type
- Knowledge graph or note-taking system beyond a small metadata note field if needed later

## Target Users

Primary user: one person using a Mac for collecting and organizing papers locally.

Secondary user: local AI agents and scripts that need structured access to the same paper library through an API and CLI.

## Product Principles

1. Native-first on macOS
The app should feel like a real desktop app, not a website wrapped in a shell.

2. One source of truth
The library engine owns all library actions. The macOS UI, local API, and CLI all call the same underlying operations.

3. Centralized files
Every imported PDF is copied into a managed paper vault rooted at `~/Documents/Papers` in version 1.

4. Metadata over clutter
Only store the fields that matter for paper identification, APA reconstruction, search, organization, and automation.

5. Agent-safe by design
All important actions should be deterministic, structured, and callable without UI automation.

## Architecture

The system is composed of five parts:

### 1. Native macOS UI

A SwiftUI app with a focused desktop layout:

- Left sidebar: collections
- Center list: papers
- Right detail pane: metadata and actions

The UI is intentionally thin. It should display and edit library state cleanly, but business logic lives elsewhere.

### 2. Library Engine

A local core module that owns all library operations:

- import from URL, DOI, arXiv, connector payload, or API payload
- normalize metadata into the app schema
- attach and copy PDF files into the managed vault
- deduplicate incoming items
- manage collections
- search and filter papers
- update metadata
- open the paper in the external PDF viewer

This module is the main product boundary and the basis for both human and AI use.

### 3. Local Metadata Store

Use SQLite as the system of record for papers, authors, collections, relationships, identifiers, and import provenance.

Reasons:

- fast local queries
- easy inspection and backup
- stable schema for API and CLI work
- good fit for one-user desktop software

### 4. Managed Paper Vault

Imported PDFs are copied into a single managed folder rooted at:

`~/Documents/Papers`

Suggested path pattern:

`~/Documents/Papers/<paper-id>/<normalized-filename>.pdf`

This avoids broken references and keeps the app in control of file location. The app stores the canonical PDF path in the database and uses that path for opening the file externally.

### 5. Automation Surface

Expose the library through:

- a local JSON API on `localhost`
- a CLI for shell and agent workflows

The API and CLI must call the same library-engine actions as the UI.

## Data Model

Version 1 focuses on scholarly papers and preprints. The schema should support APA-complete metadata for those document types without trying to represent every reference type in academic publishing.

### Paper

Required or strongly expected fields:

- `id`
- `title`
- `publication_type`
- ordered author list
- `year`
- `venue`
- `pdf_path`
- `created_at`
- `updated_at`

At least one external identifier should be stored when available, typically `doi` or `url`. Imports without a trustworthy identifier are still allowed, but should be marked for review more aggressively.

Optional fields used when available:

- `subtitle`
- `abstract`
- `month`
- `day`
- `publisher`
- `volume`
- `issue`
- `pages`
- `language`
- `last_opened_at`
- `last_read_at`

`publication_type` should support at least:

- journal article
- conference paper
- preprint

### Authors

Store authors separately and preserve order:

- `paper_id`
- `author_order`
- `given_name`
- `family_name`
- `full_name_raw`

Author order is required for correct APA reconstruction.

### Collections

Collections are the main human organization structure:

- `id`
- `name`
- `parent_id` optional
- `created_at`
- `updated_at`

Use a join table for paper-to-collection membership.

### Import Provenance

Each import stores lightweight provenance:

- `source_type` such as `url`, `browser`, `api`, `manual`
- `source_value`
- `imported_at`
- `metadata_confidence`
- `needs_review`

This makes low-confidence or agent-created records easy to inspect later.

### Status Model

Version 1 does not introduce a large workflow state machine. Lightweight organization should come from:

- collections
- `last_opened_at`
- `last_read_at`
- optional tags later if needed

## Import and Metadata Flow

Version 1 should optimize hardest for paper capture and cleanup.

### Supported Import Lanes

1. Paste link or identifier

Users or agents can provide a DOI, arXiv link, publisher URL, or paper URL. The app detects the identifier and fetches metadata.

2. Browser connector

A thin browser connector sends structured capture data to the local app, such as:

- current page URL
- page title
- detected DOI or arXiv identifier
- PDF URL if available

The app, not the extension, performs metadata fetch, normalization, storage, and deduplication.

3. API import

Agents can import by sending:

- a URL or identifier
- a metadata payload
- an optional local PDF path or downloadable PDF URL

### Import Pipeline

Every capture path should flow through the same steps:

`capture -> detect identifier -> fetch candidate metadata -> normalize -> download or copy PDF -> deduplicate -> save -> mark for review if needed`

### Metadata Source Strategy

Prefer trusted structured sources over raw page scraping whenever possible. Suitable sources include:

- Crossref
- arXiv metadata
- DOI landing page metadata
- publisher metadata when accessible

If fields conflict, the app chooses the best normalized value and preserves a confidence signal through `metadata_confidence` and `needs_review`.

### Deduplication

Deduplication should use this priority:

1. DOI exact match
2. normalized title + year + first author
3. URL fingerprint

If a likely duplicate exists, the app should not silently create a second record. It should return a duplicate result and offer merge or update behavior.

### Missing or Partial Data

- If metadata is partial, save the record and flag it for review.
- If the PDF cannot be obtained, save the metadata record with a missing-file state.
- If the PDF is present but metadata is weak, still save the item and mark it for cleanup.

## Human UI

The main window should prioritize browsing and editing over feature density.

### Main Layout

- Sidebar for collections
- Search bar at the top
- Paper list in the center
- Detail panel on the right

### Primary Actions

- Import
- Paste Link
- New Collection
- Open PDF
- Edit Metadata

### List Presentation

Each paper row should emphasize:

- title
- authors
- year
- venue
- lightweight indicators for import state or review state

The list must be easy to scan and sort.

### Search and Sorting

Search should cover:

- title
- authors
- DOI
- URL
- venue
- collection membership

Sorting should support:

- recently imported
- recently opened
- year
- author
- title

## AI Interface

Version 1 should expose both a CLI and local JSON API.

### CLI

Example commands:

- `paperlib import <url>`
- `paperlib add-file /path/to/file.pdf`
- `paperlib search "<query>"`
- `paperlib update <paper-id> --collection <name>`
- `paperlib open <paper-id>`

### Local API

Example actions:

- `POST /papers/import`
- `POST /papers`
- `GET /papers/search`
- `PATCH /papers/:id`
- `POST /papers/:id/open`
- `GET /collections`

### Interface Behavior

Both interfaces should return structured results that agents can act on, such as:

- `imported`
- `duplicate_found`
- `review_required`
- `pdf_missing`
- `metadata_incomplete`

The UI may translate these states into friendly messages, but the underlying action outcomes should remain structured and stable.

## File Handling

All imported PDFs are copied into the managed vault under `~/Documents/Papers`.

Version 1 behavior:

- never depend on scattered original locations after import
- keep a canonical stored PDF path
- open the canonical file in the external default PDF viewer
- avoid mutating files outside the managed vault during normal use

Future versions may allow configurable vault roots, but version 1 uses a fixed path to reduce complexity.

## Error Handling

Failures should be explicit and non-destructive.

- If metadata fetch fails, show the failure and allow manual completion later.
- If deduplication finds an existing item, present the existing record and a merge or update path.
- If the library folder cannot be written, block the write and explain the problem clearly.
- If an open-file action fails because the file is missing, show the missing-file state and do not pretend the record is healthy.

## Testing Strategy

Testing effort should focus on the library engine first.

High-priority coverage:

- metadata normalization
- APA-complete field validation for supported paper types
- deduplication rules
- file copy and canonical path generation
- missing-file and low-confidence states
- parity between UI, CLI, and API action outcomes

Lower-priority coverage:

- UI rendering and interaction smoke tests

The product should be correct at the engine layer even if the UI remains relatively lightweight.

## Initial Technical Recommendation

Use:

- Swift + SwiftUI for the macOS app
- SQLite for local storage
- a shared local domain layer for library logic
- a small embedded local server for the JSON API
- a CLI backed by the same domain layer

This matches the native-first goal while preserving AI-friendly control.

## Future Expansion

Potential later features, explicitly out of version 1 scope:

- configurable paper vault root
- tags
- note fields and research annotations
- built-in PDF viewing
- citation export and writing integrations
- sync or backup helpers
- richer agent integrations such as MCP exposure

## Success Criteria for Version 1

The product is successful if the user can:

- import papers quickly from URL, browser capture, or API
- trust the app to store PDFs in one stable location
- browse papers through clean collections
- open any stored paper in one click
- correct metadata without friction
- let an AI agent search, import, update, and open records through supported interfaces
