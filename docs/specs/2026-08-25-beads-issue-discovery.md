# Beads issue discovery for OpenCode

## Problem Statement

OpenCode users manage work in Beads, but the TUI prompt has no native way to
discover those Beads issues while writing a prompt. Users must leave the
prompt, run a separate Beads command, find an issue identifier, and copy it
back into the prompt. This interrupts the workflow and makes it harder to
provide the agent with the correct issue context.

## Solution

Build an external OpenCode TUI plugin that adds a live `bd:` reference picker
to the prompt. Typing `bd:` at the start of a prompt or after whitespace opens
a fuzzy dropdown. The dropdown searches recent Beads issues by issue ID and
title, shows the five best matches, and lets the user select an issue without
leaving the prompt.

The plugin replaces the public `session_prompt` TUI slot with a custom prompt
editor so it can observe cursor movement and keystrokes. It preserves the
selected reference as plain text such as `bd:opencode-beads-plugin-on0`. A
server-side message hook performs a fresh, read-only lookup before every
submitted prompt and adds compact issue metadata to model context without
changing visible prompt text.

The plugin uses the `bd` CLI from the current OpenCode worktree, inherits
`BEADS_DIR`, and never reads `.envrc` files. Missing Beads installations,
invalid state, malformed output, timeouts, and other discovery failures leave
prompt editing and submission usable.

## User Stories

1. As an OpenCode user, I want to type `bd:` in the prompt, so that I can
   discover Beads issues without leaving the TUI.
2. As an OpenCode user, I want the picker to open when `bd:` starts a prompt,
   so that I can browse recent issues immediately.
3. As an OpenCode user, I want the picker to open when `bd:` follows
   whitespace, so that I can reference an issue in a natural-language prompt.
4. As an OpenCode user, I want the picker to follow the cursor, so that I can
   discover or change a Beads reference anywhere in a multiline prompt.
5. As an OpenCode user, I want the active query to end at whitespace, so that
   normal prompt text after a reference does not become part of the search.
6. As an OpenCode user, I want a bare `bd:` to show recent eligible issues, so
   that I can browse available work without knowing an issue ID.
7. As an OpenCode user, I want results to update while I type, so that I can
   narrow the issue list interactively.
8. As an OpenCode user, I want matches ranked by issue ID and title relevance,
   so that the most likely issue appears first.
9. As an OpenCode user, I want exact and prefix matches to rank above weaker
   fuzzy matches, so that precise queries produce predictable results.
10. As an OpenCode user, I want punctuation in a query handled consistently,
    so that issue names with separators remain easy to find.
11. As an OpenCode user, I want the picker to show no more than five results,
    so that I can scan the list quickly.
12. As an OpenCode user, I want each result to show its issue ID, title, status,
    and priority, so that I can distinguish similar issues before selecting.
13. As an OpenCode user, I want only recently created or updated issues in the
    picker, so that stale work does not dominate discovery.
14. As an OpenCode user, I want closed issues excluded, so that I do not select
    completed work by mistake.
15. As an OpenCode user, I want in-progress issues excluded, so that I do not
    accidentally select work already being handled.
16. As an OpenCode user, I want deferred issues excluded, so that intentionally
    postponed work does not appear as current work.
17. As an OpenCode user, I want the candidate set bounded, so that a large
    Beads workspace does not freeze or flood the TUI.
18. As an OpenCode user, I want arrow keys to move through results, so that I
    can use the picker without a mouse.
19. As an OpenCode user, I want Enter and Tab to select a result, so that the
    picker behaves like familiar prompt completion controls.
20. As an OpenCode user, I want Escape to close the picker without changing my
    prompt, so that I can dismiss an unwanted search safely.
21. As an OpenCode user, I want mouse selection to work, so that I can choose a
    result directly from the dropdown.
22. As an OpenCode user, I want selection to replace only the active reference,
    so that the rest of my prompt remains unchanged.
23. As an OpenCode user, I want selection to insert a stable issue ID, so that
    issue titles changing later do not break the reference.
24. As an OpenCode user, I want a trailing space after selection, so that I can
    continue writing outside the Beads reference.
25. As an OpenCode user, I want multiple `bd:` references in one prompt, so
    that I can give the agent several related Beads issues.
26. As an OpenCode user, I want each reference searched independently, so that
    one query does not distort another query's results.
27. As an OpenCode user, I want selected references to remain visible as
    `bd:<issue-id>`, so that my original prompt remains understandable.
28. As an OpenCode user, I want the agent to receive compact metadata for each
    selected issue, so that it can understand the reference without a second
    manual lookup.
29. As an OpenCode user, I want issue metadata marked read-only, so that
    discovery does not imply permission to claim, update, or close work.
30. As an OpenCode user, I want descriptions and raw Beads JSON excluded from
    automatic context, so that prompts stay compact and stable.
31. As an OpenCode user, I want manually typed `bd:<issue-id>` references to
    receive the same context as picked references, so that the feature does not
    require using the dropdown.
32. As an OpenCode user, I want stale references to remain visible, so that a
    refresh does not unexpectedly rewrite my prompt.
