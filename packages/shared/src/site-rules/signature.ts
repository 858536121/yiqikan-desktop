import { ed25519 } from '@noble/curves/ed25519.js';
import { SITE_RULE_MAX_BYTES, validateSiteRuleRelease, type SignedSiteRuleRelease, type SiteRuleRelease } from './schema';

export const SITE_RULE_SIGNATURE_DOMAIN = 'yiqikan/site-rules/v1\n';
// encodeURIComponent is available in Hermes and extension workers; verification
// needs neither Node Buffer, TextEncoder, random polyfills nor a native module.
export function siteRuleUtf8(value: string): Uint8Array {
  const encoded = encodeURIComponent(value), bytes: number[] = [];
  for (let i = 0; i < encoded.length; i++) {
    if (encoded[i] === '%') { bytes.push(parseInt(encoded.slice(i + 1, i + 3), 16)); i += 2; }
    else bytes.push(encoded.charCodeAt(i));
  }
  return Uint8Array.from(bytes);
}
function hex(value: unknown, length: number): Uint8Array | null {
  if (typeof value !== 'string' || value.length !== length * 2 || !/^[a-f0-9]+$/.test(value)) return null;
  return Uint8Array.from(value.match(/../g)!.map(s => parseInt(s, 16)));
}
export interface VerifiedSiteRuleRelease { envelope: SignedSiteRuleRelease; release: SiteRuleRelease }
export function verifySiteRuleRelease(raw: string, trustedKeys: Readonly<Record<string, string>>): VerifiedSiteRuleRelease | null {
  try {
    if (raw.length > SITE_RULE_MAX_BYTES || siteRuleUtf8(raw).length > SITE_RULE_MAX_BYTES) return null;
    const envelope = JSON.parse(raw) as SignedSiteRuleRelease;
    if (!envelope || Array.isArray(envelope) || Object.keys(envelope).length !== 4 || envelope.format !== 1
      || typeof envelope.keyId !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(envelope.keyId) || typeof envelope.payload !== 'string') return null;
    const key = Object.hasOwn(trustedKeys, envelope.keyId) ? hex(trustedKeys[envelope.keyId], 32) : null;
    const signature = hex(envelope.signature, 64);
    if (!key || !signature || !ed25519.verify(signature, siteRuleUtf8(SITE_RULE_SIGNATURE_DOMAIN + envelope.payload), key, { zip215: false })) return null;
    const release: unknown = JSON.parse(envelope.payload);
    return validateSiteRuleRelease(release) ? { envelope, release } : null;
  } catch { return null; }
}
