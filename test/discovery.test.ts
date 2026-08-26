import test from "node:test"
import assert from "node:assert/strict"
import { createBeadsDiscovery, type BeadsProcessRequest } from "../src/shared/discovery.js"

const now = new Date("2026-08-26T12:00:00.000Z")

function issue(overrides: Record<string, unknown> = {}) {
  return {
    id: "issue-1",
    title: "Example issue",
    status: "open",
    priority: "P2",
    created_at: "2026-08-26T11:00:00.000Z",
    updated_at: "2026-08-26T11:30:00.000Z",
    ...overrides,
  }
}

function discoveryFor(value: unknown, options: Partial<Parameters<typeof createBeadsDiscovery>[0]> = {}) {
  return createBeadsDiscovery({
    directory: "/repo",
    now: () => now,
    runner: async () => ({ exitCode: 0, stdout: JSON.stringify(value) }),
    ...options,
  })
}

test("discovers issues through bd from the OpenCode worktree and inherited environment", async () => {
  const requests: BeadsProcessRequest[] = []
  const discovery = createBeadsDiscovery({
    directory: "/repo",
    worktree: "/repo/worktree",
    env: { PATH: "/bin", BEADS_DIR: "/shared/.beads" },
    now: () => now,
    runner: async (request) => {
      requests.push(request)
      return {
        exitCode: 0,
        stdout: JSON.stringify([
          {
            id: "opencode-beads-plugin-on0.2",
            title: "Build issue discovery",
            status: "open",
            priority: "P2",
            created_at: "2026-08-25T12:00:00.000Z",
            updated_at: "2026-08-26T11:00:00.000Z",
          },
        ]),
      }
    },
  })

  assert.deepEqual(await discovery.search("on0.2"), [
    {
      id: "opencode-beads-plugin-on0.2",
      title: "Build issue discovery",
      status: "open",
      priority: "P2",
      createdAt: "2026-08-25T12:00:00.000Z",
      updatedAt: "2026-08-26T11:00:00.000Z",
    },
  ])
  assert.equal(requests.length, 1)
  assert.deepEqual(requests[0], {
    command: "bd",
    args: ["list", "--json", "--limit", "1000", "--sort", "updated"],
    cwd: "/repo/worktree",
    env: { PATH: "/bin", BEADS_DIR: "/shared/.beads" },
    timeoutMs: 1000,
    maxOutputBytes: 2097152,
  })
})

test("accepts issue arrays and issues wrappers but rejects other response shapes", async () => {
  const expected = {
    id: "issue-1",
    title: "Example issue",
    status: "open",
    priority: "P2",
    createdAt: "2026-08-26T11:00:00.000Z",
    updatedAt: "2026-08-26T11:30:00.000Z",
  }

  assert.deepEqual(await discoveryFor([issue()]).search(""), [expected])
  assert.deepEqual(await discoveryFor({ issues: [issue()] }).search(""), [expected])
  assert.deepEqual(await discoveryFor({ records: [issue()] }).search(""), [])
  assert.deepEqual(await discoveryFor("not json issues").search(""), [])
})

test("preserves numeric priorities from Beads records", async () => {
  assert.deepEqual(await discoveryFor([issue({ priority: 2 })]).search(""), [{
    id: "issue-1",
    title: "Example issue",
    status: "open",
    priority: 2,
    createdAt: "2026-08-26T11:00:00.000Z",
    updatedAt: "2026-08-26T11:30:00.000Z",
  }])
})

test("rejects records without required values or usable timestamps", async () => {
  const records = [
    issue({ id: "" }),
    issue({ title: "" }),
    issue({ created_at: "not a date", updated_at: "also not a date" }),
    issue({ created_at: undefined, updated_at: undefined }),
  ]

  assert.deepEqual(await discoveryFor(records).search(""), [])
})

