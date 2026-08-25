import type { Hooks, Plugin } from "@opencode-ai/plugin"

export type ServerPluginContext = {
  directory: string
  worktree?: string
}

export function createServerPlugin(_context?: ServerPluginContext): Hooks {
  return {}
}

const serverPlugin: Plugin = async () => createServerPlugin()

export default serverPlugin
