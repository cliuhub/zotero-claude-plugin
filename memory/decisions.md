# Decisions

## 2026-04-22 Built-in First, Bridge Second

- Fact: Prefer Zotero's built-in local API, JavaScript API, identifier import, translator behavior, and attachment handling whenever they already solve the job.
- Why: Re-implementing Zotero behavior adds brittleness and drift, while the project goal is agent control over Zotero rather than a parallel Zotero clone.

## 2026-04-22 Add-on Manifest Must Include Update URL

- Fact: Zotero rejected the add-on install path until `applications.zotero.update_url` was present in `plugin/manifest.json`.
- Why: Zotero's internal manifest loader reported `applications.zotero.update_url not provided`, which surfaced externally as install parse error `-3`.

## 2026-04-22 XPI Install Is The Reliable Activation Path

- Fact: Source-proxy setup alone is not sufficient to guarantee that the write bridge is active.
- Why: The add-on can remain discovered-but-disabled in profile startup data, while a valid XPI install path is accepted by `AddonManager.getInstallForFile()`.

## 2026-04-22 Health Endpoint Must Use Zotero Single-Request Signature

- Fact: `/agent/health` must expose `init(request)` instead of a zero-argument `init()`.
- Why: Zotero dispatches endpoint handlers by `init.length`, so a zero-argument handler is treated as the legacy three-parameter form and hangs instead of returning JSON.

## 2026-04-22 Local Bridge Uses Direct Local Requests

- Fact: The local `/agent/command` endpoint accepts direct local requests, and the CLI talks to it without extra setup.
- Why: Extra local auth plumbing was creating agent friction without adding value for this personal local-only Zotero setup.

## 2026-04-22 Item Trash Must Use trashTx

- Fact: Live item trashing should prefer `Zotero.Items.trashTx()` over `Zotero.Items.trash()`.
- Why: The plain `trash()` path can throw `Not in transaction`, while Zotero's own UI code uses `trashTx()` for safe item-to-trash operations.

## 2026-04-23 Paper Reading Is Self-Contained In The Zotero CLI

- Fact: `items.paper` is the primary paper-reading command, and `attachments.read-text` is the lower-level equivalent.
- Why: Agents should not need to leave the Zotero pipeline just to resolve a paper PDF and parse it.

## 2026-04-23 Auto Extraction Retries With OCR When Initial Text Is Clearly Bad

- Fact: The default extractor is now `auto`: local PDF parsing first, then OCRmyPDF redo or local OCR when the first result is obviously poor.
- Why: Older PDFs often return mostly boilerplate or very sparse text from the raw parser, so the simplest agent path also needs to be the robust one.

## 2026-04-23 Read Responses Are Normalized

- Fact: CLI read commands now return normalized agent-friendly objects instead of raw Zotero API envelopes.
- Why: Agents should not have to learn one nested schema for reads and a different flat schema for writes.

## 2026-04-23 Stale Profile XPIs Can Shadow Source Add-ons

- Fact: Zotero can keep loading an older profile XPI even when a source-proxy file points at the repo plugin directory.
- Why: The live bridge only picked up new commands after removing the stale profile XPI plus `extensions.json` and `addonStartup.json.lz4`, then restarting Zotero.