33. As an OpenCode user, I want stale references omitted from injected context,
    so that the agent does not receive outdated issue metadata.
34. As an OpenCode user, I want a stale reference never to block submission,
    so that Beads availability cannot prevent normal OpenCode work.
35. As an OpenCode user, I want no-match searches to show `No matching items`,
    so that I know the picker searched and found nothing.
36. As an OpenCode user, I want Beads failures to avoid noisy notifications,
    so that an optional integration does not interrupt my workflow.
37. As an OpenCode user, I want the plugin to use the nearest repository Beads
    workspace when `BEADS_DIR` is absent, so that normal local projects work
    without extra configuration.
38. As an OpenCode user, I want the plugin to honor `BEADS_DIR`, so that shared
    or externally located Beads workspaces work correctly.
39. As an OpenCode user, I want the plugin not to parse `.envrc`, so that
    environment loading remains the responsibility of my shell and OpenCode.
40. As an OpenCode user, I want normal prompts without `bd:` to remain clean,
    so that the plugin does not inject unrelated issue catalogs.
41. As an OpenCode user, I want discovery refreshed before every submitted
    prompt, so that injected issue metadata reflects current Beads state.
42. As an OpenCode user, I want search requests debounced, so that rapid typing
    does not start an unnecessary process for every keystroke.
43. As an OpenCode user, I want older asynchronous search results ignored, so
    that a slow request cannot replace newer results.
44. As an OpenCode user, I want multiline editing preserved, so that adding
    Beads discovery does not reduce prompt composition capabilities.
45. As an OpenCode user, I want cursor movement preserved, so that I can edit
    references and surrounding text naturally.
46. As an OpenCode user, I want basic paste behavior preserved, so that the
    custom prompt remains practical for normal coding work.
47. As an OpenCode user, I want disabled and loading states preserved, so that
    the prompt cannot submit conflicting requests.
48. As an OpenCode user, I want normal prompt submission and session creation
    preserved, so that the plugin does not change OpenCode's core workflow.
49. As an OpenCode user, I want slash-command submission preserved where the
    target OpenCode API supports it, so that replacing the prompt does not
    remove familiar commands.
50. As a plugin maintainer, I want the plugin to use public OpenCode APIs only,
    so that it can be distributed without an OpenCode fork.
51. As a plugin maintainer, I want Beads search logic independent from TUI
    rendering, so that matching behavior can be tested without a terminal.
52. As a plugin maintainer, I want process failures classified without exposing
    stderr, so that diagnostics remain safe and user output stays clean.
53. As a plugin maintainer, I want the package split into TUI and server
    targets, so that each OpenCode runtime loads only compatible code.
54. As a plugin maintainer, I want an explicit OpenCode compatibility range,
    so that upgrades to the host application are deliberate.
55. As a plugin maintainer, I want a target-version TUI smoke test, so that
    replacing the prompt does not silently regress after OpenCode upgrades.

## Implementation Decisions

These decisions define the plugin boundary, interaction contract, data rules,
and compatibility expectations for the MVP.

- Build an external OpenCode plugin without changing OpenCode source or
  maintaining a fork.
- Replace the public `session_prompt` TUI slot because the public plugin API
  does not expose a registry for adding providers to native `@` completion.
- Own a cursor-aware terminal prompt editor so the plugin can detect active
  `bd:` references while the user types.
- Preserve core prompt behavior: text editing, multiline input, cursor
  movement, basic paste, submit, and disabled/loading state.
- Reuse public OpenCode session behavior through a submission bridge where the
  target API permits it, including session creation, current model and agent,
  submission, and route updates.
- Split the package into a TUI target, a server target, and shared pure logic.
- Register a server message hook that refreshes Beads before every submitted
  prompt and injects context only when the prompt contains a `bd:` reference.
- Use the `bd` CLI as the only Beads integration boundary.
- Run Beads from the current OpenCode worktree, falling back to the current
  OpenCode directory when no worktree is available.
- Inherit `BEADS_DIR` from the OpenCode process and never source or parse
  `.envrc`.
- Fetch no more than 1,000 Beads issue records per discovery request.
- Filter records locally to those created or updated within the previous 14
  days.
- Exclude records with `closed`, `in_progress`, or `deferred` status,
  case-insensitively.
- Match non-empty queries against issue ID and title only.
- Treat the text after `bd:` up to the first whitespace as the active query.
- Tokenize punctuation within that whitespace-delimited query for matching.
- Require every query token to match an ID or title token.
- Rank exact token matches above prefix matches, substring matches, and ordered
  character-subsequence matches.
- Break relevance ties by latest activity, using the later of creation and
  update timestamps, then by issue ID for deterministic output.
- Rank bare `bd:` results by latest activity and issue ID.
- Display no more than five matching issues.
- Keep each `bd:` reference independent and show the dropdown for the
  reference under the cursor.
- Replace only the active reference range on selection and insert a stable
  `bd:<issue-id>` reference with one trailing space when needed.
- Keep selected and manually typed references as ordinary visible prompt text.
- Deduplicate repeated issue IDs in injected context while preserving their
  first appearance in the prompt.
