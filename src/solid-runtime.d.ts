declare module "solid-js/dist/solid.js" {
  export type Accessor<T> = () => T
  export type Setter<T> = (value: T | ((previous: T) => T)) => T

  export function createEffect(fn: () => void): void
  export function createSignal<T>(value: T): [Accessor<T>, Setter<T>]
  export function onCleanup(fn: () => void): void
}
