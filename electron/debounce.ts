export type Debounced<Args extends unknown[]> = ((...args: Args) => void) & {
  cancel: () => void
}

/**
 * Trailing-edge debounce: each call resets the wait timer, so a burst of
 * calls within `waitMs` of each other collapses into a single invocation of
 * `fn`, fired `waitMs` after the last call in the burst, with that last
 * call's arguments.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number
): Debounced<Args> {
  let timer: ReturnType<typeof setTimeout> | null = null

  const debounced = (...args: Args): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      fn(...args)
    }, waitMs)
  }

  debounced.cancel = (): void => {
    if (timer) clearTimeout(timer)
    timer = null
  }

  return debounced
}
