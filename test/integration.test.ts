import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import type { TuiPluginApi, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { createServerPlugin } from "../src/server.js"
import { tuiPlugin } from "../src/tui.js"

test("local target configuration points at separate built entrypoints", async () => {
  const server = JSON.parse(await readFile(new URL("../opencode.json", import.meta.url), "utf8")) as {
    plugin: string[]
  }
  const tui = JSON.parse(await readFile(new URL("../tui.json", import.meta.url), "utf8")) as {
    session_prompt: string
  }

  assert.deepEqual(server.plugin, ["./dist/server.js"])
  assert.equal(tui.session_prompt, "./dist/tui.js")
})

test("TUI module registers public session_prompt replacement", async () => {
  let registered: TuiSlotPlugin | undefined
  const api = {
    slots: {
      register(plugin: TuiSlotPlugin) {
        registered = plugin
        return "opencode-beads-plugin"
      },
    },
  } as unknown as TuiPluginApi

  await tuiPlugin.tui(api, undefined, {} as never)

  assert.equal(tuiPlugin.id, "opencode-beads-plugin")
  assert.equal(typeof registered?.slots.session_prompt, "function")
})

test("server target exposes a loadable public plugin entrypoint", () => {
  assert.equal(typeof createServerPlugin({ directory: "/repo" })["chat.message"], "function")
})
