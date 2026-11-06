import { isIP } from 'node:net';

// A copy of `isForbiddenIp` from the backend (src/utils/assert-public-webhook-url.ts):
// a server pointing at one of these addresses is refused with
// `server_host_not_allowed`. Only address literals are checked here — a name
// resolves differently from the user's network than from ours, and a refusal
// we cannot be sure of would block a valid apply.

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((n) => !(n >= 0 && n <= 255))) {
    return null;
  }
  return (
    ((parts[0]! << 24) >>> 0) + (parts[1]! << 16) + (parts[2]! << 8) + parts[3]!
  );
}

function inCidrV4(ip: string, base: string, prefix: number): boolean {
  const ipInt = ipv4ToInt(ip);
  const baseInt = ipv4ToInt(base);
  if (ipInt === null || baseInt === null) return false;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return (ipInt & mask) === (baseInt & mask);
}

const FORBIDDEN_V4: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['127.0.0.0', 8],
  ['10.0.0.0', 8],
  ['172.16.0.0', 12],
  ['192.168.0.0', 16],
  ['100.64.0.0', 10],
  ['169.254.0.0', 16],
];

function isForbiddenIPv4(ip: string): boolean {
  return FORBIDDEN_V4.some(([base, prefix]) => inCidrV4(ip, base, prefix));
}

function isForbiddenIPv6(ip: string): boolean {
  const s = ip.toLowerCase();
  const dotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (dotted) return isForbiddenIPv4(dotted[1]!);
  const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(s);
  if (hex) {
    const high = parseInt(hex[1]!, 16);
    const low = parseInt(hex[2]!, 16);
    return isForbiddenIPv4(
      [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.'),
    );
  }
  return (
    s === '::1' ||
    s === '::' ||
    s.startsWith('fc') ||
    s.startsWith('fd') ||
    /^fe[89ab]/.test(s)
  );
}

/** True when the host is an internal address literal the backend refuses. */
export function isForbiddenHostLiteral(rawHost: string): boolean {
  const trimmed = rawHost.trim();
  const withScheme = /^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  let host: string;
  try {
    host = new URL(withScheme).hostname.toLowerCase();
  } catch {
    return false;
  }
  host = host.replace(/^\[/, '').replace(/\]$/, '');
  const version = isIP(host);
  if (version === 4) return isForbiddenIPv4(host);
  if (version === 6) return isForbiddenIPv6(host);
  return false;
}
