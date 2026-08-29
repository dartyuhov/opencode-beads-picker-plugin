import test from "node:test"
import assert from "node:assert/strict"
import { createPickerController } from "../src/shared/picker.js"
import type { BeadsDiscovery, BeadsIssue } from "../src/shared/discovery.js"

const issues: BeadsIssue[] = [
  { id: "issue-one", title: "First issue", status: "open", priority: "P1" },
  { id: "issue-two", title: "Second issue", status: "open", priority: 2 },
]

function discoveryFor(search: (query: string) => BeadsIssue[] | Promise<BeadsIssue[]>): BeadsDiscovery {
  return {
    search: async (query) => search(query),
    resolve: async () => [],
  }
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds))
}

test("shows results for an empty bd query and selects the active reference as a Beads token", async () => {
  let calls = 0
  const picker = createPickerController("bd:", {
    discovery: discoveryFor(async () => {
      calls++
      return issues
    }),
    debounceMs: 10,
  })

  await wait(4)
  assert.equal(calls, 0)
  await wait(12)
  assert.equal(calls, 1)
  assert.deepEqual(picker.state.results, issues)

  picker.interact({ type: "key", key: "ArrowDown" })
  picker.interact({ type: "key", key: "Tab" })
  assert.equal(picker.editor.text, "[Beads:issue-two] ")
  assert.equal(picker.state.open, false)
  picker.dispose()
})

test("shows no-match state and escape closes without changing prompt", async () => {
  const picker = createPickerController("before bd:missing", {
    discovery: discoveryFor(() => []),
    debounceMs: 1,
  })

  await wait(8)
  assert.equal(picker.state.message, "No matching items")
  picker.interact({ type: "key", key: "Escape" })
  assert.equal(picker.state.open, false)
  assert.equal(picker.editor.text, "before bd:missing")
  picker.dispose()
})

test("ignores stale responses and replaces only the reference under cursor", async () => {
  const resolvers: Array<(result: BeadsIssue[]) => void> = []
  const picker = createPickerController("before bd:first after bd:o", {
    discovery: discoveryFor(() => new Promise((resolve) => resolvers.push(resolve))),
    debounceMs: 0,
  })

  while (resolvers.length < 1) await wait(1)
  picker.dispatch({ type: "insert", value: "l" })
  while (resolvers.length < 2) await wait(1)

  resolvers[1]?.([issues[1]!])
  resolvers[0]?.([issues[0]!])
  await wait(2)

  assert.deepEqual(picker.state.results, [issues[1]])
  picker.select()
  assert.equal(picker.editor.text, "before bd:first after [Beads:issue-two] ")
  picker.dispose()
})
