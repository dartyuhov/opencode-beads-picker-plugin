/** @jsxImportSource @opentui/solid */
import test from "node:test"
import assert from "node:assert/strict"
import { testRender } from "@opentui/solid"
import type { TuiHostSlotMap, TuiPluginApi, TuiPromptInfo, TuiPromptProps, TuiPromptRef, TuiTheme } from "@opencode-ai/plugin/tui"
import type { TextareaRenderable } from "@opentui/core"
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

type PromptKeyEvent = Parameters<NonNullable<TextareaRenderable["onKeyDown"]>>[0]
type PromptSlot = TuiHostSlotMap["home_prompt"] | TuiHostSlotMap["session_prompt"]

function createNativePromptApi(onSubmit: (prompt: TuiPromptInfo) => void, status: "idle" | "busy" = "idle") {
  let submittedPrompt: TuiPromptInfo | undefined
  let submitCount = 0
  let promptVisible: boolean | undefined
  let promptText = ""
  let promptParts: TuiPromptInfo["parts"] = []
  const interceptors: {
    key: Array<(ctx: { event: PromptKeyEvent; consume(): void }) => void>
    "key:after": Array<(ctx: { event: PromptKeyEvent }) => void>
  } = { key: [], "key:after": [] }
  const statusListeners: Array<(event: { properties: { sessionID: string; status: { type: "idle" | "busy" } } }) => void> = []

  const Prompt = (props: TuiPromptProps) => {
    promptVisible = props.visible
    let input: TextareaRenderable | undefined
    const promptRef: TuiPromptRef = {
      get focused() {
        return input?.focused ?? false
      },
      get current() {
        return { input: promptText, parts: promptParts }
      },
      set(prompt) {
        promptText = prompt.input
        promptParts = prompt.parts
        input?.setText(prompt.input)
        input?.gotoBufferEnd()
      },
      reset() {
        promptText = ""
        promptParts = []
        input?.clear()
      },
      blur() {
        input?.blur()
      },
      focus() {
        input?.focus()
      },
      submit() {
        submit()
      },
    }

    function syncInput() {
      if (input) promptText = input.plainText
    }

    function submit() {
      syncInput()
      if (props.disabled || !input || !promptText) return
      submittedPrompt = { input: promptText, parts: promptParts }
      submitCount++
      promptText = ""
      promptParts = []
      input.clear()
      props.onSubmit?.()
      onSubmit(submittedPrompt)
    }

    function intercept(name: "key" | "key:after", event: PromptKeyEvent) {
      let consumed = false
      const context = {
        event,
        consume() {
          consumed = true
          event.preventDefault()
          event.stopPropagation()
        },
      }
      for (const handler of interceptors[name]) handler(context)
      return consumed
    }

    return (
      <textarea
        visible={props.visible !== false}
        placeholder="Ask anything..."
        onKeyDown={(event) => {
          const consumed = intercept("key", event)
          if (!consumed && props.disabled) {
            event.preventDefault()
          } else if (!consumed && event.name === "return") {
            event.preventDefault()
            if (event.shift || event.ctrl || event.meta) input?.insertText("\n")
            else submit()
          }
          queueMicrotask(() => intercept("key:after", event))
        }}
        onContentChange={syncInput}
        onSubmit={submit}
        ref={(value: TextareaRenderable) => {
          input = value
          props.ref?.(promptRef)
          promptRef.focus()
        }}
      />
    )
  }

  const api = {
    state: { path: { directory: "/repo", worktree: "/repo" }, session: { status: () => ({ type: status }) } },
    event: {
      on(name: string, listener: (event: unknown) => void) {
        if (name !== "session.status") return () => {}
        statusListeners.push(listener as never)
        return () => {
          const index = statusListeners.indexOf(listener as never)
          if (index >= 0) statusListeners.splice(index, 1)
        }
      },
    },
    keymap: {
      intercept(name: "key" | "key:after", handler: (ctx: never) => void) {
        interceptors[name].push(handler as never)
        return () => {
          const index = interceptors[name].indexOf(handler as never)
          if (index >= 0) interceptors[name].splice(index, 1)
        }
      },
    },
    ui: { dialog: { open: false }, Prompt, Slot: () => <box /> },
  } as unknown as TuiPluginApi

  return {
    api,
    get submittedPrompt() {
      return submittedPrompt
    },
    get submitCount() {
      return submitCount
    },
    get promptVisible() {
      return promptVisible
    },
    emitSessionStatus(sessionID: string, nextStatus: "idle" | "busy") {
      for (const listener of statusListeners) listener({ properties: { sessionID, status: { type: nextStatus } } })
    },
  }
}

function renderPrompt(api: TuiPluginApi, promptSlot: PromptSlot, themeValue = theme, discovery?: BeadsDiscovery) {
  return testRender(
    () => <PromptEditor api={api} theme={themeValue} slot={promptSlot} discovery={discovery} />,
    { width: 60, height: 10, kittyKeyboard: true },
  )
}

