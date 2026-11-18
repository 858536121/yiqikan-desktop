# RoomWebView maintenance map

`components/RoomWebView.tsx` coordinates the native WebView, room state, media
transitions and message handling. Keep synchronization policy out of the JSX.

| Responsibility | Source |
| --- | --- |
| Document-start inline/fullscreen and navigation hooks | `browser/early.ts` |
| Document-end installation, discovery cadence and page lifecycle | `browser/runtime.ts` |
| DOM/platform player discovery and its small control interface | `browser/players.ts`, `browser/types.ts` |
| Playback events, host seek confirmation, follower sync and recovery | `browser/playback.ts` |
| Website fullscreen fallback | `browser/presentation.ts` |
| Typed commands and messages shared with native code | `contracts.ts` |
| JSON parsing and legacy message compatibility | `messages.ts` |
| Native fullscreen header/transport UI | `../components/room-player/PlayerHeader.tsx`, `PlayerTransport.tsx` |
| Native controls idle/gesture lifecycle and styles | `../components/room-player/usePlayerHud.ts`, `styles.ts` |

## Browser source is TypeScript, output is plain JavaScript

Edit `browser/*.ts`, never `generated/scripts.ts`. The latter is a committed,
deterministic build artifact so native imports and test imports use the same
strings. `scripts/build-webview.cjs` first runs a strict TypeScript program with
DOM libraries and no React Native/Node ambient types, then bundles the two entry
points as browser IIFEs. Both strings end with `true;` for WebView evaluation.
No React Native modules, Metro require calls, or captured native closures may
enter the browser bundle. Do not serialize a Metro-transformed function with
`toString()`.

Metro invokes this builder in its configuration, including direct `expo start`,
Gradle/Xcode bundles, `expo export`, and the existing OTA export command. It
watches browser/contract edits in local non-CI development. A failed watched edit
invalidates the generated native module with an explicit error; fixing the edit
regenerates it. A failing startup/release build throws before bundling. CI checks
also reject a stale artifact. No device compilation is needed to run the checks:

```sh
pnpm --filter mobile build:webview
pnpm --filter mobile typecheck
pnpm --filter @yiqikan/tests exec node --import tsx --test mobile-webview-build.test.mjs mobile-sync-policy.test.mjs mobile-follower-playback-sync.test.mjs mobile-review-regressions.test.mjs
```

The native Expo tsconfig excludes the browser source directory; the builder
checks that directory with `webview/tsconfig.json`. Shared contracts have no
runtime platform imports. New page messages need both a contract and a runtime
validator: `JSON.parse` and TS assertions cannot validate the bridge. Preserve
optional fields from older local/frame scripts, plus session/document and
selected-media guards. Do not confuse page-following with video-following.

The independent iframe/presentation runtime in `utils/web-player-script.ts`,
site rules, icons, shared media-context scripts and local-player HTML retain their
existing builders in this refactor. Moving those separate runtimes is a future
change, with its own cross-frame tests; do not silently rewrite them while
changing the sync controller.

## Behavioral checks

Controller unit tests import `installPlayback` directly. Integration/browser
suites import `tests/helpers/mobile-webview-scripts.mjs`, which verifies freshness
and loads the exact generated scripts. Do not restore tests that scrape
`RoomWebView.tsx` for string or function-body fragments for the browser runtime.
The remaining native callback tests still inspect production native callbacks.

When moving code, preserve document-start/end ordering, installation guards,
frame routing, programmatic event suppression, seek confirmation, source/role
invalidation, background/local-pause intent, autoplay recovery and bounded seek
budgets. Changes affecting injected playback also need actual App + original
Bilibili/Kanju video checks; local fixtures cannot prove public-site behavior.

## Follower continuity policy

Ordinary samples update a position/time/rate anchor. A playing sample must not
become a forced seek merely because the local media was paused. New-document
catch-up, explicit host controls and member catch-up retain their existing
one-shot force metadata.

Thresholds scale with the host rate, so they represent equivalent elapsed time:

- Small drift enters correction beyond 450ms with repeated fresh observations.
  Hold one 8% correction rate; do not descend a ladder of correction speeds.
  Finish with approximately 150ms of lead to absorb native HLS rate-restoration
  cost, then observe at base rate for three seconds. Interrupted corrections
  back off for ten seconds. Acceleration requires at least one second of
  buffered runway; cached alignment still requires two seconds at the target.
- Automatic hard alignment normally needs about two seconds of persistent
  error and stable real media progress. At the playback-rate limits, a smaller
  persistent error has a bounded fallback because rate correction cannot catch
  up. A loading callback alone never authorizes a sub-second jump.
  Large leads also align when the target is buffered; outside the buffer they
  slow down until the host catches up instead of reloading earlier media.
- Cached and loading alignments share two automatic attempts, at least ten
  seconds apart. Only thirty seconds of stable alignment at the host rate can
  replenish the budget; ordinary heartbeats and our own callbacks cannot.
  After those attempts, a forward lag above two seconds can still converge at
  the fixed correction rate when real progress, buffered runway and rate limits
  permit. Exhaustion must neither grant more seeks nor strand a recoverable lag.
- Paused legacy desktop scrubs retain a separate three-second cooldown. Their
  media clock cannot advance to release the playing seek-progress guard.

These are tested policy parameters, not a promise of frame or audio alignment
on every website. Preserve tests with real seek/rate re-clocking costs and
bounded deficient-buffer behavior. Validate both continuity and convergence
before tightening thresholds or adding new retries.

## Playback clock measurement

`../utils/playback-sync.ts` can now convert host sample timestamps into the
member's clock using optional four-timestamp measurements on the existing
directed sync requests. Mobile and Web host responders provide the timing;
the server forwards the optional fields without requiring a protocol upgrade.
Three compatible, independently correlated low-delay exchanges are required.
Host sampling/bridge processing is removed from network round-trip time.
Legacy peers, missing monotonic clocks and untrusted measurements retain the
fastest-path fallback. Room/host/media changes, disconnects and clock
discontinuities invalidate measurements. This changes the anchor's accuracy,
not the continuity thresholds or seek budget above.

Expiry of the precise clock estimate keeps the valid fastest-path baseline;
relearning it on a slow path would introduce an artificial target step. Rejected
future timestamps must not modify that baseline. Replies carrying an unknown
timing request ID are discarded together with their position; replies without
the optional timing fields retain the legacy path.

See `docs/testing/2026-10-28-mobile-clock-sync.md` at the repository root for
parameters, compatibility, validation and the residual path-asymmetry limit.
