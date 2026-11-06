import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { homeConfigDependencies, observeHomeNetwork } from '../services/home-config';
import { HomeConfigClient } from '../services/home-config-client';

export function useHomeConfig(visible: boolean) {
  const [client] = useState(() => new HomeConfigClient(homeConfigDependencies()));
  const [snapshot, setSnapshot] = useState(client.getSnapshot);

  useEffect(() => {
    const unsubscribe = client.subscribe(() => setSnapshot(client.getSnapshot()));
    client.loadCache();
    setSnapshot(client.getSnapshot());
    return () => { unsubscribe(); client.dispose(); };
  }, [client]);

  useEffect(() => {
    if (!visible) { client.setActive(false); return; }
    client.setActive(AppState.currentState === 'active' || AppState.currentState == null);
    const app = AppState.addEventListener('change', state => client.setActive(state === 'active'));
    const stopNetwork = observeHomeNetwork(client.recover);
    return () => { app.remove(); stopNetwork(); client.setActive(false); };
  }, [client, visible]);

  return { ...snapshot, retry: client.retry };
}
