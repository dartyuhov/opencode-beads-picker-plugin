---
status: accepted
---

# Overlay picker on native prompt

The TUI plugin replaces each prompt slot only to render OpenCode's public
`api.ui.Prompt` and a Beads picker sibling. This preserves native prompt chrome,
editing, and submission while the picker observes `TuiPromptRef.current.input`
and intercepts navigation keys only while open; the public ref exposes no cursor
offset, so active-reference detection is end-of-input based.
