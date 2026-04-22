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

Structured write commands also use the plugin command endpoint:

- `zotero collections create --name "To Read"`
- `zotero collections rename --key COL123 --name "Reading Queue"`
- `zotero collections trash --key COL123`
- `zotero items create --item-type journalArticle --title "Example"`
- `zotero items update --key ITEM123 --patch '{"abstractNote":"Updated"}'`
- `zotero items set-field --key ITEM123 --field DOI --value 10.1000/test`
- `zotero items add-to-collection --key ITEM123 --collection-key COL123`
- `zotero items remove-from-collection --key ITEM123 --collection-key COL123`
- `zotero items move --key ITEM123 --collection-key COL456`
- `zotero items trash --key ITEM123`
- `zotero tags add --key ITEM123 --tag priority`
- `zotero tags remove --key ITEM123 --tag priority`
- `zotero bulk trash --keys ITEM123,ITEM456`
- `zotero bulk add-tag --keys ITEM123,ITEM456 --tag queued`

Guarded advanced commands:

- `zotero unsafe run-js --code 'return 1;'`
- `zotero attachments experimental add --item-key ITEM123 --file /tmp/paper.pdf --title "Main PDF"`
- `zotero attachments experimental trash --attachment-key PDF123`

The `zotero attachments best-pdf` command is still a placeholder and returns structured `NOT_IMPLEMENTED` JSON until a later task lands it.

Defaults:

- base URL: `http://127.0.0.1:23119`
- built-in read API root: `http://127.0.0.1:23119/api/users/0`
- plugin command endpoint: `http://127.0.0.1:23119/agent/command`

Plugin-backed attachment and write commands require a token. The CLI accepts `--token ...` or falls back to the `ZOTERO_AGENT_TOKEN` environment variable.

Safety defaults:

- `unsafe.runJS` is disabled unless `extensions.zotero.zoteroAgent.unsafeEnabled` is set to `true`
- experimental attachment mutation is disabled unless `extensions.zotero.zoteroAgent.experimentalAttachmentsEnabled` is set to `true`
