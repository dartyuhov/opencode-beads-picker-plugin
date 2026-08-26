import type { Hooks, Plugin } from "@opencode-ai/plugin"
import { randomUUID } from "node:crypto"
import { createBeadsDiscovery, type BeadsProcessRunner } from "./shared/discovery.js"
import { beadsReferences, formatBeadsContext } from "./shared/context.js"

export type ServerPluginContext = {
  directory: string
  worktree?: string
  now?: () => Date
  runner?: BeadsProcessRunner
}

export function createServerPlugin(context: ServerPluginContext): Hooks {
  return {
    "chat.message": async (input, output) => {
      const ids = output.parts
        .filter((part): part is typeof part & { type: "text"; text: string } => part.type === "text" && "text" in part)
        .flatMap((part) => beadsReferences(part.text))
        .filter((id, index, references) => references.indexOf(id) === index)
      if (!ids.length) return

      const discovery = createBeadsDiscovery({
        directory: context.directory,
        worktree: context.worktree,
        now: context.now,
        runner: context.runner,
        resultLimit: Number.MAX_SAFE_INTEGER,
      })
      const metadata = formatBeadsContext(ids, await discovery.search(""))
      if (metadata) {
        output.parts.push({
          id: randomUUID(),
          sessionID: input.sessionID,
          messageID: input.messageID ?? randomUUID(),
          type: "text",
          text: metadata,
          synthetic: true,
        })
      }
    },
  }
}

const serverPlugin: Plugin = async (context) => createServerPlugin(context)

export default serverPlugin
