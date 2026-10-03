# OpenCode Beads picker plugin

`opencode-beads-picker-plugin` adds a live `bd:` Beads issue picker to the
OpenCode TUI and attaches enriched, read-only issue details to submitted model
context.
It is community-maintained and is not affiliated with or endorsed by OpenCode.

The package targets OpenCode `>=1.18.23 <2.0.0` and uses public plugin APIs.

![OpenCode Beads picker demo](assets/beads-picker-demo.gif)

## Install

Install the published package with OpenCode's plugin command:

```sh
opencode plugin opencode-beads-picker-plugin
```

OpenCode detects the package's server and TUI entrypoints and updates the
relevant `opencode.json` and `tui.json` configuration files. Use `--global` to
install the plugin for your user configuration instead of the current project.

You can also add the package manually. Use the same package version in both
files when you want both targets enabled:

`opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-beads-picker-plugin@0.2.1"]
}
```

`tui.json`

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["opencode-beads-picker-plugin@0.2.1"]
}
```

Restart OpenCode after changing either configuration file. The `bd` command
must be installed and available on OpenCode's `PATH`.

## Usage

Type `bd:` at the start of a prompt or after whitespace. The picker opens
immediately and lists the five best matches. Type an issue ID or title fragment,
then use the arrow keys, Enter, Tab, Escape, or mouse to work with the picker.

Selecting an issue inserts a styled `[Beads:<issue-id>]` token into the visible
prompt and stores a native file part with the same stable label. The server
target refreshes each selected or manually typed reference on submission,
replaces its attachment payload with current issue details, and preserves
ordinary prompt text. The native attachment remains visible in the transcript.

The TUI target replaces the prompt slot with OpenCode's native prompt plus the
Beads picker. It can coexist with Vimcode and other keymap plugins: Beads only
consumes picker navigation keys while the picker is open. The server target can
be enabled independently for context injection.

By default, issue search includes every status and any age, with no issue count
limit. This includes closed, in-progress, and deferred issues, as well as gates,
infrastructure issues, and templates. The picker displays the five best matches.

The plugin runs read-only
`bd list --json --limit 0 --sort updated --all --include-gates --include-infra --include-templates`
from the OpenCode worktree. It inherits `BEADS_DIR` from OpenCode when set; otherwise,
Beads resolves its nearest repository workspace. On submission, it also runs
`bd show <issue-id>... --json --long --include-comments` to load descriptions,
type, owner, timestamps, counts, and comments. The plugin never reads `.envrc`
files.

Missing Beads state, malformed output, timeouts, and other discovery failures
show `No matching items` in an active picker or omit optional attachment context,
but never block normal prompt editing or submission.

## Configure issue search

You can add optional picker filters through a plugin options tuple in
`tui.json`. For example, to search up to 1,000 issues and show only open or
blocked issues active within the last 14 days:

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": [
    [
      "opencode-beads-picker-plugin",
      {
        "statuses": ["open", "blocked"],
        "maxAgeDays": 14,
        "maxIssues": 1000
      }
    ]
  ]
}
```

Each setting is optional:

- `statuses`: A case-insensitive list of allowed statuses. Omit it or use an
  empty array to include every status.
- `maxAgeDays`: A positive number of days since creation or the latest update,
  whichever is newer. Omit it to include any age. When enabled, issues without
  usable timestamps are excluded.
- `maxIssues`: A positive integer that caps fetched candidates before status,
  age, and query matching. Omit it or use `0` for unlimited candidates.

Invalid settings are ignored. Explicit Beads references resolve regardless of
picker filters. Process timeouts and output-size bounds still apply. Restart
OpenCode after changing these settings.

## Local development

Install dependencies, then run the complete verification suite from the
repository root:

```sh
npm ci
npm run verify
```

The package publishes already-built files because OpenCode installs npm plugins
without running package lifecycle scripts. `npm run pack:check` builds the
package and verifies that the tarball contains every runtime entrypoint and
release document, while excluding source files, tests, and development metadata.

For local plugin development, build the package and use absolute paths in the
two configuration files:

`opencode.json`

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["/absolute/path/to/opencode-beads-picker-plugin/dist/server.js"]
}
```

`tui.json`

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["/absolute/path/to/opencode-beads-picker-plugin/dist/tui.js"]
}
```

The checked-in `opencode.json` and `tui.json` keep both targets disabled as a
safe default. Add the target you want to use after `npm run build`, then restart
OpenCode.

## Verification

`npm run verify` runs TypeScript checking, Node tests, the OpenTUI/Bun component
smoke tests, the build, the npm tarball check, and the target-runtime smoke test
when `OPENCODE_BIN` points to a compatible OpenCode binary. The tested
dependency versions are:

- OpenCode plugin API `1.18.23`.
- OpenTUI packages `0.4.5`.
- Bun `1.3.10` for the TUI smoke test.

For target OpenCode runtime smoke testing, build the package and start OpenCode
`1.18.25` from this worktree. Open an existing session with `--session`, type
`bd:`, select an issue, and submit the prompt. Confirm that the visible
reference remains `[Beads:<issue-id>]` and the submitted model context contains
the issue description and other enriched details.

```sh
npm run build
npm exec --yes --package=opencode-ai@1.18.25 -- opencode \
  --session <session-id> "$PWD"
```

Run the automated target-runtime smoke test with a target binary and `tmux`:

```sh
OPENCODE_BIN=/absolute/path/to/opencode npm run test:target
```

Inspect the package contents before a release:

```sh
npm run pack:check
npm pack --dry-run --json
npm publish --dry-run
```

## License

MIT
