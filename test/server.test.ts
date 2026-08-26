import test from "node:test"
import assert from "node:assert/strict"
import { createServerPlugin } from "../src/server.js"

const now = new Date("2026-08-26T12:00:00.000Z")
const issue = {
  id: "opencode-beads-plugin-on0.4",
  title: "Inject submitted Beads context",
  status: "open",
  priority: "P2",
  created_at: "2026-08-26T11:00:00.000Z",
  updated_at: "2026-08-26T11:30:00.000Z",
  description: "must not be included",
}

test("injects fresh compact metadata in prompt order and preserves visible text", async () => {
  const secondIssue = { ...issue, id: "opencode-beads-plugin-on0.2", title: "Build issue discovery" }
  const hooks = createServerPlugin({
    directory: "/repo",
    now: () => now,
    runner: async () => ({ exitCode: 0, stdout: JSON.stringify([issue, secondIssue]) }),
  })
  const output = { parts: [{ type: "text" as const, text: "Use bd:opencode-beads-plugin-on0.2 and bd:opencode-beads-plugin-on0.4 twice bd:opencode-beads-plugin-on0.2" }] }
  const original = output.parts[0].text

  await hooks["chat.message"]?.({ sessionID: "session", messageID: "message" }, output as never)

  assert.equal(output.parts[0].text, original)
  assert.equal(output.parts.length, 2)
  const metadata = (output.parts[1] as { text: string }).text
  assert.match(metadata, /<beads-context>/)
  assert.ok(metadata.indexOf("opencode-beads-plugin-on0.2") < metadata.indexOf("opencode-beads-plugin-on0.4"))
  assert.match(metadata, /id: opencode-beads-plugin-on0\.4/)
  assert.match(metadata, /title: Inject submitted Beads context/)
  assert.match(metadata, /status: open/)
  assert.match(metadata, /priority: P2/)
  assert.doesNotMatch(metadata, /description|must not be included|\{"/)
})

test("revalidates references and fails silently", async () => {
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => { throw new Error("bd unavailable") },
  })
  const output = { parts: [{ type: "text" as const, text: "bd:stale" }] }

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.deepEqual(output.parts, [{ type: "text", text: "bd:stale" }])
})

test("omits stale references while retaining fresh metadata", async () => {
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => ({ exitCode: 0, stdout: JSON.stringify([issue]) }),
  })
  const output = { parts: [{ type: "text" as const, text: "bd:stale bd:opencode-beads-plugin-on0.4" }] }

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(output.parts[0].text, "bd:stale bd:opencode-beads-plugin-on0.4")
  assert.equal(output.parts.length, 2)
  assert.doesNotMatch((output.parts[1] as { text: string }).text, /id: stale/)
  assert.match((output.parts[1] as { text: string }).text, /id: opencode-beads-plugin-on0\.4/)
})

test("refreshes Beads on every submitted prompt", async () => {
  let calls = 0
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => {
      calls++
      return { exitCode: 0, stdout: JSON.stringify([{ ...issue, title: `Fresh ${calls}` }]) }
    },
  })
  const hook = hooks["chat.message"]
  const first = { parts: [{ type: "text" as const, text: "bd:opencode-beads-plugin-on0.4" }] }
  const second = { parts: [{ type: "text" as const, text: "bd:opencode-beads-plugin-on0.4" }] }

  await hook?.({ sessionID: "session" }, first as never)
  await hook?.({ sessionID: "session" }, second as never)

  assert.equal(calls, 2)
  assert.match((second.parts[1] as { text: string }).text, /Fresh 2/)
})

test("does not join separate text parts into a reference", async () => {
  let calls = 0
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => { calls++; return { exitCode: 0, stdout: JSON.stringify([issue]) } },
  })
  const output = { parts: [
    { type: "text" as const, text: "bd:" },
    { type: "text" as const, text: "opencode-beads-plugin-on0.4" },
  ] }

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(calls, 1)
  assert.equal(output.parts.length, 2)
})

test("refreshes without injecting context for normal prompts", async () => {
  let calls = 0
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => { calls++; return { exitCode: 0, stdout: "[]" } },
  })
  const output = { parts: [{ type: "text" as const, text: "normal prompt" }] }

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(calls, 1)
  assert.equal(output.parts.length, 1)
})

test("does not invent missing optional metadata", async () => {
  const { status: _status, ...withoutStatus } = issue
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => ({ exitCode: 0, stdout: JSON.stringify([withoutStatus]) }),
  })
  const output = { parts: [{ type: "text" as const, text: "bd:opencode-beads-plugin-on0.4" }] }

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(output.parts.length, 2)
  assert.doesNotMatch((output.parts[1] as { text: string }).text, /status:/)
})
