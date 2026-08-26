import { createEditorState, editorReference, reduceEditor, type EditorAction, type EditorState } from "./editor.js"
import type { BeadsDiscovery, BeadsIssue } from "./discovery.js"

export type PickerState = {
  open: boolean
  loading: boolean
  selected: number
  results: BeadsIssue[]
  message?: "No matching items"
}

export type PickerAction =
  | { type: "key"; key: "ArrowUp" | "ArrowDown" | "Enter" | "Tab" | "Escape" }
  | { type: "mouse-select"; index: number }

export type PickerOptions = {
  discovery: BeadsDiscovery
  debounceMs?: number
}

export type PickerController = {
  readonly editor: EditorState
  readonly state: PickerState
  dispatch(action: EditorAction): void
  interact(action: PickerAction): void
  subscribe(listener: () => void): () => void
  close(): void
  select(index?: number): void
  dispose(): void
}

export function createPickerController(initialText: string, options: PickerOptions): PickerController {
  let editor = createEditorState(initialText)
  let state: PickerState = { open: false, loading: false, selected: 0, results: [] }
  let timer: ReturnType<typeof setTimeout> | undefined
  let request = 0
  let disposed = false
  const listeners = new Set<() => void>()

  function notify() {
    for (const listener of listeners) listener()
  }

  function setState(next: PickerState) {
    state = next
    notify()
  }

  function cancelScheduledSearch() {
    if (timer !== undefined) {
      clearTimeout(timer)
      timer = undefined
    }
    request++
  }

  function refresh() {
    cancelScheduledSearch()
    const reference = editorReference(editor)
    if (!reference) {
      setState({ open: false, loading: false, selected: 0, results: [] })
      return
    }

    setState({ open: true, loading: true, selected: 0, results: [] })
    const currentRequest = request
    timer = setTimeout(() => {
      timer = undefined
      void Promise.resolve().then(() => options.discovery.search(reference.query)).then(
        (results) => {
          if (disposed || currentRequest !== request) return
          setState({
            open: true,
            loading: false,
            selected: 0,
            results,
            message: results.length ? undefined : "No matching items",
          })
        },
        () => {
          if (disposed || currentRequest !== request) return
          setState({ open: true, loading: false, selected: 0, results: [], message: "No matching items" })
        },
      )
    }, options.debounceMs ?? 150)
  }

  const controller: PickerController = {
    get editor() {
      return editor
    },
    get state() {
      return state
    },
    dispatch(action) {
      editor = reduceEditor(editor, action)
      if (["insert", "backspace", "delete", "move", "set-cursor", "set-text", "select"].includes(action.type)) refresh()
      else notify()
    },
    interact(action) {
      if (!state.open) return
      if (action.type === "key") {
        if (action.key === "Escape") {
          controller.close()
          return
        }
        if (action.key === "Enter" || action.key === "Tab") {
          controller.select()
          return
        }
        if (!state.results.length) return
        const offset = action.key === "ArrowUp" ? -1 : 1
        setState({ ...state, selected: (state.selected + offset + state.results.length) % state.results.length })
        return
      }
      controller.select(action.index)
    },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    close() {
      cancelScheduledSearch()
      setState({ ...state, open: false, loading: false })
    },
    select(index = state.selected) {
      const issue = state.results[index]
      if (!issue) return
      editor = reduceEditor(editor, { type: "select", id: issue.id })
      cancelScheduledSearch()
      setState({ ...state, open: false, loading: false, selected: 0 })
    },
    dispose() {
      disposed = true
      cancelScheduledSearch()
      listeners.clear()
    },
  }

  refresh()
  return controller
}
