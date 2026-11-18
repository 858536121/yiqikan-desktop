// Provision ONLY an offline public key here before the first engine release.
// No development/test key is trusted by shipped clients. Neither remote JSON
// nor a website can enable this gate or introduce a trusted key.
export const SITE_RULES_ENABLED = false;
export const SITE_RULE_TRUSTED_KEYS: Readonly<Record<string, string>> = Object.freeze({});
