import type { TuiPluginModule } from "@opencode-ai/plugin/tui"

const plugin: TuiPluginModule = {
  id: "vimcode",
  tui: async (api) => {
    api.keymap.intercept(
      "key",
      (ctx) => {
        if (ctx.event.eventType === "release") return
        if (ctx.event.name !== "return" || ctx.event.ctrl) return
        ctx.consume()
        api.keymap.dispatchCommand("input.newline")
      },
      { priority: 10_000 },
    )
  },
}

export default plugin
