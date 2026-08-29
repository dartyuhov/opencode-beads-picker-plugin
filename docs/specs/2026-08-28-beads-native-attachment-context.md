# Beads native attachment and context delivery

## Problem Statement

Selecting a Beads issue in the OpenCode TUI currently produces a styled text
token, not an OpenCode attachment. The submitted conversation therefore shows
only the raw `bd:<issue-id>` reference and does not show the attachment badge
that users expect. In real OpenCode sessions, issue details are also not
reliably available to the model: the current synthetic message-part approach
can be rejected during prompt persistence, and tests only verify mocked hook
output rather than the persisted runtime path.

Manually typed Beads references have the same context-delivery requirement.
Beads discovery must remain read-only and must not make prompt submission
depend on a successful lookup.

## Solution

When a user selects a Beads issue, represent it with OpenCode's supported
attachment part shape. Keep a concise, styled Beads label visible in the
prompt and transcript, while attaching a text representation containing the
issue's current details. OpenCode then persists and renders the part through
its native attachment path and sends its text content to the model through the
normal file-part conversion path.

Before submission, resolve selected issue IDs using the current Beads
workspace. Include the issue title, description, status, priority, type,
owner, timestamps, counts, and comments when available. Preserve missing
optional values as missing rather than inventing them. Manually typed
`bd:<issue-id>` references use the same resolution and attachment behavior.

If Beads is unavailable, an issue is stale or invalid, or attachment detail
generation fails, preserve the visible reference and allow normal prompt
submission. Do not claim, update, close, or otherwise mutate Beads issues.

## User Stories

1. As an OpenCode user, I want selecting a Beads issue to create a native attachment, so that OpenCode recognizes it as attached context.
2. As an OpenCode user, I want a visible Beads attachment badge after selection, so that I can see which issue is attached before submitting.
3. As an OpenCode user, I want the visible label to identify the issue ID, so that I can verify I selected the intended issue.
4. As an OpenCode user, I want the attachment label to remain concise, so that it does not overwhelm the prompt editor.
5. As an OpenCode user, I want the surrounding prompt text preserved, so that selecting an issue does not rewrite my request.
6. As an OpenCode user, I want multiple Beads issues attached to one prompt, so that I can provide related work context together.
7. As an OpenCode user, I want each selected issue represented independently, so that one issue's metadata does not overwrite another's.
8. As an OpenCode user, I want attachment selection to preserve the issue ID rather than a mutable title, so that later title changes do not break the reference.
9. As an OpenCode user, I want a manually typed `bd:<issue-id>` reference to receive the same issue details as a picked reference, so that using the picker is optional.
10. As an OpenCode user, I want sentence punctuation after a reference handled correctly, so that normal prose does not invalidate the issue ID.
11. As an OpenCode user, I want the attached context to include the issue title, so that the model understands what the issue is about.
12. As an OpenCode user, I want the attached context to include the issue description, so that the model understands the issue's requested work.
13. As an OpenCode user, I want the attached context to include status and priority when available, so that the model can judge current relevance.
14. As an OpenCode user, I want the attached context to include issue type and owner when available, so that the model has useful issue identity metadata.
15. As an OpenCode user, I want the attached context to include creation and update timestamps when available, so that freshness is explicit.
16. As an OpenCode user, I want dependency and dependent counts when available, so that the model can recognize issue relationships without querying Beads.
17. As an OpenCode user, I want comments included when available, so that relevant discussion is available to the model.
18. As an OpenCode user, I want multiline descriptions and comments preserved, so that detail is not silently truncated or flattened.
19. As an OpenCode user, I want optional fields omitted when absent, so that the plugin does not fabricate issue facts.
20. As an OpenCode user, I want the model to receive attached issue details through OpenCode's supported message conversion, so that context is available regardless of provider-specific handling.
21. As an OpenCode user, I want the persisted user message to contain a valid OpenCode part, so that the attachment survives reload and session history.
22. As an OpenCode user, I want the visible transcript to show the attachment badge, so that submitted issue context is discoverable after submission.
23. As an OpenCode user, I want the model to receive issue details without needing to run `bd`, so that prompt context is immediate and deterministic.
24. As an OpenCode user, I want normal prompt text to remain visible to the model, so that adding an issue attachment does not replace my request.
25. As an OpenCode user, I want a failed Beads lookup not to block submission, so that an optional integration cannot prevent normal work.
26. As an OpenCode user, I want stale issues to remain visible as references but not be attached as current details, so that the prompt is not unexpectedly rewritten.
27. As an OpenCode user, I want missing Beads state to leave prompt editing usable, so that the picker is safe in repositories without Beads.
28. As an OpenCode user, I want Beads operations to remain read-only, so that selecting context cannot change work state.
29. As an OpenCode user, I want attachment detail loading to refresh for every submission, so that details reflect current Beads state.
30. As an OpenCode user, I want the picker to continue showing ID, title, status, and priority, so that I can choose among similar issues.
31. As an OpenCode user, I want the picker to coexist with other TUI plugins, so that native keymaps continue working outside the Beads picker.
32. As a plugin maintainer, I want attachment parts to use the public OpenCode prompt-part contract, so that the plugin does not depend on private runtime internals.
33. As a plugin maintainer, I want runtime tests to inspect persisted messages, so that mocked hook output cannot hide serialization failures.
34. As a plugin maintainer, I want runtime tests to inspect provider-bound model input, so that context delivery is proven beyond database persistence.
35. As a plugin maintainer, I want server and TUI behavior tested independently where needed, so that failures identify the broken integration boundary.

