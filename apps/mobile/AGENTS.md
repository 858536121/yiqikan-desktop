# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

## Shared UI

For new app actions and choice sheets, start with `AppButton`, `AppIconButton`, `AppActionRow`, and `AppActionSheet` in `src/components/app/app-ui.tsx`. Their control colors live in `src/theme/colors.ts`. Keep one visually primary action per action group. In the watching tab, use the playback slot in `BrowserToolbar` for temporary actions that replace playback controls, such as saving to a watchlist.
