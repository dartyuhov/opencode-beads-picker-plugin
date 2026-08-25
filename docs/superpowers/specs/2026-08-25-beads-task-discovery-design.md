# Live Beads issue discovery in OpenCode TUI

This design defines an OpenCode plugin that adds live, fuzzy Beads issue
discovery to the TUI prompt through a `bd:` reference. The plugin keeps the
visible prompt unchanged, performs read-only searches, and gives the agent
compact metadata for selected issues.

## Status

The design is approved in conversation and is ready for written-spec review.
Implementation does not start until the written spec is approved.

## Goals

The MVP must provide the following capabilities:

- Open a dropdown as soon as the user types `bd:` at the start of a prompt or
  after whitespace.
- Search Beads issues by ID and title with local token-ranked fuzzy matching.
- Search each `bd:` reference independently, including multiple references in
  one prompt.
- Consider only issues created or updated within the previous 14 days.
- Exclude `closed`, `in_progress`, and `deferred` issues.
- Fetch at most 1,000 candidate issues and display at most 5 matches.
- Replace a selected reference with `bd:<issue-id> ` while preserving the rest
  of the prompt.
- Keep selected references as plain visible text.
- Add compact, read-only issue metadata to the submitted model context.
- Remain usable when Beads is missing, unavailable, malformed, or slow.
- Work as an external TUI plugin without modifying or forking OpenCode.

## Non-goals

The MVP does not include these capabilities:

- Registering a new provider inside OpenCode's built-in `@` autocomplete.
- Changing OpenCode source code or maintaining an OpenCode fork.
- Writing, claiming, updating, closing, or otherwise mutating Beads issues.
- Injecting full issue descriptions, notes, dependency graphs, or raw JSON.
- Showing an issue catalog for prompts that do not contain an active `bd:`
  reference.
- Publishing to npm, setting up CI, or supporting multiple OpenCode API
  generations in the first release.
- Reimplementing native prompt history, attachments, shell mode, or advanced
  editor integrations.

## User experience

The TUI plugin replaces the `session_prompt` slot and owns a cursor-aware
prompt editor. It uses the same terminal editing primitives as OpenCode but
adds a Beads-specific completion layer.

1. The user types `bd:` at the start of a prompt or after whitespace.
2. The dropdown opens immediately and shows up to five recent eligible issues.
3. Characters typed after `bd:` filter the dropdown until the first
   whitespace character.
4. Matching uses issue ID and title only. Punctuation inside the
   whitespace-delimited query is tokenized; each resulting token narrows the
   candidates and contributes to its relevance score.
5. Up and down move the highlighted row. Enter or Tab selects it. Escape
   closes the dropdown without changing the prompt.
6. Selecting an issue replaces only the active `bd:<query>` range with
   `bd:<issue-id> ` and leaves every other character unchanged.
7. Typing another `bd:` creates another independent reference and dropdown.
8. If the query has no matches, the dropdown remains visible and displays
   `No matching items`.
9. Submitting the prompt preserves the visible `bd:<issue-id>` text. The agent
   receives a separate synthetic context block containing compact metadata.

The dropdown displays each match using its ID, title, status, and priority.
Bare `bd:` uses the same candidate window but sorts by recent activity because
it has no relevance query.

## Package architecture

The package contains a TUI target, a server target, and shared pure logic. The
targets are separate modules because OpenCode loads TUI and server plugins in
different runtimes.

### TUI target

The TUI target exports a `TuiPluginModule` from `@opencode-ai/plugin/tui` and
registers a replacement for the `session_prompt` slot. It owns the visible
textarea, cursor tracking, active-reference detection, dropdown rendering,
keyboard bindings, and selection replacement.

The TUI target runs `bd list --json --limit 1000` from the current worktree.
It inherits the OpenCode process environment, including `BEADS_DIR`, and does
not read `.envrc` files. When `BEADS_DIR` is unset, Beads resolves its nearest
repository-local `.beads` directory from the command working directory.

### Server target

The server target registers a `chat.message` hook. It scans submitted text for
plain `bd:<issue-id>` references, performs a fresh read-only Beads lookup, and
appends synthetic context for valid references. It never changes the visible
prompt text and never performs a Beads mutation.

