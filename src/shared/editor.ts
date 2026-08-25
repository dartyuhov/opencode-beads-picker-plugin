import { activeReference, replaceReference, type BeadsReference } from "./references.js"

export type EditorState = {
  text: string
  cursor: number
  disabled: boolean
  loading: boolean
}

export type EditorAction =
  | { type: "insert"; value: string }
  | { type: "backspace" }
  | { type: "delete" }
  | { type: "move"; offset: number }
  | { type: "set-cursor"; cursor: number }
  | { type: "set-text"; text: string; cursor?: number }
  | { type: "set-disabled"; disabled: boolean }
  | { type: "set-loading"; loading: boolean }
  | { type: "select"; id: string }

export function createEditorState(text = "", cursor = text.length): EditorState {
  return {
    text,
    cursor: clamp(cursor, 0, text.length),
    disabled: false,
    loading: false,
  }
}

export function editorReference(state: EditorState): BeadsReference | null {
  return activeReference(state.text, state.cursor)
}

export function reduceEditor(state: EditorState, action: EditorAction): EditorState {
  if (state.disabled && action.type !== "set-disabled" && action.type !== "set-loading") return state

  switch (action.type) {
    case "insert": {
      const text = state.text.slice(0, state.cursor) + action.value + state.text.slice(state.cursor)
      return { ...state, text, cursor: state.cursor + action.value.length }
    }
    case "backspace":
      if (state.cursor === 0) return state
      return {
        ...state,
        text: state.text.slice(0, state.cursor - 1) + state.text.slice(state.cursor),
        cursor: state.cursor - 1,
      }
    case "delete":
      if (state.cursor >= state.text.length) return state
      return {
        ...state,
        text: state.text.slice(0, state.cursor) + state.text.slice(state.cursor + 1),
      }
    case "move":
      return { ...state, cursor: clamp(state.cursor + action.offset, 0, state.text.length) }
    case "set-cursor":
      return { ...state, cursor: clamp(action.cursor, 0, state.text.length) }
    case "set-text":
      return {
        ...state,
        text: action.text,
        cursor: clamp(action.cursor ?? action.text.length, 0, action.text.length),
      }
    case "set-disabled":
      return { ...state, disabled: action.disabled }
    case "set-loading":
      return { ...state, loading: action.loading }
    case "select": {
      const reference = editorReference(state)
      return reference ? { ...state, ...replaceReference(state.text, reference, action.id) } : state
    }
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}
