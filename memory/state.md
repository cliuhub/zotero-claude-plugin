# Current State

## Status

- The local Zotero write bridge is live in the desktop app.
- Read responses are normalized for agents across collections, items, attachments, and notes.
- `items paper` is now the primary paper-reading command.
- `attachments read-text` and `items paper` default to `--extractor auto`: local PDF parsing first, then OCRmyPDF redo or local OCR if the first parse is clearly bad.
- First-class note commands are live: `notes list`, `notes get`, `notes upsert`, and `notes trash`.
- The repo CLI and the installed global `~/.agents/bin/zotero` CLI are synced.

## Verified

- `npm test` passes with 47 tests.
- `npm run check:syntax` passes.
- `npm run build:xpi` succeeds and rebuilds `builds/zotero-local-agent-management.xpi`.
- Live repo CLI:
- `attachments best-pdf` resolves a real live PDF attachment from the library.
- `items paper` defaults to `requestedMode=auto` and falls back to `mode=ocrmypdf-redo` when a live older PDF needs it.
- `notes upsert` and `notes trash` succeed against live Zotero.
- Live global CLI:
- the installed global `zotero` command resolves papers correctly.
- the installed global `zotero` command can create and trash notes.

## Runtime Note

- Zotero was loading a stale profile XPI (`0.1.4`) instead of the source-proxy add-on.
- The live bridge picked up the new commands only after removing the stale profile XPI plus `extensions.json` and `addonStartup.json.lz4`, then restarting Zotero.

## Blocker

- None.

## Next Step

- If the user wants another simplification pass, the next candidates are item-level inspect commands or note bulk operations, not more low-level transport work.
