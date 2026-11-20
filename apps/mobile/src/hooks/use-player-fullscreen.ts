import { useEffect } from 'react';
import { AppState, Keyboard, NativeModules, Platform, StatusBar } from 'react-native';
import * as ScreenOrientation from 'expo-screen-orientation';

// The optional method keeps OTA bundles compatible with older Android binaries.
function setNavigationFullscreen(enabled: boolean) {
  if (Platform.OS !== 'android') return;
  const bridge = NativeModules.YiqikanPlayerDevice;
  if (bridge?.setFullscreen) {
    void bridge.setFullscreen(enabled).catch((error: unknown) => console.warn('Player navigation bar:', error));
  }
}

export function usePlayerFullscreen(enabled: boolean) {
  useEffect(() => {
    let disposed = false;
    const applyBars = () => {
      if (disposed) return;
      StatusBar.setHidden(enabled, 'fade');
      setNavigationFullscreen(enabled);
    };
    const applyOrientation = () => {
      applyBars();
      void ScreenOrientation.lockAsync(enabled
        ? ScreenOrientation.OrientationLock.LANDSCAPE
        : ScreenOrientation.OrientationLock.PORTRAIT_UP)
        .then(applyBars)
        .catch(error => console.warn('Player orientation:', error));
    };

    if (enabled) Keyboard.dismiss();
    applyOrientation();
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') applyOrientation();
    });
    // Input and native dialogs can reveal system bars while fullscreen stays on.
    const keyboard = Keyboard.addListener('keyboardDidHide', () => {
      if (enabled) applyBars();
    });
    return () => { disposed = true; appState.remove(); keyboard.remove(); };
  }, [enabled]);

  useEffect(() => () => {
    setNavigationFullscreen(false);
    StatusBar.setHidden(false, 'fade');
    void ScreenOrientation.unlockAsync().catch(error => console.warn('Player orientation cleanup:', error));
  }, []);
}
