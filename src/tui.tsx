import type {
  TuiPlugin,
  TuiPluginApi,
  TuiPluginModule,
  TuiHostSlotMap,
  TuiPromptInfo,
  TuiPromptRef,
  TuiTheme,
} from "@opencode-ai/plugin/tui"
import type { KeyBinding, TextareaRenderable } from "@opentui/core"
import { createEffect, createSignal, onCleanup } from "solid-js"
import { createEditorState, reduceEditor, type EditorAction, type EditorState } from "./shared/index.js"

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
}

export function PromptEditor(props: PromptEditorProps) {
  let input: TextareaRenderable | undefined
  let bridge: TuiPromptRef | undefined
  let submitWhenReady = false
  let parts: TuiPromptInfo["parts"] = []
  const [busy, setBusy] = createSignal(false)
  const editor = createPromptReplacement()
  const visible = () => props.slot.visible !== false
  const blocked = () => Boolean(props.slot.disabled) || busy()

  const status = props.api.state.session.status(props.slot.session_id)
  setBusy(status?.type !== undefined && status.type !== "idle")

  const unlisten = props.api.event.on("session.status", (event) => {
    if (event.properties.sessionID !== props.slot.session_id) return
    setBusy(event.properties.status.type !== "idle")
  })
  onCleanup(unlisten)

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
    },
    reset() {
      parts = []
      input?.clear()
      editor.dispatch({ type: "set-text", text: "", cursor: 0 })
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
    props.slot.on_submit?.()
  }

  function syncEditor() {
    if (!input || input.isDestroyed) return
    editor.dispatch({ type: "set-text", text: input.plainText, cursor: input.cursorOffset })
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
              if (blocked()) event.preventDefault()
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
