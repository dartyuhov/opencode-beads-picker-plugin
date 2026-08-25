export type BeadsReference = {
  start: number
  end: number
  query: string
}

function isWhitespace(value: string) {
  return /\s/u.test(value)
}

/** Find the `bd:` reference containing cursor, if any. */
export function activeReference(text: string, cursor: number): BeadsReference | null {
  const boundedCursor = Math.max(0, Math.min(cursor, text.length))
  const beforeCursor = text.slice(0, boundedCursor)
  const match = /(?:^|\s)(bd:[^\s]*)$/iu.exec(beforeCursor)
  if (!match) return null

  const token = match[1]
  if (!token) return null
  const start = beforeCursor.length - token.length
  let end = start + token.length
  while (end < text.length && !isWhitespace(text[end] ?? "")) end++

  return {
    start,
    end,
    query: text.slice(start + 3, Math.min(end, boundedCursor)),
  }
}

/** Find all `bd:` references in prompt text. */
export function allReferences(text: string): BeadsReference[] {
  const references: BeadsReference[] = []
  const pattern = /(?:^|\s)(bd:[^\s]*)/giu
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text))) {
    const token = match[1]
    if (!token) continue
    const start = match.index + match[0].length - token.length
    references.push({ start, end: start + token.length, query: token.slice(3) })
  }

  return references
}

/** Replace only active reference and add one continuation space when needed. */
export function replaceReference(text: string, reference: BeadsReference, id: string) {
  const replacement = `bd:${id}`
  const needsSpace = reference.end >= text.length || !isWhitespace(text[reference.end] ?? "")
  const inserted = needsSpace ? `${replacement} ` : replacement
  const nextText = text.slice(0, reference.start) + inserted + text.slice(reference.end)

  return {
    text: nextText,
    cursor: reference.start + inserted.length,
  }
}
