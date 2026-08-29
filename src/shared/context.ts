import type { BeadsIssue } from "./discovery.js"

// GitHub Copilot's OpenAI-compatible models accept PDF attachments, but reject
// generic text file media types. Keep issue context in a small native PDF.
export const beadsAttachmentMime = "application/pdf"

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
  return `data:${beadsAttachmentMime};base64,${createPdf(formatBeadsAttachment(issue)).toString("base64")}`
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

function createPdf(text: string): Buffer {
  const lines = text.split(/\r?\n/u).map((line) => line.replace(/[^\x20-\x7e]/gu, "?"))
  const content = ["BT", "/F1 9 Tf", "50 760 Td", ...lines.flatMap((line, index) => [index === 0 ? `(${pdfText(line)}) Tj` : `0 -12 Td (${pdfText(line)}) Tj`]), "ET"].join("\n")
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(content, "ascii")} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ]
  const chunks = ["%PDF-1.4\n"]
  const offsets = [0]
  for (let index = 0; index < objects.length; index++) {
    offsets.push(Buffer.byteLength(chunks.join(""), "ascii"))
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`)
  }
  const xrefOffset = Buffer.byteLength(chunks.join(""), "ascii")
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n `).join("\n")}\ntrailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)
  return Buffer.from(chunks.join(""), "ascii")
}

function pdfText(value: string): string {
  return value.replace(/[\\()]/gu, (character) => `\\${character}`)
}
