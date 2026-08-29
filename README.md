# OpenCode Beads plugin

This package adds a live `bd:` Beads issue picker to the OpenCode TUI and
attaches enriched, read-only issue details to submitted model context. It
targets OpenCode `>=1.18.23 <2.0.0` and uses only public plugin APIs.

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

The TUI target replaces the prompt slot with OpenCode's native prompt plus the
Beads picker. It can coexist with Vimcode and other keymap plugins: Beads only
consumes picker navigation keys while the picker is open. The server target can
still be enabled independently for context injection.

The checked-in `opencode.json` and `tui.json` keep both targets disabled as a
safe default. Add the target you want to use after `npm run build`, then
restart OpenCode.

The plugin runs read-only `bd list --json --limit 1000 --sort updated` from the
OpenCode worktree. It inherits `BEADS_DIR` from OpenCode when set; otherwise
Beads resolves its nearest repository workspace. On submission, it also runs
`bd show <issue-id>... --json --long --include-comments` to load descriptions,
type, owner, timestamps, counts, and comments. The plugin never reads `.envrc`
files.

## Usage

Type `bd:` at the start of a prompt or after whitespace. Picker opens
immediately and lists the five best matches. Type an issue ID or title fragment,
then use the arrow keys, Enter, Tab, Escape, or mouse to work with the picker.
Selecting an issue inserts a styled `[Beads:<issue-id>]` token into the visible
prompt and stores a native file part with the same stable label. The server
target refreshes each selected or manually typed reference on submission,
replaces its attachment payload with current issue details, and preserves
ordinary prompt text. The native attachment remains visible in the transcript.

Missing Beads state, malformed output, timeouts, and other discovery failures
show `No matching items` in an active picker or omit optional attachment context,
but never block normal prompt editing or submission.

## Verification

`npm run verify` runs TypeScript checking, Node tests, the OpenTUI/Bun component
smoke tests, the build, and the target-runtime smoke test when `OPENCODE_BIN`
points to OpenCode `1.18.25`. The tested dependency versions are:

- OpenCode plugin API `1.18.23`.
- OpenTUI packages `0.4.5`.
- Bun `1.3.10` for the TUI smoke test.

For target OpenCode runtime smoke testing, build the package and start
OpenCode `1.18.25` from this worktree. Open an existing session with
`--session`, type `bd:`, select an issue, and submit the prompt. Confirm that
the visible reference remains `[Beads:<issue-id>]` and the submitted model
context contains the issue description and other enriched details.

```sh
npm run build
npm exec --yes --package=opencode-ai@1.18.25 -- opencode \
  --session <session-id> "$PWD"
```

Run the automated target-runtime smoke test with a target binary and `tmux`:

```sh
OPENCODE_BIN=/absolute/path/to/opencode npm run test:target
```

The package exposes separate `./server`, `./tui`, and `./shared` entrypoints.
It does not modify or fork OpenCode, publish to npm, or configure CI.
