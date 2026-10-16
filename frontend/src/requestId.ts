// LAN HTTP pages expose getRandomValues, while randomUUID requires a secure context.
export function ensureRandomUUID(provider: Pick<Crypto, 'getRandomValues'> & { randomUUID?: Crypto['randomUUID'] } = globalThis.crypto) {
  if (provider.randomUUID) return
  provider.randomUUID = () => {
    const bytes = provider.getRandomValues(new Uint8Array(16))
    bytes[6] = (bytes[6] & 15) | 64
    bytes[8] = (bytes[8] & 63) | 128
    const hex = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }
}
