---
name: zotero-manage
description: Use when an agent needs to manage a local personal Zotero library through the `zotero` CLI, including reads, collections, items, tags, bulk operations, stable PDF retrieval, and guarded unsafe or experimental commands.
---

# Zotero Manage

Use this skill when Zotero Desktop is running on the same machine and the local plugin bridge is installed.

## Preconditions

- Zotero is running with local HTTP access enabled on `http://127.0.0.1:23119`
- the local plugin build is installed in Zotero
- `ZOTERO_AGENT_TOKEN` is set, or `--token` is passed to the CLI
- the target library is the personal Zotero library

## Default workflow

1. Prefer the `zotero` CLI over raw HTTP.
2. Read before mutating when the target is ambiguous.
3. Prefer item keys and collection keys over numeric IDs.
4. Treat trash operations as destructive but reversible.
5. Use stable attachment retrieval commands for PDFs before reaching for experimental attachment mutation.
6. Use `unsafe run-js` only as a last resort when the structured command surface cannot do the job.

## Read commands

- `zotero collections list`
- `zotero items list`
- `zotero items get --key ITEM123`
- `zotero items search --query "keyword"`
- `zotero attachments list --item-key ITEM123`
- `zotero attachments path --attachment-key PDF123`
- `zotero attachments read-text --attachment-key PDF123`
- `zotero attachments export --attachment-key PDF123 --to /tmp/paper.pdf`
- `zotero attachments open --attachment-key PDF123`

## Write commands

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

## Guarded commands

- `zotero unsafe run-js --code 'return 1;'`
- `zotero attachments experimental add --item-key ITEM123 --file /tmp/paper.pdf --title "Main PDF"`
- `zotero attachments experimental trash --attachment-key PDF123`

## Safety rules

- delete means move to Zotero Trash, not permanent delete
- `unsafe.runJS` is disabled unless `extensions.zotero.zoteroAgent.unsafeEnabled=true`
- experimental attachment mutation is disabled unless `extensions.zotero.zoteroAgent.experimentalAttachmentsEnabled=true`
- if multiple items or collections match, search or list first and then mutate the specific key

## When to pause and clarify

- more than one plausible Zotero item matches the request
- a bulk trash would touch more items than the user explicitly named
- using `unsafe run-js` would bypass an available structured command
