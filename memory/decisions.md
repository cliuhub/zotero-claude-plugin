# Decisions

## Contract auth lookup
- Added a small header resolver that checks case-insensitive plain-object keys and `get()`-based header containers.
Why: the shared contract needs to tolerate both plain objects and `Headers`-like inputs without pulling in dependencies.

## Success payload default
- `success()` now emits `data: {}` when the handler returns `undefined`.
Why: the JSON response shape stays stable for consumers.

## UMD root fallback
- Replaced raw `this` with a safer global-object fallback chain.
Why: the browser/global path should not depend on sloppy-mode `this`.
