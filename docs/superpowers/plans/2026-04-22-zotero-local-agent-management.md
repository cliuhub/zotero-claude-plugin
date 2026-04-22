# Zotero Local Agent Management Implementation Plan

This historical plan has been superseded by the live implementation in this repo.

## Current Direction

- The local Zotero bridge is local-only and does not use a separate local auth design.
- The CLI is the main agent interface.
- Reads are normalized for agents.
- Paper reading is centered on `items paper` and `attachments read-text`.
- Notes are first-class commands.

## Source Of Truth

- Use [README.md](../../../README.md) for current usage.
- Use [skills/zotero-manage/SKILL.md](../../../skills/zotero-manage/SKILL.md) for agent workflow.
- Use [memory/state.md](../../../memory/state.md) for current runtime status.
