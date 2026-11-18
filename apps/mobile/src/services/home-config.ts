import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { resolveWebUrl } from './environment';
import { otaService } from './ota-service';

export function homeConfigDependencies() {
  return {
    platform: Platform.OS === 'ios' ? 'ios' : 'android',
    appVersion: otaService.getBaseAppVersion(),
    webUrl: resolveWebUrl(), storage: AsyncStorage,
    fetch: (url: string, init?: RequestInit) => fetch(url, init),
  };
}

export function observeHomeNetwork(recover: () => void): () => void {
  // OTA can reach binaries built before ExpoNetwork was linked. Keep cache,
  // foreground recovery, timed retries and the retry button working there too.
  try {
    if (!requireOptionalNativeModule('ExpoNetwork')) return () => {};
    const network = require('expo-network') as typeof import('expo-network');
    let active = true;
    let revision = 0;
    let previous = '';
    const accept = (state: import('expo-network').NetworkState) => {
      if (!active) return;
      const signature = `${state.type}:${state.isConnected}:${state.isInternetReachable}`;
      if (signature === previous) return;
      previous = signature;
      if (state.isConnected === true && state.isInternetReachable !== false) recover();
    };
    const subscription = network.addNetworkStateListener(state => { revision++; accept(state); });
    // Subscribe before sampling; a delayed initial sample must not undo a newer event.
    void network.getNetworkStateAsync().then(state => { if (!revision) accept(state); }).catch(() => {});
    return () => { active = false; subscription.remove(); };
  } catch {
    return () => {};
  }
}
