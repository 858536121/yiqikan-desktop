import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useUpdates } from 'expo-updates';
import { automaticUpdates } from '../../services/automatic-updates';

export function AutomaticUpdateManager() {
  const state = useUpdates();
  useEffect(() => {
    automaticUpdates.appState(AppState.currentState === 'active');
    automaticUpdates.start();
    const subscription = AppState.addEventListener('change', next => automaticUpdates.appState(next === 'active'));
    return () => { subscription.remove(); automaticUpdates.stop(); };
  }, []);
  useEffect(() => {
    automaticUpdates.updateNative({
      startupRunning: state.isStartupProcedureRunning, checking: state.isChecking,
      downloading: state.isDownloading, pending: state.isUpdatePending,
      restartCount: state.restartCount,
      checkedAt: state.lastCheckForUpdateTimeSinceRestart?.getTime(),
      manifest: state.downloadedUpdate?.manifest || state.availableUpdate?.manifest,
    });
  }, [state.isStartupProcedureRunning, state.isChecking, state.isDownloading, state.isUpdatePending,
    state.restartCount, state.lastCheckForUpdateTimeSinceRestart, state.downloadedUpdate, state.availableUpdate]);
  return null;
}
