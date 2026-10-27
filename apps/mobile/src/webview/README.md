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