test("includes issues recent by either timestamp and includes the exact cutoff", async () => {
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const records = [
    issue({ id: "created-only", created_at: cutoff, updated_at: "2026-08-01T00:00:00.000Z" }),
    issue({ id: "updated-only", created_at: "2026-08-01T00:00:00.000Z", updated_at: cutoff }),
    issue({ id: "recent-both" }),
    issue({ id: "old-both", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z" }),
  ]

  assert.deepEqual((await discoveryFor(records).search("" )).map(({ id }) => id), [
    "recent-both",
    "created-only",
    "updated-only",
  ])
})

test("excludes closed, in-progress, and deferred issues case-insensitively", async () => {
  const records = [
    issue({ id: "closed", status: "CLOSED" }),
    issue({ id: "in-progress", status: "In_Progress" }),
    issue({ id: "deferred", status: "DEFERRED" }),
    issue({ id: "open", status: "OPEN" }),
  ]

  assert.deepEqual((await discoveryFor(records).search("" )).map(({ id }) => id), ["open"])
})

test("ranks exact, prefix, substring, and subsequence matches by relevance", async () => {
  const records = [
    issue({ id: "subsequence", title: "Crate" }),
    issue({ id: "substring", title: "Bobcat" }),
    issue({ id: "prefix", title: "Catapult" }),
    issue({ id: "exact", title: "Cat" }),
  ]

  assert.deepEqual((await discoveryFor(records).search("cat")).map(({ id }) => id), [
    "exact",
    "prefix",
    "substring",
    "subsequence",
  ])
})

test("requires every punctuation-separated query token to match ID or title", async () => {
  const records = [
    issue({ id: "matching", title: "Build parser", description: "hidden" }),
    issue({ id: "partial", title: "Build only", description: "missing" }),
  ]

  assert.deepEqual((await discoveryFor(records).search("build-parser")).map(({ id }) => id), ["matching"])
  assert.deepEqual(await discoveryFor(records).search("build missing"), [])
  assert.deepEqual(await discoveryFor(records).search("hidden"), [])
  assert.deepEqual(await discoveryFor(records).search("---"), [])
})

test("breaks relevance ties by latest activity and then issue ID", async () => {
  const records = [
    issue({ id: "zeta", title: "Same", created_at: "2026-08-25T09:00:00.000Z", updated_at: "2026-08-26T09:00:00.000Z" }),
    issue({ id: "beta", title: "Same", created_at: "2026-08-25T09:00:00.000Z", updated_at: "2026-08-26T10:00:00.000Z" }),
    issue({ id: "alpha", title: "Same", created_at: "2026-08-25T09:00:00.000Z", updated_at: "2026-08-26T10:00:00.000Z" }),
  ]

  assert.deepEqual((await discoveryFor(records).search("same")).map(({ id }) => id), ["alpha", "beta", "zeta"])
})

test("limits fetched records to 1000 and returned matches to five", async () => {
  const records = Array.from({ length: 1001 }, (_, index) => issue({
    id: `issue-${String(index).padStart(4, "0")}`,
    title: "Match",
    updated_at: new Date(now.getTime() - index * 1000).toISOString(),
  }))

  let requested: BeadsProcessRequest | undefined
  const discovery = discoveryFor(records, {
    runner: async (request) => {
      requested = request
      return { exitCode: 0, stdout: JSON.stringify(records) }
    },
  })

  const result = await discovery.search("match")
  assert.equal(result.length, 5)
  assert.equal(result.at(-1)?.id, "issue-0004")
  assert.equal(requested?.args[3], "1000")
})

test("returns no results for process failures without exposing stderr", async () => {
  const output: string[] = []
  const originalConsoleError = console.error
  const originalConsoleWarn = console.warn
  const originalConsoleLog = console.log
  console.error = (...args) => output.push(args.join(" "))
  console.warn = (...args) => output.push(args.join(" "))
  console.log = (...args) => output.push(args.join(" "))

  const failures = [
    async () => ({ exitCode: 1, stdout: "", stderr: "permission denied" }),
    async () => Promise.reject(new Error("bd not found")),
    async () => ({ exitCode: 0, stdout: "{\"issues\":" + "x".repeat(2097152) + "}" }),
  ]

  try {
    for (const runner of failures) {
      const discovery = discoveryFor([issue()], { runner })
      assert.deepEqual(await discovery.search(""), [])
    }
  } finally {
    console.error = originalConsoleError
    console.warn = originalConsoleWarn
    console.log = originalConsoleLog
  }

  assert.deepEqual(output, [])
})

test("returns no results when the process runner exceeds the timeout", async () => {
  const discovery = discoveryFor([issue()], {
    runner: () => new Promise(() => {}),
  })

  assert.deepEqual(await discovery.search(""), [])
})

test("handles large candidate token sets without throwing", async () => {
  const largeTitle = Array.from({ length: 200_000 }, () => "a").join(" ")
  const discovery = discoveryFor([issue({ title: largeTitle })])

  assert.deepEqual(await discovery.search("missing"), [])
})

test("uses the directory when no worktree is available and preserves inherited environment", async () => {
  let requested: BeadsProcessRequest | undefined
  const discovery = discoveryFor([issue()], {
    env: { BEADS_DIR: "/external/beads", PATH: "/usr/bin" },
    runner: async (request) => {
      requested = request
      return { exitCode: 0, stdout: JSON.stringify([issue()]) }
    },
  })

  await discovery.search("")
  assert.equal(requested?.cwd, "/repo")
  assert.deepEqual(requested?.env, { BEADS_DIR: "/external/beads", PATH: "/usr/bin" })
})
