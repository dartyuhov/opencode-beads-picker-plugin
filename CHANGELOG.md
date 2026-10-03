# Changelog

## 0.2.1 — October 3, 2026

- Use a three-argument process callback to address empty issue search results
  observed in OpenCode's Bun runtime.
- Check real-process discovery with stderr output under Node and Bun.

## 0.2.0 — October 3, 2026

- Include Beads issues of every status and age in issue search by default,
  including gates, infrastructure issues, and templates.
- Remove the default 1,000-issue candidate limit and accept issues without
  usable timestamps.
- Add optional `statuses`, `maxAgeDays`, and `maxIssues` picker settings through
  plugin options in `tui.json`.
- Resolve explicit Beads references regardless of picker filters.

## 0.1.1

- Allow OpenCode's npm installer to resolve current OpenTUI releases.

## 0.1.0

- Add a live `bd:` Beads issue picker to the OpenCode TUI.
- Attach enriched, read-only Beads issue details to submitted model context.
- Publish separate server and TUI plugin entrypoints for npm installation.
