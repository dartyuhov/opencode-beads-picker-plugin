import { execFile } from "node:child_process"
import { statSync } from "node:fs"

export type BeadsIssue = {
  id: string
  title: string
  status?: string
  priority?: string | number
  createdAt?: string
  updatedAt?: string
  description?: string
  issueType?: string
  owner?: string
  createdBy?: string
  dependentCount?: number
  dependencyCount?: number
  commentCount?: number
  comments?: BeadsComment[]
}

export type BeadsComment = {
  author?: string
  body: string
  createdAt?: string
}

export type BeadsProcessRequest = {
  command: "bd"
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes: number
}

export type BeadsProcessResult = {
  exitCode: number
  stdout: string
  failure?: BeadsDiscoveryFailure
}

export type BeadsProcessRunner = (request: BeadsProcessRequest) => Promise<BeadsProcessResult>

export type BeadsDiscoveryOptions = {
  directory: string
  worktree?: string
  env?: NodeJS.ProcessEnv
  now?: () => Date
  runner?: BeadsProcessRunner
}

export type BeadsDiscovery = {
  readonly lastFailure?: BeadsDiscoveryFailure
  search(query: string): Promise<BeadsIssue[]>
  resolve(ids: string[]): Promise<BeadsIssue[]>
  resolveDetails?(ids: string[]): Promise<BeadsIssue[]>
}

export type BeadsDiscoveryFailure =
  | "missing-executable"
  | "invalid-working-directory"
  | "process-error"
  | "timeout"
  | "oversized-output"
  | "nonzero-exit"
  | "malformed-json"
  | "unexpected-response"

const excludedStatuses = new Set(["closed", "in_progress", "deferred"])
const requestTimeoutMs = 1000
const maxOutputBytes = 2 * 1024 * 1024
const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000

export function createBeadsDiscovery(options: BeadsDiscoveryOptions): BeadsDiscovery {
  let lastFailure: BeadsDiscoveryFailure | undefined

  return {
    get lastFailure() {
      return lastFailure
    },
    async search(query) {
      const loaded = await loadIssues(options)
      lastFailure = loaded.failure
      return rankIssues(loaded.issues, query).slice(0, 5)
    },
    async resolve(ids) {
      const loaded = await loadIssues(options)
      lastFailure = loaded.failure
      const byId = new Map(loaded.issues.map((issue) => [issue.id, issue]))
      return ids.flatMap((id) => {
        const issue = byId.get(id)
        return issue ? [issue] : []
      })
    },
    async resolveDetails(ids) {
      return loadIssueDetails(options, ids)
    },
  }
}

type LoadedIssues = {
  issues: BeadsIssue[]
  failure?: BeadsDiscoveryFailure
}

async function loadIssues(options: BeadsDiscoveryOptions): Promise<LoadedIssues> {
  const now = options.now?.() ?? new Date()
  const request: BeadsProcessRequest = {
    command: "bd",
    args: ["list", "--json", "--limit", "1000", "--sort", "updated"],
    cwd: usableWorktree(options.worktree) ?? options.directory,
    env: options.env ?? process.env,
    timeoutMs: requestTimeoutMs,
    maxOutputBytes,
  }

  let result: BeadsProcessResult
  try {
    result = await withTimeout((options.runner ?? runBeadsProcess)(request), requestTimeoutMs)
  } catch (error) {
    return { issues: [], failure: classifyProcessError(error, request.cwd) }
  }

  if (result.failure) return { issues: [], failure: result.failure }
  if (result.exitCode !== 0) return { issues: [], failure: "nonzero-exit" }
  if (Buffer.byteLength(result.stdout, "utf8") > maxOutputBytes) return { issues: [], failure: "oversized-output" }
  return parseIssues(result.stdout, now)
}

async function loadIssueDetails(options: BeadsDiscoveryOptions, ids: string[]): Promise<BeadsIssue[]> {
  if (ids.length === 0) return []

  const request: BeadsProcessRequest = {
    command: "bd",
    args: ["show", ...ids, "--json", "--long", "--include-comments"],
    cwd: usableWorktree(options.worktree) ?? options.directory,
    env: options.env ?? process.env,
    timeoutMs: requestTimeoutMs,
    maxOutputBytes,
  }

  let result: BeadsProcessResult
  try {
    result = await withTimeout((options.runner ?? runBeadsProcess)(request), requestTimeoutMs)
  } catch {
    return []
  }

  if (result.failure || result.exitCode !== 0) return []
  if (Buffer.byteLength(result.stdout, "utf8") > maxOutputBytes) return []

  let value: unknown
  try {
    value = JSON.parse(result.stdout)
  } catch {
    return []
  }

  const records = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.issues)
      ? value.issues
      : []

  return records.flatMap((record) => parseIssueDetails(record))
}