function discoveryFor(search: (query: string) => BeadsIssue[] | Promise<BeadsIssue[]>): BeadsDiscovery {
  return {
    search: async (query) => search(query),
    resolve: async (ids) => {
      const issues = await search("")
      return issues.filter((issue) => ids.includes(issue.id))
    },
  }
}

function slot(disabled = false): TuiHostSlotMap["session_prompt"] {
  return {
    session_id: "session-1",
    visible: true,
    disabled,
  }
}

function homeSlot(): TuiHostSlotMap["home_prompt"] {
  return {}
}

test(
  "native prompt stays visible and submits through its public ref",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    let submitted = 0
    let slotSubmitted = 0
    const native = createNativePromptApi(() => {
      submitted++
    })
    const setup = await renderPrompt(native.api, {
      ...slot(),
      on_submit: () => {
        slotSubmitted++
      },
      ref: (value) => (customPrompt = value),
    })

    await setup.flush()
    assert.equal(native.promptVisible, true)
    assert.equal((setup.captureCharFrame().match(/Ask anything\.\.\./g) ?? []).length, 1)
    await setup.mockInput.typeText("send")
    await setup.flush()

    assert.equal(customPrompt?.current.input, "send")

    setup.mockInput.pressEnter()
    await setup.flush()

    assert.equal(native.submittedPrompt?.input, "send")
    assert.equal(native.submitCount, 1)
    assert.equal(slotSubmitted, 1)
    assert.equal(submitted, 1)
    assert.equal(customPrompt?.current.input, "")
    setup.renderer.destroy()
  },
)

test(
  "native prompt accepts typing after a submitted conversation returns idle",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const native = createNativePromptApi(() => {})
    const setup = await renderPrompt(native.api, {
      ...slot(),
      on_submit: () => {},
      ref: (value) => (customPrompt = value),
    })

    await setup.flush()
    await setup.mockInput.typeText("first")
    setup.mockInput.pressEnter()
    await setup.flush()
    native.emitSessionStatus("session-1", "busy")
    native.emitSessionStatus("session-1", "idle")
    await setup.flush()
    await setup.mockInput.typeText("second")
    await setup.flush()

    assert.equal(customPrompt?.current.input, "second")
    setup.renderer.destroy()
  },
)

test(
  "native prompt blocks keyboard input while disabled",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const native = createNativePromptApi(() => {})
    const setup = await renderPrompt(native.api, { ...slot(true), ref: (value) => (customPrompt = value) })

    await setup.flush()
    await setup.mockInput.typeText("blocked")
    await setup.flush()

    assert.equal(customPrompt?.current.input, "")
    assert.equal(native.submitCount, 0)
    setup.renderer.destroy()
  },
)

test(
  "native prompt accepts keyboard input while session is loading",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const native = createNativePromptApi(() => {}, "busy")
    const setup = await renderPrompt(native.api, { ...slot(), ref: (value) => (customPrompt = value) })

    await setup.flush()
    await setup.mockInput.typeText("blocked")
    await setup.flush()

    assert.equal(customPrompt?.current.input, "blocked")
    setup.renderer.destroy()
  },
)

test(
  "native prompt preserves multiline cursor editing and paste",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const native = createNativePromptApi(() => {})
    const setup = await renderPrompt(native.api, { ...slot(), ref: (value) => (customPrompt = value) })

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
    const native = createNativePromptApi(() => {})
    const first: BeadsIssue = { id: "issue-one", title: "First issue", status: "open", priority: "P1" }
    const second: BeadsIssue = { id: "issue-two", title: "Second issue", status: "open", priority: 2 }
    const setup = await renderPrompt(
      native.api,
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
    assert.ok(frame.indexOf("issue-one") < frame.indexOf("before bd:first after bd:"))

    setup.mockInput.pressArrow("down")
    await setup.flush()
    setup.mockInput.pressEnter()
    await setup.flush()

    assert.equal(customPrompt?.current.input, "before bd:first after [Beads:issue-two] ")
    const selectedPart = customPrompt?.current.parts[0]
    assert.deepEqual(selectedPart?.type, "file")
    assert.deepEqual(selectedPart?.mime, "application/pdf")
    assert.deepEqual(selectedPart?.filename, "[Beads:issue-two]")
    assert.match(selectedPart?.url ?? "", /^data:application\/pdf;base64,/u)
    assert.deepEqual(selectedPart?.source, {
      type: "file",
      path: "[Beads:issue-two]",
      text: { start: 22, end: 39, value: "[Beads:issue-two]" },
    })
    assert.match(Buffer.from((selectedPart?.url ?? "").slice((selectedPart?.url ?? "").indexOf(",") + 1), "base64").toString("utf8"), /title: Second issue/)
    const tokenSpan = setup.captureSpans().lines
      .flatMap((line) => line.spans)
      .find((span) => span.text.includes("[Beads:issue-two]"))
    assert.ok(tokenSpan)
    assert.notDeepEqual(tokenSpan.bg, theme.current.backgroundElement)
    assert.doesNotMatch(setup.captureCharFrame(), /Second issue/)
    setup.renderer.destroy()
  },
)

