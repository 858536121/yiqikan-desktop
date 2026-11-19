export interface SiteEntryTrial {
  id: number;
  url: string;
  readySelector: string;
  timeoutMs?: number;
}

export const SITE_ENTRY_TRIAL_TIMEOUT_MS = 9000;

export function siteEntryTrialScript(trial: SiteEntryTrial): string {
  return `(function () {
    if (window !== window.top || location.href !== ${JSON.stringify(trial.url)}) return;
    const deadline = Date.now() + ${trial.timeoutMs ?? SITE_ENTRY_TRIAL_TIMEOUT_MS};
    const poll = setInterval(function () {
      if (Date.now() >= deadline || location.href !== ${JSON.stringify(trial.url)}) {
        clearInterval(poll);
        return;
      }
      const input = document.querySelector(${JSON.stringify(trial.readySelector)});
      if (!input || input.disabled || input.readOnly || !input.getClientRects().length
        || getComputedStyle(input).visibility !== 'visible') return;
      clearInterval(poll);
      window.ReactNativeWebView?.postMessage(JSON.stringify({
        type: 'SITE_ENTRY_READY', trialId: ${trial.id}, pageUrl: location.href,
      }));
    }, 100);
  })(); true;`;
}
