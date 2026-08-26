import test from "node:test"
import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import type { TuiPluginApi, TuiSlotPlugin } from "@opencode-ai/plugin/tui"
import { createServerPlugin } from "../src/server.js"
import { createPromptReplacement, tuiPlugin } from "../src/tui.js"

test("local target configuration points at separate built entrypoints", async () => {
  const server = JSON.parse(await readFile(new URL("../opencode.json", import.meta.url), "utf8")) as {
    plugin: string[]
  }
  const tui = JSON.parse(await readFile(new URL("../tui.json", import.meta.url), "utf8")) as {
    $schema: string
    plugin: string[]
  }

  assert.deepEqual(server.plugin, ["./dist/server.js"])
  assert.equal(tui.$schema, "https://opencode.ai/tui.json")
  assert.deepEqual(tui.plugin, ["./dist/tui.js"])
})

test("package declares tested OpenCode compatibility and separate target exports", async () => {
  const manifest = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8")) as {
    engines?: { opencode?: string }
    exports: Record<string, { import: string; types: string }>
  }

  assert.equal(manifest.engines?.opencode, ">=1.18.23 <2.0.0")
  assert.deepEqual(manifest.exports["./server"], {
    types: "./dist/server.d.ts",
    import: "./dist/server.js",
  })
  assert.deepEqual(manifest.exports["./tui"], {
    types: "./dist/tui.d.ts",
    import: "./dist/tui.js",
  })
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

test("selected TUI reference reaches server context without changing visible prompt", async () => {
  const replacement = createPromptReplacement("Use bd:query")
  replacement.dispatch({ type: "select", id: "issue-one" })
  const visiblePrompt = replacement.editor.text
  const hooks = createServerPlugin({
    directory: "/repo",
    now: () => new Date("2026-08-26T12:00:00.000Z"),
    runner: async () => ({
      exitCode: 0,
      stdout: JSON.stringify([{
        id: "issue-one",
        title: "First issue",
        status: "open",
        priority: "P1",
        created_at: "2026-08-26T11:00:00.000Z",
        updated_at: "2026-08-26T11:30:00.000Z",
      }]),
    }),
  })
  const output = { parts: [{ type: "text" as const, text: visiblePrompt }] }

  await hooks["chat.message"]?.({ sessionID: "session" }, output as never)

  assert.equal(output.parts[0].text, "Use bd:issue-one ")
  assert.match((output.parts[1] as { text: string }).text, /title: First issue/)
})