The server target refreshes the lookup before every submitted prompt instead of
trusting TUI state. It discards the result when the prompt has no `bd:`
reference, so unrelated prompts receive no injected context. This keeps context
correct when an issue changes between selection and submission and also
supports manually typed issue IDs.

### Shared logic

Shared modules contain the Beads record parser, eligibility filter, reference
parser, matcher, ranking function, and context formatter. They have no TUI or
OpenCode dependencies so unit tests can exercise them deterministically.

### Submission bridge

The replacement prompt renders an unfocused, invisible instance of the public
`api.ui.Prompt` component as a submission bridge. Before submit, it copies the
custom editor's text into the bridge's `TuiPromptRef` and invokes `submit()`.
The bridge reuses OpenCode's session creation, model and agent selection,
slash-command dispatch, error handling, and route behavior.

The custom editor remains the only focused prompt. The bridge must never render
visible text, claim focus, or register active input behavior. A TUI smoke test
must verify these conditions before the package is considered usable.

## Search contract

The search backend uses a bounded, read-only CLI call and performs all product
filtering locally.

1. Run `bd list --json --limit 1000 --sort updated` with the current worktree as
   its working directory. Use the repository worktree when it is available;
   otherwise use the current OpenCode directory.
2. Accept the documented JSON issue list and a wrapper containing an `issues`
   array. Reject all other shapes.
3. Parse `id`, `title`, `status`, `priority`, `created_at`, and `updated_at`.
   Records missing an ID, title, or usable timestamp are ineligible.
4. Include an issue when `created_at` or `updated_at` is on or after the
   timestamp exactly 14 times 24 hours before the search began.
5. Exclude statuses `closed`, `in_progress`, and `deferred`, using
   case-insensitive comparison.
6. For a non-empty query, match only ID and title. Do not search description,
   notes, labels, assignee, or serialized JSON.
7. Return at most five records after filtering and ranking.

The 1,000-record bound applies to the CLI result set before local filtering.
The updated sort keeps the fetched window focused on recent activity. If the
Beads workspace contains more than 1,000 records, the backend processes the
deterministic first 1,000 returned by Beads and does not issue unbounded
follow-up queries.

### Matching and ranking

The matcher lowercases values and splits query and candidate text on
non-alphanumeric boundaries. Every non-empty query token must match at least
one token from the issue ID or title.

Each query token receives the best applicable score against the candidate:

- Exact token match: 100 points.
- Token-prefix match: 80 points.
- Contiguous substring match: 60 points.
- Ordered character-subsequence match: 40 points.
- No match: the issue is excluded.

The issue's relevance score is the sum of its best token scores. Sort matches
by relevance descending, then by latest activity descending, then by ID
ascending for deterministic ties. Latest activity is the later of the parsed
`created_at` and `updated_at` values. Bare `bd:` skips relevance scoring and
sorts only by latest activity, then ID.

## Reference semantics

The reference parser follows the native mention convention while using the
literal `bd:` prefix.

- A reference starts at the nearest `bd:` before the cursor when the prefix is
  at prompt start or immediately follows whitespace.
- The active query is the text after `bd:` up to the first whitespace or the
  cursor, whichever comes first.
- A whitespace character ends the active reference. Moving the cursor before
  the prefix closes it.
- Only the reference under the cursor owns the visible dropdown.
- Multiple references remain independent and can be selected in any order.
- A bare `bd:` is valid and shows recent eligible issues.
- Selecting an issue replaces the active range and adds one trailing space
  unless the following character is already whitespace.
- If no issue is selected, the original typed reference remains unchanged.

The server hook recognizes a submitted `bd:<issue-id>` token only when the
ID contains no whitespace. A bare `bd:` has no issue ID and produces no
context entry.

## Submitted context

The server hook preserves the visible user prompt and appends one synthetic
text part only when at least one valid reference resolves. The context format
is intentionally compact:

```text
<beads-context>
Discovered Beads issues. Read-only metadata; do not claim, update, or close them automatically.
- id: example-123
  title: Add request tracing
  status: open
  priority: P1
</beads-context>
```

