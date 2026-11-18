import React, { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';
import { BackHandler, Platform, StyleSheet, View } from 'react-native';

const ChatComposerContext = createContext<React.Dispatch<React.SetStateAction<React.ReactNode>> | null>(null);

export function ChatComposerHost({ children }: React.PropsWithChildren) {
  const [composer, setComposer] = useState<React.ReactNode>(null);
  if (Platform.OS !== 'android') return <>{children}</>;
  return (
    <ChatComposerContext.Provider value={setComposer}>
      <View style={styles.content} importantForAccessibility={composer ? 'no-hide-descendants' : 'auto'}>
        {children}
      </View>
      {composer}
    </ChatComposerContext.Provider>
  );
}

// Keep the composer in the Activity window so React Native can observe its IME insets.
export function AndroidChatComposer({ visible, onShow, onRequestClose, children, testID }: React.PropsWithChildren<{
  visible: boolean;
  onShow: () => void;
  onRequestClose: () => void;
  testID?: string;
}>) {
  const setComposer = useContext(ChatComposerContext);
  const presented = useRef(false);
  const close = useRef(onRequestClose);
  close.current = onRequestClose;
  useLayoutEffect(() => {
    if (!setComposer || !visible) return;
    return () => {
      presented.current = false;
      setComposer(null);
    };
  }, [setComposer, visible]);
  useLayoutEffect(() => {
    if (!setComposer || !visible) return;
    setComposer(
      <View style={styles.overlay} testID={testID} onLayout={() => {
        if (presented.current) return;
        presented.current = true;
        onShow();
      }}>
        {children}
      </View>,
    );
  }, [children, onShow, setComposer, testID, visible]);
  useLayoutEffect(() => {
    if (!visible) return;
    const back = BackHandler.addEventListener('hardwareBackPress', () => {
      close.current();
      return true;
    });
    return () => back.remove();
  }, [visible]);
  return null;
}

const styles = StyleSheet.create({
  content: { flex: 1 },
  overlay: { ...StyleSheet.absoluteFill, zIndex: 40 },
});