## Implementation Decisions

- Keep separate TUI and server plugin targets.
- Keep the existing cursor-aware picker and native OpenCode prompt replacement.
- Change selected Beads references from text-only prompt parts to OpenCode-supported file attachment parts.
- Use a text attachment with a `data:text/markdown` URL containing a structured, read-only Beads issue representation; OpenCode rejects `data:text/plain` file parts.
- Use a concise stable virtual label such as `[Beads:<issue-id>]` for the visible prompt attachment marker.
- Store attachment source ranges so native prompt rendering can style the label and preserve editing behavior.
- Preserve the normal prompt text separately from attachment parts during submission.
- Resolve issue IDs from the current eligible Beads candidate set before creating attachment content.
- Load enriched issue details with the read-only `bd show <ids> --json --long --include-comments` boundary.
- Merge list metadata with detail metadata by issue ID, preferring detail values when present.
- Attach one detail payload per resolved issue and preserve prompt order while deduplicating repeated IDs.
- Keep manually typed references supported by the server submission hook.
- Use valid OpenCode-generated-compatible part identifiers only where the public hook contract requires a complete persisted part; never inject arbitrary UUIDs as IDs.
- Do not rely on a synthetic text part that OpenCode rejects or hides before persistence.
- Keep context wording explicit: attached Beads issue context is read-only reference material and does not authorize Beads mutation.
- Treat lookup, parsing, timeout, invalid-working-directory, and attachment-generation failures as empty optional context, never as submission failures.
- Do not read `.envrc`; inherit the OpenCode process environment, including `BEADS_DIR`.
- Keep Beads process operations read-only and bounded by the existing timeout and output-size safeguards.
- Do not modify OpenCode source or require an OpenCode fork.
- Do not change checked-in configuration defaults from opt-in activation.

## Testing Decisions

- Test observable behavior rather than private OpenCode implementation details.
- Use the target OpenCode `1.18.25` runtime smoke seam as the highest-level integration test.
- Extend the target runtime fixture to capture the submitted session message and verify a native file attachment part exists with the expected label and text content.
- Extend the target runtime fixture to capture the provider request or equivalent model-bound message representation and verify title and description are present.
- Assert that the target runtime persists the user prompt without an invalid-part error.
- Assert that the target runtime displays the Beads attachment badge before and after submission.
- Assert that the target runtime remains editable after submission and can accept a second prompt.
- Keep the competing-TUI-plugin runtime test and assert attachment selection still works.
- Use the existing server-hook seam for manually typed references, punctuation, stale IDs, repeated IDs, detail loading, and failure behavior.
- Add a server-hook assertion for valid attachment-compatible output where the hook directly creates a supported part.
- Add a TUI component assertion that selecting an issue creates a file part with source range and stable visible label.
- Add a TUI component assertion that the submission payload keeps ordinary prompt text and selected file parts separate.
- Add regression coverage for descriptions, comments, multiline detail, optional metadata, and multiple issues.
- Add a regression test proving malformed or failed detail lookup leaves submission usable and does not create a partial invalid attachment.
- Run typecheck, Node tests, Bun OpenTUI tests, build, target runtime smoke, and `git diff --check`.

## Out of Scope

- Adding Beads as a provider to OpenCode's native `@` completion registry.
- Modifying or forking OpenCode.
- Changing OpenCode's built-in file attachment renderer or badge appearance.
- Creating a new Beads database, issue, comment, dependency, or status.
- Claiming, assigning, updating, closing, or deleting Beads issues.
- Making stale issues appear as current attached context.
- Searching issue descriptions, comments, labels, or owners in the picker.
- Adding configurable attachment formats, fields, filters, or retention policies.
- Providing interactive attachment editing after selection beyond native prompt editing.
- Guaranteeing identical attachment rendering across OpenCode versions outside the tested compatibility range.
- Requiring a provider-specific API or custom model protocol.
- Persisting a second plugin-owned database of issue details.
- Publishing the package or changing CI/release automation.

## Further Notes

The earlier implementation verified punctuation handling and mocked hook output,
but did not prove native attachment persistence or provider-visible context. The
real OpenCode log showed invalid synthetic user parts being rejected before save
when IDs did not satisfy OpenCode's part schema. The target runtime test must
therefore validate the complete path from picker selection through prompt
submission, persistence, model conversion, and visible transcript behavior.

The desired user-visible behavior is a native OpenCode attachment badge for a
selected Beads issue, not merely colorized prompt text. The desired model
behavior is direct access to issue details in submitted context, without a
fallback requirement to inspect `.beads` or run `bd` commands.
