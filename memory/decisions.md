Guard command lookup
- `createEndpoint` now checks own registry properties before dispatching.
- Why: inherited names like `constructor` and `toString` must not be treated as commands.
