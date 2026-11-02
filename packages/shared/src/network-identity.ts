// Server-only: keep this module out of browser and React Native entry points.
import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

type NetworkHeaders = { get(name: string): string | null };

export function normalizeClientIp(value: string): string | null {
  const ip = value.trim();
  if (!isIP(ip) || ip.includes('%')) return null;
  if (isIP(ip) === 4) return ip;
  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1).toLowerCase();
  const mapped = canonical.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1], 16), low = parseInt(mapped[2], 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}

export function trustedClientIp(headers: NetworkHeaders, secret = process.env.YIQIKAN_ADMIN_PROXY_SECRET): string | null {
  const supplied = Buffer.from(headers.get('x-yiqikan-proxy-key') ?? '');
  const expected = Buffer.from(secret ?? '');
  if (!secret || secret.length < 32 || expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  return normalizeClientIp(headers.get('x-yiqikan-client-ip') ?? '');
}

/** Web enrollment and legacy sockets must spend the same source quota.
 * IPv6 privacy addresses within a /64 share a bucket. Unauthenticated forwarded
 * headers never choose a bucket; direct sockets fall back to their actual peer.
 */
export function clientNetworkKey(headers: NetworkHeaders, peer?: string, secret = process.env.YIQIKAN_ADMIN_PROXY_SECRET): string {
  let network = trustedClientIp(headers, secret) ?? normalizeClientIp(peer ?? '') ?? 'unverified';
  if (isIP(network) === 6) {
    const [left, right] = network.split('::');
    const start = left ? left.split(':') : [];
    const end = right ? right.split(':') : [];
    const groups = right === undefined ? start : [...start, ...Array(8 - start.length - end.length).fill('0'), ...end];
    network = `${groups.slice(0, 4).map(group => parseInt(group, 16).toString(16)).join(':')}::/64`;
  }
  return createHash('sha256').update(`client-network:${network}`).digest('hex');
}
