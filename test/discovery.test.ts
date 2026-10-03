import test from "node:test"
import assert from "node:assert/strict"
import { createBeadsDiscovery, parseBeadsSearchOptions, type BeadsProcessRequest } from "../src/shared/discovery.js"

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
    args: ["list", "--json", "--limit", "0", "--sort", "updated", "--all", "--include-gates", "--include-infra", "--include-templates"],
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

test("loads enriched issue details through bd show", async () => {
  let requested: BeadsProcessRequest | undefined
  const discovery = createBeadsDiscovery({
    directory: "/repo",
    runner: async (request) => {
      requested = request
      return {
        exitCode: 0,
        stdout: JSON.stringify([{
          id: "issue-1",
          title: "Example issue",
          status: "open",
          priority: 2,
          issue_type: "task",
          owner: "owner@example.com",
          description: "Detailed description",
          comments: [{ author: "reviewer", body: "Needs follow-up" }],
        }]),
      }
    },
  })

  assert.deepEqual(await discovery.resolveDetails?.(["issue-1"]), [{
    id: "issue-1",
    title: "Example issue",
    status: "open",
    priority: 2,
    issueType: "task",
    owner: "owner@example.com",
    description: "Detailed description",
    comments: [{ author: "reviewer", body: "Needs follow-up" }],
  }])
  assert.deepEqual(requested?.args, ["show", "issue-1", "--json", "--long", "--include-comments"])
})

test("maps Beads assignees to attachment owners", async () => {
  const discovery = discoveryFor([issue()], {
    runner: async ({ args }) => ({
      exitCode: 0,
      stdout: JSON.stringify(args[0] === "show" ? [{ ...issue(), assignee: "assigned@example.com" }] : [issue()]),
    }),
  })

  assert.deepEqual(await discovery.resolveDetails?.(["issue-1"]), [{
    id: "issue-1",
    title: "Example issue",
    status: "open",
    priority: "P2",
    createdAt: "2026-08-26T11:00:00.000Z",
    updatedAt: "2026-08-26T11:30:00.000Z",
    owner: "assigned@example.com",
  }])
})

test("rejects records without an ID or title", async () => {
  const records = [
    issue({ id: "" }),
    issue({ title: "" }),
  ]

  assert.deepEqual(await discoveryFor(records).search(""), [])
})

