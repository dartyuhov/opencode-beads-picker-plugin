/** @jsxImportSource @opentui/solid */
import test from "node:test"
import assert from "node:assert/strict"
import { testRender } from "@opentui/solid"
import type { TuiPluginApi, TuiPromptInfo, TuiPromptProps, TuiPromptRef, TuiTheme } from "@opencode-ai/plugin/tui"
import type { BeadsDiscovery, BeadsIssue } from "../src/shared/discovery.js"
import { PromptEditor } from "../src/tui.js"

const theme = {
  current: {
    backgroundElement: "#202020",
    borderActive: "#808080",
    text: "#ffffff",
    textMuted: "#808080",
  },
} as unknown as TuiTheme

function createApi(onBridgeSubmit: () => void, status: "idle" | "busy" = "idle") {
  let bridgePrompt: TuiPromptInfo | undefined
  let bridgeSubmitCount = 0
  let bridgeVisible: boolean | undefined

  const Prompt = (props: TuiPromptProps) => {
    bridgeVisible = props.visible
    props.ref?.({
      focused: false,
      current: { input: "", parts: [] },
      set(prompt) {
        bridgePrompt = prompt
      },
      reset() {},
      blur() {},
      focus() {},
      submit() {
        bridgeSubmitCount++
        props.onSubmit?.()
      },
    })
    return <box visible={false} />
  }

  const api = {
    state: { path: { directory: "/repo", worktree: "/repo" }, session: { status: () => ({ type: status }) } },
    event: { on: () => () => {} },
    ui: { dialog: { open: false }, Prompt },
  } as unknown as TuiPluginApi

  return {
    api,
    get bridgePrompt() {
      return bridgePrompt
    },
    get bridgeSubmitCount() {
      return bridgeSubmitCount
    },
    get bridgeVisible() {
      return bridgeVisible
    },
    onBridgeSubmit,
  }
}

function renderPrompt(api: TuiPluginApi, slot: ReturnType<typeof slot>, themeValue = theme, discovery?: BeadsDiscovery) {
  return testRender(
    () => <PromptEditor api={api} theme={themeValue} slot={slot} discovery={discovery} />,
    { width: 60, height: 10, kittyKeyboard: true },
  )
}

function discoveryFor(search: (query: string) => BeadsIssue[] | Promise<BeadsIssue[]>): BeadsDiscovery {
  return { search: async (query) => search(query) }
}

function slot(disabled = false) {
  return {
    session_id: "session-1",
    visible: true,
    disabled,
  }
}

test(
  "replacement renders one visible editor and submits through hidden public bridge",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    let submitted = 0
    const bridge = createApi(() => {
      submitted++
    })
    const setup = await renderPrompt(bridge.api, {
      ...slot(),
      on_submit: bridge.onBridgeSubmit,
      ref: (value) => (customPrompt = value),
    })

    await setup.flush()
    assert.equal(bridge.bridgeVisible, false)
    assert.equal((setup.captureCharFrame().match(/Ask anything\.\.\./g) ?? []).length, 1)
    await setup.mockInput.typeText("send")
    await setup.flush()

    assert.equal(customPrompt?.current.input, "send")

    setup.mockInput.pressEnter()
    await setup.flush()

    assert.equal(bridge.bridgePrompt?.input, "send")
    assert.equal(bridge.bridgeSubmitCount, 1)
    assert.equal(submitted, 1)
    assert.equal(customPrompt?.current.input, "")
    setup.renderer.destroy()
  },
)

test(
  "replacement blocks keyboard input while disabled",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const bridge = createApi(() => {})
    const setup = await renderPrompt(bridge.api, { ...slot(true), ref: (value) => (customPrompt = value) })

    await setup.flush()
    await setup.mockInput.typeText("blocked")
    await setup.flush()

    assert.equal(customPrompt?.current.input, "")
    assert.equal(bridge.bridgeSubmitCount, 0)
    setup.renderer.destroy()
  },
)

test(
  "replacement blocks keyboard input while session is loading",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const bridge = createApi(() => {}, "busy")
    const setup = await renderPrompt(bridge.api, { ...slot(), ref: (value) => (customPrompt = value) })

    await setup.flush()
    await setup.mockInput.typeText("blocked")
    await setup.flush()

    assert.equal(customPrompt?.current.input, "")
    setup.renderer.destroy()
  },
)

test(
  "replacement preserves multiline cursor editing and paste",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const bridge = createApi(() => {})
    const setup = await renderPrompt(bridge.api, { ...slot(), ref: (value) => (customPrompt = value) })

    await setup.flush()
    await setup.mockInput.typeText("one")
    setup.mockInput.pressEnter({ shift: true })
    await setup.mockInput.typeText("two")
    setup.mockInput.pressArrow("left")
    await setup.mockInput.pasteBracketedText(" pasted")
    await setup.flush()

    assert.equal(customPrompt?.current.input, "one\ntw pastedo")
    setup.renderer.destroy()
  },
)

