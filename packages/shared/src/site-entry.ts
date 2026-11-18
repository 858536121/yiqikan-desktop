export interface CardEntryRule {
  schemaVersion: 1;
  enabled: boolean;
  directUrl: string;
  readySelector: string;
  timeoutMs: number;
}

export function supportsCardEntryRule(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname === 'kanju.ai'
      && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}

export function isCardEntryRule(value: unknown): value is CardEntryRule {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const rule = value as Record<string, unknown>;
  const fields = ['schemaVersion', 'enabled', 'directUrl', 'readySelector', 'timeoutMs'];
  if (Object.keys(rule).length !== fields.length || !fields.every(key => Object.hasOwn(rule, key))
    || rule.schemaVersion !== 1 || typeof rule.enabled !== 'boolean' || typeof rule.directUrl !== 'string'
    || typeof rule.readySelector !== 'string' || typeof rule.timeoutMs !== 'number'
    || !Number.isInteger(rule.timeoutMs) || rule.timeoutMs < 3000 || rule.timeoutMs > 20000) return false;
  // Entry readiness only needs a named input, with optional class or ID tokens.
  if (!/^(textarea|input)([.#][A-Za-z_][A-Za-z0-9_-]*)*$/.test(rule.readySelector) || rule.readySelector.length > 160) return false;
  try {
    const url = new URL(rule.directUrl);
    return url.protocol === 'https:' && /^kanju[0-9]{1,6}\.com$/.test(url.hostname)
      && !url.username && !url.password && !url.port && url.pathname === '/' && !url.search && !url.hash;
  } catch { return false; }
}

export const DEFAULT_CARD_ENTRY_RULE: CardEntryRule = {
  schemaVersion: 1,
  enabled: false,
  directUrl: 'https://kanju99.com/',
  readySelector: 'textarea.movie-composer-text-input',
  timeoutMs: 9000,
};
