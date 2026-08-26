import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiHostSlotMap,
  TuiPromptInfo,
  TuiPromptRef,
  TuiTheme,
} from "@opencode-ai/plugin/tui"
import type { BoxRenderable, KeyBinding, TextareaRenderable, TextRenderable } from "@opentui/core"
import { createEffect, createSignal, onCleanup } from "solid-js/dist/solid.js"
import { createBeadsDiscovery, createEditorState, createPickerController, reduceEditor, type BeadsDiscovery, type EditorAction, type EditorState, type PickerController } from "./shared/index.js"

export type PromptReplacement = {
  slot: "session_prompt"
  editor: EditorState
  dispatch(action: EditorAction): void
  submit(): string | null
}

export function createPromptReplacement(initialText = ""): PromptReplacement {
  let editor = createEditorState(initialText)

  return {
    slot: "session_prompt",
    get editor() {
      return editor
    },
    dispatch(action) {
      editor = reduceEditor(editor, action)
    },
    submit() {
      return editor.disabled || editor.loading ? null : editor.text
    },
  }
}

type PromptEditorProps = {
  api: TuiPluginApi
  theme: TuiTheme
  slot: TuiHostSlotMap["session_prompt"]
  discovery?: BeadsDiscovery
}

export function PromptEditor(props: PromptEditorProps) {
  let input: TextareaRenderable | undefined
  let bridge: TuiPromptRef | undefined
  let submitWhenReady = false
  let syncingFromPicker = false
  let parts: TuiPromptInfo["parts"] = []
  const [busy, setBusy] = createSignal(false)
  const editor = createPromptReplacement()
  const discovery = props.discovery ?? createBeadsDiscovery({
    directory: props.api.state.path.directory,
    worktree: props.api.state.path.worktree,
  })
  const picker = createPickerController("", { discovery })
  const [pickerVersion, setPickerVersion] = createSignal(0)
  const visible = () => props.slot.visible !== false
  const blocked = () => Boolean(props.slot.disabled) || busy()
  const pickerState = () => {
    pickerVersion()
    return picker.state
  }
  const pickerOpen = () => pickerState().open
  const pickerLoading = () => pickerState().loading
  const pickerResults = () => pickerState().results

  const status = props.api.state.session.status(props.slot.session_id)
  setBusy(status?.type !== undefined && status.type !== "idle")

  const unlisten = props.api.event.on("session.status", (event) => {
    if (event.properties.sessionID !== props.slot.session_id) return
    setBusy(event.properties.status.type !== "idle")
  })
  onCleanup(unlisten)
  onCleanup(picker.subscribe(() => {
    setPickerVersion((version) => version + 1)
    syncInputFromPicker()
  }))
  onCleanup(() => picker.dispose())

  const promptRef: TuiPromptRef = {
    get focused() {
      return input?.focused ?? false
    },
    get current() {
      return {
        input: input?.plainText ?? editor.editor.text,
        parts,
      }
    },
    set(prompt) {
      input?.setText(prompt.input)
      input?.gotoBufferEnd()
      parts = prompt.parts
      editor.dispatch({ type: "set-text", text: prompt.input, cursor: prompt.input.length })
      picker.dispatch({ type: "set-text", text: prompt.input, cursor: prompt.input.length })
    },
    reset() {
      parts = []
      input?.clear()
      editor.dispatch({ type: "set-text", text: "", cursor: 0 })
      picker.dispatch({ type: "set-text", text: "", cursor: 0 })
    },
    blur() {
      input?.blur()
    },
    focus() {
      if (visible() && !blocked()) input?.focus()
    },
    submit() {
      submit()
    },
  }

  function focusPrompt() {
    if (!input || input.isDestroyed) return
    if (!visible() || blocked() || props.api.ui.dialog.open) {
      input.blur()
      return
    }
    input.focus()
  }

  function handleBridgeSubmit() {
    if (!input || input.isDestroyed) return
    submitWhenReady = false
    parts = []
    input.clear()
    editor.dispatch({ type: "set-text", text: "", cursor: 0 })
    picker.dispatch({ type: "set-text", text: "", cursor: 0 })
    props.slot.on_submit?.()
  }

  function syncEditor() {
    if (!input || input.isDestroyed) return
    editor.dispatch({ type: "set-text", text: input.plainText, cursor: input.cursorOffset })
    if (!syncingFromPicker) picker.dispatch({ type: "set-text", text: input.plainText, cursor: input.cursorOffset })
  }

  function syncInputFromPicker() {
    if (!input || input.isDestroyed) return
    if (input.plainText === picker.editor.text && input.cursorOffset === picker.editor.cursor) return
    syncingFromPicker = true
    try {
      input.setText(picker.editor.text)
      input.cursorOffset = picker.editor.cursor
    } finally {
      syncingFromPicker = false
    }
    editor.dispatch({ type: "set-text", text: picker.editor.text, cursor: picker.editor.cursor })
  }

  function pickerKey(name: string): "ArrowUp" | "ArrowDown" | "Enter" | "Tab" | "Escape" | undefined {
    switch (name) {
      case "up":
      case "arrowup":
        return "ArrowUp"
      case "down":
      case "arrowdown":
        return "ArrowDown"
      case "return":
      case "linefeed":
        return "Enter"
      case "tab":
        return "Tab"
      case "escape":
        return "Escape"
      default:
        return undefined
    }
  }

  function handlePickerKey(event: Parameters<NonNullable<TextareaRenderable["onKeyDown"]>>[0]) {
    if (!pickerOpen()) return false
    const key = pickerKey(event.name)
    if (!key) return false
    if (key !== "Escape" && (pickerLoading() || pickerResults().length === 0)) return false
    event.preventDefault()
    picker.interact({ type: "key", key })
    return true
  }

  function submit() {
    if (!input || input.isDestroyed) return
    editor.dispatch({ type: "set-disabled", disabled: Boolean(props.slot.disabled) })
    editor.dispatch({ type: "set-loading", loading: busy() })
    syncEditor()
    const value = editor.submit()
    if (!value) return
    if (!bridge) {
      submitWhenReady = true
      return
    }
    bridge.set({ input: value, parts })
    bridge.submit()
  }

  createEffect(() => {
    editor.dispatch({ type: "set-disabled", disabled: Boolean(props.slot.disabled) })
    editor.dispatch({ type: "set-loading", loading: busy() })
    visible()
    blocked()
    props.api.ui.dialog.open
    focusPrompt()
  })

  onCleanup(() => {
    props.slot.ref?.(undefined)
  })

  const colors = props.theme.current
  const Prompt = props.api.ui.Prompt

  return (
    <>
      <box visible={visible()} width="100%" flexDirection="column">
        <box
          width="100%"
          border={["left"]}
          borderColor={colors.borderActive}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          backgroundColor={colors.backgroundElement}
        >
          <textarea
            width="100%"
            minHeight={1}
            maxHeight={6}
            textColor={colors.text}
            focusedTextColor={colors.text}
            placeholder="Ask anything..."
            placeholderColor={colors.textMuted}
            backgroundColor={colors.backgroundElement}
            focusedBackgroundColor={colors.backgroundElement}
            cursorColor={blocked() ? colors.backgroundElement : colors.text}
            keyBindings={[
              { name: "return", action: "submit" },
              { name: "return", shift: true, action: "newline" },
              { name: "return", ctrl: true, action: "newline" },
              { name: "return", meta: true, action: "newline" },
            ] satisfies KeyBinding[]}
            onContentChange={() => {
              syncEditor()
              parts = []
            }}
            onCursorChange={() => syncEditor()}
            onKeyDown={(event) => {
              if (blocked()) {
                event.preventDefault()
                return
              }
              handlePickerKey(event)
            }}
            onPaste={(event) => {
              if (blocked()) event.preventDefault()
            }}
            onSubmit={() => submit()}
            ref={(value: TextareaRenderable) => {
              input = value
              syncEditor()
              props.slot.ref?.(promptRef)
              focusPrompt()
            }}
          />
        </box>
        <PickerView picker={picker} version={pickerVersion} colors={colors} blocked={blocked} />
        <box height={1} border={["left"]} borderColor={colors.borderActive} />
      </box>
      <Prompt
        sessionID={props.slot.session_id}
        visible={false}
        disabled={blocked()}
        onSubmit={handleBridgeSubmit}
        ref={(value: TuiPromptRef | undefined) => {
          bridge = value
          if (value && submitWhenReady) {
            submitWhenReady = false
            submit()
          }
        }}
      />
    </>
  )
}

