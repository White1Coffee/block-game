import { networkInterfaces, type NetworkInterfaceInfo } from "node:os";
import { isIP } from "node:net";
type Interfaces = Record<string, NetworkInterfaceInfo[] | undefined>;
function normalize(address: string) {
  const value = address.toLowerCase().split("%")[0];
  if (!isIP(value)) return "";
  if (value.startsWith("::ffff:") && isIP(value.slice(7)) === 4)
    return value.slice(7);
  if (isIP(value) === 6) {
    const canonical = new URL(`http://[${value}]/`).hostname.slice(1, -1);
    const mapped = canonical.match(/^::ffff:([a-f0-9]+):([a-f0-9]+)$/);
    if (mapped) {
      const high = parseInt(mapped[1], 16),
        low = parseInt(mapped[2], 16);
      return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
    }
    return canonical;
  }
  return value;
}
/** Only the real TCP peer is classified. HTTP headers and claimed player identity are irrelevant. */
export function isHostAddress(
  address: string | undefined,
  interfaces: Interfaces = networkInterfaces(),
) {
  if (!address) return false;
  const peer = normalize(address);
  if (!peer) return false;
  if (peer === "::1" || (isIP(peer) === 4 && peer.startsWith("127.")))
    return true;
  return Object.values(interfaces).some((entries) =>
    entries?.some((entry) => normalize(entry.address) === peer),
  );
}
