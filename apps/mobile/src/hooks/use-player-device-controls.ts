import { useEffect, useRef, useState } from 'react';
import { AppState, NativeModules } from 'react-native';
import { PlayerDeviceSession, type DeviceSetting, type PlayerDeviceBridge, type PlayerDeviceState } from '../services/player-device-session';

export function usePlayerDeviceControls(enabled: boolean) {
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [resumeVersion, setResumeVersion] = useState(0);
  const [state, setState] = useState<PlayerDeviceState | null>(null);
  const [failure, setFailure] = useState<DeviceSetting | null>(null);
  const session = useRef<PlayerDeviceSession | null>(null);
  useEffect(() => {
    const listener = AppState.addEventListener('change', next => {
      if (next !== 'active') { session.current?.end(); session.current = null; }
      // Android can suspend rendering between these notifications. Even if
      // inactive -> active is batched back to the same boolean, reopen the
      // session that was synchronously ended above.
      else setResumeVersion(version => version + 1);
      setActive(next === 'active');
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    setState(null); setFailure(null);
    const bridge = NativeModules.YiqikanPlayerDevice as PlayerDeviceBridge | undefined;
    if (!enabled || !active || !bridge?.begin || !bridge.read || !bridge.setBrightness || !bridge.setVolume || !bridge.end) return;
    const control = new PlayerDeviceSession(bridge, setState, setFailure);
    session.current = control;
    void control.start();
    const timer = setInterval(() => { void control.poll(); }, 400);
    return () => { clearInterval(timer); control.end(); if (session.current === control) session.current = null; };
  }, [enabled, active, resumeVersion]);
  return { state: enabled && active ? state : null, active, failure,
    set(setting: DeviceSetting, value: number) { session.current?.set(setting, value); },
    flush() { session.current?.flush(); },
  };
}
