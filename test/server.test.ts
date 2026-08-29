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

function outputFor(text: string, messageID = "submitted-message") {
  return {
    message: { id: messageID },
    parts: [{ type: "text" as const, text }],
  }
}

function fileParts(output: { parts: unknown[] }) {
  return output.parts.filter((part): part is {
    type: "file"
    filename?: string
    mime: string
    url: string
    source?: { text?: { start: number; end: number; value: string } }
  } => typeof part === "object" && part !== null && "type" in part && part.type === "file")
}

function attachmentText(url: string) {
  const body = url.slice(url.indexOf(",") + 1)
  return url.includes(";base64,") ? Buffer.from(body, "base64").toString("utf8") : decodeURIComponent(body)
}

test("creates native Beads file attachments with structured detail payloads", async () => {
  const secondIssue = { ...issue, id: "opencode-beads-plugin-on0.2", title: "Build issue discovery" }
  const hooks = createServerPlugin({
    directory: "/repo",
    now: () => now,
    runner: async ({ args }) => ({
      exitCode: 0,
      stdout: JSON.stringify(args[0] === "show"
        ? [{
            ...issue,
            issue_type: "task",
            owner: "owner@example.com",
            created_by: "creator",
            description: "Full issue description\nSecond description line",
            dependent_count: 1,
            dependency_count: 2,
            comment_count: 3,
            comments: [{ author: "reviewer", body: "Needs follow-up\nSecond comment line", created_at: "2026-08-26T11:45:00Z" }],
          }, secondIssue]
        : [issue, secondIssue]),
    }),
  })
  const output = outputFor("Use bd:opencode-beads-plugin-on0.2 and bd:opencode-beads-plugin-on0.4.")
  const originalParts = output.parts

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.strictEqual(output.parts, originalParts)
  const attachments = fileParts(output)
  assert.deepEqual(attachments.map((part) => part.filename), ["[Beads:opencode-beads-plugin-on0.2]", "[Beads:opencode-beads-plugin-on0.4]"])
  assert.deepEqual(attachments.map((part) => part.mime), ["text/markdown", "text/markdown"])
   assert.ok(attachments.every((part) => part.url.startsWith("data:text/markdown;base64,")))
  assert.equal(attachments[0]?.source?.text?.value, "bd:opencode-beads-plugin-on0.2")
  assert.equal(attachments[1]?.source?.text?.value, "bd:opencode-beads-plugin-on0.4")
  assert.match(attachmentText(attachments[1]!.url), /title: Inject submitted Beads context/)
  assert.match(attachmentText(attachments[1]!.url), /description:/)
  assert.match(attachmentText(attachments[1]!.url), /Full issue description/)
  assert.match(attachmentText(attachments[1]!.url), /Second description line/)
  assert.match(attachmentText(attachments[1]!.url), /Needs follow-up/)
  assert.match(attachmentText(attachments[1]!.url), /Second comment line/)
  assert.equal(output.parts.filter((part) => typeof part === "object" && part !== null && "type" in part && part.type === "text").length, 1)
})

test("refreshes selected native attachments in prompt order and preserves visible text", async () => {
  const secondIssue = { ...issue, id: "opencode-beads-plugin-on0.2", title: "Build issue discovery" }
  const hooks = createServerPlugin({
    directory: "/repo",
    now: () => now,
    runner: async ({ args }) => ({
      exitCode: 0,
      stdout: JSON.stringify(args[0] === "show"
        ? [{
            ...issue,
            issue_type: "task",
            owner: "owner@example.com",
            created_by: "creator",
            description: "Full issue description",
            dependent_count: 1,
            dependency_count: 2,
            comment_count: 3,
            comments: [{ author: "reviewer", body: "Needs follow-up", created_at: "2026-08-26T11:45:00Z" }],
          }, secondIssue]
        : [issue, secondIssue]),
    }),
  })
  const output = outputFor("Use bd:opencode-beads-plugin-on0.2 and bd:opencode-beads-plugin-on0.4 twice bd:opencode-beads-plugin-on0.2")
  const original = output.parts[0].text

  await hooks["chat.message"]?.({ sessionID: "session", messageID: "message" }, output as never)

  assert.equal(output.parts[0].text, original)
  const attachments = fileParts(output)
  assert.deepEqual(attachments.map((part) => part.filename), ["[Beads:opencode-beads-plugin-on0.2]", "[Beads:opencode-beads-plugin-on0.4]"])
  assert.match(attachmentText(attachments[0]!.url), /id: opencode-beads-plugin-on0\.2/)
  assert.match(attachmentText(attachments[1]!.url), /id: opencode-beads-plugin-on0\.4/)
  assert.match(attachmentText(attachments[1]!.url), /title: Inject submitted Beads context/)
  assert.match(attachmentText(attachments[1]!.url), /status: open/)
  assert.match(attachmentText(attachments[1]!.url), /priority: P2/)
  assert.match(attachmentText(attachments[1]!.url), /type: task/)
  assert.match(attachmentText(attachments[1]!.url), /owner: owner@example.com/)
  assert.match(attachmentText(attachments[1]!.url), /created_by: creator/)
  assert.match(attachmentText(attachments[1]!.url), /description:/)
  assert.match(attachmentText(attachments[1]!.url), /Full issue description/)
  assert.match(attachmentText(attachments[1]!.url), /dependent_count: 1/)
  assert.match(attachmentText(attachments[1]!.url), /dependency_count: 2/)
  assert.match(attachmentText(attachments[1]!.url), /comment_count: 3/)
  assert.match(attachmentText(attachments[1]!.url), /comments:/)
  assert.match(attachmentText(attachments[1]!.url), /Needs follow-up/)
})