type PickerViewProps = {
  picker: PickerController
  version: () => number
  colors: TuiTheme["current"]
  blocked: () => boolean
}

function PickerView(props: PickerViewProps) {
  let container: BoxRenderable | undefined
  let loadingText: TextRenderable | undefined
  let messageText: TextRenderable | undefined
  const state = () => {
    props.version()
    return props.picker.state
  }

  function update() {
    const current = state()
    if (container && !container.isDestroyed) container.visible = current.open && !props.blocked()
    if (loadingText && !loadingText.isDestroyed) loadingText.visible = current.open && !props.blocked() && current.loading
    if (messageText && !messageText.isDestroyed) {
      messageText.visible = current.open && !props.blocked() && !current.loading && current.results.length === 0
      messageText.content = current.message ?? "No matching items"
    }
  }

  createEffect(update)

  return (
    <box
      ref={(value: BoxRenderable) => {
        container = value
        update()
      }}
      visible={false}
      width="100%"
      flexDirection="column"
      border={["left", "right"]}
      borderColor={props.colors.borderActive}
      paddingLeft={2}
      paddingRight={2}
      backgroundColor={props.colors.backgroundElement}
    >
      <text
        ref={(value: TextRenderable) => {
          loadingText = value
          update()
        }}
        visible={false}
        content="Searching Beads issues..."
        fg={props.colors.textMuted}
        bg={props.colors.backgroundElement}
      />
      <text
        ref={(value: TextRenderable) => {
          messageText = value
          update()
        }}
        visible={false}
        content="No matching items"
        fg={props.colors.textMuted}
        bg={props.colors.backgroundElement}
      />
      {Array.from({ length: 5 }, (_, index) => (
        <PickerRow
          index={index}
          picker={props.picker}
          version={props.version}
          colors={props.colors}
          blocked={props.blocked}
        />
      ))}
    </box>
  )
}

