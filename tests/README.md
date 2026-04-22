# Manual verification

## Stable attachment retrieval

1. Install the plugin build in Zotero and restart Zotero.
2. Set a local token in Zotero prefs that matches `ZOTERO_AGENT_TOKEN`.
3. Pick a stored PDF attachment key from your personal library.
4. Run `python3 scripts/zotero_cli.py --token "$ZOTERO_AGENT_TOKEN" attachments path --attachment-key PDF123`.
5. Confirm the JSON result includes the local file path.
6. Run `python3 scripts/zotero_cli.py --token "$ZOTERO_AGENT_TOKEN" attachments read-text --attachment-key PDF123`.
7. Confirm the JSON result includes extracted text when Zotero has indexed the file.
8. Run `python3 scripts/zotero_cli.py --token "$ZOTERO_AGENT_TOKEN" attachments export --attachment-key PDF123 --to /tmp/exported-paper.pdf`.
9. Confirm the file is copied to the requested destination.
10. Run `python3 scripts/zotero_cli.py --token "$ZOTERO_AGENT_TOKEN" attachments open --attachment-key PDF123`.
11. Confirm the system opens the attachment file.
