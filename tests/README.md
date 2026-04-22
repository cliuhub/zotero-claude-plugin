# Manual verification

## Preconditions

1. Build and install the plugin XPI in Zotero.
2. Restart Zotero.
3. Ensure Zotero is listening on `http://127.0.0.1:23119`.

## Health

1. Run `curl -s http://127.0.0.1:23119/agent/health`.
2. Confirm the JSON reports Zotero version and current unsafe or experimental flags.

## Reads

1. Run `python3 scripts/zotero_cli.py collections list`.
2. Run `python3 scripts/zotero_cli.py items list`.
3. Run `python3 scripts/zotero_cli.py items get --key ITEM123`.
4. Run `python3 scripts/zotero_cli.py items paper --key ITEM123`.
5. Run `python3 scripts/zotero_cli.py items search --query "keyword"`.
6. Confirm the JSON shape is normalized for agent use rather than mirroring the raw Zotero local API output.

## Writes

1. Run `python3 scripts/zotero_cli.py collections create --name "CLI Test"`.
2. Rename that collection with `collections rename`.
3. Create an item with `items create`.
4. Update one field with `items set-field`.
5. Move the item into the new collection and then trash it.
6. Trash the temporary collection.

## Bulk

1. Create or choose two temporary items.
2. Run `bulk add-tag`, `bulk remove-tag`, and `bulk trash`.
3. Confirm the JSON result reports the targeted item keys and per-item results.

## Stable attachment retrieval

1. Pick a stored PDF attachment key from your personal library.
2. Run `python3 scripts/zotero_cli.py attachments best-pdf --item-key ITEM123`.
3. Confirm the JSON result chooses the expected PDF attachment.
4. Run `python3 scripts/zotero_cli.py attachments path --attachment-key PDF123`.
5. Confirm the JSON result includes the local file path.
6. Run `python3 scripts/zotero_cli.py attachments read-text --attachment-key PDF123`.
7. Confirm the JSON result includes parsed text and an `extraction` block.
8. Run `python3 scripts/zotero_cli.py attachments export --attachment-key PDF123 --to /tmp/exported-paper.pdf`.
9. Confirm the file is copied to the requested destination.
10. Run `python3 scripts/zotero_cli.py attachments open --attachment-key PDF123`.
11. Confirm the system opens the attachment file.

## Notes

1. Run `python3 scripts/zotero_cli.py notes list --item-key ITEM123`.
2. Run `python3 scripts/zotero_cli.py notes upsert --item-key ITEM123 --note "CLI note smoke test"`.
3. Confirm the JSON returns the created note key and preview.
4. Trash the temporary note with `python3 scripts/zotero_cli.py notes trash --key NOTE123`.

## Unsafe gate

1. Confirm `extensions.zotero.zoteroAgent.unsafeEnabled=false`.
2. Run `python3 scripts/zotero_cli.py unsafe run-js --code 'return 1;'`.
3. Confirm the command returns `UNSAFE_DISABLED`.
4. Enable the pref, rerun the command, and confirm it succeeds.

## Experimental gate

1. Confirm `extensions.zotero.zoteroAgent.experimentalAttachmentsEnabled=false`.
2. Run `python3 scripts/zotero_cli.py attachments experimental add --item-key ITEM123 --file /tmp/paper.pdf`.
3. Confirm the command returns `EXPERIMENTAL_DISABLED`.
4. Enable the pref and rerun the command.
5. Confirm the experimental attachment add or trash command succeeds.
