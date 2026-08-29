import test from "node:test"
import assert from "node:assert/strict"
import { createEditorState, reduceEditor } from "../src/shared/editor.js"
import { activeReference, allReferences, replaceReference } from "../src/shared/references.js"
import { createPromptReplacement } from "../src/tui.js"

test("finds references under the cursor and stops at whitespace", () => {
  assert.deepEqual(activeReference("write bd:one next", 10), { start: 6, end: 12, query: "o" })
  assert.equal(activeReference("write bd:one next", 15), null)
  assert.deepEqual(allReferences("bd:first and bd:second"), [
    { start: 0, end: 8, query: "first" },
    { start: 13, end: 22, query: "second" },
  ])
})

test("selection replaces only the active reference with a Beads token", () => {
  const result = replaceReference("before bd:query after", { start: 7, end: 15, query: "query" }, "issue-1")
  assert.deepEqual(result, { text: "before [Beads:issue-1] after", cursor: 22 })
})

test("editor preserves multiline editing, cursor movement, and paste", () => {
  let state = createEditorState("one\ntwo")

  state = reduceEditor(state, { type: "set-cursor", cursor: 3 })
  state = reduceEditor(state, { type: "insert", value: " pasted" })
  state = reduceEditor(state, { type: "move", offset: -1 })
  state = reduceEditor(state, { type: "backspace" })

  assert.equal(state.text, "one pastd\ntwo")
  assert.equal(state.cursor, 8)
})

test("disabled editor ignores editing actions while state toggles remain available", () => {
  let state = createEditorState("prompt")
  state = reduceEditor(state, { type: "set-disabled", disabled: true })
  state = reduceEditor(state, { type: "set-cursor", cursor: 0 })
  state = reduceEditor(state, { type: "insert", value: "changed" })

  assert.equal(state.text, "prompt")
  assert.equal(state.cursor, 6)

  state = reduceEditor(state, { type: "set-disabled", disabled: false })
  state = reduceEditor(state, { type: "set-loading", loading: true })
  assert.equal(state.loading, true)
})

test("prompt replacement blocks submission only while disabled or loading", () => {
  const replacement = createPromptReplacement("prompt")

  assert.equal(replacement.submit(), "prompt")
  replacement.dispatch({ type: "set-disabled", disabled: true })
  assert.equal(replacement.submit(), null)
  replacement.dispatch({ type: "set-disabled", disabled: false })
  replacement.dispatch({ type: "set-loading", loading: true })
  assert.equal(replacement.submit(), null)
})
