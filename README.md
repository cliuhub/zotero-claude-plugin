# Zotero Local Agent Management

## CLI scaffold

This project includes a JSON-first `zotero` CLI scaffold in [scripts/zotero_cli.py](/Users/cliu/Documents/tasks/zotero/.worktrees/zotero-local-agent-management/scripts/zotero_cli.py).

Current read commands:

- `zotero collections list`
- `zotero items list`
- `zotero items get --key ABC123`
- `zotero items search --query deep learning`
- `zotero attachments list`
- `zotero attachments best-pdf --item-key ABC123`
- `zotero attachments path --attachment-key PDF123`
- `zotero attachments read-text --attachment-key PDF123`
- `zotero attachments export --attachment-key PDF123 --to /tmp/paper.pdf`

Defaults:

- base URL: `http://127.0.0.1:23119`
- built-in read API root: `http://127.0.0.1:23119/api/users/0`

The attachment helper commands currently return structured `NOT_IMPLEMENTED` JSON until the later attachment tasks land.
