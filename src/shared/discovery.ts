import { execFile } from "node:child_process"

export type BeadsIssue = {
  id: string
  title: string
  status?: string
  priority?: string | number
  createdAt?: string
  updatedAt?: string
}

export type BeadsProcessRequest = {
  command: "bd"
  args: ["list", "--json", "--limit", "1000", "--sort", "updated"]
  cwd: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
  maxOutputBytes: number
}

export type BeadsProcessResult = {
  exitCode: number
  stdout: string
}

export type BeadsProcessRunner = (request: BeadsProcessRequest) => Promise<BeadsProcessResult>

export type BeadsDiscoveryOptions = {
  directory: string
  worktree?: string
  env?: NodeJS.ProcessEnv
  now?: () => Date
  runner?: BeadsProcessRunner
  resultLimit?: number
}

export type BeadsDiscovery = {
  search(query: string): Promise<BeadsIssue[]>
}

const excludedStatuses = new Set(["closed", "in_progress", "deferred"])
const requestTimeoutMs = 1000
const maxOutputBytes = 2 * 1024 * 1024
const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000

export function createBeadsDiscovery(options: BeadsDiscoveryOptions): BeadsDiscovery {
  return {
    async search(query) {
      const now = options.now?.() ?? new Date()
      const request: BeadsProcessRequest = {
        command: "bd",
        args: ["list", "--json", "--limit", "1000", "--sort", "updated"],
        cwd: options.worktree ?? options.directory,
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

      if (result.exitCode !== 0) return []
      if (Buffer.byteLength(result.stdout, "utf8") > maxOutputBytes) return []
      const issues = parseIssues(result.stdout, now)
      return rankIssues(issues, query).slice(0, options.resultLimit ?? 5)
    },
  }
}

function parseIssues(stdout: string, now: Date): BeadsIssue[] {
  let value: unknown
  try {
    value = JSON.parse(stdout)
  } catch {
    return []
  }

  const records = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.issues)
      ? value.issues
      : null
  if (!records) return []

  const cutoff = now.getTime() - fourteenDaysMs
  return records.slice(0, 1000).flatMap((record) => {
    if (!isRecord(record)) return []
    const id = nonEmptyString(record.id)
    const title = nonEmptyString(record.title)
    const rawCreatedAt = nonEmptyString(record.created_at)
    const rawUpdatedAt = nonEmptyString(record.updated_at)
    if (!id || !title || !rawCreatedAt && !rawUpdatedAt) return []

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
  })
}

function rankIssues(issues: BeadsIssue[], query: string): BeadsIssue[] {
  const queryTokens = tokenize(query)
  if (query.trim().length > 0 && queryTokens.length === 0) return []
  return issues
    .flatMap((issue, index) => {
      if (queryTokens.length === 0) return [{ issue, score: 0, index }]
      const candidateTokens = tokenize(`${issue.id} ${issue.title}`)
      const scores = queryTokens.map((queryToken) => bestTokenScore(queryToken, candidateTokens))
      return scores.every((score) => score >= 0)
        ? [{ issue, score: scores.reduce((total, score) => total + score, 0), index }]
        : []
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score
      const activityDifference = latestActivity(right.issue) - latestActivity(left.issue)
      if (activityDifference !== 0) return activityDifference
      const idDifference = left.issue.id < right.issue.id ? -1 : left.issue.id > right.issue.id ? 1 : 0
      return idDifference !== 0 ? idDifference : left.index - right.index
    })
    .map(({ issue }) => issue)
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

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Beads process timed out")), timeoutMs)
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
        })
      },
    )
  })
}
