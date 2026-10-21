// 内网HTTP页面通常没有randomUUID，用getRandomValues生成同样格式的安全随机UUID。
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
