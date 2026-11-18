import { useCallback, useEffect, useRef, useState } from 'react';
import { DeviceEventEmitter, NativeModules, Platform } from 'react-native';

const bridge = Platform.OS === 'android' ? NativeModules.YiqikanPlayerDevice : undefined;
export const androidAutoPictureInPicture = Platform.OS === 'android' && Number(Platform.Version) >= 31;
export const readAndroidPictureInPicture = () => bridge?.isPictureInPictureActive?.() as Promise<boolean> | undefined;

export function usePictureInPicture(autoEnter: boolean) {
  const [active, setActive] = useState(false);
  const [supported, setSupported] = useState(Platform.OS === 'ios');
  const activeRef = useRef(false);

  const update = useCallback((value: boolean) => {
    activeRef.current = value;
    setActive(value);
  }, []);

  useEffect(() => {
    if (!bridge?.isPictureInPictureActive) return;
    const listener = DeviceEventEmitter.addListener('YiqikanPictureInPictureChanged', update);
    return () => {
      listener.remove();
      void bridge.setPictureInPictureEnabled?.(false).catch(() => {});
    };
  }, [update]);

  useEffect(() => {
    if (!bridge?.setPictureInPictureEnabled) return;
    let mounted = true;
    void bridge.setPictureInPictureEnabled(autoEnter).then((value: boolean) => {
      if (mounted) setSupported(value);
    }).catch(() => {
      if (mounted) setSupported(false);
    });
    return () => { mounted = false; };
  }, [autoEnter]);

  return {
    active, activeRef, supported,
    onWebMode: update,
    enterAndroid: () => bridge?.enterPictureInPicture?.() as Promise<boolean> | undefined,
  };
}
