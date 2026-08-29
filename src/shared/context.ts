import type { BeadsIssue } from "./discovery.js"

// OpenCode excludes text/plain file parts before model conversion. Keep the
// payload plain text while using a text MIME that remains a native attachment.
export const beadsAttachmentMime = "text/markdown"

export type BeadsTextReference = {
  id: string
  start: number
  end: number
}

export function beadsReferences(text: string): string[] {
  return [...new Set(beadsReferenceRanges(text).map((reference) => reference.id))]
}

export function beadsReferenceRanges(text: string): BeadsTextReference[] {
  return [...text.matchAll(/(?:^|\s)bd:([^\s]+)/giu)].flatMap((match) => {
    const rawID = match[1]
    const id = rawID?.replace(/[.,;:!?)}\]]+$/u, "")
    if (!rawID || !id) return []
    const start = match.index + match[0].length - rawID.length - 3
    return [{ id, start, end: start + id.length + 3 }]
  })
}

export function formatBeadsContext(ids: string[], issues: BeadsIssue[]): string {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const resolved = ids.map((id) => byId.get(id)).filter((issue): issue is BeadsIssue => Boolean(issue))
  if (!resolved.length) return ""

  return [
    "<beads-context>",
    "Discovered Beads issues. Read-only context; do not claim, update, or close them automatically.",
    ...resolved.flatMap(formatIssue),
    "</beads-context>",
  ].join("\n")
}

export function formatBeadsAttachment(issue: BeadsIssue): string {
  return formatBeadsContext([issue.id], [issue])
}

export function beadsAttachmentUrl(issue: BeadsIssue): string {
  return `data:text/plain;base64,${Buffer.from(formatBeadsAttachment(issue), "utf8").toString("base64")}`
}

export function beadsAttachmentLabel(id: string): string {
  return `[Beads:${id}]`
}

function formatIssue(issue: BeadsIssue): string[] {
  const lines = [
    `- id: ${issue.id}`,
    `  title: ${issue.title}`,
    ...(issue.status === undefined ? [] : [`  status: ${issue.status}`]),
    ...(issue.priority === undefined ? [] : [`  priority: ${issue.priority}`]),
    ...(issue.issueType === undefined ? [] : [`  type: ${issue.issueType}`]),
    ...(issue.owner === undefined ? [] : [`  owner: ${issue.owner}`]),
    ...(issue.createdBy === undefined ? [] : [`  created_by: ${issue.createdBy}`]),
    ...(issue.createdAt === undefined ? [] : [`  created_at: ${issue.createdAt}`]),
    ...(issue.updatedAt === undefined ? [] : [`  updated_at: ${issue.updatedAt}`]),
    ...(issue.dependentCount === undefined ? [] : [`  dependent_count: ${issue.dependentCount}`]),
    ...(issue.dependencyCount === undefined ? [] : [`  dependency_count: ${issue.dependencyCount}`]),
    ...(issue.commentCount === undefined ? [] : [`  comment_count: ${issue.commentCount}`]),
  ]
  if (issue.description !== undefined) {
    lines.push("  description:", ...issue.description.split(/\r?\n/u).map((line) => `    ${line}`))
  }
  if (issue.comments !== undefined) {
    lines.push(
      "  comments:",
      ...issue.comments.flatMap((comment) => [
        `    -${comment.author === undefined ? "" : ` ${comment.author}`}${comment.createdAt === undefined ? "" : ` (${comment.createdAt})`}:`,
        ...comment.body.split(/\r?\n/u).map((line) => `      ${line}`),
      ]),
    )
  }
  return lines
}
