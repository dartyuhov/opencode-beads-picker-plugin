import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiHostSlotMap,
  TuiPromptRef,
  TuiTheme,
} from "@opencode-ai/plugin/tui"
import type { BoxRenderable, TextRenderable } from "@opentui/core"
import { createEffect, createSignal, onCleanup } from "solid-js/dist/solid.js"
import { createBeadsDiscovery, createEditorState, createPickerController, reduceEditor, type BeadsDiscovery, type EditorAction, type EditorState, type PickerController } from "./shared/index.js"

export type PromptReplacement = {
  slot: "session_prompt" | "home_prompt"
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
  slot: TuiHostSlotMap["home_prompt"] | TuiHostSlotMap["session_prompt"]
  discovery?: BeadsDiscovery
}

export function PromptEditor(props: PromptEditorProps) {
  let prompt: TuiPromptRef | undefined
  const [busy, setBusy] = createSignal(false)
  const sessionID = "session_id" in props.slot ? props.slot.session_id : undefined
  const discovery = props.discovery ?? createBeadsDiscovery({
    directory: props.api.state.path.directory,
    worktree: props.api.state.path.worktree,
  })
  const picker = createPickerController("", { discovery })
  const [pickerVersion, setPickerVersion] = createSignal(0)
  const visible = () => !(("visible" in props.slot) && props.slot.visible === false)
  const disabled = () => "disabled" in props.slot && Boolean(props.slot.disabled)
  const blocked = () => disabled() || busy()
  const pickerState = () => {
    pickerVersion()
    return picker.state
  }
  const pickerOpen = () => pickerState().open
  const pickerLoading = () => pickerState().loading
  const pickerResults = () => pickerState().results

  const status = sessionID ? props.api.state.session.status(sessionID) : undefined
  setBusy(status?.type !== undefined && status.type !== "idle")

  const unlisten = props.api.event.on("session.status", (event) => {
    if (!sessionID || event.properties.sessionID !== sessionID) return
    setBusy(event.properties.status.type !== "idle")
  })
  onCleanup(unlisten)
  onCleanup(picker.subscribe(() => {
    setPickerVersion((version) => version + 1)
    syncPromptFromPicker()
  }))
  onCleanup(() => picker.dispose())

  function focusPrompt() {
    if (!prompt) return
    if (!visible() || blocked() || props.api.ui.dialog.open) {
      prompt.blur()
      return
    }
    prompt.focus()
  }

  function handleSubmit() {
    queueMicrotask(() => {
      syncPrompt()
      picker.close()
      if ("on_submit" in props.slot) props.slot.on_submit?.()
    })
  }

  function syncPrompt() {
    if (!prompt) return
    const input = prompt.current.input
    if (picker.editor.text === input && picker.editor.cursor === input.length) return
    picker.dispatch({ type: "set-text", text: input, cursor: input.length })
  }

  function syncPromptFromPicker() {
    if (!prompt || prompt.current.input === picker.editor.text) return
    const current = prompt.current
    prompt.set({ ...current, input: picker.editor.text })
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
      case "enter":
      case "kpenter":
        return "Enter"
      case "tab":
        return "Tab"
      case "escape":
        return "Escape"
      default:
        return undefined
    }
  }

  const removeKeyIntercept = props.api.keymap.intercept(
    "key",
    (ctx) => {
      if (ctx.event.eventType === "release" || !prompt?.focused || blocked() || !pickerOpen()) return
      if (ctx.event.ctrl || ctx.event.shift || ctx.event.meta || ctx.event.super || ctx.event.hyper) return
      const key = pickerKey(ctx.event.name)
      if (!key) return
      if ((key === "Enter" || key === "Tab") && (pickerLoading() || pickerResults().length === 0)) return
      ctx.consume()
      picker.interact({ type: "key", key })
    },
    { priority: 10_000 },
  )
  onCleanup(removeKeyIntercept)

  const removeAfterIntercept = props.api.keymap.intercept(
    "key:after",
    (ctx) => {
      if (ctx.event.eventType === "release" || !prompt?.focused) return
      queueMicrotask(syncPrompt)
    },
    { priority: -10_000 },
  )
  onCleanup(removeAfterIntercept)

  createEffect(() => {
    if (!visible() || blocked()) picker.close()
    props.api.ui.dialog.open
    focusPrompt()
  })

  const colors = props.theme.current
  const Prompt = props.api.ui.Prompt
  const Slot = props.api.ui.Slot
  const placeholders = sessionID
    ? undefined
    : {
        normal: ["Fix a TODO in the codebase", "What is the tech stack of this project?", "Fix broken tests"],
        shell: ["ls -la", "git status", "pwd"],
      }

  return (
    <>
      <Prompt
        sessionID={sessionID}
        visible={visible()}
        disabled={blocked()}
        onSubmit={handleSubmit}
        right={sessionID ? <Slot name="session_prompt_right" session_id={sessionID} /> : <Slot name="home_prompt_right" />}
        placeholders={placeholders}
        ref={(value: TuiPromptRef | undefined) => {
          prompt = value
          props.slot.ref?.(value)
          if (value) {
            syncPrompt()
            focusPrompt()
          }
        }}
      />
      <PickerView picker={picker} version={pickerVersion} colors={colors} blocked={blocked} />
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
  if (api.plugins?.list?.().some((plugin) => plugin.source !== "internal" && plugin.enabled && plugin.id !== "opencode-beads-plugin")) return

  api.slots.register({
    slots: {
      session_prompt(ctx, props) {
        return <PromptEditor api={api} theme={ctx.theme} slot={props} />
      },
      home_prompt(ctx, props) {
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
