import { describe, it, expect } from "vitest";
import type { NetworkInterfaceInfo } from "node:os";
import { isHostAddress } from "../server/HostAddress";
const interfaces = {
  ethernet: [
    { address: "192.168.2.19" },
    { address: "fe80::a123:4567" },
  ] as NetworkInterfaceInfo[],
};
describe("host-computer admin recognition", () => {
  it.each([
    "127.0.0.1",
    "127.0.0.2",
    "::1",
    "0:0:0:0:0:0:0:1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "192.168.2.19",
    "::ffff:192.168.2.19",
    "fe80::a123:4567%12",
  ])("recognizes the host address %s", (address) =>
    expect(isHostAddress(address, interfaces)).toBe(true),
  );
  it.each([
    undefined,
    "",
    "localhost",
    "127.attacker",
    "192.168.2.20",
    "10.0.0.2",
    "::ffff:192.168.2.20",
    "203.0.113.5",
    "0.0.0.0",
    "::",
  ])("does not promote other peers or claimed host names: %s", (address) =>
    expect(isHostAddress(address, interfaces)).toBe(false),
  );
});