function parseIssues(stdout: string, now: Date): LoadedIssues {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return { issues: [], failure: "malformed-json" }
  }

  const records = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.issues)
      ? value.issues
      : null
  if (!records) return { issues: [], failure: "unexpected-response" }

  const cutoff = now.getTime() - fourteenDaysMs
  return {
    issues: records.slice(0, 1000).flatMap((record) => {
      if (!isRecord(record)) return []
      const id = nonEmptyString(record.id)
      const title = nonEmptyString(record.title)
      const rawCreatedAt = nonEmptyString(record.created_at)
      const rawUpdatedAt = nonEmptyString(record.updated_at)
      if (!id || !title || (!rawCreatedAt && !rawUpdatedAt)) return []

      const createdTime = parseTimestamp(rawCreatedAt)
      const updatedTime = parseTimestamp(rawUpdatedAt)
      if (createdTime === undefined && updatedTime === undefined) return []
      if (Math.max(createdTime ?? Number.NEGATIVE_INFINITY, updatedTime ?? Number.NEGATIVE_INFINITY) < cutoff) {
        return []
      }

      const status = nonEmptyString(record.status)
      if (status && excludedStatuses.has(status.trim().toLowerCase())) return []

      const issue: BeadsIssue = { id, title }
      if (status !== undefined) issue.status = status
      const priority = priorityValue(record.priority)
      if (priority !== undefined) issue.priority = priority
      if (createdTime !== undefined) issue.createdAt = rawCreatedAt
      if (updatedTime !== undefined) issue.updatedAt = rawUpdatedAt
      return [issue]
    }),
  }
}

function parseIssueDetails(value: unknown): BeadsIssue[] {
  if (!isRecord(value)) return []
  const id = nonEmptyString(value.id)
  const title = nonEmptyString(value.title)
  if (!id || !title) return []

  const issue: BeadsIssue = { id, title }
  const status = nonEmptyString(value.status)
  if (status !== undefined) issue.status = status
  const priority = priorityValue(value.priority)
  if (priority !== undefined) issue.priority = priority
  const createdAt = nonEmptyString(value.created_at)
  if (createdAt !== undefined) issue.createdAt = createdAt
  const updatedAt = nonEmptyString(value.updated_at)
  if (updatedAt !== undefined) issue.updatedAt = updatedAt
  const description = typeof value.description === "string" ? value.description : undefined
  if (description !== undefined) issue.description = description
  const issueType = nonEmptyString(value.issue_type)
  if (issueType !== undefined) issue.issueType = issueType
  const owner = nonEmptyString(value.owner) ?? nonEmptyString(value.assignee)
  if (owner !== undefined) issue.owner = owner
  const createdBy = nonEmptyString(value.created_by)
  if (createdBy !== undefined) issue.createdBy = createdBy
  const dependentCount = finiteNumber(value.dependent_count)
  if (dependentCount !== undefined) issue.dependentCount = dependentCount
  const dependencyCount = finiteNumber(value.dependency_count)
  if (dependencyCount !== undefined) issue.dependencyCount = dependencyCount
  const commentCount = finiteNumber(value.comment_count)
  if (commentCount !== undefined) issue.commentCount = commentCount
  if (Array.isArray(value.comments)) {
    const comments = value.comments.flatMap((comment) => parseComment(comment))
    if (comments.length > 0) issue.comments = comments
  }
  return [issue]
}

function parseComment(value: unknown): BeadsComment[] {
  if (!isRecord(value) || typeof value.body !== "string") return []
  const comment: BeadsComment = { body: value.body }
  const author = nonEmptyString(value.author)
  if (author !== undefined) comment.author = author
  const createdAt = nonEmptyString(value.created_at)
  if (createdAt !== undefined) comment.createdAt = createdAt
  return [comment]
}

