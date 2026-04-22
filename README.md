# Zotero Local Agent Management

## CLI scaffold

This project includes a JSON-first `zotero` CLI scaffold implemented in `scripts/zotero_cli.py`.

Current built-in read commands:

- `zotero collections list`
- `zotero items list`
- `zotero items get --key ABC123`
- `zotero items search --query "deep learning"`
- `zotero attachments list`

Stable attachment retrieval commands now use the authenticated plugin command endpoint:

- `zotero attachments path --attachment-key PDF123`
- `zotero attachments read-text --attachment-key PDF123`
- `zotero attachments export --attachment-key PDF123 --to /tmp/paper.pdf`
- `zotero attachments open --attachment-key PDF123`

The `zotero attachments best-pdf` command is still a placeholder and returns structured `NOT_IMPLEMENTED` JSON until a later task lands it.

Defaults:

- base URL: `http://127.0.0.1:23119`
- built-in read API root: `http://127.0.0.1:23119/api/users/0`
- plugin command endpoint: `http://127.0.0.1:23119/agent/command`

Plugin-backed attachment commands require a token. The CLI accepts `--token ...` or falls back to the `ZOTERO_AGENT_TOKEN` environment variable.
