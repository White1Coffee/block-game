/** Stable byte checksum shared by Node and browsers, independent of platform endianness. */
export function chunkChecksum(bytes: Uint8Array) {
  let hash = 2166136261;
  for (const byte of bytes) hash = Math.imul(hash ^ byte, 16777619);
  return hash >>> 0;
}
