import { bundledSiteRuleSnapshot } from '../../packages/shared/src/site-rules/playback-page';
import { SITE_RULES_ENABLED } from '../../packages/shared/src/site-rules/trust';

// Called only after the existing room-ancestor gate. Packaged rules must be
// installed before any SPA navigation or video observation, without worker I/O.
Object.assign(window, { __yiqikanPackagedSiteRuleSnapshot: (version: string) =>
  SITE_RULES_ENABLED ? null : bundledSiteRuleSnapshot('extension', version) });
