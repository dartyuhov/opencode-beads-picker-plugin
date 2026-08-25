/** @jsxImportSource @opentui/solid */
import test from "node:test"
import assert from "node:assert/strict"
import { testRender } from "@opentui/solid"
import type { TuiPluginApi, TuiPromptInfo, TuiPromptProps, TuiPromptRef, TuiTheme } from "@opencode-ai/plugin/tui"
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
    state: { session: { status: () => ({ type: status }) } },
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

function renderPrompt(api: TuiPluginApi, slot: ReturnType<typeof slot>, themeValue = theme) {
  return testRender(
    () => <PromptEditor api={api} theme={themeValue} slot={slot} />,
    { width: 60, height: 10, kittyKeyboard: true },
  )
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
