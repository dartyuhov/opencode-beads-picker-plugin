import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiHostSlotMap,
  TuiPromptInfo,
  TuiPromptRef,
  TuiTheme,
} from "@opencode-ai/plugin/tui"
import type { BoxRenderable, TextRenderable } from "@opentui/core"
import { createEffect, createSignal, onCleanup } from "solid-js/dist/solid.js"
import { beadsAttachmentMime, beadsAttachmentUrl, beadsDisplay, createBeadsDiscovery, createEditorState, createPickerController, reduceEditor, type BeadsDiscovery, type BeadsIssue, type EditorAction, type EditorState, type PickerController } from "./shared/index.js"

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
  const selectedBeads = new Set<string>()
  const selectedIssues = new Map<string, BeadsIssue>()
  const sessionID = "session_id" in props.slot ? props.slot.session_id : undefined
  const discovery = props.discovery ?? createBeadsDiscovery({
    directory: props.api.state.path.directory,
    worktree: props.api.state.path.worktree,
  })
  const picker = createPickerController("", {
    discovery,
    onSelect: ({ issue }) => {
      selectedBeads.add(issue.id)
      selectedIssues.set(issue.id, issue)
    },
  })
  const [pickerVersion, setPickerVersion] = createSignal(0)
  const visible = () => !(("visible" in props.slot) && props.slot.visible === false)
  const disabled = () => "disabled" in props.slot && Boolean(props.slot.disabled)
  const blocked = () => disabled()
  const pickerState = () => {
    pickerVersion()
    return picker.state
  }
  const pickerOpen = () => pickerState().open
  const pickerLoading = () => pickerState().loading
  const pickerResults = () => pickerState().results

  onCleanup(picker.subscribe(() => {
    setPickerVersion((version) => version + 1)
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
    const current = prompt.current
    rememberSelectedBeads(current.parts)
    const input = current.input
    pruneSelectedBeads(input)
    const cursor = promptCursor(input)
    if (picker.editor.text === input && picker.editor.cursor === cursor) return
    picker.dispatch({ type: "set-text", text: input, cursor })
  }

  function applyPickerSelection() {
    if (!prompt || prompt.current.input === picker.editor.text) return
    const current = prompt.current
    prompt.set({
      ...current,
      input: picker.editor.text,
      parts: promptParts(picker.editor.text, current.parts),
    })
  }

  function promptCursor(input: string) {
    const editor = props.api.renderer?.currentFocusedEditor
    if (!editor || editor.isDestroyed) return input.length
    return Math.max(0, Math.min(editor.cursorOffset, input.length))
  }

  function pruneSelectedBeads(input: string) {
    for (const id of selectedBeads) {
      if (input.includes(beadsDisplay(id))) continue
      selectedBeads.delete(id)
      selectedIssues.delete(id)
    }
  }

  function rememberSelectedBeads(parts: TuiPromptInfo["parts"]) {
    for (const part of parts) {
      if (part.type !== "file" || !part.source?.text) continue
      const id = beadsID(part.source.text.value)
      if (id) selectedBeads.add(id)
    }
  }

  function promptParts(input: string, current: TuiPromptInfo["parts"]): TuiPromptInfo["parts"] {
    const existing = new Map<string, Extract<TuiPromptInfo["parts"][number], { type: "file" }>>()
    const parts = current.filter((part) => {
      if (part.type === "file" && part.source?.text) {
        const id = beadsID(part.source.text.value)
        if (id) {
          existing.set(id, part)
          return false
        }
      }
      if (part.type !== "text" || !part.source?.text) return true
      return !beadsID(part.source.text.value)
    })
    const beads: TuiPromptInfo["parts"] = []
    const pattern = /\[Beads:([^\]\s]+)\]/gu
    const seen = new Set<string>()
    let match: RegExpExecArray | null
    while ((match = pattern.exec(input))) {
      const id = match[1]
      if (!id || !selectedBeads.has(id) || seen.has(id)) continue
      seen.add(id)
      const value = match[0]
      const start = match.index
      const end = start + value.length
      const issue = selectedIssues.get(id)
      const previous = existing.get(id)
      if (issue) {
        beads.push({
          type: "file",
          mime: beadsAttachmentMime,
          filename: value,
          url: beadsAttachmentUrl(issue),
          source: {
            type: "file",
            path: value,
            text: { start, end, value },
          },
        })
      } else if (previous) {
        beads.push({
          ...previous,
          source: previous.source ? { ...previous.source, text: { ...previous.source.text, start, end, value } } : undefined,
        })
      }
    }
    return [...parts, ...beads]
  }

  function beadsID(value: string | undefined): string | undefined {
    const match = value ? /^\[Beads:([^\]\s]+)\]$/u.exec(value) : undefined
    return match?.[1]
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
      if (key === "Enter" || key === "Tab") applyPickerSelection()
    },
    { priority: 20_000 },
  )
  onCleanup(removeKeyIntercept)

  const removeAfterIntercept = props.api.keymap.intercept(
    "key:after",
    (ctx) => {
      if (ctx.event.eventType === "release" || !prompt?.focused) return
      setTimeout(syncPrompt, 0)
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
      <PickerView picker={picker} version={pickerVersion} colors={colors} blocked={blocked} onSelect={applyPickerSelection} />
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
    </>
  )
}

type PickerViewProps = {
  picker: PickerController
  version: () => number
  colors: TuiTheme["current"]
  blocked: () => boolean
  onSelect(): void
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
          onSelect={props.onSelect}
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
  onSelect(): void
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
        props.onSelect()
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
