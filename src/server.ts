import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { createBeadsDiscovery, type BeadsProcessRunner } from "./shared/discovery.js"
import {
  beadsAttachmentLabel,
  beadsAttachmentMime,
  beadsAttachmentUrl,
  beadsReferenceRanges,
} from "./shared/context.js"
import type { BeadsIssue } from "./shared/discovery.js"

type ChatMessageOutput = Parameters<NonNullable<Hooks["chat.message"]>>[1]
type ChatMessagePart = ChatMessageOutput["parts"][number]
type BeadsFilePart = Extract<ChatMessagePart, { type: "file" }>

export type ServerPluginContext = {
  directory: string
  worktree?: string
  now?: () => Date
  runner?: BeadsProcessRunner
}

export function createServerPlugin(context: ServerPluginContext): Hooks {
  return {
    "chat.message": async (input, output) => {
      const textReferences = output.parts.flatMap((part) =>
        part.type === "text" && !part.synthetic ? beadsReferenceRanges(part.text) : [],
      )
      const selectedReferences = output.parts.flatMap((part) => {
        if (part.type !== "file" || !part.source?.text) return []
        const id = beadsID(part.source.text.value)
        return id ? [{ id, start: part.source.text.start, end: part.source.text.end }] : []
      })
      const references = [...textReferences, ...selectedReferences]
        .sort((left, right) => left.start - right.start)
        .filter((reference, index, all) => all.findIndex((candidate) => candidate.id === reference.id) === index)
      const ids = references.map((reference) => reference.id)
      if (!ids.length) return

      const discovery = createBeadsDiscovery({
        directory: context.directory,
        worktree: context.worktree,
        now: context.now,
        runner: context.runner,
      })
      let resolved: BeadsIssue[] = []
      try {
        resolved = await discovery.resolve(ids)
      } catch {
        return
      }

      if (!discovery.resolveDetails) {
        return
      }
      let details: BeadsIssue[] = []
      try {
        details = await discovery.resolveDetails(resolved.map((issue) => issue.id))
      } catch {
        details = []
      }

      const detailedById = new Map(details.map((issue) => [issue.id, issue]))
      const resolvedById = new Map(
        resolved.flatMap((issue) => {
          const detail = detailedById.get(issue.id)
          return detail ? [[issue.id, { ...issue, ...detail }] as const] : []
        }),
      )
      const existing = new Map<string, BeadsFilePart>()
      for (const part of output.parts) {
        if (!isBeadsFilePart(part)) continue
        const id = beadsID(part.source?.text?.value)
        if (id) existing.set(id, part)
      }

      const parts: ChatMessagePart[] = output.parts.filter((part) => !isBeadsFilePart(part))
      for (const reference of references) {
        const issue = resolvedById.get(reference.id)
        const selected = existing.get(reference.id)
        if (issue) {
          parts.push(selected ? updateBeadsFilePart(selected, issue) : beadsFilePart(input.sessionID, output.message.id, reference, issue))
        } else if (selected) {
          parts.push(selected)
        }
      }
      replaceParts(output.parts, parts)
    },
  }
}

function beadsID(value: string | undefined): string | undefined {
  if (!value) return undefined
  const label = /^\[Beads:([^\]\s]+)\]$/u.exec(value)
  if (label?.[1]) return label[1]
  const reference = /^bd:([^\s]+)$/iu.exec(value)
  return reference?.[1]?.replace(/[.,;:!?)}\]]+$/u, "")
}

function isBeadsFilePart(part: ChatMessagePart): part is BeadsFilePart {
  return part.type === "file" && beadsID(part.source?.text?.value) !== undefined
}

function updateBeadsFilePart(part: BeadsFilePart, issue: BeadsIssue): BeadsFilePart {
  return {
    ...part,
    mime: beadsAttachmentMime,
    filename: beadsAttachmentLabel(issue.id),
    url: beadsAttachmentUrl(issue),
  }
}

function beadsFilePart(
  sessionID: string,
  messageID: string,
  reference: { id: string; start: number; end: number },
  issue: BeadsIssue,
): BeadsFilePart {
  return {
    id: `prt_${randomUUID()}`,
    sessionID,
    messageID,
    type: "file",
    mime: beadsAttachmentMime,
    filename: beadsAttachmentLabel(reference.id),
    url: beadsAttachmentUrl(issue),
    source: {
      type: "file",
      path: beadsAttachmentLabel(reference.id),
      text: {
        start: reference.start,
        end: reference.end,
        value: `bd:${reference.id}`,
      },
    },
  }
}

function replaceParts(target: ChatMessagePart[], next: ChatMessagePart[]) {
  target.splice(0, target.length, ...next)
}

const serverPlugin: Plugin = async (context) => createServerPlugin(context)

export default serverPlugin