- Inject only issue ID, title, status, and priority in a marked synthetic
  read-only context block.
- Omit descriptions, notes, dependencies, labels, assignees, and raw JSON from
  automatic context.
- Revalidate IDs against a fresh eligible candidate set before context
  injection.
- Omit stale, malformed, closed, in-progress, and deferred records from
  context without changing visible text or blocking submission.
- Show `No matching items` for an empty active result set, including Beads
  command failures.
- Treat missing executables, missing state, invalid environment paths, nonzero
  exits, malformed output, timeouts, and oversized output as empty results.
- Debounce active TUI searches by 150 milliseconds and ignore stale responses.
- Bound each Beads process to 1,000 milliseconds and 2 MiB of standard output.
- Do not show stderr, issue bodies, environment values, or prompt text in user
  output or optional debug logs.
- Do not claim, create, update, close, or otherwise mutate Beads issues.
- Declare separate TUI and server package entrypoints with a tested OpenCode
  compatibility range.
- Keep npm publishing, CI, and future configurable filters out of this MVP.

## Testing Decisions

Tests must verify observable discovery, prompt, context, and failure behavior.
They must not assert private OpenCode implementation details or the internal
shape of a ranking helper when the same behavior can be tested through the
shared discovery boundary.

The highest seam is the shared Beads discovery boundary with an injected
process runner. It accepts command output and time, then returns eligible,
ranked issue records. This seam covers parsing, eligibility, matching, ranking,
limits, timestamps, and failure handling without requiring OpenCode or a TUI.
The second seam is one target-version TUI smoke test covering the public
`session_prompt` replacement and end-to-end prompt submission.

The repository has no prior application test suite, so tests establish the
minimum conventions needed for this plugin:

- Unit-test valid issue arrays and supported wrapped issue responses.
- Unit-test malformed JSON, missing required values, unusable timestamps, and
  unexpected response shapes.
- Unit-test records recent by creation time, recent by update time, recent by
  both, and old by both.
- Unit-test the exact fourteen-day boundary.
- Unit-test case-insensitive exclusion of closed, in-progress, and deferred
  statuses.
- Unit-test exact, prefix, substring, and subsequence matches over IDs and
  titles.
- Unit-test rejection when any query token lacks a match.
- Unit-test relevance, activity, and issue-ID tie-break ordering.
- Unit-test the 1,000-record fetch bound and five-result display bound.
- Unit-test bare references, references after whitespace, cursor-local
  references, multiple references, and references ending at whitespace.
- Unit-test replacement of only the active reference and preservation of all
  surrounding prompt text.
- Unit-test trailing-space insertion without duplicate whitespace.
- Unit-test context preservation of visible text, ID deduplication, prompt
  order, compact fields, read-only marker, and omission of stale IDs.
- Unit-test no-context behavior when no valid reference resolves.
- Process-test current working directory and inherited `BEADS_DIR`.
- Process-test exact CLI arguments, timeout behavior, output-size bounds,
  nonzero exits, and stderr isolation.
- TUI-test dropdown opening, live filtering, empty-query browsing, no-match
  rendering, keyboard navigation, Enter selection, Tab selection, Escape
  dismissal, mouse selection, and reference replacement.
- TUI-test multiple references, multiline editing, cursor movement, basic paste,
  disabled/loading behavior, and submission through the target OpenCode session
  flow.
- TUI-test that the submission bridge does not render, steal focus, or create a
  second visible prompt.
- Run a manual target-version acceptance test against a real Beads workspace.

## Out of Scope

The following work is excluded from this spec:

- Adding a provider to OpenCode's native `@` autocomplete registry.
- Modifying OpenCode source or maintaining an OpenCode fork.
- A separate Beads picker route or standalone command as the primary MVP UX.
- Automatic Beads claiming, assignment, status changes, creation, updates, or
  closure.
- Full issue descriptions, notes, dependency graphs, labels, assignees, or raw
  JSON in automatic context.
- Searching descriptions, notes, labels, assignees, or other non-ID/title
  fields.
- Showing an issue catalog for prompts without an active `bd:` reference.
- Configurable statuses, time windows, candidate counts, result counts, or
  ranking weights.
- Searching beyond the bounded recent candidate set.
- Parsing `.envrc` or loading environment variables on the user's behalf.
- Full parity with native prompt history, attachments, shell mode, editor
  integrations, or other advanced prompt features in the first release.
- npm publication, CI, release automation, or multi-version compatibility
  support in the MVP.

## Further Notes

The user-facing domain terms are `Beads issue`, `issue search`, and `Beads
reference`. The plugin uses `issue` rather than ticket or task in its product
language.

The choice to replace `session_prompt` is recorded as an accepted architectural
decision because it is surprising, difficult to reverse, and required by the
live dropdown requirement. Future OpenCode support for completion-provider
registration could replace this boundary and reduce compatibility maintenance.

The initial implementation must validate the exact public TUI API version
against the target OpenCode release before relying on the submission bridge.
If a public bridge cannot preserve a required core behavior, implementation
must surface that incompatibility rather than silently degrade submission.