The hook deduplicates repeated IDs while preserving their first appearance in
the prompt. It resolves IDs against a fresh candidate set using the same
14-day and status rules as the dropdown. Stale, malformed, closed,
in-progress, and deferred records are omitted. Missing optional values are not
invented.

Descriptions, notes, dependencies, labels, assignees, and raw JSON never enter
the synthetic context. An agent can request more detail through its normal
Beads tools when needed.

## Failure boundaries

Beads discovery is an optional integration and must not block prompt editing or
submission.

- Missing `bd`, missing `.beads`, invalid `BEADS_DIR`, nonzero exit, malformed
  JSON, timeout, or oversized output produces an empty result set.
- Empty result sets display `No matching items` only while a `bd:` dropdown is
  active. Unrelated prompts remain unaffected.
- The TUI uses a 150 ms debounce and ignores results from older requests.
- The server refreshes before every submitted prompt, but injects context only
  when the prompt contains at least one `bd:<issue-id>` reference.
- Each Beads process has a 1,000 ms timeout and a 2 MiB stdout bound.
- Stale selected IDs remain visible in the prompt, but receive no synthetic
  context and never block submission.
- Stderr and error details never appear in the prompt or dropdown.
- User-facing notifications are not emitted for discovery failures.
- Optional debug logging may record failure categories through OpenCode's
  structured logger, but must not include prompt text, issue bodies,
  environment values, or stderr.

## Compatibility and configuration

The package targets the public OpenCode TUI plugin API and must not depend on
private OpenCode modules. The package manifest exposes separate `./tui` and
`./server` entrypoints and declares an OpenCode engine range.

During MVP development, the TUI entrypoint is listed in `tui.json` and the
server entrypoint is listed in `opencode.json`. A later npm release can use the
same entrypoints without changing runtime behavior. The package does not
source environment files; `BEADS_DIR` must already be present in OpenCode's
environment when OpenCode starts.

OpenCode upgrades require a TUI smoke test because replacing `session_prompt`
is an intentional compatibility boundary. The package must pin or document
the tested OpenCode API range before publication.

## Verification

The implementation is complete only when automated tests and a manual TUI
smoke test cover the following behavior.

### Unit tests

Unit tests cover pure functions without starting OpenCode:

- Parse valid arrays and `{ issues: [...] }` wrappers.
- Reject malformed JSON and records with unusable required fields.
- Include created-only recent and updated-only recent records.
- Exclude records older than 14 days and test the exact boundary.
- Exclude `closed`, `in_progress`, and `deferred` statuses.
- Match exact, prefix, substring, and subsequence ID/title queries.
- Reject candidates missing any query token.
- Verify relevance, activity, and ID tie-break ordering.
- Enforce the five-result display cap.
- Parse bare, single, multiple, and cursor-local `bd:` references.
- Replace only the active reference range and preserve surrounding text.
- Deduplicate context entries while preserving prompt order.
- Omit stale IDs and preserve the original prompt when no IDs resolve.

### Process tests

Process tests use a fake `bd` executable or injected runner to verify the
working directory, inherited `BEADS_DIR`, argument list, timeout, output bound,
nonzero exit behavior, and stderr isolation.

### TUI smoke test

The smoke test runs the plugin in the target OpenCode version and verifies that
the user can type `bd:`, see a dropdown, filter it, navigate with arrows,
select with Enter or Tab, close with Escape, and submit through the native
session flow. It also verifies multiple references, `No matching items`,
disabled/loading state, multiline editing, cursor movement, basic paste, and
that the invisible submission bridge never steals focus or renders.

### Acceptance criteria

The MVP is accepted when all of these statements are true:

- Typing `bd:` opens a live dropdown without an OpenCode fork.
- Query text ends at whitespace and filters by issue ID/title.
- The dropdown shows no more than five eligible issues and displays the exact
  `No matching items` fallback when empty.
- Selecting an issue inserts `bd:<issue-id>` and preserves the rest of the
  prompt.
- Only recent, non-closed, non-in-progress, non-deferred issues appear.
- The agent receives only compact metadata for fresh valid IDs.
- Beads failures never prevent normal prompt submission.
- Automated tests pass, and the target-version TUI smoke test passes.
