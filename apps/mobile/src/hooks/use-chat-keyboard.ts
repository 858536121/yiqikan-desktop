import { useEffect, useRef, useState } from 'react';
import { Dimensions, Keyboard, Platform, type KeyboardEvent, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function useChatKeyboard(active: boolean, onHide?: () => void) {
  const { bottom: bottomInset } = useSafeAreaInsets();
  const [layoutHeight, setLayoutHeight] = useState(0);
  const [keyboardTop, setKeyboardTop] = useState<number | null>(null);
  const bottomInsetRef = useRef(bottomInset);
  bottomInsetRef.current = bottomInset;
  const onHideRef = useRef(onHide);
  onHideRef.current = onHide;
  const ios = Platform.OS === 'ios';

  useEffect(() => {
    if (!active) {
      setKeyboardTop(null);
      return;
    }
    let wasShown = false;
    const updateFrame = (event: KeyboardEvent) => {
      const { screenY, height } = event.endCoordinates;
      // iOS reports keyboard frames in window coordinates.
      const viewportHeight = Dimensions.get(ios ? 'window' : 'screen').height;
      // Android's keyboard height excludes the system navigation bar. The inset
      // also covers devices that report an unoccluded visible frame in screenY.
      const top = ios ? screenY : Math.min(screenY, viewportHeight - height - bottomInsetRef.current);
      const visible = height > 0 && top < viewportHeight;
      wasShown ||= visible;
      if (ios) {
        // Fabric treats UIKit's unnamed keyboard curve as linear. Ease out to
        // keep up with its faster initial motion while retaining its duration.
        Keyboard.scheduleLayoutAnimation(event.easing === 'keyboard' ? { ...event, easing: 'easeOut' } : event);
      }
      // A floating iPad keyboard can move through the middle of the window.
      const docked = !ios || screenY + height >= viewportHeight - 1;
      setKeyboardTop(visible && docked ? top : null);
    };
    const frame = Keyboard.addListener(ios ? 'keyboardWillChangeFrame' : 'keyboardDidShow', updateFrame);
    const hide = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardTop(null);
      if (wasShown) onHideRef.current?.();
      wasShown = false;
    });
    return () => { frame.remove(); hide.remove(); };
  }, [active, ios]);

  const onLayout = ({ nativeEvent }: LayoutChangeEvent) => setLayoutHeight(nativeEvent.layout.height);
  const visible = active && keyboardTop !== null;
  return { onLayout, visible, bottomInset, inset: visible ? Math.max(0, layoutHeight - keyboardTop) : 0 };
}
