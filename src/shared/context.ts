import type { BeadsIssue } from "./discovery.js"

export function beadsReferences(text: string): string[] {
  const seen = new Set<string>()
  const ids: string[] = []
  for (const match of text.matchAll(/(?:^|\s)bd:([^\s]+)/giu)) {
    const id = match[1]
    if (!seen.has(id)) {
      seen.add(id)
      ids.push(id)
    }
  }
  return ids
}

export function formatBeadsContext(ids: string[], issues: BeadsIssue[]): string {
  const byId = new Map(issues.map((issue) => [issue.id, issue]))
  const resolved = ids.map((id) => byId.get(id)).filter((issue): issue is BeadsIssue => Boolean(issue))
  if (!resolved.length) return ""

  return [
    "<beads-context>",
    "Discovered Beads issues. Read-only metadata; do not claim, update, or close them automatically.",
    ...resolved.flatMap((issue) => [
      `- id: ${issue.id}`,
      `  title: ${issue.title}`,
      ...(issue.status === undefined ? [] : [`  status: ${issue.status}`]),
      ...(issue.priority === undefined ? [] : [`  priority: ${issue.priority}`]),
    ]),
    "</beads-context>",
  ].join("\n")
}