test(
  "live picker searches immediately after typing the bd prefix",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    const queries: string[] = []
    const native = createNativePromptApi(() => {})
    const setup = await renderPrompt(native.api, { ...slot() }, theme, discoveryFor((query) => {
      queries.push(query)
      return [{ id: "issue-one", title: "First issue", status: "open", priority: "P1" }]
    }))

    await setup.flush()
    await setup.mockInput.typeText("b")
    await setup.flush()
    await setup.mockInput.typeText("d")
    await setup.flush()
    await setup.mockInput.typeText(":")
    await new Promise((resolve) => setTimeout(resolve, 180))
    await setup.flush()

    assert.equal(queries[queries.length - 1], "")
    assert.match(setup.captureCharFrame(), /issue-one/)
    setup.renderer.destroy()
  },
)

test(
  "live picker shows no matching items and dismisses without changing prompt",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const native = createNativePromptApi(() => {})
    const setup = await renderPrompt(
      native.api,
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
  "picker navigation keys stay native when picker is closed and are consumed when open",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const native = createNativePromptApi(() => {})
    const issue: BeadsIssue = { id: "issue-one", title: "First issue", status: "open", priority: "P1" }
    const setup = await renderPrompt(
      native.api,
      { ...homeSlot(), ref: (value) => (customPrompt = value) },
      theme,
      discoveryFor(() => [issue]),
    )

    await setup.flush()
    await setup.mockInput.typeText("ab")
    setup.mockInput.pressArrow("left")
    await setup.mockInput.typeText("X")
    await setup.flush()
    assert.equal(customPrompt?.current.input, "aXb")

    customPrompt?.reset()
    await setup.flush()
    await setup.mockInput.typeText("bd:")
    await new Promise((resolve) => setTimeout(resolve, 180))
    await setup.flush()
    setup.mockInput.pressArrow("down")
    await setup.mockInput.pressEnter()
    await setup.flush()

    assert.equal(customPrompt?.current.input, "[Beads:issue-one] ")
    setup.renderer.destroy()
  },
)

test(
  "live picker browses bare references and selects with the mouse",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const queries: string[] = []
    const native = createNativePromptApi(() => {})
    const first: BeadsIssue = { id: "issue-one", title: "First issue", status: "open", priority: "P1" }
    const second: BeadsIssue = { id: "issue-two", title: "Second issue", status: "open", priority: 2 }
    const setup = await renderPrompt(
      native.api,
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

    assert.equal(queries[queries.length - 1], "")
    await setup.mockMouse.click(5, 1)
    await setup.flush()

    assert.equal(customPrompt?.current.input, "Use [Beads:issue-two] ")
    setup.renderer.destroy()
  },
)

test(
  "live picker uses end-of-input reference through the public prompt ref",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const queries: string[] = []
    const native = createNativePromptApi(() => {})
    const first: BeadsIssue = { id: "issue-one", title: "First issue", status: "open", priority: "P1" }
    const second: BeadsIssue = { id: "issue-two", title: "Second issue", status: "open", priority: 2 }
    const setup = await renderPrompt(
      native.api,
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
    assert.equal(queries[queries.length - 1], "two")

    setup.mockInput.pressEnter()
    await setup.flush()
    assert.equal(customPrompt?.current.input, "bd:one and [Beads:issue-two] ")
    setup.renderer.destroy()
  },
)

test(
  "live picker selects the active result with Tab",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const native = createNativePromptApi(() => {})
    const issue: BeadsIssue = { id: "issue-one", title: "First issue", status: "open", priority: "P1" }
    const setup = await renderPrompt(
      native.api,
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

    assert.equal(customPrompt?.current.input, "Use [Beads:issue-one] ")
    setup.renderer.destroy()
  },
)

test(
  "Beads issue search failure leaves prompt submission usable",
  { skip: process.versions.bun ? false : "OpenTUI native smoke test requires Bun" },
  async () => {
    let customPrompt: TuiPromptRef | undefined
    const native = createNativePromptApi(() => {})
    const setup = await renderPrompt(
      native.api,
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
    setup.mockInput.pressArrow("left")
    await setup.mockInput.typeText("X")
    await setup.flush()
    assert.equal(customPrompt?.current.input, "send bd:missinXg")
    setup.mockInput.pressEnter()
    await setup.flush()

    assert.equal(native.submitCount, 1)
    assert.equal(customPrompt?.current.input, "")
    setup.renderer.destroy()
  },
)
