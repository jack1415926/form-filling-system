// DRF and action endpoints may use different offsets; retain sub-millisecond precision.
export function newestResponse<T extends { updated_at: string }>(current: T | undefined, incoming: T): T {
  if (!current) return incoming
  const milliseconds = Date.parse(current.updated_at) - Date.parse(incoming.updated_at)
  const fraction = (value: string) => (value.match(/\.(\d+)/)?.[1] ?? '').padEnd(9, '0')
  const order = milliseconds || fraction(current.updated_at).localeCompare(fraction(incoming.updated_at))
  return order > 0 ? current : incoming
}