test("revalidates references and fails silently", async () => {
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => { throw new Error("bd unavailable") },
  })
  const output = outputFor("bd:stale")

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.deepEqual(output.parts, [{ type: "text", text: "bd:stale" }])
})

test("keeps typed references usable when detail loading fails", async () => {
  let showCalls = 0
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async ({ args }) => {
      if (args[0] === "show") {
        showCalls++
        return { exitCode: 0, stdout: "not json" }
      }
      return { exitCode: 0, stdout: JSON.stringify([issue]) }
    },
  })
  const output = outputFor("Keep this request with bd:opencode-beads-plugin-on0.4")

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(showCalls, 1)
  assert.equal(output.parts.length, 1)
  assert.equal(output.parts[0]?.type, "text")
  assert.equal(output.parts[0]?.text, "Keep this request with bd:opencode-beads-plugin-on0.4")
})

test("deduplicates repeated selected and typed references", async () => {
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async ({ args }) => ({
      exitCode: 0,
      stdout: JSON.stringify(args[0] === "show" ? [{ ...issue, description: "Current details" }] : [issue]),
    }),
  })
  const output = outputFor("bd:opencode-beads-plugin-on0.4 bd:opencode-beads-plugin-on0.4")
  output.parts.push({
    type: "file",
    mime: "text/markdown",
    filename: "[Beads:opencode-beads-plugin-on0.4]",
    url: "data:text/plain;base64,YmFk",
    source: {
      type: "file",
      path: "[Beads:opencode-beads-plugin-on0.4]",
      text: { start: 0, end: 28, value: "[Beads:opencode-beads-plugin-on0.4]" },
    },
  } as never)

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(fileParts(output).length, 1)
  assert.equal(attachmentText(fileParts(output)[0]!.url).includes("Current details"), true)
})

test("omits stale references while retaining fresh metadata", async () => {
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => ({ exitCode: 0, stdout: JSON.stringify([issue]) }),
  })
  const output = outputFor("bd:stale bd:opencode-beads-plugin-on0.4")

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(output.parts[0].text, "bd:stale bd:opencode-beads-plugin-on0.4")
  assert.deepEqual(fileParts(output).map((part) => part.filename), ["[Beads:opencode-beads-plugin-on0.4]"])
  assert.doesNotMatch(attachmentText(fileParts(output)[0]!.url), /id: stale/)
  assert.match(attachmentText(fileParts(output)[0]!.url), /id: opencode-beads-plugin-on0\.4/)
})

test("accepts sentence punctuation after a Beads reference", async () => {
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => ({ exitCode: 0, stdout: JSON.stringify([issue]) }),
  })
  const output = outputFor("Use bd:opencode-beads-plugin-on0.4.")

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.match(attachmentText(fileParts(output)[0]!.url), /id: opencode-beads-plugin-on0\.4/)
})

test("uses the Beads reference range including its prefix", async () => {
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async ({ args }) => ({
      exitCode: 0,
      stdout: JSON.stringify(args[0] === "show" ? [{ ...issue, description: "details" }] : [issue]),
    }),
  })
  const output = outputFor("Keep bd:opencode-beads-plugin-on0.4.")

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.deepEqual(fileParts(output)[0]?.source?.text, {
    start: 5,
    end: 35,
    value: "bd:opencode-beads-plugin-on0.4",
  })
})

test("ignores trailing punctuation when resolving a Beads reference", async () => {
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => ({ exitCode: 0, stdout: JSON.stringify([issue]) }),
  })
  const output = outputFor("Use bd:opencode-beads-plugin-on0.4, then continue.")

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.match(attachmentText(fileParts(output)[0]!.url), /id: opencode-beads-plugin-on0\.4/)
})

test("refreshes Beads on every submitted prompt", async () => {
  let listCalls = 0
  let showCalls = 0
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async ({ args }) => {
      if (args[0] === "show") {
        showCalls++
        return { exitCode: 0, stdout: JSON.stringify([{ ...issue, title: `Fresh ${showCalls}` }]) }
      }
      listCalls++
      return { exitCode: 0, stdout: JSON.stringify([{ ...issue, title: `List ${listCalls}` }]) }
    },
  })
  const hook = hooks["chat.message"]
  const first = outputFor("bd:opencode-beads-plugin-on0.4", "first-message")
  const second = outputFor("bd:opencode-beads-plugin-on0.4", "second-message")

  await hook?.({ sessionID: "session" }, first as never)
  await hook?.({ sessionID: "session" }, second as never)

  assert.equal(listCalls, 2)
  assert.equal(showCalls, 2)
  assert.match(attachmentText(fileParts(second)[0]!.url), /Fresh 2/)
})

test("does not join separate text parts into a reference", async () => {
  let calls = 0
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => { calls++; return { exitCode: 0, stdout: JSON.stringify([issue]) } },
  })
  const output = {
    message: { id: "submitted-message" },
    parts: [
    { type: "text" as const, text: "bd:" },
    { type: "text" as const, text: "opencode-beads-plugin-on0.4" },
    ],
  }

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(calls, 0)
  assert.equal(output.parts.length, 2)
})

test("refreshes without injecting context for normal prompts", async () => {
  let calls = 0
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => { calls++; return { exitCode: 0, stdout: "[]" } },
  })
  const output = outputFor("normal prompt")

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(calls, 0)
  assert.equal(output.parts.length, 1)
})

test("does not invent missing optional metadata", async () => {
  const { status: _status, ...withoutStatus } = issue
  const hooks = createServerPlugin({
    directory: "/repo",
    runner: async () => ({ exitCode: 0, stdout: JSON.stringify([withoutStatus]) }),
  })
  const output = outputFor("bd:opencode-beads-plugin-on0.4")

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(fileParts(output).length, 1)
  assert.doesNotMatch(attachmentText(fileParts(output)[0]!.url), /status:/)
})
