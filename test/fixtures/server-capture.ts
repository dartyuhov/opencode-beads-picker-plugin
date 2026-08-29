import type { Plugin } from "@opencode-ai/plugin"
import { appendFile } from "node:fs/promises"

const capturePath = process.env.OPENCODE_BEADS_CAPTURE

function capture(value: unknown) {
  if (!capturePath) return
  void appendFile(capturePath, `${JSON.stringify(value)}\n`).catch(() => {})
}

const plugin: Plugin = async () => ({
  "chat.message": async (_input, output) => {
    capture({ kind: "chat-output", parts: output.parts })
  },
  event: async ({ event }) => {
    if (event.type === "message.part.updated") {
      capture({ kind: "persisted-part", part: event.properties.part })
    }
    if (event.type === "session.error") {
      capture({ kind: "session-error", error: event.properties.error })
    }
  },
})

export default plugin
