---
status: superseded by ADR-0002
---

# Replace session prompt for live Beads completion

OpenCode's public plugin API does not expose a completion-provider registry for
the built-in `@` autocomplete. The plugin therefore replaces the public
`session_prompt` TUI slot and owns a cursor-aware editor and `bd:` dropdown,
which delivers the required live interaction without maintaining an OpenCode
fork at the cost of tracking native prompt compatibility.