function rankIssues(issues: BeadsIssue[], query: string): BeadsIssue[] {
  const queryTokens = tokenize(query)
  if (query.trim().length > 0 && queryTokens.length === 0) return []
  return issues
    .flatMap((issue, index) => {
      if (queryTokens.length === 0) return [{ issue, scores: [], index }]
      const candidateTokens = tokenize(`${issue.id} ${issue.title}`)
      const scores = queryTokens.map((queryToken) => bestTokenScore(queryToken, candidateTokens))
      return scores.every((score) => score >= 0)
        ? [{ issue, scores: [...scores].sort((left, right) => right - left), index }]
        : []
    })
    .sort((left, right) => {
      for (let index = 0; index < Math.max(left.scores.length, right.scores.length); index++) {
        const leftScore = left.scores[index] ?? 0
        const rightScore = right.scores[index] ?? 0
        if (rightScore !== leftScore) return rightScore - leftScore
      }
      const activityDifference = latestActivity(right.issue) - latestActivity(left.issue)
      if (activityDifference !== 0) return activityDifference
      const idDifference = left.issue.id < right.issue.id ? -1 : left.issue.id > right.issue.id ? 1 : 0
      return idDifference !== 0 ? idDifference : left.index - right.index
    })
    .map(({ issue }) => issue)
}

function usableWorktree(worktree: string | undefined): string | undefined {
  return worktree && worktree !== "/" ? worktree : undefined
}

function bestTokenScore(query: string, candidates: string[]): number {
  let best = -1
  for (const candidate of candidates) best = Math.max(best, tokenScore(query, candidate))
  return best
}

function tokenize(value: string): string[] {
  return value.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean)
}

function tokenScore(queryToken: string, candidateToken: string): number {
  if (candidateToken === queryToken) return 100
  if (candidateToken.startsWith(queryToken)) return 80
  if (candidateToken.includes(queryToken)) return 60
  if (isSubsequence(queryToken, candidateToken)) return 40
  return -1
}

function isSubsequence(query: string, candidate: string): boolean {
  let candidateIndex = 0
  for (const character of query) {
    candidateIndex = candidate.indexOf(character, candidateIndex)
    if (candidateIndex === -1) return false
    candidateIndex++
  }
  return true
}

function latestActivity(issue: BeadsIssue): number {
  return Math.max(parseTimestamp(issue.createdAt) ?? Number.NEGATIVE_INFINITY, parseTimestamp(issue.updatedAt) ?? Number.NEGATIVE_INFINITY)
}

function parseTimestamp(value: string | undefined): number | undefined {
  if (!value) return undefined
  const time = Date.parse(value)
  return Number.isNaN(time) ? undefined : time
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function priorityValue(value: unknown): string | number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value
  return nonEmptyString(value)
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new BeadsTimeoutError()), timeoutMs)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error: unknown) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

class BeadsTimeoutError extends Error {
  constructor() {
    super("Beads process timed out")
    this.name = "BeadsTimeoutError"
  }
}

function runBeadsProcess(request: BeadsProcessRequest): Promise<BeadsProcessResult> {
  return new Promise((resolve) => {
    execFile(
      request.command,
      request.args,
      {
        cwd: request.cwd,
        env: request.env,
        timeout: request.timeoutMs,
        maxBuffer: request.maxOutputBytes,
        encoding: "utf8",
      },
      (error, stdout) => {
        resolve({
          exitCode: error ? (typeof error.code === "number" ? error.code : 1) : 0,
          stdout: typeof stdout === "string" ? stdout : String(stdout ?? ""),
          failure: error && typeof error.code !== "number" ? classifyProcessError(error, request.cwd) : undefined,
        })
      },
    )
  })
}

function classifyProcessError(error: unknown, cwd: string): BeadsDiscoveryFailure {
  if (error instanceof BeadsTimeoutError) return "timeout"
  const processError = error as { code?: string | number | null; killed?: boolean; signal?: string | null }
  if (processError.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER") return "oversized-output"
  if (processError.killed || processError.signal === "SIGTERM" || processError.code === "ETIMEDOUT") return "timeout"
  if (processError.code === "ENOENT") return cwdExists(cwd) ? "missing-executable" : "invalid-working-directory"
  return "process-error"
}

function cwdExists(cwd: string): boolean {
  try {
    return statSync(cwd).isDirectory()
  } catch {
    return false
  }
}