test("includes old issues and records without usable timestamps by default", async () => {
  const records = [
    issue({ id: "old", created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-02T00:00:00Z" }),
    issue({ id: "no-dates", created_at: undefined, updated_at: undefined }),
    issue({ id: "bad-dates", created_at: "not a date", updated_at: "not a date" }),
  ]
  const results = await discoveryFor(records).search("")
  assert.deepEqual(results.map(({ id }) => id), ["old", "bad-dates", "no-dates"])
  assert.equal(results[1]?.createdAt, undefined)
  assert.equal(results[1]?.updatedAt, undefined)
})

test("optionally filters by latest activity and includes the exact cutoff", async () => {
  const cutoff = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString()
  const records = [
    issue({ id: "created-only", created_at: cutoff, updated_at: "2026-08-01T00:00:00.000Z" }),
    issue({ id: "updated-only", created_at: "2026-08-01T00:00:00.000Z", updated_at: cutoff }),
    issue({ id: "recent-both" }),
    issue({ id: "old-both", created_at: "2026-08-01T00:00:00.000Z", updated_at: "2026-08-02T00:00:00.000Z" }),
    issue({ id: "no-dates", created_at: undefined, updated_at: undefined }),
  ]

  assert.deepEqual((await discoveryFor(records, { maxAgeDays: 14 }).search("")).map(({ id }) => id), [
    "recent-both",
    "created-only",
    "updated-only",
  ])
})

test("includes every status by default and supports a case-insensitive allowlist", async () => {
  const records = [
    issue({ id: "closed", status: "CLOSED" }),
    issue({ id: "in-progress", status: "In_Progress" }),
    issue({ id: "deferred", status: "DEFERRED" }),
    issue({ id: "open", status: "OPEN" }),
    issue({ id: "blocked", status: "blocked" }),
    issue({ id: "custom", status: "custom" }),
    issue({ id: "unknown", status: undefined }),
  ]

  const discovery = discoveryFor(records)
  for (const { id } of records) assert.equal((await discovery.search(String(id)))[0]?.id, id)
  assert.deepEqual((await discoveryFor(records, { statuses: [" OPEN ", "Blocked"] }).search("")).map(({ id }) => id), ["blocked", "open"])
  assert.equal((await discoveryFor(records, { statuses: [] }).search("closed"))[0]?.id, "closed")
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

test("ranks an exact token above multiple weaker token matches", async () => {
  const records = [
    issue({ id: "exact", title: "cat aXbXc" }),
    issue({ id: "prefixes", title: "catapult abcdef" }),
  ]

  assert.deepEqual((await discoveryFor(records).search("cat abc")).map(({ id }) => id), ["exact", "prefixes"])
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

test("searches beyond 1000 records by default and returns the five best matches", async () => {
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
  assert.equal(result[result.length - 1]?.id, "issue-0004")
  assert.equal(requested?.args[3], "0")
  assert.equal((await discovery.search("issue-1000"))[0]?.id, "issue-1000")
})

test("optionally caps fetched issues while resolving references without picker filters", async () => {
  const requests: BeadsProcessRequest[] = []
  const records = [
    issue({ id: "recent" }),
    issue({ id: "old-closed", status: "closed", created_at: "2020-01-01T00:00:00Z", updated_at: "2020-01-02T00:00:00Z" }),
  ]
  const discovery = discoveryFor(records, {
    statuses: ["open"], maxAgeDays: 14, maxIssues: 1,
    runner: async (request) => {
      requests.push(request)
      return { exitCode: 0, stdout: JSON.stringify(records) }
    },
  })
  assert.deepEqual(await discovery.search("old-closed"), [])
  assert.equal(requests[0]?.args[3], "1")
  assert.equal((await discovery.resolve(["old-closed"]))[0]?.id, "old-closed")
  assert.equal(requests[1]?.args[3], "0")
})

test("normalizes plugin search options and ignores invalid values", () => {
  assert.deepEqual(parseBeadsSearchOptions({ statuses: [" OPEN ", "CLOSED"], maxAgeDays: 0.5, maxIssues: 0 }), {
    statuses: ["open", "closed"], maxAgeDays: 0.5, maxIssues: 0,
  })
  for (const value of [undefined, null, [], "invalid", { statuses: [123], maxAgeDays: -1, maxIssues: 1.5 }, { statuses: [""], maxAgeDays: Infinity, maxIssues: -1 }]) {
    assert.deepEqual(parseBeadsSearchOptions(value), {})
  }
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

test("classifies discovery failures without retaining process details", async () => {
  const failures: Array<{
    runner: NonNullable<Parameters<typeof createBeadsDiscovery>[0]["runner"]>
    expected: string
  }> = [
    { runner: async () => ({ exitCode: 1, stdout: "" }), expected: "nonzero-exit" },
    { runner: () => new Promise<never>(() => {}), expected: "timeout" },
    { runner: async () => ({ exitCode: 0, stdout: "not json" }), expected: "malformed-json" },
    { runner: async () => ({ exitCode: 0, stdout: JSON.stringify({ records: [] }) }), expected: "unexpected-response" },
  ]

  for (const { runner, expected } of failures) {
    const discovery = discoveryFor([issue()], { runner })
    assert.deepEqual(await discovery.search(""), [])
    assert.equal(discovery.lastFailure, expected)
  }
})

test("classifies missing executables and invalid working directories", async () => {
  const missingExecutable = createBeadsDiscovery({
    directory: process.cwd(),
    env: { PATH: "/definitely-missing" },
  })
  assert.deepEqual(await missingExecutable.search(""), [])
  assert.equal(missingExecutable.lastFailure, "missing-executable")

  const invalidWorkingDirectory = createBeadsDiscovery({
    directory: process.cwd(),
    worktree: "/definitely-missing",
  })
  assert.deepEqual(await invalidWorkingDirectory.search(""), [])
  assert.equal(invalidWorkingDirectory.lastFailure, "invalid-working-directory")
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

test("uses the OpenCode directory when its no-worktree sentinel is provided", async () => {
  let requested: BeadsProcessRequest | undefined
  const discovery = discoveryFor([issue()], {
    worktree: "/",
    runner: async (request) => {
      requested = request
      return { exitCode: 0, stdout: JSON.stringify([issue()]) }
    },
  })

  await discovery.search("")
  assert.equal(requested?.cwd, "/repo")
})
