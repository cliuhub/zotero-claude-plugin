# Zotero Local Agent Management

Local-first Zotero automation for agents and power users.

This project keeps Zotero as the real library app, then adds a clean local bridge and JSON-first CLI so an agent can manage your library without UI automation. The goal is simple: keep Zotero's familiar library model, but make it much easier to script, inspect, and control.

> [!IMPORTANT]
> This project is designed for a personal local Zotero library on the same machine. It is not a hosted service and it does not use Zotero's cloud API as the primary control surface.

[Overview](#overview) • [Features](#features) • [Getting started](#getting-started) • [Common workflows](#common-workflows) • [Paper reading](#paper-reading) • [Development](#development) • [Troubleshooting](#troubleshooting)

## Overview

The system has three parts:

- A Zotero desktop add-on that exposes a local command bridge at `http://127.0.0.1:23119/agent/command`
- A `zotero` CLI implemented in [`scripts/zotero_cli.py`](./scripts/zotero_cli.py)
- A local agent skill in [`skills/zotero-manage/SKILL.md`](./skills/zotero-manage/SKILL.md)

Reads reuse Zotero's built-in local API where that already works well. Writes and attachment helpers go through the add-on, which uses Zotero's own local JavaScript API. The CLI hides that split behind one stable command surface.

## Features

- Local-only agent control over collections, items, tags, notes, bulk operations, and attachment helpers
- Normalized JSON output for reads and writes, so agents do not need to learn two different schemas
- First-class paper reading via `items paper`, which resolves the best PDF, returns the local path, and parses the paper text in one response
- Automatic parser fallback for difficult PDFs: local parse first, then OCRmyPDF redo or local OCR when the first result is clearly bad
- Safe defaults: trash instead of permanent delete, guarded `unsafe run-js`, and experimental attachment mutation behind a Zotero pref
- Source install and XPI install paths for the Zotero add-on

> [!NOTE]
> The main paper-reading entrypoint is `items paper`, not a separate PDF workflow. The parser logic takes inspiration from the PDF skill, but the Zotero pipeline is self-contained.

## Getting started

### Requirements

- Zotero Desktop 7 or newer
- Python 3
- Node.js
- macOS for the built-in local OCR helper in [`scripts/pdf_text_extract.swift`](./scripts/pdf_text_extract.swift)
- Optional: `ocrmypdf` for stronger PDF rescue mode

Install OCRmyPDF on macOS if you want the best fallback path:

```bash
brew install ocrmypdf
```

### Install the add-on from this checkout

For local development from this repo:

```bash
npm run install:source
```

Then restart Zotero.

If `http://127.0.0.1:23119/agent/command` still returns `404`, install the built XPI once:

```bash
npm run build:xpi
```

Install [`builds/zotero-local-agent-management.xpi`](./builds/zotero-local-agent-management.xpi) from `Tools -> Plugins -> gear -> Install Add-on From File...`, then restart Zotero again.

### Use the CLI

From the repo:

```bash
sh bin/zotero --help
```

Or directly:

```bash
python3 scripts/zotero_cli.py --help
```

The CLI talks directly to:

- built-in Zotero read API: `http://127.0.0.1:23119/api/users/0`
- local write bridge: `http://127.0.0.1:23119/agent/command`

No separate local auth setup is required.

## Common workflows

### Inspect the library

```bash
zotero collections list
zotero items list --collection-key COL123
zotero items get --key ITEM123
zotero items search --query "agency theory"
```

### Create and organize items

```bash
zotero collections create --name "To Read"
zotero items create --doi 10.3115/v1/D14-1179
zotero items add-to-collection --key ITEM123 --collection-key COL123
zotero tags add --key ITEM123 --tag queued
```

### Manage notes

```bash
zotero notes list --item-key ITEM123
zotero notes upsert --item-key ITEM123 --note "Key takeaway"
zotero notes get --key NOTE123
zotero notes trash --key NOTE123
```

### Bulk actions

```bash
zotero bulk add-tag --keys ITEM123,ITEM456 --tag review
zotero bulk move --keys ITEM123,ITEM456 --collection-key COL456
zotero bulk trash --keys ITEM123,ITEM456
```

## Paper reading

The default paper-reading command is:

```bash
zotero items paper --key ITEM123
```

That returns:

- normalized item metadata
- the chosen PDF attachment
- the local PDF path
- parsed paper text
- extraction metadata

If you need lower-level attachment control:

```bash
zotero attachments best-pdf --item-key ITEM123
zotero attachments path --attachment-key PDF123
zotero attachments read-text --attachment-key PDF123
zotero attachments export --attachment-key PDF123 --to /tmp/paper.pdf
zotero attachments open --attachment-key PDF123
```

### Extraction modes

Default mode is `auto`.

`auto` means:

1. try local `pdfplumber`
2. if the result looks clearly bad, retry with `ocrmypdf-redo`
3. if needed, fall back again to local OCR

You can still force a specific mode:

```bash
zotero items paper --key ITEM123 --extractor pdf
zotero items paper --key ITEM123 --extractor ocr
zotero items paper --key ITEM123 --extractor ocrmypdf-redo
zotero items paper --key ITEM123 --extractor ocrmypdf-force
zotero items paper --key ITEM123 --extractor zotero
```

> [!TIP]
> Use `auto` for normal agent work. Only override the extractor when you are debugging a bad PDF or comparing extraction quality.

## Safety model

- Delete means move to Zotero Trash, not permanent delete
- `unsafe run-js` is disabled unless `extensions.zotero.zoteroAgent.unsafeEnabled=true`
- Experimental attachment mutation is disabled unless `extensions.zotero.zoteroAgent.experimentalAttachmentsEnabled=true`
- Reads and writes return JSON so agents can inspect results before chaining more actions

Guarded commands:

```bash
zotero unsafe run-js --code 'return 1;'
zotero attachments experimental add --item-key ITEM123 --file /tmp/paper.pdf --title "Main PDF"
zotero attachments experimental trash --attachment-key PDF123
```

## Development

Useful scripts:

```bash
npm test
npm run check:syntax
npm run build:xpi
npm run install:source
```

Project layout:

- [`plugin/`](./plugin) - Zotero add-on bootstrap, command registry, and shared contract
- [`scripts/zotero_cli.py`](./scripts/zotero_cli.py) - main CLI
- [`scripts/pdf_text_extract.py`](./scripts/pdf_text_extract.py) - local PDF text parser helper
- [`scripts/pdf_text_extract.swift`](./scripts/pdf_text_extract.swift) - local OCR helper
- [`skills/zotero-manage/SKILL.md`](./skills/zotero-manage/SKILL.md) - agent workflow instructions
- [`tests/`](./tests) - CLI, contract, and manual verification coverage

## Troubleshooting

### `/agent/command` returns `404`

The add-on is not currently loaded by Zotero.

Try this:

1. Run `npm run install:source`
2. Restart Zotero
3. If needed, run `npm run build:xpi` and install the XPI once from Zotero's Plugins window

### Zotero still seems to run old add-on code

Zotero can keep loading a stale profile XPI even when the source-proxy file points at this repo. If the live bridge does not reflect your repo changes, remove the stale profile add-on state and restart Zotero.

The current runtime note is tracked in [`memory/state.md`](./memory/state.md).

### A PDF extracts poorly

Start with:

```bash
zotero items paper --key ITEM123
```

If you want to compare parser behavior explicitly:

```bash
zotero items paper --key ITEM123 --extractor pdf
zotero items paper --key ITEM123 --extractor ocrmypdf-redo
zotero items paper --key ITEM123 --extractor zotero
```

## Reference files

- Current runtime state: [`memory/state.md`](./memory/state.md)
- Key implementation decisions: [`memory/decisions.md`](./memory/decisions.md)
- Manual verification checklist: [`tests/README.md`](./tests/README.md)
