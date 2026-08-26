# OpenCode Beads plugin

This package adds a live `bd:` Beads issue picker to the OpenCode TUI and
injects compact, read-only metadata for fresh references into submitted
prompts. It targets OpenCode `>=1.18.23 <2.0.0` and uses only public plugin
APIs.

## Local setup

Build and verify the package from its repository root:

```sh
npm install
npm run verify
```

Add both generated targets to your local OpenCode configuration. Keep the
server target in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-beads-plugin/dist/server.js"]
}
```

Keep the TUI target in `tui.json`:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-beads-plugin/dist/tui.js"]
}
```

For a repository-local setup, the checked-in files already point at the local
`dist` entrypoints. Start OpenCode from this worktree after `npm run build`.

The plugin runs read-only `bd list --json --limit 1000 --sort updated` from the
OpenCode worktree. It inherits `BEADS_DIR` from OpenCode when set; otherwise
Beads resolves its nearest repository workspace. The plugin never reads
`.envrc` files.

## Usage

Type `bd:` at the start of a prompt or after whitespace. Type an issue ID or
title fragment, then use the arrow keys, Enter, Tab, Escape, or mouse to work
with the picker. Selecting an issue inserts `bd:<issue-id>` into the visible
prompt. The server target refreshes references on submission and adds only
current issue ID, title, status, and priority metadata.

Missing Beads state, malformed output, timeouts, and other discovery failures
show `No matching items` in an active picker but never block normal prompt
editing or submission.

## Verification

`npm run verify` runs TypeScript checking, Node tests, the target OpenTUI/Bun
smoke tests, and the build. The tested dependency versions are:

- OpenCode plugin API `1.18.23`.
- OpenTUI packages `0.4.5`.
- Bun `1.3.10` for the TUI smoke test.

The package exposes separate `./server`, `./tui`, and `./shared` entrypoints.
It does not modify or fork OpenCode, publish to npm, or configure CI.