test(
  "live picker renders issue metadata, navigates, and replaces only active reference",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const bridge = createApi(() => {})
    const first: BeadsIssue = { id: "issue-one", title: "First issue", status: "open", priority: "P1" }
    const second: BeadsIssue = { id: "issue-two", title: "Second issue", status: "open", priority: 2 }
    const setup = await renderPrompt(
      bridge.api,
      { ...slot(), ref: (value) => (customPrompt = value) },
      theme,
      discoveryFor(() => [first, second]),
    )

    await setup.flush()
    await setup.mockInput.typeText("before bd:first after bd:")
    await new Promise((resolve) => setTimeout(resolve, 180))
    await setup.flush()

    const frame = setup.captureCharFrame()
    assert.match(frame, /issue-one/)
    assert.match(frame, /First issue/)
    assert.match(frame, /open/)
    assert.match(frame, /P1/)
    assert.match(frame, /issue-two/)

    setup.mockInput.pressArrow("down")
    await setup.flush()
    setup.mockInput.pressEnter()
    await setup.flush()

    assert.equal(customPrompt?.current.input, "before bd:first after bd:issue-two ")
    assert.doesNotMatch(setup.captureCharFrame(), /Second issue/)
    setup.renderer.destroy()
  },
)

test(
  "live picker shows no matching items and dismisses without changing prompt",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const bridge = createApi(() => {})
    const setup = await renderPrompt(
      bridge.api,
      { ...slot(), ref: (value) => (customPrompt = value) },
      theme,
      discoveryFor(() => []),
    )

    await setup.flush()
    await setup.mockInput.typeText("keep bd:missing")
    await new Promise((resolve) => setTimeout(resolve, 180))
    await setup.flush()

    assert.match(setup.captureCharFrame(), /No matching items/)
    setup.mockInput.pressEscape()
    await setup.flush()
    assert.equal(customPrompt?.current.input, "keep bd:missing")
    assert.doesNotMatch(setup.captureCharFrame(), /No matching items/)
    setup.renderer.destroy()
  },
)

test(
  "live picker browses bare references and selects with the mouse",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const queries: string[] = []
    const bridge = createApi(() => {})
    const first: BeadsIssue = { id: "issue-one", title: "First issue", status: "open", priority: "P1" }
    const second: BeadsIssue = { id: "issue-two", title: "Second issue", status: "open", priority: 2 }
    const setup = await renderPrompt(
      bridge.api,
      { ...slot(), ref: (value) => (customPrompt = value) },
      theme,
      discoveryFor((query) => {
        queries.push(query)
        return [first, second]
      }),
    )

    await setup.flush()
    await setup.mockInput.typeText("Use bd:")
    await new Promise((resolve) => setTimeout(resolve, 180))
    await setup.flush()

    assert.deepEqual(queries.at(-1), "")
    await setup.mockMouse.click(5, 3)
    await setup.flush()

    assert.equal(customPrompt?.current.input, "Use bd:issue-two ")
    setup.renderer.destroy()
  },
)

test(
  "live picker keeps multiple references independent while cursor moves",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const queries: string[] = []
    const bridge = createApi(() => {})
    const first: BeadsIssue = { id: "issue-one", title: "First issue", status: "open", priority: "P1" }
    const second: BeadsIssue = { id: "issue-two", title: "Second issue", status: "open", priority: 2 }
    const setup = await renderPrompt(
      bridge.api,
      { ...slot(), ref: (value) => (customPrompt = value) },
      theme,
      discoveryFor((query) => {
        queries.push(query)
        return query === "one" ? [first] : [second]
      }),
    )

    await setup.flush()
    await setup.mockInput.typeText("bd:one and bd:two")
    await new Promise((resolve) => setTimeout(resolve, 180))
    await setup.flush()
    assert.equal(queries.at(-1), "two")

    for (let index = 0; index < 11; index++) setup.mockInput.pressArrow("left")
    await new Promise((resolve) => setTimeout(resolve, 180))
    await setup.flush()
    assert.equal(queries.at(-1), "one")

    setup.mockInput.pressEnter()
    await setup.flush()
    assert.equal(customPrompt?.current.input, "bd:issue-one and bd:two")
    setup.renderer.destroy()
  },
)

test(
  "live picker selects the active result with Tab",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const bridge = createApi(() => {})
    const issue: BeadsIssue = { id: "issue-one", title: "First issue", status: "open", priority: "P1" }
    const setup = await renderPrompt(
      bridge.api,
      { ...slot(), ref: (value) => (customPrompt = value) },
      theme,
      discoveryFor(() => [issue]),
    )

    await setup.flush()
    await setup.mockInput.typeText("Use bd:one")
    await new Promise((resolve) => setTimeout(resolve, 180))
    await setup.flush()
    setup.mockInput.pressTab()
    await setup.flush()

    assert.equal(customPrompt?.current.input, "Use bd:issue-one ")
    setup.renderer.destroy()
  },
)

test(
  "discovery failure leaves prompt submission usable",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const bridge = createApi(() => {})
    const setup = await renderPrompt(
      bridge.api,
      { ...slot(), ref: (value) => (customPrompt = value) },
      theme,
      discoveryFor(async () => {
        throw new Error("bd unavailable")
      }),
    )

    await setup.flush()
    await setup.mockInput.typeText("send bd:missing")
    await new Promise((resolve) => setTimeout(resolve, 180))
    await setup.flush()

    assert.match(setup.captureCharFrame(), /No matching items/)
    setup.mockInput.pressEnter()
    await setup.flush()

    assert.equal(bridge.bridgeSubmitCount, 1)
    assert.equal(customPrompt?.current.input, "")
    setup.renderer.destroy()
  },
)