type PickerRowProps = {
  index: number
  picker: PickerController
  version: () => number
  colors: TuiTheme["current"]
  blocked: () => boolean
}

function PickerRow(props: PickerRowProps) {
  let row: BoxRenderable | undefined
  let text: TextRenderable | undefined

  function update() {
    props.version()
    const issue = props.picker.state.results[props.index]
    const selected = props.picker.state.selected === props.index
    const visible = !props.blocked() && props.picker.state.open && !props.picker.state.loading && issue !== undefined
    if (row && !row.isDestroyed) {
      row.visible = visible
      row.backgroundColor = selected ? props.colors.borderActive : props.colors.backgroundElement
    }
    if (text && !text.isDestroyed && issue) {
      const content = `${selected ? "> " : "  "}${issue.id} | ${issue.title} | ${issue.status ?? "unknown"} | ${issue.priority === undefined ? "priority unknown" : `priority ${issue.priority}`}`
      text.visible = visible
      text.content = content
      text.fg = selected ? props.colors.backgroundElement : props.colors.text
      text.bg = selected ? props.colors.borderActive : props.colors.backgroundElement
    }
  }

  createEffect(update)

  return (
    <box
      ref={(value: BoxRenderable) => {
        row = value
        update()
      }}
      width="100%"
      height={1}
      backgroundColor={props.colors.backgroundElement}
      onMouseDown={(event) => {
        if (event.button !== 0 || props.blocked()) return
        event.preventDefault()
        props.picker.interact({ type: "mouse-select", index: props.index })
      }}
    >
      <text
        ref={(value: TextRenderable) => {
          text = value
          update()
        }}
        content=""
        fg={props.colors.text}
        bg={props.colors.backgroundElement}
      />
    </box>
  )
}

export const tui: TuiPlugin = async (api) => {
  api.slots.register({
    slots: {
      session_prompt(ctx, props) {
        return <PromptEditor api={api} theme={ctx.theme} slot={props} />
      },
    },
  })
}

export const tuiPlugin: TuiPluginModule = {
  id: "opencode-beads-plugin",
  tui,
}

export default tuiPlugin
