export function createSerialSaveQueue<T>(
  save: (payload: T) => Promise<unknown>
): (payload: T) => Promise<unknown> {
  let tail = Promise.resolve()

  return (payload: T) => {
    const next = tail.then(() => save(payload))
    tail = next.then(() => undefined, () => undefined)
    return next
  }
}
