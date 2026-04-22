# Zotero Local Agent Management

## Quick start

For local development from this checkout:

1. Run `npm run install:source`.
2. Restart Zotero so it reloads prefs and the source add-on proxy from `plugin/`.
3. If `http://127.0.0.1:23119/agent/command` still returns `404`, install the built XPI once from `Tools -> Plugins -> gear -> Install Add-on From File...`.
4. Use `python3 scripts/zotero_cli.py --help` or `sh bin/zotero --help` to drive the local API.

For an XPI install instead:

1. Build the plugin XPI with `npm run build:xpi`.
2. Install `builds/zotero-local-agent-management.xpi` in Zotero from `Tools -> Plugins -> gear -> Install Add-on From File...`.

## Skill

The agent skill lives at `skills/zotero-manage/SKILL.md`.

To make it available to Codex locally, link or copy `skills/zotero-manage/` into `~/.codex/skills/`.

## CLI scaffold

This project includes a JSON-first `zotero` CLI scaffold implemented in `scripts/zotero_cli.py`.

Current built-in read commands:

- `zotero collections list`
- `zotero items list`
- `zotero items list --collection-key COL123`
- `zotero items get --key ABC123`
- `zotero items paper --key ABC123`
- `zotero items search --query "deep learning"`
- `zotero items lookup-doi --doi 10.1000/example`
- `zotero attachments list --item-key ABC123`
- `zotero attachments best-pdf --item-key ABC123`
- `zotero notes list --item-key ABC123`
- `zotero notes get --key NOTE123`

Stable attachment retrieval commands now use the local plugin command endpoint:

- `zotero attachments path --attachment-key PDF123`
- `zotero attachments read-text --attachment-key PDF123`
- `zotero attachments export --attachment-key PDF123 --to /tmp/paper.pdf`
- `zotero attachments open --attachment-key PDF123`

For actual paper reading, the preferred workflow is now a single Zotero command:

1. `zotero items paper --key ITEM123`
2. inspect the returned normalized item metadata, chosen PDF attachment, local path, and parsed text

The parser design follows the PDF skill workflow internally, but the Zotero pipeline is self-contained now. `zotero items paper` and `zotero attachments read-text` both default to `--extractor auto`: they try the local `pdfplumber` parser first, then automatically fall back to `ocrmypdf-redo` and finally local OCR when the first result is obviously bad. Use `--extractor pdf` only when you explicitly want the raw parser output, `--extractor ocr` for local OCR, `--extractor ocrmypdf-redo` or `--extractor ocrmypdf-force` for explicit OCRmyPDF passes, and `--extractor zotero` only when you want Zotero's built-in text layer for debugging or comparison. Non-PDF attachments still use Zotero's built-in text path.

OCRmyPDF is optional. On macOS, install it with `brew install ocrmypdf`. If it is unavailable, the OCRmyPDF extractors return a structured local error instead of silently falling back.

Read responses are normalized for agents. They no longer mirror the raw Zotero local API shape directly, so the CLI surface is consistent across reads and writes.

Structured write commands also use the plugin command endpoint:

- `zotero collections create --name "To Read"`
- `zotero collections rename --key COL123 --name "Reading Queue"`
- `zotero collections trash --key COL123`
- `zotero items create --item-type journalArticle --title "Example"`
- `zotero items create --doi 10.3115/v1/d14-1179`
- `zotero items update --key ITEM123 --patch '{"abstractNote":"Updated"}'`
- `zotero items set-field --key ITEM123 --field DOI --value 10.1000/test`
- `zotero items add-to-collection --key ITEM123 --collection-key COL123`
- `zotero items remove-from-collection --key ITEM123 --collection-key COL123`
- `zotero items move --key ITEM123 --collection-key COL456`
- `zotero items trash --key ITEM123`
- `zotero notes upsert --item-key ITEM123 --note "Key insight"`
- `zotero notes trash --key NOTE123`
- `zotero tags add --key ITEM123 --tag priority`
- `zotero tags remove --key ITEM123 --tag priority`
- `zotero bulk trash --keys ITEM123,ITEM456`
- `zotero bulk add-tag --keys ITEM123,ITEM456 --tag queued`

Guarded advanced commands:

- `zotero unsafe run-js --code 'return 1;'`
- `zotero attachments experimental add --item-key ITEM123 --file /tmp/paper.pdf --title "Main PDF"`
- `zotero attachments experimental trash --attachment-key PDF123`

Defaults:

- base URL: `http://127.0.0.1:23119`
- built-in read API root: `http://127.0.0.1:23119/api/users/0`
- plugin command endpoint: `http://127.0.0.1:23119/agent/command`

Plugin-backed attachment and write commands are local-only. The CLI sends commands directly to `http://127.0.0.1:23119/agent/command`.

If `http://127.0.0.1:23119/agent/command` returns `404`, the add-on is not loaded. Run `npm run install:source`, restart Zotero, and if needed install `builds/zotero-local-agent-management.xpi` once from Zotero's Plugins window.

Safety defaults:

- `unsafe.runJS` is disabled unless `extensions.zotero.zoteroAgent.unsafeEnabled` is set to `true`
- experimental attachment mutation is disabled unless `extensions.zotero.zoteroAgent.experimentalAttachmentsEnabled` is set to `true`

Stable support:

- normalized read commands
- structured collection, item, tag, and bulk management
- first-class note management
- attachment best-pdf, path, open, read-text, export, and item paper

Experimental support:

- attachment add
- attachment trash
- raw unsafe JavaScript execution
